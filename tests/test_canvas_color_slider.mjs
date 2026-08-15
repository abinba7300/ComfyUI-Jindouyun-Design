import assert from "node:assert/strict";
import fs from "node:fs";

import {
    hueSliderColorAt,
    hueSliderPositionForColor,
} from "../js/jindouyun_color_slider.mjs";

const compositeSource = fs.readFileSync(
    new URL("../js/jindouyun_canvas_composite.js", import.meta.url),
    "utf8",
);

assert.equal(hueSliderColorAt(0), "#FF0000");
assert.equal(hueSliderColorAt(1 / 6), "#FFFF00");
assert.equal(hueSliderColorAt(0.5), "#00FFFF");
assert.equal(hueSliderColorAt(1), "#FF0000");
assert.equal(hueSliderColorAt(-1), "#FF0000");
assert.equal(hueSliderColorAt(2), "#FF0000");

assert.ok(Math.abs(hueSliderPositionForColor("#00FF00") - 1 / 3) < 1e-9);
assert.ok(Math.abs(hueSliderPositionForColor("#0000FF") - 2 / 3) < 1e-9);
assert.equal(hueSliderPositionForColor("#FFFFFF", 0.5), 0.5);
assert.equal(hueSliderPositionForColor("not-a-color", 0.25), 0.25);

assert.match(compositeSource, /bar\.addEventListener\("pointerdown"/);
assert.match(compositeSource, /bar\.addEventListener\("pointermove"/);
assert.match(compositeSource, /setPointerCapture/);
assert.match(compositeSource, /applyColor\(hueSliderColorAt\(position\)\)/);
assert.doesNotMatch(compositeSource, /bar\.addEventListener\("click"/);
assert.match(compositeSource, /text\.addEventListener\("click"/);

console.log("canvas color slider tests passed");
