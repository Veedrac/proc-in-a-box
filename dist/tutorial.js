(function () {
'use strict';

class Gpu {
    constructor(canvas) {
        const gl = canvas.getContext("webgl2", {"antialias": false});
        if (!gl) {
            throw new Error("WebGL2 not supported");
        }
        this.gl = gl;
        this.syncQueue = [];
    }

    compileShader(shaderSource, kind) {
        const shader = this.gl.createShader(kind);
        this.gl.shaderSource(shader, shaderSource);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            throw new Error("Shader compilation failed:\n\t" + this.gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    createProgram(vertexShader, fragmentShader) {
        const program = this.gl.createProgram();

        this.gl.attachShader(program, this.compileShader(vertexShader, this.gl.VERTEX_SHADER));
        this.gl.attachShader(program, this.compileShader(fragmentShader, this.gl.FRAGMENT_SHADER));
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            throw new Error("Program linking failed:\n\t" + this.gl.getProgramInfoLog(program));
        }
        return program;
    }

    textureCreateAndBind([width, height], internalformat, format, type, pixels, disableInterpolation=true) {
        const texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, internalformat, width, height, 0, format, type, pixels);

        if (disableInterpolation) {
            this.textureDisableInterpolation();
        }

        // TODO: Error handling
        return texture;
    }

    textureDisableInterpolation() {
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    }

    sync() {
        let newSync = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (this.syncQueue.length > 3) {
            let s = this.syncQueue.shift();
            while(this.gl.clientWaitSync(s, 0, 0) == this.gl.TIMEOUT_EXPIRED) {}
            this.gl.deleteSync(s);
        }
        this.syncQueue.push(newSync);
    }
}

const getKind = function(data, idx) {
    const r = data[idx + 0];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const rgb = (r << 16) | (g << 8) | (b << 0);

    // LineLogic 2 includes protection and
    // goals. Protection and wires are orthogonal,
    // whereas a goal is *always* accompanied
    // by a protected wire.
    //
    // Goals do not seem worth the implementation
    // effort; avoiding any cost to the GPU
    // iteration is likely to be non-trivial.
    // Protection is easy, but I'm unconvinced
    // that it's worthwhile, and it would be
    // deprecated by a higher-level UI anyway.

    // no signal (wire, goal, protected wire)
    if ((rgb === 0x0080FF) || rgb === 0x800000 || rgb === 0x00FFFF) {
        return 0b01;
    }

    // signal, any direction (wire or goal, protected wire)
    if ((rgb & 0xFF7FF0) === 0xFF0000 || (rgb & 0xFFFFF0) === 0xFFFF00) {
        return 0b11;
    }

    // no wire, anything else
    return 0b00;
};

const imageToGpuRepresentation = function(data, width, height, numWires) {
    const worker = new Worker("dist/gpu-wires-decoder.worker.js");

    const promise = new Promise(function(resolve) {
        worker.onmessage = function(event) {
            const [kind, data] = event.data;
            if (kind === "frame") {
                document.getElementById("fps").innerHTML = data;
            }
            else if (kind === "finish") {
                resolve(data);
            }
            else {
                console.log("Unknown response from Web Worker: ");
                console.log(event);
            }
        };
    });

    worker.postMessage([data, width, height, numWires], [data.buffer]);
    return promise;
};

const bootstrapInner = function(img) {
    const width = img.naturalWidth;
    const height = img.naturalHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error("Canvas2D not supported");
    }

    context.drawImage(img, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;

    let numWires = 0;
    const predecoded = new Uint8Array((width + 2) * (height + 2));
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            const kind = getKind(pixels, (i + (height - 1 - j) * width) * 4);
            numWires += kind === 0 ? 0 : 1;
            predecoded[(i + 1) + (j + 1) * (width + 2)] = kind;
            predecoded[(i + 1) + (j + 1) * (width + 2)] = kind;
        }
    }

    return [predecoded, width, height, numWires];
};

const bootstrapFromImageTag = function(img) {
    // Extract to allow collections of temporaries.
    const [predecoded, width, height, numWires] = bootstrapInner(img);
    return imageToGpuRepresentation(predecoded, width, height, numWires);
};


var gpuWiresDecoder = Object.freeze({
	bootstrapFromImageTag: bootstrapFromImageTag
});

const vs = `#version 300 es
    precision mediump float;
    precision mediump int;

    in vec2 a_triangleCoordinates;

    void main() {
      gl_Position = vec4(a_triangleCoordinates, 0, 1);
    }
`;

const renderFs = `#version 300 es
    precision mediump float;
    precision mediump int;

    uniform highp float u_scale;
    uniform highp vec2 u_offset;

    uniform lowp    usampler2D u_wireStates;
    uniform mediump usampler2D u_imageDecoder;
    uniform mediump usampler2D u_imageDecoderExtra;
    out vec4 color;

    bool wireState(uint idx) {
        idx &= 0x7FFFFFFFu;
        uint subidx = idx & 7u;
        idx >>= 3u;

        return (texelFetch(u_wireStates, ivec2(idx & 127u, idx >> 7u), 0).r & (1u << subidx)) > 0u;
    }

    void main() {
        vec2 where = gl_FragCoord.xy * u_scale + u_offset;
        uint x = uint(where.x);
        uint y = uint(where.y);

        uint wireIdx1 = texelFetch(u_imageDecoder, ivec2(x, y), 0).r;
        if (wireIdx1 == 0u) {
            if ((x & 31u) == 0u || (y & 31u) == 0u) {
                color = vec4(0.9, 0.9, 0.9, 1);
                return;
            } else {
                color = vec4(1.0, 1.0, 1.0, 1);
                return;
            }
        }

        uint luminance = wireState(wireIdx1) ? 2u : 0u;

        if ((wireIdx1 & 0x80000000u) != 0u) {
            uint wireIdx2 = texelFetch(u_imageDecoderExtra, ivec2(x >> 2u, y), 0).r;
            luminance = (luminance >> 1u) + (wireState(wireIdx2) ? 1u : 0u);
        }

        if (luminance == 2u) {
            color = vec4(1.0, 0, 0, 1);
        } else if (luminance == 1u) {
            color = vec4(0.71, 0.35, 0.71, 1);
        } else {
            color = vec4(0.0, 0.5, 1.0, 1);
        }
    }
`;

const stepFs = `#version 300 es
    precision mediump float;
    precision mediump int;

    uniform lowp usampler2D u_wireStates;
    uniform mediump usampler2D u_incomingWires;
    uniform mediump usampler2D u_incomingWireGroupsOff;
    uniform lowp    usampler2D u_incomingWireGroupsLen;

    out lowp uint color;

    void main() {
        uint x = uint(gl_FragCoord.x) << 3u;
        uint y = uint(gl_FragCoord.y);

        color = 0u;

        uint wireGroup   = uint(texelFetch(u_incomingWireGroupsOff, ivec2(x >> 3u, y), 0).r);
        for (uint subwire = 0u; subwire < 8u; subwire++, x++) {
            uint groupLength = uint(texelFetch(u_incomingWireGroupsLen, ivec2(x, y), 0).r);

            for (uint i = 0u; i < groupLength; i++) {
                uint idx = wireGroup + i;
                uint wireIdx = texelFetch(u_incomingWires, ivec2(idx & 1023u, idx >> 10u), 0).r;

                uint subidx = wireIdx & 7u;
                wireIdx >>= 3;

                uint texel = texelFetch(u_wireStates, ivec2(wireIdx & 127u, wireIdx >> 7u), 0).r;
                if (!((texel & (1u << subidx)) > 0u)) {
                    color |= 1u << subwire;
                    break;
                }
            }

            wireGroup += groupLength;
        }
    }
`;

class GpuWiresRenderer {
    constructor(ctx) {
        this.ctx = ctx;

        this.sync = [];
        this.n = 0;
        this.t = performance.now();
    }

    async initialize(width, height, graph) {
        const gl = this.ctx.gl;
        this.width = width;
        this.height = height;
        this.numWires = graph.wireStates.length;

        if (!gl.getExtension("EXT_color_buffer_float")) {
            alert("Floating point textures not supported!");
        }
        gl.disable(gl.BLEND);

        this.renderProgram         = this.ctx.createProgram(vs, renderFs);
        this.a_triangleCoordinates = gl.getAttribLocation (this.renderProgram, "a_triangleCoordinates");
        this.u_render_scale        = gl.getUniformLocation(this.renderProgram, "u_scale");
        this.u_render_offset       = gl.getUniformLocation(this.renderProgram, "u_offset");
        this.u_render_wireStates   = gl.getUniformLocation(this.renderProgram, "u_wireStates");
        this.u_render_imageDecoder = gl.getUniformLocation(this.renderProgram, "u_imageDecoder");
        this.u_render_imageDecoderExtra = gl.getUniformLocation(this.renderProgram, "u_imageDecoderExtra");

        this.stepProgram           = this.ctx.createProgram(vs, stepFs);
        this.u_step_wireStates     = gl.getUniformLocation(this.stepProgram, "u_wireStates");
        this.u_step_incomingWires  = gl.getUniformLocation(this.stepProgram, "u_incomingWires");
        this.u_step_incomingWireGroupsOff = gl.getUniformLocation(this.stepProgram, "u_incomingWireGroupsOff");
        this.u_step_incomingWireGroupsLen = gl.getUniformLocation(this.stepProgram, "u_incomingWireGroupsLen");
        this.framebuffer = gl.createFramebuffer();


        let textureId = 0;

        gl.activeTexture(gl.TEXTURE0 + textureId);
        this.ctx.textureCreateAndBind(
            [width, height], gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, graph.imageDecoder
        );
        this.imageDecoderIdx = textureId;
        textureId++;

        gl.activeTexture(gl.TEXTURE0 + textureId);
        this.ctx.textureCreateAndBind(
            [Math.ceil(width >> 2), height], gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, graph.imageDecoderExtra
        );
        this.imageDecoderExtraIdx = textureId;
        textureId++;

        gl.activeTexture(gl.TEXTURE0 + textureId);
        this.ctx.textureCreateAndBind(
            [1024, graph.incomingWires.length >> 10], gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, graph.incomingWires
        );
        this.incomingWiresIdx = textureId;
        textureId++;

        gl.activeTexture(gl.TEXTURE0 + textureId);
        this.ctx.textureCreateAndBind(
            [128, graph.incomingWireGroupsOff.length >> 7], gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, graph.incomingWireGroupsOff
        );
        this.incomingWireGroupsOffIdx = textureId;
        textureId++;

        gl.activeTexture(gl.TEXTURE0 + textureId);
        this.ctx.textureCreateAndBind(
            [1024, graph.incomingWireGroupsLen.length >> 10], gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, graph.incomingWireGroupsLen
        );
        this.incomingWireGroupsLenIdx = textureId;
        textureId++;

        gl.activeTexture(gl.TEXTURE0 + textureId);
        this.wireStatesCurrTex = this.ctx.textureCreateAndBind(
            [128, graph.wireStates.length >> 7], gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(graph.wireStates)
        );
        this.wireStatesCurrIdx = textureId;
        textureId++;

        gl.activeTexture(gl.TEXTURE0 + textureId);
        this.wireStatesNextTex = this.ctx.textureCreateAndBind(
            [128, graph.wireStates.length >> 7], gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, null
        );
        this.wireStatesNextIdx = textureId;
        textureId++;

        const triangleCovering = new Float32Array([
            -1.0, -1.0,   3.0, -1.0,  -1.0,  3.0,
        ]);
        const triangleCoveringBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, triangleCoveringBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, triangleCovering, gl.STATIC_DRAW);
        gl.vertexAttribPointer(this.a_triangleCoordinates, 2, gl.FLOAT, false, 0, 0); // TODO: Type safety
        gl.enableVertexAttribArray(this.a_triangleCoordinates); // TODO: Type safety
    };

    render(scale, offset) { // TODO: This is getting refactored anyway
        const gl = this.ctx.gl;

        gl.useProgram(this.renderProgram);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.uniform1f(this.u_render_scale, scale);
        gl.uniform2f(this.u_render_offset, ...offset);
        gl.uniform1i(this.u_render_wireStates, this.wireStatesCurrIdx);
        gl.uniform1i(this.u_render_imageDecoder, this.imageDecoderIdx);
        gl.uniform1i(this.u_render_imageDecoderExtra, this.imageDecoderExtraIdx);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.useProgram(this.stepProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, 128, this.numWires >> 7);
        gl.uniform1i(this.u_step_incomingWires, this.incomingWiresIdx);
        gl.uniform1i(this.u_step_incomingWireGroupsOff, this.incomingWireGroupsOffIdx);
        gl.uniform1i(this.u_step_incomingWireGroupsLen, this.incomingWireGroupsLenIdx);
    }

    step() {
        const gl = this.ctx.gl;

        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.wireStatesNextTex, 0);
        gl.uniform1i(this.u_step_wireStates, this.wireStatesCurrIdx);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        [this.wireStatesCurrTex, this.wireStatesNextTex] = [this.wireStatesNextTex, this.wireStatesCurrTex];
        [this.wireStatesCurrIdx, this.wireStatesNextIdx] = [this.wireStatesNextIdx, this.wireStatesCurrIdx];
    }
}

const decoder = gpuWiresDecoder;
const Renderer = GpuWiresRenderer;

class Frame {
    constructor(ctx, renderer) {
        this.ctx = ctx;
        this.renderer = renderer;
    }

    static async load(img) {
        const [width, height] = [img.naturalWidth, img.naturalHeight];

        const canvas = document.createElement('canvas');
        canvas.width = width / 10;
        canvas.height = height / 10;
        canvas.style.width = (img.width / 10).toString();
        canvas.style.height = (img.height / 10).toString();

        const ctx = new Gpu(canvas);

        const subState = await decoder.bootstrapFromImageTag(img);
        const subRenderer = new Renderer(ctx);
        subRenderer.initialize(width, height, subState);

        const frame = new Frame(ctx, subRenderer);
        frame.render();

        return {canvas, frame};
    }

    render() {
        this.renderer.render(1, [0, 0]);
        this.ctx.sync();
    }

    update() {
        this.renderer.step();
    }
}

class Engine {
    constructor() {
        this.frames = [];
    }

    async load(img) {
        const {canvas, frame} = await Frame.load(img);
        img.replaceWith(canvas);
        this.frames.push(frame);
    }

    render() {
        for (let frame of this.frames) {
            frame.render();
        }
    }

    update() {
        for (let frame of this.frames) {
            frame.update();
        }
    }
}

const engine = new Engine();

const linelogic_area = document.getElementsByClassName("linelogic");
for (var i = 0; i < linelogic_area.length; i++) {
    const area = linelogic_area[i];
    if (!(area instanceof HTMLImageElement)) {
        continue;
    }

    if (area.complete) {
        setTimeout(() => engine.load(area), 0);
    } else {
        area.onload = () => engine.load(area);
    }
}

const renderAll = function() {
    engine.render();
    requestAnimationFrame(renderAll);
};
requestAnimationFrame(renderAll);

const update = function(deadline) {
    engine.update();
    requestIdleCallback(update);
};
requestIdleCallback(update);

}());
//# sourceMappingURL=tutorial.js.map
