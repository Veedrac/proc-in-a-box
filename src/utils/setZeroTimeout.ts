// From https://dbaron.org/log/20100309-faster-timeouts

const timeouts: (() => void)[] = [];
const messageName = "zero-timeout-message";

// Like setTimeout, but only takes a function argument.  There's
// no time argument (always zero) and no arguments (you have to
// use a closure).
export function setZeroTimeout(fn: () => void) {
    timeouts.push(fn);
    window.postMessage(messageName, "*");
}

function handleMessage(event: MessageEvent) {
    if (event.source === window && event.data === messageName) {
        event.stopPropagation();
        if (timeouts.length > 0) {
            let fn = timeouts.shift()!;
            fn();
        }
    }
}

window.addEventListener("message", handleMessage, true);

export function pause(): Promise<undefined> {
    return new Promise(resolve => setZeroTimeout(resolve));
}
