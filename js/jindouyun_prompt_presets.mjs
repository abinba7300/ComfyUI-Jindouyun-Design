export const MAX_PROMPT_PRESETS = 50;


function cleanText(value) {
    return String(value ?? "").trim();
}


export function normalizePromptPresets(value) {
    let items = value;
    if (typeof items === "string") {
        try {
            items = JSON.parse(items);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(items)) return [];

    const normalized = [];
    const seenIds = new Set();
    for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const id = cleanText(item.id);
        const name = cleanText(item.name).slice(0, 80);
        if (!id || !name || seenIds.has(id)) continue;
        seenIds.add(id);
        normalized.push({
            id,
            name,
            systemPrompt: String(item.systemPrompt ?? ""),
            userPrompt: String(item.userPrompt ?? ""),
            updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : 0,
        });
    }
    return normalized.slice(-MAX_PROMPT_PRESETS);
}


export function upsertPromptPreset(
    presets,
    values,
    {now = Date.now(), idFactory} = {},
) {
    const normalized = normalizePromptPresets(presets);
    const name = cleanText(values?.name).slice(0, 80);
    if (!name) throw new Error("请先填写预设名称");

    const matchIndex = normalized.findIndex(
        (item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    const existing = matchIndex >= 0 ? normalized[matchIndex] : null;
    const id = existing?.id || idFactory?.() || `preset-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const preset = {
        id,
        name,
        systemPrompt: String(values?.systemPrompt ?? ""),
        userPrompt: String(values?.userPrompt ?? ""),
        updatedAt: Number(now),
    };
    if (matchIndex >= 0) normalized.splice(matchIndex, 1);
    normalized.push(preset);
    return {
        presets: normalized.slice(-MAX_PROMPT_PRESETS),
        preset,
        updated: Boolean(existing),
    };
}


export function deletePromptPreset(presets, presetId) {
    const id = cleanText(presetId);
    return normalizePromptPresets(presets).filter((item) => item.id !== id);
}
