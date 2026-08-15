export const MAX_SEGMENTS = 12;
export const MAX_SCHEMES = 64;

let idCounter = 0;

function createId(prefix) {
    idCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function booleanValue(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return ["true", "1", "yes", "on", "开启"].includes(String(value || "").trim().toLowerCase());
}

export function normalizeLoraSignal(value) {
    let text = String(value || "").trim().replace(/^["']|["']$/g, "").replaceAll("\\", "/");
    text = text.replace(/\/{2,}/g, "/");
    return text.replace(/\.(safetensors|ckpt|pt|pth)$/i, "");
}

function uniqueId(value, fallback, used) {
    const base = String(value || "").trim().slice(0, 128) || fallback;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }
    used.add(candidate);
    return candidate;
}

function defaultSegments() {
    return Array.from({length: 3}, () => ({id: createId("segment"), text: ""}));
}

export function createDefaultRouterConfig() {
    const schemeId = createId("scheme");
    return {
        version: 1,
        activeSchemeId: schemeId,
        schemes: [{
            id: schemeId,
            name: "方案 1",
            bindings: [],
            segments: defaultSegments(),
            delimiter: ", ",
            isDefault: true,
        }],
    };
}

export function normalizeRouterConfig(value) {
    let payload = value;
    if (typeof payload === "string") {
        try {
            payload = JSON.parse(payload);
        } catch (_) {
            return createDefaultRouterConfig();
        }
    }
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.schemes) || !payload.schemes.length) {
        return createDefaultRouterConfig();
    }

    const usedSchemeIds = new Set();
    const usedBindings = new Set();
    let defaultClaimed = false;
    const schemes = payload.schemes.slice(0, MAX_SCHEMES).map((rawScheme, schemeIndex) => {
        const source = rawScheme && typeof rawScheme === "object" ? rawScheme : {};
        const id = uniqueId(source.id, `scheme-${schemeIndex + 1}`, usedSchemeIds);
        const usedSegmentIds = new Set();
        const rawSegments = Array.isArray(source.segments) ? source.segments : [];
        const segments = rawSegments.slice(0, MAX_SEGMENTS).map((rawSegment, segmentIndex) => {
            const segment = rawSegment && typeof rawSegment === "object"
                ? rawSegment
                : {text: rawSegment};
            return {
                id: uniqueId(segment.id, `segment-${schemeIndex + 1}-${segmentIndex + 1}`, usedSegmentIds),
                text: String(segment.text || ""),
            };
        });
        if (!segments.length) segments.push({id: `segment-${schemeIndex + 1}-1`, text: ""});

        const rawBindings = Array.isArray(source.bindings)
            ? source.bindings
            : typeof source.bindings === "string" ? [source.bindings] : [];
        const bindings = [];
        for (const rawBinding of rawBindings) {
            const binding = normalizeLoraSignal(rawBinding);
            const key = binding.toLowerCase();
            if (!binding || usedBindings.has(key)) continue;
            usedBindings.add(key);
            bindings.push(binding);
        }
        const wantsDefault = booleanValue(source.isDefault);
        const isDefault = wantsDefault && !defaultClaimed;
        defaultClaimed ||= isDefault;
        return {
            id,
            name: String(source.name || "").trim().slice(0, 200) || `方案 ${schemeIndex + 1}`,
            bindings,
            segments,
            delimiter: String(source.delimiter ?? ", "),
            isDefault,
        };
    });

    const validIds = new Set(schemes.map((scheme) => scheme.id));
    const activeSchemeId = validIds.has(String(payload.activeSchemeId || ""))
        ? String(payload.activeSchemeId)
        : schemes[0].id;
    return {version: 1, activeSchemeId, schemes};
}

export function serializeRouterConfig(value) {
    return JSON.stringify(normalizeRouterConfig(value));
}

export function findSerializedRouterConfig(widgetValues) {
    if (!Array.isArray(widgetValues)) return "";
    for (const candidate of widgetValues) {
        let payload = candidate;
        if (typeof payload === "string") {
            const text = payload.trim();
            if (!text.startsWith("{")) continue;
            try {
                payload = JSON.parse(text);
            } catch (_) {
                continue;
            }
        }
        if (!payload || typeof payload !== "object" || !Array.isArray(payload.schemes) || !payload.schemes.length) {
            continue;
        }
        return serializeRouterConfig(payload);
    }
    return "";
}

export function migrateRouterNodeData(nodeData, nodeType = "JindouyunStringRouter") {
    if (!nodeData || nodeData.type !== nodeType) return "";
    const propertyConfig = nodeData.properties?.jindouyunStringRouterConfig;
    const serialized = findSerializedRouterConfig(nodeData.widgets_values)
        || findSerializedRouterConfig([propertyConfig]);
    if (!serialized) return "";
    nodeData.properties ||= {};
    nodeData.properties.jindouyunStringRouterConfig = serialized;
    nodeData.widgets_values = [serialized];
    return serialized;
}

export function migrateRouterWorkflowGraphData(graphData, nodeType = "JindouyunStringRouter") {
    const visit = (nodes) => {
        if (!Array.isArray(nodes)) return;
        for (const nodeData of nodes) migrateRouterNodeData(nodeData, nodeType);
    };
    visit(graphData?.nodes);
    for (const subgraph of graphData?.definitions?.subgraphs || []) visit(subgraph?.nodes);
    return graphData;
}

export function matchLoraScheme(value, loraName) {
    const config = normalizeRouterConfig(value);
    const signal = normalizeLoraSignal(loraName);
    const signalKey = signal.toLowerCase();
    const matches = [];

    if (signalKey) {
        for (const scheme of config.schemes) {
            const matchedKeyword = scheme.bindings.find((binding) => signalKey.includes(binding.toLowerCase())) || "";
            if (matchedKeyword) matches.push({scheme, matchedKeyword});
        }
    }

    if (matches.length) {
        return {
            loraName: signal,
            matchMode: matches.length > 1 ? "conflict" : "matched",
            schemeName: matches[0].scheme.name,
            schemeId: matches[0].scheme.id,
            matchedKeyword: matches[0].matchedKeyword,
            matchCount: matches.length,
        };
    }

    const fallback = config.schemes.find((scheme) => scheme.isDefault);
    return {
        loraName: signal,
        matchMode: fallback ? "default" : "unmatched",
        schemeName: fallback?.name || "",
        schemeId: fallback?.id || "",
        matchedKeyword: "",
        matchCount: 0,
    };
}

export function resolveExecutedSchemeId(value, execution = {}) {
    const config = normalizeRouterConfig(value);
    const directSchemeId = String(execution.schemeId ?? execution.scheme_id ?? "").trim();
    if (directSchemeId && config.schemes.some((scheme) => scheme.id === directSchemeId)) {
        return directSchemeId;
    }

    const matchMode = String(execution.matchMode ?? execution.match_mode ?? "").trim().toLowerCase();
    const loraName = normalizeLoraSignal(execution.loraName ?? execution.lora_name ?? "");
    const loraKey = loraName.toLowerCase();
    const matchedKeyword = normalizeLoraSignal(
        execution.matchedKeyword ?? execution.matched_keyword ?? "",
    );
    const keywordKey = matchedKeyword.toLowerCase();
    const schemeName = String(execution.schemeName ?? execution.scheme_name ?? "").trim();

    if (matchMode === "matched" || matchMode === "conflict") {
        if (keywordKey && (!loraKey || loraKey.includes(keywordKey))) {
            const keywordScheme = config.schemes.find((scheme) => scheme.bindings.some(
                (binding) => binding.toLowerCase() === keywordKey,
            ));
            if (keywordScheme) return keywordScheme.id;
        }

        const rematched = matchLoraScheme(config, loraName);
        if (rematched.matchMode === "matched" || rematched.matchMode === "conflict") {
            return rematched.schemeId;
        }
    }

    if (matchMode === "default") {
        return config.schemes.find((scheme) => scheme.isDefault)?.id || "";
    }
    if (matchMode === "unmatched") return "";

    if (schemeName) {
        const namedSchemes = config.schemes.filter((scheme) => scheme.name === schemeName);
        if (namedSchemes.length === 1) return namedSchemes[0].id;
    }
    return "";
}

export function addScheme(value, requestedName = "") {
    const config = normalizeRouterConfig(value);
    if (config.schemes.length >= MAX_SCHEMES) return config;
    const id = createId("scheme");
    const next = {
        id,
        name: String(requestedName || "").trim() || `方案 ${config.schemes.length + 1}`,
        bindings: [],
        segments: defaultSegments(),
        delimiter: ", ",
        isDefault: false,
    };
    return {...config, activeSchemeId: id, schemes: [...config.schemes, next]};
}

export function removeScheme(value, schemeId) {
    const config = normalizeRouterConfig(value);
    if (config.schemes.length <= 1) return config;
    const index = config.schemes.findIndex((scheme) => scheme.id === schemeId);
    if (index < 0) return config;
    const schemes = config.schemes.filter((scheme) => scheme.id !== schemeId);
    const activeSchemeId = config.activeSchemeId === schemeId
        ? schemes[Math.min(index, schemes.length - 1)].id
        : config.activeSchemeId;
    return {...config, activeSchemeId, schemes};
}

export function addSegment(value, schemeId) {
    const config = normalizeRouterConfig(value);
    const schemes = config.schemes.map((scheme) => {
        if (scheme.id !== schemeId || scheme.segments.length >= MAX_SEGMENTS) return scheme;
        return {...scheme, segments: [...scheme.segments, {id: createId("segment"), text: ""}]};
    });
    return {...config, schemes};
}

export function removeSegment(value, schemeId, segmentId) {
    const config = normalizeRouterConfig(value);
    const schemes = config.schemes.map((scheme) => {
        if (scheme.id !== schemeId || scheme.segments.length <= 1) return scheme;
        return {...scheme, segments: scheme.segments.filter((segment) => segment.id !== segmentId)};
    });
    return {...config, schemes};
}

export function updateScheme(value, schemeId, patch) {
    const config = normalizeRouterConfig(value);
    const schemes = config.schemes.map((scheme) => scheme.id === schemeId ? {...scheme, ...patch, id: scheme.id} : scheme);
    return normalizeRouterConfig({...config, schemes});
}

export function updateSegmentText(value, schemeId, segmentId, text) {
    const config = normalizeRouterConfig(value);
    const schemes = config.schemes.map((scheme) => scheme.id !== schemeId ? scheme : {
        ...scheme,
        segments: scheme.segments.map((segment) => segment.id === segmentId
            ? {...segment, text: String(text || "")}
            : segment),
    });
    return {...config, schemes};
}

export function replaceSchemeBindings(value, schemeId, rawBindings) {
    let config = normalizeRouterConfig(value);
    const requested = [];
    const seen = new Set();
    for (const rawBinding of rawBindings || []) {
        const binding = normalizeLoraSignal(rawBinding);
        const key = binding.toLowerCase();
        if (!binding || seen.has(key)) continue;
        seen.add(key);
        requested.push(binding);
    }
    const requestedKeys = new Set(requested.map((binding) => binding.toLowerCase()));
    const schemes = config.schemes.map((scheme) => {
        if (scheme.id === schemeId) return {...scheme, bindings: requested};
        return {...scheme, bindings: scheme.bindings.filter((binding) => !requestedKeys.has(binding.toLowerCase()))};
    });
    config = {...config, schemes};
    return config;
}

export function bindLoraToScheme(value, schemeId, loraName) {
    const config = normalizeRouterConfig(value);
    const binding = normalizeLoraSignal(loraName);
    if (!binding) return config;
    const target = config.schemes.find((scheme) => scheme.id === schemeId);
    if (!target) return config;
    return replaceSchemeBindings(config, schemeId, [...target.bindings, binding]);
}

export function setDefaultScheme(value, schemeId, enabled) {
    const config = normalizeRouterConfig(value);
    const schemes = config.schemes.map((scheme) => ({
        ...scheme,
        isDefault: enabled ? scheme.id === schemeId : scheme.id === schemeId ? false : scheme.isDefault,
    }));
    return {...config, schemes};
}
