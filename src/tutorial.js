import { Engine } from './engine';

const engine = new Engine();

const linelogic_area = document.getElementsByClassName("linelogic");
for (var i = 0; i < linelogic_area.length; i++) {
    const area = linelogic_area[i];
    if (!(area instanceof HTMLImageElement)) {
        continue;
    }

    if (area.complete) {
        setTimeout(() => engine.load(area), 0);
    } else {
        area.onload = () => engine.load(area);
    }
}

const renderAll = function() {
    engine.render();
    requestAnimationFrame(renderAll);
}
requestAnimationFrame(renderAll);

const update = function(deadline) {
    engine.update();
    requestIdleCallback(update);
}
requestIdleCallback(update);
