import assert from "node:assert/strict";
import {
    MAX_PROMPT_PRESETS,
    deletePromptPreset,
    normalizePromptPresets,
    upsertPromptPreset,
} from "../js/jindouyun_prompt_presets.mjs";


assert.deepEqual(normalizePromptPresets("not json"), []);
assert.deepEqual(normalizePromptPresets({}), []);

const created = upsertPromptPreset([], {
    name: " 产品分析 ",
    systemPrompt: "你是工业设计师",
    userPrompt: "分析这张图片",
}, {now: 10, idFactory: () => "preset-1"});
assert.equal(created.updated, false);
assert.equal(created.preset.name, "产品分析");
assert.equal(created.preset.systemPrompt, "你是工业设计师");
assert.equal(created.preset.userPrompt, "分析这张图片");

const updated = upsertPromptPreset(created.presets, {
    name: "产品分析",
    systemPrompt: "你是资深工业设计师",
    userPrompt: "详细分析图片",
}, {now: 20, idFactory: () => "should-not-be-used"});
assert.equal(updated.updated, true);
assert.equal(updated.presets.length, 1);
assert.equal(updated.preset.id, "preset-1");
assert.equal(updated.preset.userPrompt, "详细分析图片");

assert.deepEqual(deletePromptPreset(updated.presets, "preset-1"), []);
assert.throws(() => upsertPromptPreset([], {name: "   "}), /请先填写预设名称/);

let many = [];
for (let index = 0; index < MAX_PROMPT_PRESETS + 5; index += 1) {
    many = upsertPromptPreset(many, {name: `预设${index}`}, {
        now: index,
        idFactory: () => `preset-${index}`,
    }).presets;
}
assert.equal(many.length, MAX_PROMPT_PRESETS);
assert.equal(many[0].name, "预设5");

console.log("prompt preset tests passed");
