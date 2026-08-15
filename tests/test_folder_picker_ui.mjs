import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const sourceUrl = new URL("../js/krea2_random_lora_folder_picker.js", import.meta.url);
const source = await fs.readFile(sourceUrl, "utf8");
const extensions = [];
const fetchCalls = [];
const animationFrames = [];
const context = vm.createContext({
    console,
    alert() {},
    window: {
        requestAnimationFrame(callback) {
            animationFrames.push(callback);
        },
    },
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
                dataset: {},
                listeners: {},
                attributes: {},
                append(...children) {
                    this.children = children;
                },
                setAttribute(name, value) {
                    this.attributes[name] = String(value);
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
let randomCallbackCount = 0;
class RandomLoraNode {
    constructor() {
        this.comfyClass = "JindouyunRandomLora";
        this.size = [480, 600];
        this.inputs = [
            {name: "模型", type: "MODEL"},
            {name: "随机", type: "BOOLEAN"},
            {name: "LoRA目录", type: "STRING"},
            {name: "固定", type: "COMBO"},
        ];
        this.widgets = [
            {name: "随机", value: true, callback() { randomCallbackCount += 1; }},
            {name: "LoRA目录", value: "", options: {}},
            {name: "固定", value: "无"},
            {name: "LoRA值最小", value: 0.6},
            {name: "LoRA值最大", value: 1.0},
            {name: "重绘值最小", value: 0.5},
            {name: "重绘值最大", value: 1.0},
            {name: "seed", value: 0},
            {name: "生成后控制", value: "randomize"},
            {name: "子目录", value: false},
            {name: "过滤", value: ""},
            {name: "LoRA值步进", value: 0.05},
            {name: "重绘值步进", value: 0.05},
        ];
    }

    configure(info) {
        if (Array.isArray(info.inputs)) this.inputs = info.inputs.map((input) => ({...input}));
        info.widgets_values?.forEach((value, index) => {
            if (this.widgets[index]) this.widgets[index].value = value;
        });
    }

    addDOMWidget(name, type, element, options) {
        const widget = {name, type, element, options};
        this.widgets.push(widget);
        return widget;
    }

    setSize(size) {
        this.size = size;
    }
}

extension.beforeRegisterNodeDef(RandomLoraNode, {name: "JindouyunRandomLora"});
const node = new RandomLoraNode();
const malformedWorkflow = {
    type: "JindouyunRandomLora",
    inputs: [
        {name: "模型", type: "MODEL"},
        {name: "启用", localized_name: "启用", type: "BOOLEAN"},
        {name: "随机", type: "BOOLEAN"},
        {name: "LoRA目录", type: "STRING"},
        {name: "固定", type: "COMBO"},
        {name: "LoRA值最小", type: "FLOAT"},
        {name: "LoRA值最大", type: "FLOAT"},
        {name: "重绘值最小", type: "FLOAT"},
        {name: "重绘值最大", type: "FLOAT"},
        {name: "seed", type: "INT"},
        {name: "子目录", type: "BOOLEAN"},
        {name: "过滤", type: "STRING"},
        {name: "LoRA值步进", type: "FLOAT"},
        {name: "重绘值步进", type: "FLOAT"},
    ],
    widgets_values: [
        "",
        true,
        false,
        "C:\\ComfyUI\\models\\loras\\demo-model",
        "demo-model\\DEMO-STYLE-LORA-V1.0_000004500.safetensors",
        1,
        1,
        1,
        1,
        559179573216862,
        "randomize",
        false,
        "",
        0.05,
        0.05,
    ],
};
extension.beforeConfigureGraph({nodes: [malformedWorkflow]});
node.configure(malformedWorkflow);
extension.nodeCreated(node);
while (animationFrames.length) animationFrames.shift()(0);

const widgets = node.widgets;
const randomWidget = widgets.find((widget) => widget.name === "随机");
const folderWidget = widgets.find((widget) => widget.name === "LoRA目录");
const fixedWidget = widgets.find((widget) => widget.name === "固定");
assert.equal(malformedWorkflow.widgets_values.length, 13);
assert.equal(malformedWorkflow.inputs.length, 13);
assert.equal(node.inputs.some((input) => input.name === "启用"), false);
assert.equal(widgets.length, 13, "mode card must reuse the native random widget");
assert.equal(widgets.some((widget) => widget.name === "启用"), false);
assert.equal(randomWidget.value, false);
assert.equal(folderWidget.value, "C:\\ComfyUI\\models\\loras\\demo-model");
assert.equal(fixedWidget.value, "demo-model\\DEMO-STYLE-LORA-V1.0_000004500.safetensors");
assert.equal(widgets.find((widget) => widget.name === "LoRA值最大").value, 1);
assert.equal(folderWidget.options.placeholder, "点击此处选择 LoRA 文件夹");
assert.equal(typeof folderWidget.draw, "function");
assert.equal(typeof folderWidget.mouse, "function");
assert.equal(typeof folderWidget.onPointerDown, "function");
assert.equal(randomWidget.computeSize(480)[1], 60);
assert.equal(typeof randomWidget.draw, "function");

randomWidget.mouse({type: "pointerdown", preventDefault() {}, stopPropagation() {}});
assert.equal(randomWidget.value, true);
assert.equal(randomCallbackCount, 1);

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
    arc() {},
    closePath() {},
    measureText(value) {
        return {width: String(value).length * 7};
    },
    fillText(value) {
        drawnText.push(value);
    },
};
randomWidget.draw(context2d, node, 480, 100, 60);
assert.ok(drawnText.includes("随"));
assert.ok(drawnText.includes("随机目录模式"));
assert.ok(drawnText.includes("目录内全部 LoRA · 每次随机 1 个"));

drawnText.length = 0;
folderWidget.draw(context2d, {}, 480, 100, 24);
assert.equal(drawnText[0], "LoRA目录");
assert.equal(drawnText[1], "C:\\ComfyUI\\models\\loras\\demo-model");

assert.equal(folderWidget.mouse({type: "pointerdown"}), true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].url, "/jindouyun_design/select_folder");
assert.equal(folderWidget.value, "D:\\LoRA");

console.log("folder picker UI test passed");
