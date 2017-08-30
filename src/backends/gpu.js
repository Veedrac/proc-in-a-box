export class Gpu {
    constructor(canvas) {
        const gl = canvas.getContext("webgl2", {"antialias": false});
        if (!gl) {
            throw new Error("WebGL2 not supported");
        }
        this.gl = gl;
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
};
