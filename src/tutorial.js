import { Engine } from './engine';

const scheduler = new Engine();

const linelogic_area = document.getElementsByClassName("linelogic");
for (var i = 0; i < linelogic_area.length; i++) {
    const area = linelogic_area[i];
    if (!(area instanceof HTMLImageElement)) {
        continue;
    }

    if (area.complete) {
        setTimeout(() => scheduler.load(area), 0);
    } else {
        area.onload = () => scheduler.load(area);
    }
}
