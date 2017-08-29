interface ChildNode {
    replaceWith(replacement: HTMLElement): void;
}

interface HTMLImageElement extends ChildNode {}

type TypedArray =
    Uint8Array | Uint8ClampedArray | Uint16Array | Uint32Array |
    Int8Array | Int16Array | Int32Array |
    Float32Array | Float64Array;
