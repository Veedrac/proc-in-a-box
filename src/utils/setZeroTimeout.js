// From https://dbaron.org/log/20100309-faster-timeouts

const timeouts = [];
const messageName = "zero-timeout-message";

// Like setTimeout, but only takes a function argument.  There's
// no time argument (always zero) and no arguments (you have to
// use a closure).
export const setZeroTimeout = function(fn) {
    timeouts.push(fn);
    window.postMessage(messageName, "*");
}

const handleMessage = function(event) {
    if (event.source === window && event.data === messageName) {
        event.stopPropagation();
        if (timeouts.length > 0) {
            let fn = timeouts.shift();
            fn();
        }
    }
}

window.addEventListener("message", handleMessage, true);

export const pause = function() {
    return new Promise(resolve => setZeroTimeout(resolve));
}
