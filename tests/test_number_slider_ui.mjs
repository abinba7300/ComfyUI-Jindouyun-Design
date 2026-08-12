import assert from "node:assert/strict";
import fs from "node:fs/promises";

const path = new URL("../js/jindouyun_number_slider.js", import.meta.url);
const source = await fs.readFile(path, "utf8");

function loadSliderHelpers(script) {
    const finite = script.match(/function finiteNumber\(value, fallback\) \{[\s\S]*?\n\}/)?.[0];
    const places = script.match(/function decimalPlaces\(value\) \{[\s\S]*?\n\}/)?.[0];
    const normalize = script.match(/function normalizeSliderConfig\(value, minimum, maximum, step\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(finite && places && normalize, "slider normalization helpers must exist");
    return Function(`${finite}\n${places}\n${normalize}\nreturn {normalizeSliderConfig};`)();
}

assert.match(source, /const NODE_TYPE = "JindouyunNumberSlider"/);
assert.match(source, /findWidget\(node, "滑块名称"\)/);
assert.match(source, /findWidget\(node, "当前值"\)/);
assert.match(source, /findWidget\(node, "最小值"\)/);
assert.match(source, /findWidget\(node, "最大值"\)/);
assert.match(source, /findWidget\(node, "步进值"\)/);
assert.match(source, /findWidget\(node, "滑块颜色"\)/);
assert.match(source, /slider\.type = "range"/);
assert.match(source, /colorPicker\.type = "color"/);
assert.match(source, /nameInput\.addEventListener\("input"/);
assert.match(source, /String\(nameWidget\?\.value \?\? "数值滑块"\)/);
assert.doesNotMatch(source, /String\(nameWidget\?\.value \|\| "数值滑块"\)/);
assert.match(source, /slider\.addEventListener\("input"/);
assert.match(source, /currentInput\.addEventListener\("change"/);
assert.match(source, /colorPicker\.addEventListener\("input"/);
assert.match(source, /colorText\.addEventListener\("change"/);
assert.match(source, /accentColor/);
assert.match(source, /getMinHeight: \(\) => 216/);
assert.match(source, /hideNativeWidgets\(node\)/);
assert.match(source, /node\.setSize/);

const {normalizeSliderConfig} = loadSliderHelpers(source);
assert.deepEqual(normalizeSliderConfig(0.87, 0, 1, 0.05), {
    value: 0.85,
    minimum: 0,
    maximum: 1,
    step: 0.05,
});
assert.deepEqual(normalizeSliderConfig(0.18, 0.1, 1, 0.05), {
    value: 0.2,
    minimum: 0.1,
    maximum: 1,
    step: 0.05,
});
assert.deepEqual(normalizeSliderConfig(0.75, 1, 0, 0.1), {
    value: 0.8,
    minimum: 0,
    maximum: 1,
    step: 0.1,
});
assert.equal(normalizeSliderConfig(2, 0, 1, 0.05).value, 1);
assert.equal(normalizeSliderConfig(0.12, 0, 1, 0).step, 0.05);

console.log("number slider UI test passed");
