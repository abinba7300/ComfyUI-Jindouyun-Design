import assert from "node:assert/strict";
import fs from "node:fs/promises";

const path = new URL("../js/jindouyun_canvas_drawing.js", import.meta.url);
const source = await fs.readFile(path, "utf8");

function loadColorHelpers(script) {
    const rgbaToHex = script.match(/function rgbaToHex\(red, green, blue\) \{[\s\S]*?\n\}/)?.[0];
    const normalizeSavedColors = script.match(/function normalizeSavedColors\(values\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(rgbaToHex, "rgbaToHex must be defined");
    assert.ok(normalizeSavedColors, "normalizeSavedColors must be defined");
    return Function("COLORS", "MAX_SAVED_COLORS", `${rgbaToHex}\n${normalizeSavedColors}\nreturn {rgbaToHex, normalizeSavedColors};`)(
        ["#FF6A00"],
        20,
    );
}

assert.match(source, /const EYEDROPPER_COLOR_STORAGE_KEY = "jindouyun\.canvas\.eyedropperColor"/);
assert.match(source, /const SAVED_COLORS_STORAGE_KEY = "jindouyun\.canvas\.savedColors"/);
assert.match(source, /savedColors: \[\]/);
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
assert.match(source, /function rebuildSavedColorButtons\(\)/);
assert.match(source, /function addSavedColor\(color\)/);
assert.match(source, /savedColorButtons\.push\(swatch\)/);
assert.match(source, /colorHeaderActions\.append\(screenEyedropperButton, customColorWrapper\)/);
assert.match(source, /const eyedropperButton = makeButton\("吸管"/);
assert.match(source, /decorateIconButton\(eyedropperButton, "⌾", "颜色吸管"\)/);
assert.match(source, /tool === "eyedropper"/);
assert.match(source, /ctx\.getImageData\(/);
assert.match(source, /applyPickedColor\(sampledColor, "已从画布吸取颜色"\)/);
assert.match(source, /function applyPickedColor\(color, message\)/);
assert.match(source, /if \(event\?\.type === "change"\) \{[\s\S]*addSavedColor\(selectedColor\)/);
assert.match(source, /已新增颜色球/);
assert.match(source, /customColor\.addEventListener\("input", applyCustomColor\)/);
assert.match(source, /customColor\.addEventListener\("change", applyCustomColor\)/);
assert.match(source, /customColor\.addEventListener\("pointerdown", \(\) => \{ nativeColorPickerActive = true; \}\)/);
assert.match(source, /nativeColorPickerActive = false;[\s\S]*customColor\.blur\(\);[\s\S]*}, 800\)/);
assert.match(source, /function isNativeColorPickerEscape\(event\)/);
assert.match(source, /nativeColorPickerActive \|\| event\.target === customColor \|\| document\.activeElement === customColor/);
assert.match(source, /if \(isNativeColorPickerEscape\(event\)\) \{[\s\S]*customColor\.blur\(\);[\s\S]*return;/);
assert.match(source, /toolbar\.append\([\s\S]*eyedropperButton/);
assert.match(source, /const visibilityGuideCanvas = document\.createElement\("canvas"\)/);
assert.match(source, /function strokeVisibilityGuideColor\(stroke\)/);
assert.match(source, /function drawStrokeVisibilityGuide\(ctx, stroke, width, height\)/);
assert.match(source, /ctx\.globalCompositeOperation = "destination-out"/);
assert.match(source, /drawStrokeVisibilityGuides\([\s\S]*previewStroke/);
assert.doesNotMatch(source, /stroke\.visibilityGuide\s*=/);
assert.match(source, /rgba\(210, 232, 255, 0\.92\)/);
assert.match(source, /rgba\(4, 10, 18, 0\.88\)/);
assert.match(source, /const screenEyedropperButton = makeButton\("屏幕取色"/);
assert.match(source, /new window\.EyeDropper\(\)\.open\(\)/);
assert.match(source, /let screenEyedropperActive = false/);
assert.match(source, /if \(screenEyedropperActive\) return;/);
assert.match(source, /screenEyedropperButton\.disabled = true/);
assert.match(source, /screenEyedropperButton\.disabled = false/);
assert.match(source, /screenEyedropperActive = false/);
assert.match(source, /屏幕取色已开启/);
const screenEyedropperHandler = source.match(
    /screenEyedropperButton\.addEventListener\("click", async \(\) => \{[\s\S]*?\n    \}\);\n    eraserButton\.addEventListener/,
);
assert.ok(screenEyedropperHandler, "screen eyedropper handler must be defined");
assert.doesNotMatch(screenEyedropperHandler[0], /nativeColorPickerActive/);
assert.match(source, /colorHeaderActions\.append\(screenEyedropperButton, customColorWrapper\)/);
assert.match(source, /addSavedColor\(selectedColor\)/);

const {rgbaToHex, normalizeSavedColors} = loadColorHelpers(source);
assert.equal(rgbaToHex(255, 106, 0), "#FF6A00");
assert.equal(rgbaToHex(35, 135, 255), "#2387FF");
assert.equal(rgbaToHex(-10, 999, 15.6), "#00FF10");
assert.deepEqual(normalizeSavedColors(["#123456", "123456", "#FF6A00", "bad"]), ["#123456"]);
const manyColors = Array.from({length: 21}, (_, index) => `#${index.toString(16).padStart(6, "0")}`);
assert.deepEqual(normalizeSavedColors(manyColors), manyColors.slice(-20).map((color) => color.toUpperCase()));

console.log("canvas drawing color UI test passed");
