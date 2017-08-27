"use strict";

const engine = (function () {
    const module = {};

    function compileShader(gl, shaderSource, kind) {
        const shader = gl.createShader(kind);
        gl.shaderSource(shader, shaderSource);
        gl.compileShader(shader);
        const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (!success) {
            console.log("Shader compilation failed: " + gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    function loadShaderScript(gl, id) {
        const scriptElement = document.getElementById(id);
        const script = scriptElement.text.trim();
        if (scriptElement.type === "x-shader/x-vertex") {
            return compileShader(gl, script, gl.VERTEX_SHADER);
        } else if (scriptElement.type === "x-shader/x-fragment") {
            return compileShader(gl, script, gl.FRAGMENT_SHADER);
        } else {
            console.log("Unknown shader type: " + scriptElement.type);
            return;
        }
    }

    function createProgram(gl, vertexShader, fragmentShader) {
        const program = gl.createProgram();
        gl.attachShader(program, loadShaderScript(gl, vertexShader));
        gl.attachShader(program, loadShaderScript(gl, fragmentShader));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.log("Program linking failed: " + gl.getProgramInfoLog(program));
        }
        return program;
    }

    function textureCreateAndBind([width, height], internalformat, format, type, pixels) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalformat, width, height, 0, format, type, pixels);
        return texture;
    }

    function textureDisableInterpolation() {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    module.initialize = async function(img) {
        const [wireStates, incomingWires, incomingWireGroupsOff, incomingWireGroupsLen, imageDecoder, imageDecoderExtra] =
            await decode.bootstrapFromImageTag(img);
        window.wireStates = wireStates;
        window.incomingWires = incomingWires;
        window.incomingWireGroupsOff = incomingWireGroupsOff;
        window.incomingWireGroupsLen = incomingWireGroupsLen;
        window.imageDecoder = imageDecoder;
        window.imageDecoderExtra = imageDecoderExtra;
        const [width, height] = [img.naturalWidth, img.naturalHeight];

        const canvas = document.createElement('canvas');
        canvas.width = width / 10;
        canvas.height = height / 10;
        canvas.style.width = img.width / 10;
        canvas.style.height = img.height / 10;

        const gl = canvas.getContext("webgl2", {"antialias": false});
        /* dbg */ window.gl = gl;

        if (!gl.getExtension("EXT_color_buffer_float")) {
            alert("Floating point textures not supported!");
        }
        gl.disable(gl.BLEND);

        const renderProgram = createProgram(gl, "vs", "render-fs");
        const a_triangleCoordinates = gl.getAttribLocation (renderProgram, "a_triangleCoordinates");
        const u_render_scale        = gl.getUniformLocation(renderProgram, "u_scale");
        const u_render_offset       = gl.getUniformLocation(renderProgram, "u_offset");
        const u_render_wireStates   = gl.getUniformLocation(renderProgram, "u_wireStates");
        const u_render_imageDecoder = gl.getUniformLocation(renderProgram, "u_imageDecoder");
        const u_render_imageDecoderExtra = gl.getUniformLocation(renderProgram, "u_imageDecoderExtra");

        const stepProgram = createProgram(gl, "vs", "step-fs");
        const u_step_wireStates     = gl.getUniformLocation(stepProgram, "u_wireStates");
        const u_step_incomingWires  = gl.getUniformLocation(stepProgram, "u_incomingWires");
        const u_step_incomingWireGroupsOff = gl.getUniformLocation(stepProgram, "u_incomingWireGroupsOff");
        const u_step_incomingWireGroupsLen = gl.getUniformLocation(stepProgram, "u_incomingWireGroupsLen");
        const framebuffer = gl.createFramebuffer(gl.FRAMEBUFFER);

        gl.activeTexture(gl.TEXTURE0 + 0);
        const imageDecoderTex = textureCreateAndBind([width, height], gl.R32I, gl.RED_INTEGER, gl.INT, imageDecoder);
        const imageDecoderIdx = 0;
        textureDisableInterpolation();

        gl.activeTexture(gl.TEXTURE0 + 1);
        const imageDecoderExtraTex = textureCreateAndBind([width, height], gl.R32I, gl.RED_INTEGER, gl.INT, imageDecoderExtra);
        const imageDecoderExtraIdx = 1;
        textureDisableInterpolation();

        gl.activeTexture(gl.TEXTURE0 + 2);
        const incomingWiresTex = textureCreateAndBind([1024, incomingWires.length >> 10], gl.R32I, gl.RED_INTEGER, gl.INT, incomingWires);
        const incomingWiresIdx = 2;
        textureDisableInterpolation();

        gl.activeTexture(gl.TEXTURE0 + 3);
        const incomingWireGroupsOffTex = textureCreateAndBind([128, incomingWireGroupsOff.length >> 7], gl.R32I, gl.RED_INTEGER, gl.INT, incomingWireGroupsOff);
        const incomingWireGroupsOffIdx = 3;
        textureDisableInterpolation();

        gl.activeTexture(gl.TEXTURE0 + 4);
        const incomingWireGroupsLenTex = textureCreateAndBind([1024, incomingWireGroupsLen.length >> 10], gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, incomingWireGroupsLen);
        const incomingWireGroupsLenIdx = 4;
        textureDisableInterpolation();

        gl.activeTexture(gl.TEXTURE0 + 5);
        let wireStatesCurrTex = textureCreateAndBind([128, wireStates.length >> 7], gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(wireStates));
        let wireStatesCurrIdx = 5;
        textureDisableInterpolation();

        gl.activeTexture(gl.TEXTURE0 + 6);
        let wireStatesNextTex = textureCreateAndBind([128, wireStates.length >> 7], gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, null);
        let wireStatesNextIdx = 6;
        textureDisableInterpolation();

        const triangleCovering = new Float32Array([
            -1.0, -1.0,   3.0, -1.0,  -1.0,  3.0,
        ]);
        const triangleCoveringBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, triangleCoveringBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, triangleCovering, gl.STATIC_DRAW);
        gl.vertexAttribPointer(a_triangleCoordinates, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(a_triangleCoordinates);

        let scale = 1;
        let mul = 1.003;
        let offset = 0;

        function animate(now) {
            requestAnimationFrame(animate);

            gl.useProgram(renderProgram);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, width, height);
            gl.uniform1f(u_render_scale, scale);
            gl.uniform2f(u_render_offset, offset, offset);
            gl.uniform1i(u_render_wireStates, wireStatesCurrIdx);
            gl.uniform1i(u_render_imageDecoder, imageDecoderIdx);
            gl.uniform1i(u_render_imageDecoderExtra, imageDecoderExtraIdx);
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            offset += 4 * scale;
            scale *= mul;
            if (scale > 1) {
                mul = 0.9999 / mul;
            } else if (scale < 0.1) {
                mul = 1.0001 / mul;
            }

            gl.useProgram(stepProgram);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.viewport(0, 0, 128, wireStates.length >> 7);
            gl.uniform1i(u_step_incomingWires, incomingWiresIdx);
            gl.uniform1i(u_step_incomingWireGroupsOff, incomingWireGroupsOffIdx);
            gl.uniform1i(u_step_incomingWireGroupsLen, incomingWireGroupsLenIdx);
        }

        let sync = [];
        let n = 0;
        let t = performance.now();
        function step(deadline) {
            while (deadline.timeRemaining() > 0.6) {
                n++;
                let now = performance.now();
                if (now - t > 100){
                    document.getElementById("fps").innerHTML = document.getElementById("fps").innerHTML / 2 + n * (1000 / (now - t)) / 2;
                    t = now;
                    n = 0;
                }

                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, wireStatesNextTex, 0);
                gl.uniform1i(u_step_wireStates, wireStatesCurrIdx);
                gl.drawArrays(gl.TRIANGLES, 0, 3);

                [wireStatesCurrTex, wireStatesNextTex] = [wireStatesNextTex, wireStatesCurrTex];
                [wireStatesCurrIdx, wireStatesNextIdx] = [wireStatesNextIdx, wireStatesCurrIdx];

                let newSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
                if (sync.length > 3) {
                    let s = sync.shift();
                    while(gl.clientWaitSync(s, 0, 0) == gl.TIMEOUT_EXPIRED) {}
                    gl.deleteSync(s);
                }
                sync.push(newSync);
            }

            requestIdleCallback(step);
            // setTimeout(step, 200);
        }

        animate();
        img.replaceWith(canvas);
        requestIdleCallback(step);
    };

    // module.run = function() {
    //     // Perform at start to force this to
    //     // effectively have lower priority than
    //     // the interruption.
    //     if (interrupted) {
    //         return;
    //     }

    //     // Schedule early to avoid minimum delay.
    //     setTimeout(run, 0);

    //     stepGraph();
    //     initializeNextTexture();
    //     rotateTextures();

    // };

    // module.render = function() {
    //     // render quad to canvas
    // };

    return module;
}());
