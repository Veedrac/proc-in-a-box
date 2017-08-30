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
}

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
}

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
}

export const bootstrapFromImageTag = function(img) {
    // Extract to allow collections of temporaries.
    const [predecoded, width, height, numWires] = bootstrapInner(img);
    return imageToGpuRepresentation(predecoded, width, height, numWires);
}
