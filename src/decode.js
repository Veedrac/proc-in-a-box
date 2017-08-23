"use strict";

const decode = (function () {
    const module = {};

    function getKind(data, idx) {
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

    function imageToGpuRepresentation(data, width, height, numWires) {
        // Loops aside, trace *only* from ends.
        // No stack is needed for this, since it's always a
        // single one-way traversal.
        //
        // When doing so,
        //
        //   * OR all the signals together and
        //     push to the wire states array.
        //
        //   * Record all input T-junctions to the line,
        //     and push each pair to the transition map.
        //
        //   * Map the values in the pixels to the
        //     wire states array location.
        //
        // Finally, check for unhandled pixels, aka. loops.
        //
        // Afterwards, use the mapping to remap the
        // transition map to the correct location in the
        // wire states array, and turn it into an indexed
        // mapping.

        const size = width * height;
        numWires = (numWires + 1024) & ~1023;

        // Is each wire on or off?
        // The preallocated length is massively pessimistic.
        // An extra state is reserved at the beginning to dump state into.
        let wireStatesN = 1;
        const wireStates = new Int8Array(numWires);

        // TODO
        let incomingWiresN = 0;
        const incomingWires = new Int32Array(numWires * 2);
        const incomingWireGroups = new Int32Array(numWires * 2);

        // Which wire does each pixel get its value from?
        const imageDecoder = new Int32Array(size);
        const imageDecoderExtra = new Int32Array(size);

        function traverseFrom(data, width, height, i, j) {
            const idx = (i + 1) + (j + 1) * (width + 2);
            const kind  = data[idx];
            const up    = data[idx - (width + 2)] & 1;
            const down  = data[idx + (width + 2)] & 1;
            const left  = data[idx - 1] & 1;
            const right = data[idx + 1] & 1;
            const numSiblings = up + down + left + right;

            if (numSiblings === 2 || numSiblings === 4) {
                // Only start traversals from ends.
                return;
            }

            // End #1
            let wireActive = (kind >> 1) & (numSiblings != 3);
            imageDecoder[i + j * width] = wireStatesN;
            incomingWireGroups[wireStatesN * 2] = incomingWiresN;

            let [m, n] = [i, j];
            let [dm, dn] = [0, 0];

            if (numSiblings === 0) {
                wireStates[wireStatesN] = wireActive;
                wireStatesN++;
                return;
            } else if (numSiblings === 1) {
                // Go towards the filled pixel
                if      (up)    { dn = -1; }
                else if (down)  { dn = +1; }
                else if (left)  { dm = -1; }
                else if (right) { dm = +1; }
                else            { debugger; }
            } else {
                // Go away from the empty pixel
                if      (!up)    { dn = +1; }
                else if (!down)  { dn = -1; }
                else if (!left)  { dm = +1; }
                else if (!right) { dm = -1; }
                else             { debugger; }
            }

            while (true) {
                [m, n] = [m + dm, n + dn];
                const mnIdx = m + n * width;

                const straight = data[(m + dm + 1) + (n + dn + 1) * (width + 2)] & 1;
                const left     = data[(m - dn + 1) + (n + dm + 1) * (width + 2)] & 1;
                const right    = data[(m + dn + 1) + (n - dm + 1) * (width + 2)] & 1;

                if (straight) {
                    // The line continues
                    if (left && right) {
                        // Don't cross the streams!
                        imageDecoderExtra[mnIdx] = imageDecoder[mnIdx]
                        imageDecoder[mnIdx] = wireStatesN;
                    } else if (left) {
                        incomingWires[incomingWiresN] = mnIdx;
                        incomingWiresN++;
                        incomingWireGroups[wireStatesN * 2 + 1]++;
                    } else if (right) {
                        incomingWires[incomingWiresN] = mnIdx;
                        incomingWiresN++;
                        incomingWireGroups[wireStatesN * 2 + 1]++;
                    } else {
                        wireActive |= data[(m + 1) + (n + 1) * (width + 2)] >> 1;
                        imageDecoder[mnIdx] = wireStatesN;
                    }
                } else if (left === right) {
                    // End here
                    wireActive |= (data[(m + 1) + (n + 1) * (width + 2)] >> 1) & !left;
                    imageDecoder[mnIdx] = wireStatesN
                    wireStates[wireStatesN] = wireActive;
                    wireStatesN++;
                    return;
                } else {
                    wireActive |= data[(m + 1) + (n + 1) * (width + 2)] >> 1;
                    imageDecoder[mnIdx] = wireStatesN
                    if (left) {
                        [dm, dn] = [-dn, +dm];
                    } else {
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
        }

        function traverseLoopsFrom(data, width, height, i, j) {
            const idx = (i + 1) + (j + 1) * (width + 2);
            const kind  = data[idx];
            const up    = data[idx - (width + 2)] & 1;
            const down  = data[idx + (width + 2)] & 1;
            const left  = data[idx - 1] & 1;
            const right = data[idx + 1] & 1;
            const numSiblings = up + down + left + right;

            if (numSiblings !== 2) {
                // Only loops should be missing!
                debugger;
            }

            // Loop "start"; stop when reached again.
            let wireActive = kind >> 1;
            imageDecoder[i + j * width] = wireStatesN;
            incomingWireGroups[wireStatesN * 2] = incomingWiresN;

            let [m, n] = [i, j];
            let [dm, dn] = [0, 0];

            // Any side will do right now.
            if      (up)   { dn = +1; }
            else if (down) { dn = -1; }
            else           { dm = +1; }

            while (true) {
                [m, n] = [m + dm, n + dn];
                const mnIdx = m + n * width;

                if (m == i && n == j) {
                    // Back to the future.
                    wireStates[wireStatesN] = wireActive;
                    wireStatesN++;
                    return;
                }

                const straight = data[(m + dm + 1) + (n + dn + 1) * (width + 2)] & 1;
                const left     = data[(m - dn + 1) + (n + dm + 1) * (width + 2)] & 1;
                const right    = data[(m + dn + 1) + (n - dm + 1) * (width + 2)] & 1;

                if (straight) {
                    // The line continues
                    if (left && right) {
                        // Don't cross the streams!
                        imageDecoderExtra[mnIdx] = imageDecoder[mnIdx]
                        imageDecoder[mnIdx] = wireStatesN;
                    } else if (left) {
                        incomingWires[incomingWiresN] = mnIdx;
                        incomingWiresN++;
                        incomingWireGroups[wireStatesN * 2 + 1]++;
                    } else if (right) {
                        incomingWires[incomingWiresN] = mnIdx;
                        incomingWiresN++;
                        incomingWireGroups[wireStatesN * 2 + 1]++;
                    } else {
                        wireActive |= data[(m + 1) + (n + 1) * (width + 2)] >> 1;
                        imageDecoder[mnIdx] = wireStatesN;
                    }
                } else if (left === right) {
                    // Impossibru!
                    debugger;
                } else {
                    wireActive |= data[(m + 1) + (n + 1) * (width + 2)] >> 1;
                    imageDecoder[mnIdx] = wireStatesN
                    if (left) {
                        [dm, dn] = [-dn, +dm];
                    } else {
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
        }

        for (let i = 0; i < incomingWiresN; i++) {
            incomingWires[i] = imageDecoder[incomingWires[i]];
        }

        for (let i = 0; i < wireStatesN; i++) {
            let groupStart = incomingWireGroups[i * 2];
            let groupLength = incomingWireGroups[i * 2 + 1];

            let incoming = incomingWires.slice(groupStart, groupStart + groupLength);
            incoming.sort();
            incomingWires.set(incoming, groupStart);
        }

        // Round up to multiple of width so we can have less-skew textures.
        const packedWireStatesN = (wireStatesN / 8 + 1023) & ~1023;
        wireStatesN = (wireStatesN + 1023) & ~1023;
        incomingWiresN = (incomingWiresN + 1023) & ~1023;

        let packedWireStates = new Uint8Array(packedWireStatesN)
        for (let i = 0; i < wireStatesN / 8; i++) {
            for (let j = 0; j < 8; j++) {
                packedWireStates[i] |= wireStates[i * 8 + j] << j;
            }
        }

        return [
            packedWireStates,
            incomingWires.slice(0, incomingWiresN),
            incomingWireGroups.slice(0, wireStatesN * 2),
            imageDecoder, imageDecoderExtra
        ];
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
                numWires += kind !== 0;
                predecoded[(i + 1) + (j + 1) * (width + 2)] = kind;
                predecoded[(i + 1) + (j + 1) * (width + 2)] = kind;
            }
        }

        return [predecoded, width, height, numWires];
    }

    module.bootstrapFromImageTag = function(img) {
        // Extract to allow collections of temporaries.
        const [predecoded, width, height, numWires] = bootstrapInner(img);
        return imageToGpuRepresentation(predecoded, width, height, numWires);
    }

    return module;
}());
