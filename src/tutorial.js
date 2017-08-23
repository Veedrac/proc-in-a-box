"use strict";

window.onload = function() {
    let linelogic_area = document.getElementsByClassName("linelogic");
    for (let area of linelogic_area) {
        if (area.complete) {
            setTimeout(() => engine.initialize(area), 0);
        } else {
            area.onload = () => engine.initialize(area);
        }
    }
}
