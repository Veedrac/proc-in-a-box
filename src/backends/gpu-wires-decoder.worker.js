onmessage = function(event) {
    let [data, width, height, numWires] = event.data;
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
    let wireStates = new Uint8Array(numWires);

    // TODO
    let incomingWiresN = 0;
    let incomingWires = new Uint32Array(numWires * 2);
    let incomingWireGroupsOff = new Uint32Array(numWires >> 3);
    let incomingWireGroupsLen = new Uint8Array(numWires);

    // Which wire does each pixel get its value from?
    const imageDecoder = new Uint32Array(size);

    // Extra information for wire crossings.
    // This only stores horizontal wires, because they can change
    // at most once every four wires.
    const imageDecoderExtra = new Uint32Array(Math.ceil(size >> 2));

    const traverseFrom = function(data, width, i, j) {
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
        } else if (numSiblings === 1) {
            // Go towards the filled pixel
            if      (up)    { dn = -1; }
            else if (down)  { dn = +1; }
            else if (left)  { dm = -1; }
            else if (right) { dm = +1; }
            else            { throw 1; }
        } else {
            // Go away from the empty pixel
            if      (!up)    { dn = +1; }
            else if (!down)  { dn = -1; }
            else if (!left)  { dm = +1; }
            else if (!right) { dm = -1; }
            else             { throw 2; }
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
                    if (dm != 0) {
                        imageDecoderExtra[mnIdx >> 2] = wireStatesN;
                    } else {
                        imageDecoder[mnIdx] = 0x80000000 | wireStatesN;
                    }
                } else if (left) {
                    incomingWires[incomingWiresN] = mnIdx;
                    incomingWiresN++;
                    incomingWireGroupsLen[wireStatesN]++;
                } else if (right) {
                    incomingWires[incomingWiresN] = mnIdx;
                    incomingWiresN++;
                    incomingWireGroupsLen[wireStatesN]++;
                } else {
                    wireActive |= data[(m + 1) + (n + 1) * (width + 2)] >> 1;
                    imageDecoder[mnIdx] = wireStatesN;
                }
            } else if (left === right) {
                // End here
                wireActive |= (data[(m + 1) + (n + 1) * (width + 2)] >> 1) & (left ? 0 : 1);
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

            traverseFrom(data, width, i, j);
        }

        postMessage(["frame", j]);
    }

    const traverseLoopsFrom = function(data, width, i, j) {
        const idx = (i + 1) + (j + 1) * (width + 2);
        const kind  = data[idx];
        const up    = data[idx - (width + 2)] & 1;
        const down  = data[idx + (width + 2)] & 1;
        const left  = data[idx - 1] & 1;
        const right = data[idx + 1] & 1;
        const numSiblings = up + down + left + right;

        if (numSiblings !== 2) {
            // Only loops should be missing!
            throw 3;
        }

        // Loop "start"; stop when reached again.
        let wireActive = kind >> 1;
        imageDecoder[i + j * width] = wireStatesN;
        if ((wireStatesN & 7) == 0) {
            incomingWireGroupsOff[wireStatesN >> 3] = incomingWiresN;
        }

        let [m, n] = [i, j];
        let [dm, dn] = [0, 0];

        // Any side will do right now.
        if      (up)   { dn = -1; }
        else if (down) { dn = +1; }
        else           { dm = -1; }

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
                    imageDecoderExtra[mnIdx >> 2] = imageDecoder[mnIdx]
                    imageDecoder[mnIdx] = wireStatesN;
                } else if (left) {
                    incomingWires[incomingWiresN] = mnIdx;
                    incomingWiresN++;
                    incomingWireGroupsLen[wireStatesN]++;
                } else if (right) {
                    incomingWires[incomingWiresN] = mnIdx;
                    incomingWiresN++;
                    incomingWireGroupsLen[wireStatesN]++;
                } else {
                    wireActive |= data[(m + 1) + (n + 1) * (width + 2)] >> 1;
                    imageDecoder[mnIdx] = wireStatesN;
                }
            } else if (left === right) {
                // Impossibru!
                throw 4;
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

            traverseLoopsFrom(data, width, i, j);
        }

        postMessage(["frame", j]);
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

    // Round up to multiple of width so we can have less-skew textures.
    const packedWireStatesN = ((wireStatesN >> 3) + 1023) & ~1023;
    wireStatesN = (wireStatesN + 1023) & ~1023;
    incomingWiresN = (incomingWiresN + 1023) & ~1023;

    let packedWireStates = new Uint8Array(packedWireStatesN)
    for (let i = 0; i < wireStatesN / 8; i++) {
        for (let j = 0; j < 8; j++) {
            packedWireStates[i] |= wireStates[i * 8 + j] << j;
        }
    }

    // Return
    wireStates = packedWireStates;
    incomingWires = incomingWires.slice(0, incomingWiresN);
    incomingWireGroupsOff = incomingWireGroupsOff.slice(0, wireStatesN >> 3);
    incomingWireGroupsLen = incomingWireGroupsLen.slice(0, wireStatesN);

    postMessage(
        ["finish", {wireStates, incomingWires, incomingWireGroupsOff, incomingWireGroupsLen, imageDecoder, imageDecoderExtra}],
        [wireStates.buffer, incomingWires.buffer, incomingWireGroupsOff.buffer, incomingWireGroupsLen.buffer, imageDecoder.buffer, imageDecoderExtra.buffer]
    );
    close();
}
