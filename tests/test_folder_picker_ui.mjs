import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const sourceUrl = new URL("../js/krea2_random_lora_folder_picker.js", import.meta.url);
const source = await fs.readFile(sourceUrl, "utf8");
const extensions = [];
const fetchCalls = [];
const context = vm.createContext({
    console,
    alert() {},
    async fetch(url, options) {
        fetchCalls.push({url, options});
        return {
            ok: true,
            async json() {
                return {path: "D:\\LoRA"};
            },
        };
    },
    document: {
        createElement(tagName) {
            return {
                tagName,
                style: {},
                listeners: {},
                append(...children) {
                    this.children = children;
                },
                addEventListener(type, callback) {
                    this.listeners[type] = callback;
                },
            };
        },
    },
});
const module = new vm.SourceTextModule(source, {context, identifier: sourceUrl.href});
const appModule = new vm.SyntheticModule(["app"], function() {
    this.setExport("app", {
        graph: {setDirtyCanvas() {}},
        registerExtension(extension) {
            extensions.push(extension);
        },
    });
}, {context});
await module.link(async (specifier) => {
    assert.equal(specifier, "../../scripts/app.js");
    return appModule;
});
await module.evaluate();

const extension = extensions.find((item) => item.name === "comfyui-jindouyun-design.folder-picker");
assert.ok(extension);
const folderWidget = {name: "LoRA目录", value: "", options: {}};
const widgets = [folderWidget, {name: "固定", value: "无"}];
extension.nodeCreated({
    comfyClass: "JindouyunRandomLora",
    widgets,
    size: [480, 600],
});

assert.equal(widgets.length, 2);
assert.equal(widgets[1].name, "固定");
assert.equal(folderWidget.options.placeholder, "点击此处选择 LoRA 文件夹");
assert.equal(typeof folderWidget.draw, "function");
assert.equal(typeof folderWidget.mouse, "function");
assert.equal(typeof folderWidget.onPointerDown, "function");

const drawnText = [];
const context2d = {
    save() {},
    restore() {},
    beginPath() {},
    roundRect() {},
    rect() {},
    fill() {},
    stroke() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    measureText(value) {
        return {width: String(value).length * 7};
    },
    fillText(value) {
        drawnText.push(value);
    },
};
folderWidget.draw(context2d, {}, 480, 100, 24);
assert.equal(drawnText[0], "LoRA目录");
assert.equal(drawnText[1], "点击选择文件夹");

assert.equal(folderWidget.mouse({type: "pointerdown"}), true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].url, "/jindouyun_design/select_folder");
assert.equal(folderWidget.value, "D:\\LoRA");

console.log("folder picker UI test passed");
