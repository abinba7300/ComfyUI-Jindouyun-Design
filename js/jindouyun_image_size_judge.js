import { app } from "../../scripts/app.js";

const NODE_TYPE = "JindouyunImageSwitch";
const CROP_NODE_TYPE = "JindouyunInteractiveCrop";
const DESIRED_INPUTS = [
    ["符合尺寸图像", "IMAGE"],
    ["不符合尺寸图像", "IMAGE"],
    ["符合尺寸信号", "BOOLEAN"],
    ["不符合尺寸信号", "BOOLEAN"],
];

function nodeType(node) {
    return node?.comfyClass || node?.type;
}

function renameLegacyImageInputs(node) {
    const aliases = new Map([
        ["图像", "符合尺寸图像"],
        ["符合尺寸", "符合尺寸图像"],
        ["不符合尺寸", "不符合尺寸图像"],
    ]);
    for (const input of node.inputs || []) {
        if (input.type === "IMAGE" && aliases.has(input.name)) {
            input.name = aliases.get(input.name);
            input.label = input.name;
        }
    }
}

function ensureInput(node, name, type) {
    const existing = node.inputs?.find((input) => input.name === name && input.type === type);
    if (existing) return existing;
    node.addInput?.(name, type);
    return node.inputs?.find((input) => input.name === name && input.type === type);
}

function reorderInputs(node) {
    const graph = app.graph;
    const ordered = [];
    for (const [name, type] of DESIRED_INPUTS) {
        const input = ensureInput(node, name, type);
        if (input) ordered.push(input);
    }

    if (ordered.length !== DESIRED_INPUTS.length) return false;
    node.inputs = ordered;
    node.inputs.forEach((input, index) => {
        if (input.link == null) return;
        const link = graph?.links?.[input.link];
        if (link) link.target_slot = index;
    });
    return true;
}

function mergeLegacyOutputs(node) {
    const graph = app.graph;
    const outputs = node.outputs || [];
    if (outputs.length === 1 && outputs[0].name === "图像" && outputs[0].type === "IMAGE") {
        return false;
    }

    const imageOutputs = outputs.filter((output) => output.type === "IMAGE");
    const legacyLinks = [...new Set(imageOutputs.flatMap((output) => output.links || []))];
    for (const linkId of legacyLinks) {
        if (graph?.removeLink) graph.removeLink(linkId);
    }
    const output = imageOutputs[0] || {name: "图像", type: "IMAGE", links: []};
    output.name = "图像";
    output.label = "图像";
    output.type = "IMAGE";
    output.links = [];
    node.outputs = [output];
    return true;
}

function migrateNode(node) {
    if (nodeType(node) !== NODE_TYPE) return false;
    renameLegacyImageInputs(node);
    const inputsReady = reorderInputs(node);
    const outputsChanged = mergeLegacyOutputs(node);
    if (!inputsReady) return false;

    const computed = node.computeSize?.();
    if (computed && node.setSize) {
        node.setSize([node.size?.[0] || computed[0], Math.max(150, computed[1])]);
    }
    if (outputsChanged || inputsReady) app.graph?.setDirtyCanvas(true, true);
    return true;
}

function migrateNodeSoon(node) {
    migrateNode(node);
    window.setTimeout(() => migrateNode(node), 0);
}

function removeInvalidCropLinks(node) {
    if (nodeType(node) !== CROP_NODE_TYPE) return false;
    const graph = app.graph;
    if (!graph) return false;

    let removed = false;
    for (const output of node.outputs || []) {
        for (const linkId of [...(output.links || [])]) {
            const link = graph.links?.[linkId];
            if (!link) continue;
            const target = graph.getNodeById?.(link.target_id)
                || graph._nodes?.find((item) => item.id === link.target_id);
            if (nodeType(target) !== NODE_TYPE) continue;
            const targetInput = target.inputs?.[link.target_slot];
            if (!targetInput || output.type === targetInput.type) continue;
            if (graph.removeLink) graph.removeLink(linkId);
            else target.disconnectInput?.(link.target_slot);
            removed = true;
        }
    }
    if (removed) graph.setDirtyCanvas?.(true, true);
    return removed;
}

app.registerExtension({
    name: "comfyui-jindouyun-design.image-size-judge-migration",

    nodeCreated(node) {
        migrateNodeSoon(node);
        removeInvalidCropLinks(node);
    },

    loadedGraphNode(node) {
        migrateNodeSoon(node);
        removeInvalidCropLinks(node);
    },

    afterConfigureGraph() {
        for (const node of app.graph?._nodes || []) migrateNode(node);
        for (const node of app.graph?._nodes || []) removeInvalidCropLinks(node);
    },

    beforeRegisterNodeDef(nodeTypeDefinition, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const originalOnAdded = nodeTypeDefinition.prototype.onAdded;
        nodeTypeDefinition.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            migrateNodeSoon(this);
        };

        const originalOnConfigure = nodeTypeDefinition.prototype.onConfigure;
        nodeTypeDefinition.prototype.onConfigure = function() {
            const result = originalOnConfigure?.apply(this, arguments);
            migrateNodeSoon(this);
            return result;
        };
    },
});
