import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const sourceUrl = new URL("../js/jindouyun_image_size_judge.js", import.meta.url);
const source = await fs.readFile(sourceUrl, "utf8");
const extensions = [];
const graph = {
    links: {},
    _nodes: [],
    setDirtyCanvas() {},
    getNodeById(id) {
        return this._nodes.find((node) => node.id === id);
    },
    removeLink(id) {
        delete this.links[id];
    },
};
const context = vm.createContext({
    console,
    window: {setTimeout},
    Set,
});
const module = new vm.SourceTextModule(source, {context, identifier: sourceUrl.href});
const appModule = new vm.SyntheticModule(["app"], function() {
    this.setExport("app", {
        graph,
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

const extension = extensions.find(
    (item) => item.name === "comfyui-jindouyun-design.image-size-judge-migration",
);
assert.ok(extension);

const removed = [];
const node = {
    id: 10,
    comfyClass: "JindouyunImageSwitch",
    inputs: [
        {name: "图像", type: "IMAGE"},
        {name: "符合尺寸信号", type: "BOOLEAN"},
        {name: "不符合尺寸信号", type: "BOOLEAN"},
        {name: "符合尺寸", type: "IMAGE"},
        {name: "不符合尺寸", type: "IMAGE"},
    ],
    outputs: [
        {name: "符合尺寸", type: "IMAGE", links: []},
        {name: "不符合尺寸", type: "IMAGE", links: []},
    ],
    size: [420, 260],
    removeInput(index) {
        removed.push(this.inputs[index].name);
        this.inputs.splice(index, 1);
    },
    addInput(name, type) {
        this.inputs.push({name, type, link: null});
    },
    removeOutput(index) {
        this.outputs.splice(index, 1);
    },
    computeSize() {
        return [260, 130];
    },
    setSize(size) {
        this.size = size;
    },
};

extension.nodeCreated(node);
await new Promise((resolve) => setTimeout(resolve, 0));

assert.deepEqual(
    Array.from(node.inputs, (input) => input.name),
    ["符合尺寸图像", "不符合尺寸图像", "符合尺寸信号", "不符合尺寸信号"],
);
assert.deepEqual(Array.from(node.outputs, (output) => output.name), ["图像"]);
assert.equal(node.size[0], 420);
assert.equal(node.size[1], 150);

const imageTarget = {
    id: 2,
    comfyClass: "JindouyunImageSwitch",
    inputs: [
        {name: "image_b", type: "IMAGE", link: 100},
        {name: "enabled", type: "BOOLEAN", link: 101},
    ],
};
const cropNode = {
    id: 1,
    comfyClass: "JindouyunInteractiveCrop",
    outputs: [
        {name: "图像", type: "IMAGE", links: []},
        {name: "符合尺寸", type: "BOOLEAN", links: [100, 101]},
        {name: "不符合尺寸", type: "BOOLEAN", links: []},
    ],
};
graph._nodes = [cropNode, imageTarget];
graph.links = {
    100: {target_id: 2, target_slot: 0},
    101: {target_id: 2, target_slot: 1},
};

extension.afterConfigureGraph();

assert.equal(graph.links[100], undefined);
assert.deepEqual(graph.links[101], {target_id: 2, target_slot: 1});

console.log("image size judge UI migration test passed");
