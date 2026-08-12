import assert from "node:assert/strict";
import fs from "node:fs/promises";

const path = new URL("../js/jindouyun_canvas_drawing.js", import.meta.url);
const source = await fs.readFile(path, "utf8");

function loadColorHelpers(script) {
    const rgbaToHex = script.match(/function rgbaToHex\(red, green, blue\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(rgbaToHex, "rgbaToHex must be defined");
    return Function(`${rgbaToHex}\nreturn {rgbaToHex};`)();
}

assert.match(source, /const EYEDROPPER_COLOR_STORAGE_KEY = "jindouyun\.canvas\.eyedropperColor"/);
for (const [name, value] of [
    ["金色", "#D4AF37"],
    ["银色", "#C0C0C0"],
    ["黑色", "#111111"],
    ["白色", "#FFFFFF"],
    ["灰色", "#808080"],
    ["蓝色", "#2387FF"],
    ["橙色", "#FF6A00"],
    ["咖啡色", "#6F4E37"],
    ["绿色", "#34A853"],
]) {
    assert.ok(source.includes(`["${name}", "${value}"]`), `${name} preset must use ${value}`);
}
assert.match(source, /gridTemplateColumns: "repeat\(5, 30px\)"/);
assert.match(source, /colorPresetGrid\.appendChild\(swatch\)/);
assert.match(source, /colorPresetGrid\.appendChild\(eyedropperColorButton\)/);
assert.match(source, /colorHeader\.appendChild\(customColorWrapper\)/);
assert.match(source, /const eyedropperButton = makeButton\("吸管"/);
assert.match(source, /decorateIconButton\(eyedropperButton, "⌾", "颜色吸管"\)/);
assert.match(source, /tool === "eyedropper"/);
assert.match(source, /ctx\.getImageData\(/);
assert.match(source, /rememberEyedropperColor\(node, drawing, sampledColor\)/);
assert.match(source, /const eyedropperColorButton = document\.createElement\("button"\)/);
assert.match(source, /eyedropperColorButton\.title = `吸管保存颜色/);
assert.match(source, /customColor\.addEventListener\("input", applyCustomColor\)/);
assert.match(source, /customColor\.addEventListener\("change", applyCustomColor\)/);
assert.match(source, /customColor\.addEventListener\("pointerdown", \(\) => \{ nativeColorPickerActive = true; \}\)/);
assert.match(source, /nativeColorPickerActive = false;[\s\S]*customColor\.blur\(\);[\s\S]*}, 800\)/);
assert.match(source, /function isNativeColorPickerEscape\(event\)/);
assert.match(source, /nativeColorPickerActive \|\| event\.target === customColor \|\| document\.activeElement === customColor/);
assert.match(source, /if \(isNativeColorPickerEscape\(event\)\) \{[\s\S]*customColor\.blur\(\);[\s\S]*return;/);
assert.match(source, /toolbar\.append\([\s\S]*eyedropperButton/);

const {rgbaToHex} = loadColorHelpers(source);
assert.equal(rgbaToHex(255, 106, 0), "#FF6A00");
assert.equal(rgbaToHex(35, 135, 255), "#2387FF");
assert.equal(rgbaToHex(-10, 999, 15.6), "#00FF10");

console.log("canvas drawing color UI test passed");
