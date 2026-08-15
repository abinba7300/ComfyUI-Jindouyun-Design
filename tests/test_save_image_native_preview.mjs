import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";


const sourceUrl = new URL("../js/jindouyun_save_image.js", import.meta.url);
const source = await fs.readFile(sourceUrl, "utf8");
const extensions = [];
let animationTime = 0;

class MockImage {
    constructor() {
        this.src = "";
        this.onload = null;
        this.onerror = null;
    }
}

const context = vm.createContext({
    console,
    Image: MockImage,
    URLSearchParams,
    performance: {
        now() {
            return animationTime;
        },
    },
    window: {
        requestAnimationFrame(callback) {
            animationTime += 500;
            callback(animationTime);
        },
    },
});

const appModule = new vm.SyntheticModule(["app"], function() {
    this.setExport("app", {
        canvas: {},
        graph: {},
        registerExtension(extension) {
            extensions.push(extension);
        },
    });
}, {context});

const apiModule = new vm.SyntheticModule(["api"], function() {
    this.setExport("api", {
        apiURL(path) {
            return path;
        },
    });
}, {context});

const geometryModule = new vm.SyntheticModule([
    "containImageRect",
    "featuredPreviewRects",
    "interpolateRect",
    "pointInRect",
], function() {
    this.setExport("containImageRect", () => ({x: 0, y: 0, width: 1, height: 1}));
    this.setExport("featuredPreviewRects", () => []);
    this.setExport("interpolateRect", (from) => from);
    this.setExport("pointInRect", (x, y, rect) => Boolean(rect)
        && x >= rect.x
        && x <= rect.x + rect.width
        && y >= rect.y
        && y <= rect.y + rect.height);
}, {context});

const module = new vm.SourceTextModule(source, {context, identifier: sourceUrl.href});
await module.link((specifier) => {
    if (specifier.endsWith("scripts/app.js")) return appModule;
    if (specifier.endsWith("scripts/api.js")) return apiModule;
    if (specifier.endsWith("jindouyun_save_preview_geometry.mjs")) return geometryModule;
    throw new Error(`Unexpected import: ${specifier}`);
});
await module.evaluate();

const extension = extensions.find((item) => item.name === "comfyui-jindouyun-design.save-image");
assert.ok(extension);

class SaveImageNode {
    constructor() {
        this.pos = [1000, 500];
        this.size = [400, 500];
        this.widgets = [];
        this.imgs = [];
    }

    onExecuted(message) {
        this.imgs = message.images.map(() => "native-preview");
    }

    addCustomWidget(widget) {
        this.widgets.push(widget);
        return widget;
    }

    computeSize() {
        return [400, 500];
    }

    setSize(size) {
        this.size = size;
    }

    setDirtyCanvas() {}
}

extension.beforeRegisterNodeDef(SaveImageNode, {name: "JindouyunSaveImage"});
const node = new SaveImageNode();
node.onExecuted({
    images: [0, 1, 2, 3].map((index) => ({
        filename: `preview-${index}.png`,
        subfolder: "",
        type: "temp",
    })),
});

assert.equal(node.imgs.length, 0, "ComfyUI native preview cache must stay empty");
assert.equal(node.__jindouyunRecentImages.length, 4);
assert.ok(node.__jindouyunRecentImages.every((image) => image instanceof MockImage));
assert.ok(node.__jindouyunFeaturedPreviewWidget);

const previewWidget = node.__jindouyunFeaturedPreviewWidget;
previewWidget.hitRects = [
    {x: 10, y: 20, width: 200, height: 300},
    {x: 220, y: 20, width: 80, height: 90},
    {x: 220, y: 120, width: 80, height: 90},
    {x: 220, y: 220, width: 80, height: 90},
];
previewWidget.trashRect = {x: 300, y: 300, width: 70, height: 32};

previewWidget.mouse({type: "pointerdown", timeStamp: 100}, [1230, 630], node);
assert.equal(previewWidget.selectedIndex, 2, "global canvas coordinates must select a thumbnail");
previewWidget.mouse({type: "pointerdown", timeStamp: 260}, [1230, 630], node);
assert.equal(node.__jindouyunRecentImageData[0].filename, "preview-2.png");
assert.equal(previewWidget.selectedIndex, 0, "double-clicked thumbnail becomes featured");

let deleteRequest = null;
node.__jindouyunEffectiveSaveDirectory = () => "C:\\save";
node.__jindouyunPostSaveJson = async (endpoint, body) => {
    deleteRequest = {endpoint, body};
    return {ok: true, filename: body.filename, directory: "C:\\save", images: []};
};
previewWidget.trashRect = {x: 300, y: 300, width: 70, height: 32};
previewWidget.mouse({type: "pointerdown", timeStamp: 600}, [1335, 816], node);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(deleteRequest?.endpoint, "/jindouyun_design/delete_saved_image");
assert.equal(deleteRequest?.body?.filename, "preview-2.png");
assert.equal(node.__jindouyunRecentImageData.length, 0);

console.log("save image native preview suppression test passed");
