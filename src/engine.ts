import { Gpu } from './backends/gpu';
import * as gpuWiresDecoder from './backends/gpu-wires-decoder';
import { GpuWiresRenderer } from './backends/gpu-wires-renderer';

const decoder = gpuWiresDecoder;
const renderer = GpuWiresRenderer;

export class Engine {
    async load(img: HTMLImageElement) {
        const [width, height] = [img.naturalWidth, img.naturalHeight];

        const canvas = document.createElement('canvas');
        canvas.width = width / 10;
        canvas.height = height / 10;
        canvas.style.width = (img.width / 10).toString();
        canvas.style.height = (img.height / 10).toString();

        const context = new Gpu(canvas);
        /* dbg */ (<any>window).context = context;

        const subState = await decoder.bootstrapFromImageTag(img);
        const subRenderer = new renderer(context);
        subRenderer.initialize(width, height, subState);

        subRenderer.animate();
        img.replaceWith(canvas);
        subRenderer.step();
        // requestIdleCallback(subRenderer.step);
        // while (deadline.timeRemaining() > 0.6) {
    };
};
