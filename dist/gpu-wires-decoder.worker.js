(function () {
'use strict';

// From https://dbaron.org/log/20100309-faster-timeouts

const timeouts = [];
const messageName = "zero-timeout-message";

// Like setTimeout, but only takes a function argument.  There's
// no time argument (always zero) and no arguments (you have to
// use a closure).


const handleMessage = function(event) {
    if (event.source === window && event.data === messageName) {
        event.stopPropagation();
        if (timeouts.length > 0) {
            let fn = timeouts.shift();
            fn();
        }
    }
};

window.addEventListener("message", handleMessage, true);

// TODO

}());
//# sourceMappingURL=gpu-wires-decoder.worker.js.map
