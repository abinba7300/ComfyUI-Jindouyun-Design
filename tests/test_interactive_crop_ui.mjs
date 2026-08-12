import assert from "node:assert/strict";
import fs from "node:fs/promises";

const path = new URL("../js/jindouyun_interactive_crop.js", import.meta.url);
const source = await fs.readFile(path, "utf8");

function loadRotationGeometry(script) {
    const normalize = script.match(/function normalizeRotationDegrees\(value\) \{[\s\S]*?\n\}/)?.[0];
    const rotatedSize = script.match(/function rotatedImageSize\(width, height, angle\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(normalize, "normalizeRotationDegrees must be defined");
    assert.ok(rotatedSize, "rotatedImageSize must be defined");
    return Function(`${normalize}\n${rotatedSize}\nreturn {normalizeRotationDegrees, rotatedImageSize};`)();
}

function loadRotationHandleGeometry(script) {
    const geometry = script.match(/function rotationHandleGeometry\(canvasHeight\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(geometry, "rotationHandleGeometry must be defined");
    return Function(`${geometry}\nreturn {rotationHandleGeometry};`)();
}

function loadRotationInputHelpers(script) {
    const parseInput = script.match(/function parseRotationInputValue\(value, badInput = false\) \{[\s\S]*?\n\}/)?.[0];
    const shouldSync = script.match(/function shouldSyncRotationWidget\(raw, next\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(parseInput, "parseRotationInputValue must be defined");
    assert.ok(shouldSync, "shouldSyncRotationWidget must be defined");
    return Function(`${parseInput}\n${shouldSync}\nreturn {parseRotationInputValue, shouldSyncRotationWidget};`)();
}

function loadBooleanWidgetHelper(script) {
    const helper = script.match(/function widgetBooleanValue\(value\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(helper, "widgetBooleanValue must be defined");
    return Function(`${helper}\nreturn {widgetBooleanValue};`)();
}

function loadNumericWidgetHelper(script) {
    const helper = script.match(/function finiteNumberOrDefault\(value, fallback\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(helper, "finiteNumberOrDefault must be defined");
    return Function(`${helper}\nreturn {finiteNumberOrDefault};`)();
}

function loadNumericWidgetNormalizer(script) {
    const findWidget = script.match(/function findWidget\(node, name\) \{[\s\S]*?\n\}/)?.[0];
    const clamp = script.match(/function clamp\(value, minimum, maximum\) \{[\s\S]*?\n\}/)?.[0];
    const fallback = script.match(/function finiteNumberOrDefault\(value, fallback\) \{[\s\S]*?\n\}/)?.[0];
    const normalize = script.match(/function normalizeNumericWidget\(node, name, fallback, minimum, maximum, round = false\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(findWidget && clamp && fallback && normalize, "numeric widget normalizer must be defined");
    const app = {canvas: null, graph: {setDirtyCanvas() {}}};
    return Function("app", `${findWidget}\n${clamp}\n${fallback}\n${normalize}\nreturn {normalizeNumericWidget};`)(app);
}

function loadScaledPixelSizeHelper(script) {
    const clamp = script.match(/function clamp\(value, minimum, maximum\) \{[\s\S]*?\n\}/)?.[0];
    const scaledPixelSize = script.match(/function scaledPixelSize\(width, height, widthPercent, heightPercent, aspectLocked\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(clamp, "clamp must be defined");
    assert.ok(scaledPixelSize, "scaledPixelSize must be defined");
    return Function(`${clamp}\n${scaledPixelSize}\nreturn {scaledPixelSize};`)();
}

function loadCropPanelWidthHelper(script) {
    const helper = script.match(/function syncCropPanelWidth\(node, wrapper\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(helper, "syncCropPanelWidth must be defined");
    return Function(`${helper}\nreturn {syncCropPanelWidth};`)();
}

assert.match(source, /const NODE_TYPE = "JindouyunInteractiveCrop"/);
assert.match(source, /自由比例/);
assert.match(source, /const canvasShell = document\.createElement\("div"\)/);
assert.match(source, /canvas\.addEventListener\("pointerdown"/);
assert.match(source, /resizeCropFree/);
assert.match(source, /resizeCropWithRatio/);
assert.match(source, /原始裁剪 \$\{pixels\.width\} × \$\{pixels\.height\}/);
assert.match(source, /function maxEdgePixelSize/);
assert.match(source, /function scaledPixelSize/);
assert.match(source, /function isMaxEdgeEnabled/);
assert.match(source, /findWidget\(node, "最大边分辨率"\)/);
assert.match(source, /findWidget\(node, "启用最大边分辨率"\)/);
assert.match(source, /const maxEdgeToggleButton = makeButton/);
assert.match(source, /最大边缩放/);
assert.match(source, /const maxEdgeInput = document\.createElement\("input"\)/);
assert.match(source, /maxEdgeInput\.addEventListener\("change"/);
assert.match(source, /最大边分辨率/);
assert.match(source, /findWidget\(node, "锁定长宽比"\)/);
assert.match(source, /findWidget\(node, "宽度比例"\)/);
assert.match(source, /findWidget\(node, "高度比例"\)/);
assert.match(source, /findWidget\(node, "分流标准最大边"\)/);
assert.match(source, /const aspectLockButton = makeButton/);
assert.match(source, /function updateAspectLock/);
assert.match(source, /function updateTransformScale/);
assert.match(source, /const resetTransformButton = makeButton\("重置"/);
assert.match(source, /function resetTransformScale/);
assert.match(source, /if \(!source \|\| aspectLocked\) return;/);
assert.match(source, /handle\.setAttribute\("aria-disabled", String\(aspectLocked\)\)/);
assert.match(source, /hideTransformWidgets\(node\)/);
assert.match(source, /function normalizeCropNumericWidgets/);
assert.match(source, /normalizeCropNumericWidgets\(this\)/);
assert.match(source, /afterConfigureGraph\(\)/);
assert.match(source, /function syncCropPanelWidth/);
assert.match(source, /wrapper\.style\.maxWidth/);
assert.match(source, /node\.onResize = function/);
assert.match(source, /requestAnimationFrame\(\(\) => syncCropPanelWidth\(node, wrapper\)\)/);
assert.match(source, /const transformHandleLayer = document\.createElement\("div"\)/);
assert.match(source, /function makeTransformHandle/);
assert.match(source, /function updateTransformHandlePositions/);
assert.match(source, /mode: "transform-scale"/);
assert.match(source, /const previewDimensions = scaledPixelSize/);
assert.match(source, /符合尺寸|不符合尺寸/);
assert.match(source, /原始裁剪 \$\{pixels\.width\} × \$\{pixels\.height\}（判断）/);
assert.match(source, /const branch = Math\.max\(pixels\.width, pixels\.height\) >= splitThreshold/);
assert.doesNotMatch(source, /jindouyunMaxEdgeAuto/);
assert.match(source, /最大边缩放已关闭/);
assert.match(source, /patchMaxEdgeWidget/);
assert.match(source, /const RESIZE_METHODS =/);
assert.match(source, /patchResizeMethodWidget/);
assert.match(source, /RESIZE_METHODS\.includes\(String\(widget\.value/);
assert.match(source, /connectedSource\(node\)/);
assert.match(source, /function executionPreviewUrl/);
assert.match(source, /t: String\(Date\.now\(\)\)/);
assert.match(source, /api\.addEventListener\("executed"/);
assert.match(source, /api\.addEventListener\("execution_success"/);
assert.match(source, /__jindouyunCropExecutionPreview/);
assert.match(source, /scheduleCropSourceRefresh/);
assert.match(source, /refreshSource\(\{quiet: Boolean\(source\)\}\)/);
assert.match(source, /uploadImageUrl\(node\)/);
assert.match(source, /setWidgetValue\(dataWidget, serializeCrop\(crop, ratioLock\), node\)/);
assert.match(source, /getMinHeight: \(\) => 625/);
assert.match(source, /patchNativeImagePreview/);
assert.doesNotMatch(source, /makeButton\("✂ 打开交互裁剪"/);
assert.match(source, /nodeData\.name !== NODE_TYPE/);

assert.match(source, /function normalizeRotationDegrees/);
assert.match(source, /function rotatedImageSize/);
assert.match(source, /function drawCheckerboard/);
assert.match(source, /findWidget\(node, "图片旋转"\)/);
assert.match(source, /findWidget\(node, "左右镜像"\)/);
assert.match(source, /findWidget\(node, "上下镜像"\)/);
assert.match(source, /const mirrorHorizontalButton = makeButton\("↔ 左右"/);
assert.match(source, /const mirrorVerticalButton = makeButton\("↕ 上下"/);
assert.match(source, /function hideMirrorWidgets/);
assert.match(source, /hideMirrorWidgets\(node\);/);
assert.match(source, /ctx\.scale\(mirrorHorizontal \? -1 : 1, mirrorVertical \? -1 : 1\)/);
assert.match(source, /ctx\.rotate\(rotation \* Math\.PI \/ 180\)/);
assert.match(
    source,
    /if \(rotation === 0 && !mirrorHorizontal && !mirrorVertical\) \{\s+ctx\.drawImage\(source, 0, 0, canvas\.width, canvas\.height\);\s+\} else \{/,
);

assert.match(source, /rotationNumber\.min = "-180"/);
assert.match(source, /rotationNumber\.max = "180"/);
assert.match(source, /rotationNumber\.step = "0\.1"/);
assert.match(source, /const resetRotationButton = makeButton\("归零"/);
assert.match(source, /const rotateLeftButton = makeButton\("↶ 90°"/);
assert.match(source, /const rotateRightButton = makeButton\("↷ 90°"/);
assert.match(source, /function hideRotationWidget/);
assert.match(source, /hideRotationWidget\(node\);/);
assert.match(source, /mode: "rotate"/);
assert.match(source, /hitRotationHandle\(pointer\.x, pointer\.y\)/);
assert.match(source, /Math\.atan2/);
assert.match(source, /updateRotation\(0\)/);
assert.match(source, /updateRotation\(rotation - 90\)/);
assert.match(source, /updateRotation\(rotation \+ 90\)/);
assert.match(source, /rotationNumber\.addEventListener\("input", \(\) => \{/);
assert.match(source, /rotationNumber\.validity\?\.badInput/);
assert.match(source, /if \(parsedRotation !== null\) updateRotation\(parsedRotation\);/);
assert.match(source, /rotationNumber\.value = String\(rotation\);/);
assert.match(source, /height: "625px"/);
assert.match(source, /height: "338px"/);
assert.match(source, /minHeight: "338px"/);
assert.match(source, /旋转 \$\{[^}]+\}°/);
assert.match(source, /rotationWidget\.callback = function\(value\)/);
assert.match(source, /updateRotation\(value, \{fromWidget: true\}\)/);
assert.match(source, /updateRotation\(rotationWidget\?\.value, \{fromWidget: true\}\)/);
assert.match(source, /node\.__jindouyunResetForNewImage/);
assert.match(source, /let resetReady = false/);
assert.match(source, /if \(resetReady && currentValue && currentValue !== previousValue\)/);
assert.match(source, /crop = \{\.\.\.DEFAULT_CROP\}/);
assert.match(source, /ratioLock = null/);
assert.match(source, /const rotationAvailable = Boolean\(rotationWidget\);/);
assert.match(source, /rotationNumber\.disabled = true/);
assert.match(source, /for \(const button of \[rotateLeftButton, rotateRightButton, resetRotationButton\]\)/);
assert.match(source, /请重启 ComfyUI 后再使用旋转功能/);
assert.match(source, /function isDroppedImageFile/);
assert.match(source, /async function uploadDroppedImage/);
assert.match(source, /api\.fetchApi\("\/upload\/image"/);
assert.match(source, /node\.onDragDrop = async function/);
assert.match(source, /wrapper\.addEventListener\("drop"/);
assert.match(source, /if \(!rotationAvailable\) return false;/);
assert.match(source, /if \(rotationAvailable\) \{\s+const rotationHandle = rotationHandlePosition\(\);/);
assert.match(source, /ctx\.setLineDash\(\[4, 4\]\);/);
assert.match(source, /ctx\.strokeStyle = "rgba\(245, 158, 11, 0\.35\)";/);
assert.match(
    source,
    /ctx\.moveTo\(canvas\.width \/ 2, canvas\.height \/ 2\);\s+ctx\.lineTo\(rotationHandle\.x, rotationHandle\.y\);/,
);

const {normalizeRotationDegrees, rotatedImageSize} = loadRotationGeometry(source);
assert.equal(normalizeRotationDegrees(450), 90);
assert.equal(normalizeRotationDegrees(180), 180);
assert.equal(normalizeRotationDegrees(540), 180);
assert.equal(normalizeRotationDegrees(-180), -180);
assert.equal(normalizeRotationDegrees(""), 0);
assert.equal(normalizeRotationDegrees(null), 0);
assert.equal(normalizeRotationDegrees("not-a-number"), 0);
assert.deepEqual(rotatedImageSize(100, 50, 45), {width: 107, height: 107});

const {rotationHandleGeometry} = loadRotationHandleGeometry(source);
assert.deepEqual(rotationHandleGeometry(9), {radius: 4.5, y: 4.5});
assert.deepEqual(rotationHandleGeometry(100), {radius: 7, y: 18});

const {parseRotationInputValue, shouldSyncRotationWidget} = loadRotationInputHelpers(source);
assert.equal(parseRotationInputValue(""), null);
assert.equal(parseRotationInputValue("-"), null);
assert.equal(parseRotationInputValue("+"), null);
assert.equal(parseRotationInputValue("1.", true), null);
assert.equal(parseRotationInputValue("12.5"), 12.5);
assert.equal(parseRotationInputValue("not-a-number"), null);
assert.equal(shouldSyncRotationWidget(12.5, 12.5), false);
assert.equal(shouldSyncRotationWidget("12.5", 12.5), false);
assert.equal(shouldSyncRotationWidget("", 0), true);
assert.equal(shouldSyncRotationWidget(null, 0), true);
assert.equal(shouldSyncRotationWidget(Number.POSITIVE_INFINITY, 0), true);
assert.equal(shouldSyncRotationWidget("not-a-number", 0), true);
assert.equal(shouldSyncRotationWidget(0, 12.5), true);

const {widgetBooleanValue} = loadBooleanWidgetHelper(source);
assert.equal(widgetBooleanValue(true), true);
assert.equal(widgetBooleanValue(false), false);
assert.equal(widgetBooleanValue("true"), true);
assert.equal(widgetBooleanValue("false"), false);
assert.equal(widgetBooleanValue(1), true);
assert.equal(widgetBooleanValue(0), false);

const {finiteNumberOrDefault} = loadNumericWidgetHelper(source);
assert.equal(finiteNumberOrDefault("", 100), 100);
assert.equal(finiteNumberOrDefault("   ", 100), 100);
assert.equal(finiteNumberOrDefault(null, 100), 100);
assert.equal(finiteNumberOrDefault(undefined, 100), 100);
assert.equal(finiteNumberOrDefault("125", 100), 125);
assert.equal(finiteNumberOrDefault(0, 100), 0);
assert.equal(finiteNumberOrDefault("not-a-number", 100), 100);

const {normalizeNumericWidget} = loadNumericWidgetNormalizer(source);
const emptyWidth = {name: "宽度比例", value: ""};
const emptyRotation = {name: "图片旋转", value: ""};
const numericNode = {widgets: [emptyWidth, emptyRotation]};
assert.equal(normalizeNumericWidget(numericNode, "宽度比例", 100, 1, 2000), 100);
assert.equal(emptyWidth.value, 100);
assert.equal(normalizeNumericWidget(numericNode, "图片旋转", 0, -180, 180), 0);
assert.equal(emptyRotation.value, 0);

const {scaledPixelSize} = loadScaledPixelSizeHelper(source);
assert.deepEqual(scaledPixelSize(800, 1200, 50, 75, false), {width: 400, height: 900});
assert.deepEqual(scaledPixelSize(800, 1200, 50, 75, true), {width: 400, height: 600});
assert.deepEqual(scaledPixelSize(800, 1200, 2500, 0, false), {width: 16000, height: 12});

const {syncCropPanelWidth} = loadCropPanelWidthHelper(source);
const cropPanelHost = {
    style: {},
    classList: {contains: (name) => name === "dom-widget"},
};
const cropPanelWrapper = {style: {}, parentElement: cropPanelHost};
assert.equal(syncCropPanelWidth({size: [380, 686]}, cropPanelWrapper), 352);
assert.equal(cropPanelWrapper.style.width, "352px");
assert.equal(cropPanelWrapper.style.maxWidth, "352px");
assert.equal(cropPanelHost.style.width, "352px");
assert.equal(cropPanelHost.style.maxWidth, "352px");
assert.equal(syncCropPanelWidth({size: [224, 686]}, cropPanelWrapper), 196);

console.log("interactive crop UI source test passed");
