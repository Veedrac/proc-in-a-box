"use strict";
System.register("backends/gpu", [], function (exports_1, context_1) {
    "use strict";
    var __moduleName = context_1 && context_1.id;
    var Gpu;
    return {
        setters: [],
        execute: function () {
            Gpu = class Gpu {
                constructor(canvas) {
                    this.gl = canvas.getContext("webgl2", { "antialias": false });
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
                textureCreateAndBind([width, height], internalformat, format, type, pixels, disableInterpolation = true) {
                    const texture = this.gl.createTexture();
                    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
                    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, internalformat, width, height, 0, format, type, pixels);
                    if (disableInterpolation) {
                        this.textureDisableInterpolation();
                    }
                    return texture;
                }
                textureDisableInterpolation() {
                    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
                    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
                    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
                    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
                }
            };
            exports_1("Gpu", Gpu);
            ;
        }
    };
});
System.register("utils/setZeroTimeout", [], function (exports_2, context_2) {
    "use strict";
    var __moduleName = context_2 && context_2.id;
    function setZeroTimeout(fn) {
        timeouts.push(fn);
        window.postMessage(messageName, "*");
    }
    exports_2("setZeroTimeout", setZeroTimeout);
    function handleMessage(event) {
        if (event.source === window && event.data === messageName) {
            event.stopPropagation();
            if (timeouts.length > 0) {
                const fn = timeouts.shift();
                fn();
            }
        }
    }
    function pause() {
        return new Promise(resolve => setZeroTimeout(resolve));
    }
    exports_2("pause", pause);
    var timeouts, messageName;
    return {
        setters: [],
        execute: function () {
            timeouts = [];
            messageName = "zero-timeout-message";
            window.addEventListener("message", handleMessage, true);
        }
    };
});
System.register("backends/gpu-wires-decoder", ["utils/setZeroTimeout"], function (exports_3, context_3) {
    "use strict";
    var __moduleName = context_3 && context_3.id;
    function getKind(data, idx) {
        const r = data[idx + 0];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const rgb = (r << 16) | (g << 8) | (b << 0);
        if ((rgb === 0x0080FF) || rgb === 0x800000 || rgb === 0x00FFFF) {
            return 0b01;
        }
        if ((rgb & 0xFF7FF0) === 0xFF0000 || (rgb & 0xFFFFF0) === 0xFFFF00) {
            return 0b11;
        }
        return 0b00;
    }
    async function imageToGpuRepresentation(data, width, height, numWires) {
        const size = width * height;
        numWires = (numWires + 1024) & ~1023;
        let wireStatesN = 1;
        const wireStates = new Uint8Array(numWires);
        let incomingWiresN = 0;
        const incomingWires = new Uint32Array(numWires * 2);
        const incomingWireGroupsOff = new Uint32Array(numWires >> 3);
        const incomingWireGroupsLen = new Uint8Array(numWires);
        const imageDecoder = new Uint32Array(size);
        const imageDecoderExtra = new Uint32Array(Math.ceil(size >> 2));
        function traverseFrom(data, width, height, i, j) {
            const idx = (i + 1) + (j + 1) * (width + 2);
            const kind = data[idx];
            const up = data[idx - (width + 2)] & 1;
            const down = data[idx + (width + 2)] & 1;
            const left = data[idx - 1] & 1;
            const right = data[idx + 1] & 1;
            const numSiblings = up + down + left + right;
            if (numSiblings === 2 || numSiblings === 4) {
                return;
            }
            let wireActive = (kind >> 1) & (numSiblings != 3 ? 1 : 0);
            imageDecoder[i + j * width] = wireStatesN;
            if ((wireStatesN & 7) == 0) {
                incomingWireGroupsOff[wireStatesN >> 3] = incomingWiresN;
            }
            let [m, n] = [i, j];
            let [dm, dn] = [0, 0];
            if (numSiblings === 0) {
                wireStates[wireStatesN] = wireActive;
                wireStatesN++;
                return;
            }
            else if (numSiblings === 1) {
                if (up) {
                    dn = -1;
                }
                else if (down) {
                    dn = +1;
                }
                else if (left) {
                    dm = -1;
                }
                else if (right) {
                    dm = +1;
                }
                else {
                    throw 1;
                }
            }
            else {
                if (!up) {
                    dn = +1;
                }
                else if (!down) {
                    dn = -1;
                }
                else if (!left) {
                    dm = +1;
                }
                else if (!right) {
                    dm = -1;
                }
                else {
                    throw 2;
                }
            }
            while (true) {
                [m, n] = [m + dm, n + dn];
                const mnIdx = m + n * width;
                const straight = data[(m + dm + 1) + (n + dn + 1) * (width + 2)] & 1;
                const left = data[(m - dn + 1) + (n + dm + 1) * (width + 2)] & 1;
                const right = data[(m + dn + 1) + (n - dm + 1) * (width + 2)] & 1;
                if (straight) {
                    if (left && right) {
                        if (dm != 0) {
                            imageDecoderExtra[mnIdx >> 2] = wireStatesN;
                        }
                        else {
                            imageDecoder[mnIdx] = 0x80000000 | wireStatesN;
                        }
                    }
                    else if (left) {
                        incomingWires[incomingWiresN] = mnIdx;
                        incomingWiresN++;
                        incomingWireGroupsLen[wireStatesN]++;
                    }
                    else if (right) {
                        incomingWires[incomingWiresN] = mnIdx;
                        incomingWiresN++;
                        incomingWireGroupsLen[wireStatesN]++;
                    }
                    else {
                        wireActive |= data[(m + 1) + (n + 1) * (width + 2)] >> 1;
                        imageDecoder[mnIdx] = wireStatesN;
                    }
                }
                else if (left === right) {
                    wireActive |= (data[(m + 1) + (n + 1) * (width + 2)] >> 1) & (left ? 0 : 1);
                    imageDecoder[mnIdx] = wireStatesN;
                    wireStates[wireStatesN] = wireActive;
                    wireStatesN++;
                    return;
                }
                else {
                    wireActive |= data[(m + 1) + (n + 1) * (width + 2)] >> 1;
                    imageDecoder[mnIdx] = wireStatesN;
                    if (left) {
                        [dm, dn] = [-dn, +dm];
                    }
                    else {
                        [dm, dn] = [+dn, -dm];
                    }
                }
            }
        }
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                if (!data[(i + 1) + (j + 1) * (width + 2)]) {
                    continue;
                }
                if (imageDecoder[i + j * width] != 0) {
                    continue;
                }
                traverseFrom(data, width, height, i, j);
            }
            if (j % 10 == 0) {
                document.getElementById("fps").innerHTML = j.toString();
                await setZeroTimeout_1.pause();
            }
        }
        function traverseLoopsFrom(data, width, height, i, j) {
            const idx = (i + 1) + (j + 1) * (width + 2);
            const kind = data[idx];
            const up = data[idx - (width + 2)] & 1;
            const down = data[idx + (width + 2)] & 1;
            const left = data[idx - 1] & 1;
            const right = data[idx + 1] & 1;
            const numSiblings = up + down + left + right;
            if (numSiblings !== 2) {
                throw 3;
            }
            let wireActive = kind >> 1;
            imageDecoder[i + j * width] = wireStatesN;
            if ((wireStatesN & 7) == 0) {
                incomingWireGroupsOff[wireStatesN >> 3] = incomingWiresN;
            }
            let [m, n] = [i, j];
            let [dm, dn] = [0, 0];
            if (up) {
                dn = -1;
            }
            else if (down) {
                dn = +1;
            }
            else {
                dm = -1;
            }
            while (true) {
                [m, n] = [m + dm, n + dn];
                const mnIdx = m + n * width;
                if (m == i && n == j) {
                    wireStates[wireStatesN] = wireActive;
                    wireStatesN++;
                    return;
                }
                const straight = data[(m + dm + 1) + (n + dn + 1) * (width + 2)] & 1;
                const left = data[(m - dn + 1) + (n + dm + 1) * (width + 2)] & 1;
                const right = data[(m + dn + 1) + (n - dm + 1) * (width + 2)] & 1;
                if (straight) {
                    if (left && right) {
                        imageDecoderExtra[mnIdx >> 2] = imageDecoder[mnIdx];
                        imageDecoder[mnIdx] = wireStatesN;
                    }
                    else if (left) {
                        incomingWires[incomingWiresN] = mnIdx;
                        incomingWiresN++;
                        incomingWireGroupsLen[wireStatesN]++;
                    }
                    else if (right) {
                        incomingWires[incomingWiresN] = mnIdx;
                        incomingWiresN++;
                        incomingWireGroupsLen[wireStatesN]++;
                    }
                    else {
                        wireActive |= data[(m + 1) + (n + 1) * (width + 2)] >> 1;
                        imageDecoder[mnIdx] = wireStatesN;
                    }
                }
                else if (left === right) {
                    throw 4;
                }
                else {
                    wireActive |= data[(m + 1) + (n + 1) * (width + 2)] >> 1;
                    imageDecoder[mnIdx] = wireStatesN;
                    if (left) {
                        [dm, dn] = [-dn, +dm];
                    }
                    else {
                        [dm, dn] = [+dn, -dm];
                    }
                }
            }
        }
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                if (!data[(i + 1) + (j + 1) * (width + 2)]) {
                    continue;
                }
                if (imageDecoder[i + j * width] != 0) {
                    continue;
                }
                traverseLoopsFrom(data, width, height, i, j);
            }
            if (j % 10 == 0) {
                document.getElementById("fps").innerHTML = j.toString();
                await setZeroTimeout_1.pause();
            }
        }
        for (let i = 0; i < incomingWiresN; i++) {
            incomingWires[i] = imageDecoder[incomingWires[i]];
        }
        let groupStart = 0;
        for (let i = 0; i < wireStatesN; i++) {
            let groupLength = incomingWireGroupsLen[i];
            let incoming = incomingWires.slice(groupStart, groupStart + groupLength);
            incoming.sort();
            incomingWires.set(incoming, groupStart);
            groupStart += groupLength;
        }
        const packedWireStatesN = ((wireStatesN >> 3) + 1023) & ~1023;
        wireStatesN = (wireStatesN + 1023) & ~1023;
        incomingWiresN = (incomingWiresN + 1023) & ~1023;
        let packedWireStates = new Uint8Array(packedWireStatesN);
        for (let i = 0; i < wireStatesN / 8; i++) {
            for (let j = 0; j < 8; j++) {
                packedWireStates[i] |= wireStates[i * 8 + j] << j;
            }
        }
        return {
            wireStates: packedWireStates,
            incomingWires: incomingWires.slice(0, incomingWiresN),
            incomingWireGroupsOff: incomingWireGroupsOff.slice(0, wireStatesN >> 3),
            incomingWireGroupsLen: incomingWireGroupsLen.slice(0, wireStatesN),
            imageDecoder: imageDecoder,
            imageDecoderExtra: imageDecoderExtra
        };
    }
    function bootstrapInner(img) {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
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
    }
    function bootstrapFromImageTag(img) {
        const [predecoded, width, height, numWires] = bootstrapInner(img);
        return imageToGpuRepresentation(predecoded, width, height, numWires);
    }
    exports_3("bootstrapFromImageTag", bootstrapFromImageTag);
    var setZeroTimeout_1;
    return {
        setters: [
            function (setZeroTimeout_1_1) {
                setZeroTimeout_1 = setZeroTimeout_1_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("backends/gpu-wires-renderer", [], function (exports_4, context_4) {
    "use strict";
    var __moduleName = context_4 && context_4.id;
    var vs, renderFs, stepFs, GpuWiresRenderer;
    return {
        setters: [],
        execute: function () {
            vs = `#version 300 es
    precision mediump float;
    precision mediump int;

    in vec2 a_triangleCoordinates;

    void main() {
      gl_Position = vec4(a_triangleCoordinates, 0, 1);
    }
`;
            renderFs = `#version 300 es
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
            stepFs = `#version 300 es
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
            GpuWiresRenderer = class GpuWiresRenderer {
                constructor(ctx) {
                    this.ctx = ctx;
                    this.sync = [];
                    this.n = 0;
                    this.t = performance.now();
                    this.scale = 1;
                    this.mul = 1.003;
                    this.offset = 0;
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
                    this.renderProgram = this.ctx.createProgram(vs, renderFs);
                    this.a_triangleCoordinates = gl.getAttribLocation(this.renderProgram, "a_triangleCoordinates");
                    this.u_render_scale = gl.getUniformLocation(this.renderProgram, "u_scale");
                    this.u_render_offset = gl.getUniformLocation(this.renderProgram, "u_offset");
                    this.u_render_wireStates = gl.getUniformLocation(this.renderProgram, "u_wireStates");
                    this.u_render_imageDecoder = gl.getUniformLocation(this.renderProgram, "u_imageDecoder");
                    this.u_render_imageDecoderExtra = gl.getUniformLocation(this.renderProgram, "u_imageDecoderExtra");
                    this.stepProgram = this.ctx.createProgram(vs, stepFs);
                    this.u_step_wireStates = gl.getUniformLocation(this.stepProgram, "u_wireStates");
                    this.u_step_incomingWires = gl.getUniformLocation(this.stepProgram, "u_incomingWires");
                    this.u_step_incomingWireGroupsOff = gl.getUniformLocation(this.stepProgram, "u_incomingWireGroupsOff");
                    this.u_step_incomingWireGroupsLen = gl.getUniformLocation(this.stepProgram, "u_incomingWireGroupsLen");
                    this.framebuffer = gl.createFramebuffer();
                    let textureId = 0;
                    gl.activeTexture(gl.TEXTURE0 + textureId);
                    this.ctx.textureCreateAndBind([width, height], gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, graph.imageDecoder);
                    this.imageDecoderIdx = textureId;
                    textureId++;
                    gl.activeTexture(gl.TEXTURE0 + textureId);
                    this.ctx.textureCreateAndBind([Math.ceil(width >> 2), height], gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, graph.imageDecoderExtra);
                    this.imageDecoderExtraIdx = textureId;
                    textureId++;
                    gl.activeTexture(gl.TEXTURE0 + textureId);
                    this.ctx.textureCreateAndBind([1024, graph.incomingWires.length >> 10], gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, graph.incomingWires);
                    this.incomingWiresIdx = textureId;
                    textureId++;
                    gl.activeTexture(gl.TEXTURE0 + textureId);
                    this.ctx.textureCreateAndBind([128, graph.incomingWireGroupsOff.length >> 7], gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, graph.incomingWireGroupsOff);
                    this.incomingWireGroupsOffIdx = textureId;
                    textureId++;
                    gl.activeTexture(gl.TEXTURE0 + textureId);
                    this.ctx.textureCreateAndBind([1024, graph.incomingWireGroupsLen.length >> 10], gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, graph.incomingWireGroupsLen);
                    this.incomingWireGroupsLenIdx = textureId;
                    textureId++;
                    gl.activeTexture(gl.TEXTURE0 + textureId);
                    this.wireStatesCurrTex = this.ctx.textureCreateAndBind([128, graph.wireStates.length >> 7], gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(graph.wireStates));
                    this.wireStatesCurrIdx = textureId;
                    textureId++;
                    gl.activeTexture(gl.TEXTURE0 + textureId);
                    this.wireStatesNextTex = this.ctx.textureCreateAndBind([128, graph.wireStates.length >> 7], gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, null);
                    this.wireStatesNextIdx = textureId;
                    textureId++;
                    const triangleCovering = new Float32Array([
                        -1.0, -1.0, 3.0, -1.0, -1.0, 3.0,
                    ]);
                    const triangleCoveringBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, triangleCoveringBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, triangleCovering, gl.STATIC_DRAW);
                    gl.vertexAttribPointer(this.a_triangleCoordinates, 2, gl.FLOAT, false, 0, 0);
                    gl.enableVertexAttribArray(this.a_triangleCoordinates);
                }
                ;
                animate(now = null) {
                    const gl = this.ctx.gl;
                    gl.useProgram(this.renderProgram);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.viewport(0, 0, this.width, this.height);
                    gl.uniform1f(this.u_render_scale, this.scale);
                    gl.uniform2f(this.u_render_offset, this.offset, this.offset);
                    gl.uniform1i(this.u_render_wireStates, this.wireStatesCurrIdx);
                    gl.uniform1i(this.u_render_imageDecoder, this.imageDecoderIdx);
                    gl.uniform1i(this.u_render_imageDecoderExtra, this.imageDecoderExtraIdx);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    this.offset += 4 * this.scale;
                    this.scale *= this.mul;
                    if (this.scale > 1) {
                        this.mul = 0.9999 / this.mul;
                    }
                    else if (this.scale < 0.1) {
                        this.mul = 1.0001 / this.mul;
                    }
                    gl.useProgram(this.stepProgram);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
                    gl.viewport(0, 0, 128, this.numWires >> 7);
                    gl.uniform1i(this.u_step_incomingWires, this.incomingWiresIdx);
                    gl.uniform1i(this.u_step_incomingWireGroupsOff, this.incomingWireGroupsOffIdx);
                    gl.uniform1i(this.u_step_incomingWireGroupsLen, this.incomingWireGroupsLenIdx);
                }
                step() {
                    const gl = this.ctx.gl;
                    this.n++;
                    let now = performance.now();
                    if (now - this.t > 100) {
                        document.getElementById("fps").innerHTML = (Number.parseFloat(document.getElementById("fps").innerHTML) / 2 + this.n * (1000 / (now - this.t)) / 2).toString();
                        this.t = now;
                        this.n = 0;
                    }
                    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.wireStatesNextTex, 0);
                    gl.uniform1i(this.u_step_wireStates, this.wireStatesCurrIdx);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    [this.wireStatesCurrTex, this.wireStatesNextTex] = [this.wireStatesNextTex, this.wireStatesCurrTex];
                    [this.wireStatesCurrIdx, this.wireStatesNextIdx] = [this.wireStatesNextIdx, this.wireStatesCurrIdx];
                    let newSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
                    if (this.sync.length > 3) {
                        let s = this.sync.shift();
                        while (gl.clientWaitSync(s, 0, 0) == gl.TIMEOUT_EXPIRED) { }
                        gl.deleteSync(s);
                    }
                    this.sync.push(newSync);
                }
            };
            exports_4("GpuWiresRenderer", GpuWiresRenderer);
            ;
        }
    };
});
System.register("engine", ["backends/gpu", "backends/gpu-wires-decoder", "backends/gpu-wires-renderer"], function (exports_5, context_5) {
    "use strict";
    var __moduleName = context_5 && context_5.id;
    var gpu_1, gpuWiresDecoder, gpu_wires_renderer_1, decoder, renderer, Engine;
    return {
        setters: [
            function (gpu_1_1) {
                gpu_1 = gpu_1_1;
            },
            function (gpuWiresDecoder_1) {
                gpuWiresDecoder = gpuWiresDecoder_1;
            },
            function (gpu_wires_renderer_1_1) {
                gpu_wires_renderer_1 = gpu_wires_renderer_1_1;
            }
        ],
        execute: function () {
            decoder = gpuWiresDecoder;
            renderer = gpu_wires_renderer_1.GpuWiresRenderer;
            Engine = class Engine {
                async load(img) {
                    const [width, height] = [img.naturalWidth, img.naturalHeight];
                    const canvas = document.createElement('canvas');
                    canvas.width = width / 10;
                    canvas.height = height / 10;
                    canvas.style.width = (img.width / 10).toString();
                    canvas.style.height = (img.height / 10).toString();
                    const context = new gpu_1.Gpu(canvas);
                    window.context = context;
                    const subState = await decoder.bootstrapFromImageTag(img);
                    const subRenderer = new renderer(context);
                    subRenderer.initialize(width, height, subState);
                    subRenderer.animate();
                    img.replaceWith(canvas);
                    subRenderer.step();
                }
                ;
            };
            exports_5("Engine", Engine);
            ;
        }
    };
});
System.register("tutorial", ["engine"], function (exports_6, context_6) {
    "use strict";
    var __moduleName = context_6 && context_6.id;
    var engine_1, scheduler, linelogic_area, i;
    return {
        setters: [
            function (engine_1_1) {
                engine_1 = engine_1_1;
            }
        ],
        execute: function () {
            scheduler = new engine_1.Engine();
            linelogic_area = document.getElementsByClassName("linelogic");
            for (i = 0; i < linelogic_area.length; i++) {
                const area = linelogic_area[i];
                if (!(area instanceof HTMLImageElement)) {
                    continue;
                }
                if (area.complete) {
                    setTimeout(() => scheduler.load(area), 0);
                }
                else {
                    area.onload = () => scheduler.load(area);
                }
            }
        }
    };
});
//# sourceMappingURL=tutorial.js.map