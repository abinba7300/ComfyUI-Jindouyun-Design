import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
    MAX_SEGMENTS,
    addScheme,
    addSegment,
    bindLoraToScheme,
    createDefaultRouterConfig,
    findSerializedRouterConfig,
    matchLoraScheme,
    migrateRouterNodeData,
    migrateRouterWorkflowGraphData,
    normalizeLoraSignal,
    normalizeRouterConfig,
    removeScheme,
    removeSegment,
    replaceSchemeBindings,
    resolveExecutedSchemeId,
    setDefaultScheme,
} from "../js/jindouyun_string_router_config.mjs";


const defaultConfig = createDefaultRouterConfig();
assert.equal(defaultConfig.schemes.length, 1);
assert.equal(defaultConfig.schemes[0].segments.length, 3);
assert.equal(defaultConfig.schemes[0].isDefault, true);

assert.equal(
    normalizeLoraSignal(' "demo-model\\styles\\DEMO-STYLE-LORA-v2.safetensors" '),
    "demo-model/styles/DEMO-STYLE-LORA-v2",
);

let config = addScheme(defaultConfig, "第二方案");
assert.equal(config.schemes.length, 2);
assert.equal(config.schemes[1].segments.length, 3);
assert.equal(config.activeSchemeId, config.schemes[1].id);

const firstId = config.schemes[0].id;
const secondId = config.schemes[1].id;
config = bindLoraToScheme(config, firstId, "same-lora.safetensors");
config = bindLoraToScheme(config, secondId, "same-lora");
assert.deepEqual(config.schemes[0].bindings, []);
assert.deepEqual(config.schemes[1].bindings, ["same-lora"]);

config = replaceSchemeBindings(config, secondId, ["V1.1", "V1.0"]);
assert.equal(config.schemes[1].name, "第二方案");
assert.deepEqual(config.schemes[1].bindings, ["V1.1", "V1.0"]);

const previewMatch = matchLoraScheme(config, "DEMO-STYLE-LORA-V1.1_000005100.safetensors");
assert.equal(previewMatch.matchMode, "matched");
assert.equal(previewMatch.schemeName, "第二方案");
assert.equal(previewMatch.matchedKeyword, "V1.1");

const previewFallback = matchLoraScheme(config, "unknown-lora.safetensors");
assert.equal(previewFallback.matchMode, "default");
assert.equal(previewFallback.schemeName, config.schemes[0].name);

const runtimeConfig = normalizeRouterConfig({
    version: 1,
    activeSchemeId: "scheme-v10",
    schemes: [
        {
            id: "scheme-v10",
            name: "同名方案",
            bindings: ["V1.0"],
            segments: [{id: "segment-v10", text: "prompt v1.0"}],
            delimiter: ", ",
            isDefault: true,
        },
        {
            id: "scheme-v11",
            name: "同名方案",
            bindings: ["V1.1"],
            segments: [{id: "segment-v11", text: "prompt v1.1"}],
            delimiter: ", ",
            isDefault: false,
        },
    ],
});
assert.equal(resolveExecutedSchemeId(runtimeConfig, {
    loraName: "DEMO-STYLE-LORA-V1.1_000005200.safetensors",
    matchMode: "matched",
    schemeName: "同名方案",
    matchedKeyword: "V1.1",
}), "scheme-v11");
assert.equal(resolveExecutedSchemeId(runtimeConfig, {
    loraName: "DEMO-STYLE-LORA-V1.0_000004600.safetensors",
    matchMode: "matched",
    schemeName: "同名方案",
    matchedKeyword: "V1.0",
}), "scheme-v10");
assert.equal(resolveExecutedSchemeId(runtimeConfig, {
    loraName: "unknown-lora",
    matchMode: "default",
    schemeName: "同名方案",
    matchedKeyword: "",
}), "scheme-v10");
const noDefaultRuntimeConfig = setDefaultScheme(runtimeConfig, "scheme-v10", false);
assert.equal(resolveExecutedSchemeId(noDefaultRuntimeConfig, {
    loraName: "unknown-lora",
    matchMode: "unmatched",
    schemeName: "",
    matchedKeyword: "",
}), "");

const savedWidgetConfig = JSON.stringify(config);
assert.equal(
    JSON.parse(findSerializedRouterConfig(["", savedWidgetConfig])).schemes[0].id,
    config.schemes[0].id,
);
assert.equal(findSerializedRouterConfig(["", "not-json"]), "");

const legacyNodeData = {
    type: "JindouyunStringRouter",
    widgets_values: [savedWidgetConfig, ""],
    properties: {},
};
assert.ok(migrateRouterNodeData(legacyNodeData));
assert.equal(legacyNodeData.widgets_values.length, 1);
assert.equal(legacyNodeData.widgets_values[0], legacyNodeData.properties.jindouyunStringRouterConfig);
assert.equal(JSON.parse(legacyNodeData.widgets_values[0]).schemes.length, config.schemes.length);

const legacySubgraphNode = {
    type: "JindouyunStringRouter",
    widgets_values: [savedWidgetConfig, ""],
    properties: {},
};
migrateRouterWorkflowGraphData({definitions: {subgraphs: [{nodes: [legacySubgraphNode]}]}});
assert.equal(legacySubgraphNode.widgets_values.length, 1);
assert.ok(legacySubgraphNode.properties.jindouyunStringRouterConfig);

for (let index = 0; index < 20; index += 1) config = addSegment(config, secondId);
assert.equal(config.schemes[1].segments.length, MAX_SEGMENTS);
for (let index = 0; index < 20; index += 1) config = removeSegment(config, secondId, config.schemes[1].segments.at(-1).id);
assert.equal(config.schemes[1].segments.length, 1);

config = setDefaultScheme(config, secondId, true);
assert.equal(config.schemes[0].isDefault, false);
assert.equal(config.schemes[1].isDefault, true);
config = setDefaultScheme(config, secondId, false);
assert.equal(config.schemes.every((item) => !item.isDefault), true);

config = removeScheme(config, secondId);
assert.equal(config.schemes.length, 1);
assert.equal(config.activeSchemeId, firstId);
config = removeScheme(config, firstId);
assert.equal(config.schemes.length, 1);

const normalized = normalizeRouterConfig({
    version: 1,
    activeSchemeId: "missing",
    schemes: [{
        id: "custom",
        name: "自定义",
        bindings: ["A.safetensors", "a"],
        segments: [],
        delimiter: " / ",
        isDefault: false,
    }],
});
assert.equal(normalized.activeSchemeId, "custom");
assert.deepEqual(normalized.schemes[0].bindings, ["A"]);
assert.equal(normalized.schemes[0].segments.length, 1);

const source = await fs.readFile(new URL("../js/jindouyun_string_router.js", import.meta.url), "utf8");
assert.match(source, /JindouyunStringRouter/);
assert.match(source, /新增分流方案/);
assert.match(source, /删除当前方案/);
assert.match(source, /新增文本段/);
assert.match(source, /删除文本段/);
assert.match(source, /LoRA 名称关键词/);
assert.match(source, /对应提示词方案名称/);
assert.match(source, /命中后输出的提示词/);
assert.match(source, /自动保存/);
assert.match(source, /每行一个关键词，例如 V1\.1/);
assert.match(source, /最多保留 12 个文本段/);
assert.match(source, /已自动分流/);
assert.match(source, /预计分流/);
assert.match(source, /随机 LoRA：运行时自动分流/);
assert.match(source, /未匹配，使用默认方案/);
assert.match(source, /未找到关键词方案/);
assert.match(source, /多重命中/);
assert.match(source, /serialize:\s*false/);
assert.match(source, /message\?\.lora_name/);
assert.match(source, /message\?\.matched_keyword/);
assert.match(source, /resolveExecutedSchemeId\(config,/);
assert.match(source, /activeSchemeId:\s*executedSchemeId/);
assert.match(source, /onConnectionsChange/);
assert.match(source, /updateFixedRoutePreview/);
assert.match(source, /__jindouyunReloadStringRouterConfig/);
assert.match(source, /loadedGraphNode\(node\)/);
assert.match(source, /beforeConfigureGraph\(graphData\)/);
assert.match(source, /migrateRouterWorkflowGraphData\(graphData, NODE_TYPE\)/);
assert.match(source, /migrateRouterNodeData\(info, NODE_TYPE\)/);
assert.match(source, /serializedRouterConfigFromNode\(node\)/);
assert.match(source, /findSerializedRouterConfig\(node\?\.widgets_values\)/);
assert.match(source, /node\.__jindouyunReloadStringRouterConfig\?\.\(savedConfig\)/);
assert.match(source, /if \(savedConfig\) this\.__jindouyunReloadStringRouterConfig\?\.\(savedConfig\)/);
assert.match(source, /jindouyunStringRouterConfig/);
assert.match(source, /findSerializedRouterConfig/);
assert.doesNotMatch(source, /persist\(config\);\s*renderStatus\(\);\s*renderEditor\(\);/);
assert.match(source, /findWidget\(sourceNode, "固定"\)/);
assert.doesNotMatch(source, /方案名称已同步/);
assert.doesNotMatch(source, /保存匹配关键词/);
assert.doesNotMatch(source, /匹配关键词已保存/);
assert.doesNotMatch(source, /syncAutomaticSchemeName/);
assert.doesNotMatch(source, /autoNameSchemeForLora/);
assert.doesNotMatch(source, /bindCurrentButton\.disabled\s*=\s*!lastLora/);
assert.doesNotMatch(source, /触发词.*匹配/);

console.log("string router UI tests passed");
