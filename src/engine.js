import { Gpu } from './backends/gpu';
import * as gpuWiresDecoder from './backends/gpu-wires-decoder';
import { GpuWiresRenderer } from './backends/gpu-wires-renderer';

const decoder = gpuWiresDecoder;
const Renderer = GpuWiresRenderer;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

export class Engine {
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
};
