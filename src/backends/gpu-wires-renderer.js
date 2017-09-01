import { Gpu } from './gpu';

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

export class GpuWiresRenderer {
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
};
