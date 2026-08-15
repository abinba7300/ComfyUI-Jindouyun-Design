import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const drawingPath = new URL("../js/jindouyun_canvas_drawing.js", import.meta.url);
const source = await fs.readFile(drawingPath, "utf8");
const compositeSource = await fs.readFile(
    new URL("../js/jindouyun_canvas_composite.js", import.meta.url),
    "utf8",
);
const compositeRuntimeSource = await fs.readFile(
    new URL("../js/jindouyun_canvas_composite_runtime2.js", import.meta.url),
    "utf8",
);
assert.match(compositeRuntimeSource, /jindouyun_canvas_composite\.js\?v=20260815-canvas-overflow1/);
assert.match(compositeSource, /function drawInputImagePreview/);
assert.match(compositeSource, /ctx\.drawImage\(source/);
assert.match(compositeSource, /computeLayoutSize/);
assert.match(compositeSource, /maxHeight:\s*height/);
assert.match(compositeSource, /resolvePreviewArea/);
assert.match(compositeSource, /resolvePreviewWidgetHeight/);
assert.doesNotMatch(compositeSource, /computeSize\(\)\s*\{[\s\S]{0,300}remainingHeight/);
assert.match(compositeSource, /loadedGraphNode\(node\)/);
assert.match(compositeSource, /Number\(node\.size\?\.\[1\] \|\| 0\) - y - 8/);
assert.match(compositeSource, /jindouyun_canvas_geometry\.mjs\?v=20260815-canvas-overflow1/);
assert.match(source, /曲线优化：开/);
assert.match(source, /smoothingStrength: 50/);
assert.match(source, /smartRegularize: false/);
assert.match(source, /smartRegularize: parsed\.smartRegularize === true/);
assert.match(source, /regularizeSensitivity: 50/);
assert.match(source, /智能规整：开/);
assert.match(source, /识别灵敏度/);
assert.match(source, /regularizeStrokePoints/);
assert.match(source, /已规整为/);
assert.match(source, /智能直线/);
assert.match(source, /智能圆弧/);
assert.match(source, /优化全部/);
assert.match(source, /优化选中/);
assert.match(source, /选择线条/);
assert.match(source, /几何图形/);
assert.match(source, /createShapeStrokePoints/);
assert.match(source, /stopImmediatePropagation/);
assert.match(source, /window\.addEventListener\("keyup", onKeyUp, true\)/);
assert.match(source, /图形 100%/);
assert.match(source, /let brushSize = 10/);
assert.match(source, /const brushButton = makeButton\("普通画笔"/);
assert.match(source, /const pencilBrushButton = makeButton\("铅笔质感"/);
assert.match(source, /brushType = "solid"/);
assert.match(source, /brushType = "pencil"/);
assert.doesNotMatch(source, /brushTypeSelect/);
assert.match(source, /brushType: tool === "brush" \? brushType : "solid"/);
assert.match(source, /function drawPencilStroke\(ctx, pixelPoints, lineWidth\)/);
assert.match(source, /stroke\.brushType === "pencil"/);
assert.match(source, /sizeInput\.min = "2"/);
assert.match(source, /sizeInput\.max = "20"/);
assert.match(source, /customSizeInput\.max = "5000"/);
assert.match(source, /decorateIconButton\(runButton, "▶", "保存并运行"\)/);
assert.match(source, /let queueCount = Math\.round\(clamp\(node\.__jindouyunQueueCount \?\? 1, 1, 999\)\)/);
assert.match(source, /queueCountInput\.type = "number"/);
assert.match(source, /queueMinusButton\.addEventListener/);
assert.match(source, /queuePlusButton\.addEventListener/);
assert.match(source, /app\.queuePrompt\?\.\(0, requestedQueueCount\)/);
assert.match(source, /保存并运行 ×\$\{queueCount\}/);
assert.match(source, /输入图作背景/);
assert.match(source, /const customColorWrapper = document\.createElement\("div"\)/);
assert.match(source, /conic-gradient\(#FF3B30/);
assert.match(source, /width: "44px", height: "44px"/);
assert.match(source, /customColorPreview\.style\.background = activeColor/);
assert.match(source, /BRUSH_COLOR_STORAGE_KEY/);
assert.match(source, /groupSelectButton/);
assert.match(source, /transformDrawingGroup/);
assert.match(source, /const layerList = document.createElement\("div"\)/);
assert.match(source, /hitLayerTransformHandle/);
assert.match(source, /inputVisible: parsed\.inputVisible !== false/);
assert.match(source, /resize: "vertical"/);
assert.match(source, /event\?\.shiftKey/);
assert.match(source, /function eraseStrokeAt\(pointerX, pointerY\)/);
assert.match(source, /drawing\.strokes\.splice\(hitIndex, 1\)/);
assert.match(source, /eraserDrag = \{historyRecorded: currentStrokeHasHistory\}/);
assert.match(source, /触碰绘画线条即可删除整笔/);
assert.match(source, /height: "min\(620px, 52vh\)"/);
assert.match(source, /Math\.min\(selectionAnchorIndex, index\)/);
assert.match(source, /Math\.max\(selectionAnchorIndex, index\)/);
assert.match(source, /for \(let current = start; current <= end; current \+= 1\)/);
assert.match(source, /isEditorTransformShortcut/);
assert.match(source, /createGroupFromSelection/);
assert.match(source, /if \(!allInSharedGroup\)/);
assert.match(source, /const stage = document.createElement\("div"\)/);
assert.match(source, /stage\.style\.gridTemplateColumns/);
assert.match(source, /const rightPanel = document.createElement\("aside"\)/);
assert.match(source, /workspace\.append\(canvas, mirrorToggleLabel\)/);
assert.match(source, /mirrorToggleLabel\.style\.top/);
assert.match(source, /width: "146px"/);
assert.match(source, /height: "22px", minHeight: "22px"/);
assert.match(source, /Math\.max\(0, \(availableHeight - cssHeight\) \/ 2\)/);
assert.match(source, /commandSection\.append\(commandTitle, outputToggleLabel, commandGrid\)/);
assert.match(source, /status\.append\(statusSize, statusMessage\)/);
assert.match(source, /decorateIconButton\(brushButton/);
assert.match(source, /decorateIconButton\(undoButton/);
const context = vm.createContext({console});
const registeredExtensions = [];
const drawingModule = new vm.SourceTextModule(source, {
    context,
    identifier: drawingPath.href,
});
const appModule = new vm.SyntheticModule(["app"], function() {
    this.setExport("app", {
        canvas: {},
        graph: {setDirtyCanvas() {}},
        registerExtension(extension) {
            registeredExtensions.push(extension);
        },
    });
}, {context});
const cachedGeometryModule = new vm.SyntheticModule([
    "normalizeScaleMode",
    "resolveDraggedLayerPosition",
    "resolveLayerSize",
    "SCALE_MODE_MANUAL",
], function() {
    this.setExport("normalizeScaleMode", (value) => value);
    this.setExport("resolveDraggedLayerPosition", () => ({}));
    this.setExport("resolveLayerSize", () => ({width: 1, height: 1}));
    this.setExport("SCALE_MODE_MANUAL", "手动缩放");
}, {context});

await drawingModule.link(async (specifier) => {
    if (specifier === "../../scripts/app.js") {
        return appModule;
    }
    if (specifier.startsWith("./jindouyun_canvas_geometry.mjs")) {
        return cachedGeometryModule;
    }
    assert.fail(`Unexpected import: ${specifier}`);
});
await drawingModule.evaluate();

const drawingExtension = registeredExtensions.find((extension) =>
    extension.name === "comfyui-jindouyun-design.canvas-drawing"
);
assert.ok(drawingExtension);
const rotationWidget = {name: "图片旋转", value: ""};
drawingExtension.nodeCreated({
    comfyClass: "JindouyunCanvasComposite",
    widgets: [rotationWidget, {name: "绘画数据", value: '{"version":1,"strokes":[]}'}],
});
assert.equal(rotationWidget.value, "0.0");

function CachedCanvasNode() {
    this.comfyClass = "JindouyunCanvasComposite";
    this.widgets = [{name: "图片旋转", value: "0.0"}];
}
CachedCanvasNode.prototype.onConfigure = function() {
    this.widgets[0].value = "";
};
drawingExtension.beforeRegisterNodeDef(CachedCanvasNode, {name: "JindouyunCanvasComposite"});
const restoredNode = new CachedCanvasNode();
restoredNode.onConfigure({});
assert.equal(restoredNode.widgets[0].value, "0.0");

console.log("canvas drawing import compatibility test passed");
