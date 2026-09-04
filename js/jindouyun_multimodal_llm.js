import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
    deletePromptPreset,
    normalizePromptPresets,
    upsertPromptPreset,
} from "./jindouyun_prompt_presets.mjs";


const NODE_TYPE = "JindouyunMultimodalLLM";
const PANEL_HEIGHT = 550;
const PROVIDER_STORAGE_KEY = "jindouyun.multimodal.provider";
const API_KEYS_STORAGE_KEY = "jindouyun.multimodal.apiKeys";
const BASE_URLS_STORAGE_KEY = "jindouyun.multimodal.baseUrls";
const PROMPT_PRESETS_STORAGE_KEY = "jindouyun.multimodal.promptPresets";
let promptPresetMemory = [];
const PROVIDERS = {
    "OpenAI": {
        baseUrl: "https://api.openai.com/v1",
        keyUrl: "https://platform.openai.com/api-keys",
        color: "#74A7FF",
    },
    "DeepSeek": {
        baseUrl: "https://api.deepseek.com",
        keyUrl: "https://platform.deepseek.com/api_keys",
        color: "#73B7FF",
    },
    "阿里云百炼": {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        keyUrl: "https://bailian.console.aliyun.com/?apiKey=1&tab=model",
        color: "#B99BFF",
    },
    "豆包（火山方舟）": {
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        keyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
        color: "#63D39A",
    },
    "智谱AI": {
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        keyUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
        color: "#6FD4D8",
    },
    "Kimi": {
        baseUrl: "https://api.moonshot.cn/v1",
        keyUrl: "https://platform.kimi.com/console/api-keys",
        color: "#F2B567",
    },
    "小米MiMo": {
        baseUrl: "https://api.xiaomimimo.com/v1",
        keyUrl: "https://platform.xiaomimimo.com",
        color: "#FF9C6E",
    },
    "自定义 OpenAI 兼容": {
        baseUrl: "http://127.0.0.1:8000/v1",
        keyUrl: "https://platform.openai.com/docs/api-reference/introduction",
        color: "#A8B0BC",
    },
};

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function hideNativeWidget(widget) {
    if (!widget || widget.__jindouyunMultimodalHidden) return;
    widget.__jindouyunMultimodalHidden = true;
    widget.hidden = true;
    widget.draw = function() {};
    widget.mouse = function() { return false; };
    widget.computeSize = function() { return [0, 0]; };
}

function setWidgetValue(widget, value, node) {
    if (!widget || widget.value === value) return;
    widget.value = value;
    widget.callback?.(value, app.canvas, node, widget);
    app.graph?.setDirtyCanvas?.(true, true);
}

function applyStyle(element, style) {
    Object.assign(element.style, style);
    return element;
}

function makeField(type = "text") {
    const input = document.createElement("input");
    input.type = type;
    input.spellcheck = false;
    applyStyle(input, {
        width: "100%",
        minWidth: "0",
        height: "31px",
        boxSizing: "border-box",
        border: "1px solid #505967",
        borderRadius: "5px",
        background: "#181C22",
        color: "#F3F5F7",
        padding: "0 9px",
        fontSize: "12px",
        letterSpacing: "0",
        outline: "none",
    });
    return input;
}

function makeTextarea(placeholder) {
    const textarea = document.createElement("textarea");
    textarea.placeholder = placeholder;
    textarea.spellcheck = false;
    applyStyle(textarea, {
        width: "100%",
        minWidth: "0",
        height: "58px",
        resize: "none",
        boxSizing: "border-box",
        border: "1px solid #505967",
        borderRadius: "5px",
        background: "#181C22",
        color: "#F3F5F7",
        padding: "7px 9px",
        fontSize: "12px",
        lineHeight: "1.4",
        letterSpacing: "0",
        outline: "none",
    });
    return textarea;
}

function makeButton(label, title, borderColor = "#536071") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    applyStyle(button, {
        minHeight: "31px",
        padding: "0 10px",
        border: `1px solid ${borderColor}`,
        borderRadius: "5px",
        background: "#252B33",
        color: "#F3F5F7",
        fontSize: "12px",
        fontWeight: "650",
        cursor: "pointer",
        whiteSpace: "nowrap",
    });
    return button;
}

function makeLabel(text) {
    const label = document.createElement("span");
    label.textContent = text;
    applyStyle(label, {
        color: "#B8C0CA",
        fontSize: "11px",
        fontWeight: "650",
        whiteSpace: "nowrap",
    });
    return label;
}

function safeMessage(payload, fallback) {
    return String(payload?.error || payload?.message || fallback || "请求失败").slice(0, 280);
}

function booleanValue(value) {
    if (typeof value === "string") {
        return ["1", "true", "yes", "on", "开启", "锁定"].includes(value.trim().toLowerCase());
    }
    return Boolean(value);
}

function readStoredMap(storageKey) {
    try {
        const value = JSON.parse(window.localStorage?.getItem(storageKey) || "{}");
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

function writeStoredMap(storageKey, value) {
    try {
        window.localStorage?.setItem(storageKey, JSON.stringify(value));
    } catch {
        // Browser privacy settings can disable local storage; the node still works normally.
    }
}

function storedProvider() {
    try {
        const provider = window.localStorage?.getItem(PROVIDER_STORAGE_KEY) || "";
        return PROVIDERS[provider] ? provider : "";
    } catch {
        return "";
    }
}

function rememberProvider(provider) {
    try {
        window.localStorage?.setItem(PROVIDER_STORAGE_KEY, provider);
    } catch {
        // Keep provider persistence optional.
    }
}

function storedProviderValue(storageKey, provider) {
    return String(readStoredMap(storageKey)[provider] || "");
}

function rememberProviderValue(storageKey, provider, value) {
    const values = readStoredMap(storageKey);
    const normalized = String(value || "").trim();
    if (normalized) values[provider] = normalized;
    else delete values[provider];
    writeStoredMap(storageKey, values);
}

function readPromptPresets() {
    try {
        promptPresetMemory = normalizePromptPresets(
            window.localStorage?.getItem(PROMPT_PRESETS_STORAGE_KEY) || "[]",
        );
    } catch {
        // Fall back to the in-memory copy when browser storage is unavailable.
    }
    return [...promptPresetMemory];
}

function writePromptPresets(presets) {
    promptPresetMemory = normalizePromptPresets(presets);
    try {
        window.localStorage?.setItem(PROMPT_PRESETS_STORAGE_KEY, JSON.stringify(promptPresetMemory));
    } catch {
        // The current page can still use presets until it is closed.
    }
}

function normalizedBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

function isForeignProviderPreset(provider, value) {
    const candidate = normalizedBaseUrl(value);
    if (!candidate || provider === "自定义 OpenAI 兼容") return false;
    return Object.entries(PROVIDERS).some(([name, preset]) => (
        name !== provider
        && name !== "自定义 OpenAI 兼容"
        && normalizedBaseUrl(preset.baseUrl) === candidate
    ));
}

function resolvedProviderBaseUrl(provider, ...candidates) {
    for (const candidate of candidates) {
        const normalized = normalizedBaseUrl(candidate);
        if (normalized && !isForeignProviderPreset(provider, normalized)) return normalized;
    }
    return PROVIDERS[provider]?.baseUrl || PROVIDERS["自定义 OpenAI 兼容"].baseUrl;
}

function addMultimodalSettings(node) {
    if (node.__jindouyunMultimodalAdded || !node.addDOMWidget) return;
    const providerWidget = findWidget(node, "供应商");
    const keyWidget = findWidget(node, "API密钥");
    const baseWidget = findWidget(node, "Base URL");
    const modelWidget = findWidget(node, "模型名称");
    const systemWidget = findWidget(node, "系统提示词");
    const promptWidget = findWidget(node, "对话内容");
    const temperatureWidget = findWidget(node, "温度");
    const maxTokensWidget = findWidget(node, "最大输出Token");
    const timeoutWidget = findWidget(node, "超时秒数");
    const lockReplyWidget = findWidget(node, "锁定回复");
    if (!providerWidget || !keyWidget || !baseWidget || !modelWidget
        || !systemWidget || !promptWidget || !temperatureWidget
        || !maxTokensWidget || !timeoutWidget || !lockReplyWidget) return;
    node.__jindouyunMultimodalAdded = true;
    [
        providerWidget,
        keyWidget,
        baseWidget,
        modelWidget,
        systemWidget,
        promptWidget,
        temperatureWidget,
        maxTokensWidget,
        timeoutWidget,
        lockReplyWidget,
    ].forEach(hideNativeWidget);

    const wrapper = document.createElement("div");
    applyStyle(wrapper, {
        display: "flex",
        flexDirection: "column",
        gap: "7px",
        width: "calc(100% - 24px)",
        maxWidth: "calc(100% - 24px)",
        minWidth: "0",
        height: `${PANEL_HEIGHT}px`,
        padding: "8px",
        boxSizing: "border-box",
        overflow: "hidden",
        color: "#F3F5F7",
        fontFamily: "system-ui, sans-serif",
    });

    const providerRow = document.createElement("div");
    applyStyle(providerRow, {
        display: "grid",
        gridTemplateColumns: "58px minmax(0, 1fr) 92px",
        gap: "6px",
        alignItems: "center",
        minWidth: "0",
        width: "100%",
    });
    const providerSelect = document.createElement("select");
    applyStyle(providerSelect, {
        width: "100%",
        minWidth: "0",
        height: "31px",
        border: "1px solid #505967",
        borderRadius: "5px",
        background: "#181C22",
        color: "#F3F5F7",
        padding: "0 7px",
        fontSize: "12px",
    });
    for (const name of Object.keys(PROVIDERS)) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        providerSelect.append(option);
    }
    const keyPageButton = makeButton("获取 Key", "打开当前供应商的官方 API Key 页面", "#4C7DC5");
    providerRow.append(makeLabel("供应商"), providerSelect, keyPageButton);

    const baseRow = document.createElement("div");
    applyStyle(baseRow, {
        display: "grid",
        gridTemplateColumns: "58px minmax(0, 1fr)",
        gap: "6px",
        alignItems: "center",
        minWidth: "0",
        width: "100%",
    });
    const baseInput = makeField();
    baseInput.placeholder = "OpenAI 兼容 Base URL";
    baseInput.title = "可修改为供应商的其他地域或业务空间地址";
    baseRow.append(makeLabel("Base URL"), baseInput);

    const keyRow = document.createElement("div");
    applyStyle(keyRow, {
        display: "grid",
        gridTemplateColumns: "58px minmax(0, 1fr) 50px",
        gap: "6px",
        alignItems: "center",
        minWidth: "0",
        width: "100%",
    });
    const keyInput = makeField();
    keyInput.type = "password";
    keyInput.placeholder = "粘贴 API Key";
    keyInput.autocomplete = "off";
    const revealButton = makeButton("显示", "显示或隐藏 API Key");
    keyRow.append(makeLabel("API Key"), keyInput, revealButton);

    const modelRow = document.createElement("div");
    applyStyle(modelRow, {
        display: "grid",
        gridTemplateColumns: "58px minmax(0, 1fr) 72px",
        gap: "6px",
        alignItems: "center",
        minWidth: "0",
        width: "100%",
    });
    const modelControl = document.createElement("div");
    applyStyle(modelControl, {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 44px",
        gap: "5px",
        minWidth: "0",
    });
    const modelSelect = document.createElement("select");
    applyStyle(modelSelect, {
        gridColumn: "1",
        width: "100%",
        minWidth: "0",
        height: "31px",
        border: "1px solid #505967",
        borderRadius: "5px",
        background: "#181C22",
        color: "#F3F5F7",
        padding: "0 7px",
        fontSize: "12px",
    });
    const modelInput = makeField();
    modelInput.style.gridColumn = "1";
    modelInput.style.display = "none";
    modelInput.placeholder = "手工填写模型名称";
    const manualModeButton = makeButton("手填", "切换为手工填写模型名称", "#687487");
    manualModeButton.style.gridColumn = "2";
    modelControl.append(modelSelect, modelInput, manualModeButton);
    const fetchButton = makeButton("获取模型", "使用当前 API Key 获取可用模型列表", "#4FA875");
    modelRow.append(makeLabel("模型"), modelControl, fetchButton);

    const status = document.createElement("div");
    applyStyle(status, {
        display: "flex",
        alignItems: "center",
        minHeight: "31px",
        padding: "0 10px",
        boxSizing: "border-box",
        border: "1px solid #4D5866",
        borderRadius: "5px",
        background: "rgba(75, 85, 99, 0.14)",
        color: "#BFC7D1",
        fontSize: "11px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    });

    const systemGroup = document.createElement("label");
    applyStyle(systemGroup, {display: "flex", flexDirection: "column", gap: "4px"});
    const systemInput = makeTextarea("设置模型的身份和回答规则");
    systemGroup.append(makeLabel("系统提示词"), systemInput);

    const promptGroup = document.createElement("label");
    applyStyle(promptGroup, {display: "flex", flexDirection: "column", gap: "4px"});
    const promptInput = makeTextarea("输入要发送给模型的问题");
    promptGroup.append(makeLabel("对话内容"), promptInput);

    const presetRow = document.createElement("div");
    applyStyle(presetRow, {
        display: "grid",
        gridTemplateColumns: "58px minmax(0, 1fr) 50px",
        gap: "6px",
        alignItems: "center",
        minWidth: "0",
        width: "100%",
    });
    const presetSelect = document.createElement("select");
    applyStyle(presetSelect, {
        width: "100%",
        minWidth: "0",
        height: "31px",
        border: "1px solid #4FA875",
        borderRadius: "5px",
        background: "#181C22",
        color: "#F3F5F7",
        padding: "0 7px",
        fontSize: "12px",
    });
    const deletePresetButton = makeButton("删除", "删除当前选中的提示词预设", "#B95763");
    presetRow.append(makeLabel("提示词预设"), presetSelect, deletePresetButton);

    const presetSaveRow = document.createElement("div");
    applyStyle(presetSaveRow, {
        display: "grid",
        gridTemplateColumns: "58px minmax(0, 1fr) 76px",
        gap: "6px",
        alignItems: "center",
        minWidth: "0",
        width: "100%",
    });
    const presetNameInput = makeField();
    presetNameInput.placeholder = "自定义预设名称";
    presetNameInput.maxLength = 80;
    const savePresetButton = makeButton("保存当前", "保存当前系统提示词和对话内容", "#4FA875");
    presetSaveRow.append(makeLabel("预设名称"), presetNameInput, savePresetButton);

    const numericRow = document.createElement("div");
    applyStyle(numericRow, {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: "7px",
        alignItems: "end",
    });

    function makeNumericControl(label, minimum, maximum, step) {
        const group = document.createElement("label");
        applyStyle(group, {display: "flex", flexDirection: "column", gap: "4px", minWidth: "0"});
        const input = makeField("number");
        input.min = String(minimum);
        input.max = String(maximum);
        input.step = String(step);
        group.append(makeLabel(label), input);
        numericRow.append(group);
        return input;
    }

    const temperatureInput = makeNumericControl("温度", 0, 2, 0.05);
    const maxTokensInput = makeNumericControl("最大输出Token", 1, 131072, 1);
    const timeoutInput = makeNumericControl("超时秒数", 5, 7200, 5);
    const lockRow = document.createElement("div");
    applyStyle(lockRow, {
        display: "grid",
        gridTemplateColumns: "58px minmax(0, 1fr)",
        gap: "6px",
        alignItems: "center",
        minWidth: "0",
        width: "100%",
    });
    const lockReplyButton = makeButton("随机种子：每次生成新回复", "切换为固定种子后，相同输入会复用上次成功回复", "#7D6BE8");
    lockReplyButton.style.width = "100%";
    lockRow.append(makeLabel("种子模式"), lockReplyButton);
    wrapper.append(
        providerRow,
        baseRow,
        keyRow,
        modelRow,
        status,
        systemGroup,
        promptGroup,
        presetRow,
        presetSaveRow,
        numericRow,
        lockRow,
    );

    function currentPreset() {
        return PROVIDERS[providerSelect.value] || PROVIDERS["自定义 OpenAI 兼容"];
    }

    function setStatus(message, kind = "info") {
        const colors = {
            info: ["#BFC7D1", "#4D5866", "rgba(75,85,99,0.14)"],
            loading: ["#9CC5FF", "#4C7DC5", "rgba(76,125,197,0.15)"],
            success: ["#8EE6AE", "#4FA875", "rgba(79,168,117,0.15)"],
            error: ["#FF9FA9", "#B95763", "rgba(185,87,99,0.15)"],
        };
        const [color, border, background] = colors[kind] || colors.info;
        status.textContent = message;
        status.title = message;
        status.style.color = color;
        status.style.borderColor = border;
        status.style.background = background;
    }

    function updateProviderAccent() {
        const preset = currentPreset();
        providerSelect.style.borderColor = preset.color;
        providerSelect.style.boxShadow = `inset 3px 0 0 ${preset.color}`;
    }

    function updateLockReplyButton() {
        const locked = booleanValue(lockReplyWidget.value);
        lockReplyButton.textContent = locked ? "固定种子：复用当前回复" : "随机种子：每次生成新回复";
        lockReplyButton.title = locked
            ? "固定种子：输入未变化时不再调用 API；再次点击可切换为随机种子"
            : "随机种子：每次运行都会调用 API；点击后固定当前输入对应的回复";
        lockReplyButton.style.borderColor = locked ? "#4FA875" : "#7D6BE8";
        lockReplyButton.style.background = locked ? "rgba(79,168,117,0.20)" : "rgba(125,107,232,0.16)";
        lockReplyButton.style.color = locked ? "#9AE9B7" : "#C8BEFF";
    }

    function renderPromptPresets(selectedId = "") {
        const presets = readPromptPresets();
        presetSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = presets.length ? "选择后立即调用预设" : "暂无预设，填写名称后保存";
        presetSelect.append(placeholder);
        for (const preset of presets) {
            const option = document.createElement("option");
            option.value = preset.id;
            option.textContent = preset.name;
            presetSelect.append(option);
        }
        presetSelect.value = presets.some((item) => item.id === selectedId) ? selectedId : "";
        deletePresetButton.disabled = !presetSelect.value;
        deletePresetButton.style.opacity = presetSelect.value ? "1" : "0.45";
    }

    function applySelectedPromptPreset() {
        const preset = readPromptPresets().find((item) => item.id === presetSelect.value);
        if (!preset) {
            deletePresetButton.disabled = true;
            deletePresetButton.style.opacity = "0.45";
            return;
        }
        systemInput.value = preset.systemPrompt;
        promptInput.value = preset.userPrompt;
        presetNameInput.value = preset.name;
        setWidgetValue(systemWidget, preset.systemPrompt, node);
        setWidgetValue(promptWidget, preset.userPrompt, node);
        deletePresetButton.disabled = false;
        deletePresetButton.style.opacity = "1";
        setStatus(`已调用提示词预设：${preset.name}`, "success");
    }

    function saveCurrentPromptPreset() {
        try {
            const result = upsertPromptPreset(readPromptPresets(), {
                name: presetNameInput.value,
                systemPrompt: systemInput.value,
                userPrompt: promptInput.value,
            });
            writePromptPresets(result.presets);
            presetNameInput.value = result.preset.name;
            renderPromptPresets(result.preset.id);
            setStatus(
                `${result.updated ? "已更新" : "已保存"}提示词预设：${result.preset.name}`,
                "success",
            );
        } catch (error) {
            setStatus(safeMessage({error: error?.message}, "保存预设失败"), "error");
            presetNameInput.focus();
        }
    }

    let availableModels = [];
    let manualMode = false;

    function populateModels(models) {
        availableModels = [...new Set(models.map((model) => String(model).trim()).filter(Boolean))];
        const current = String(modelInput.value || modelWidget.value || "").trim();
        modelSelect.replaceChildren();
        if (!availableModels.length && !current) {
            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = "请先获取模型";
            modelSelect.append(placeholder);
            return;
        }
        if (current && !availableModels.includes(current)) {
            const currentOption = document.createElement("option");
            currentOption.value = current;
            currentOption.textContent = `${current}（当前）`;
            modelSelect.append(currentOption);
        }
        for (const model of availableModels) {
            const option = document.createElement("option");
            option.value = String(model);
            option.textContent = String(model);
            modelSelect.append(option);
        }
        const selected = current || availableModels[0] || "";
        modelSelect.value = selected;
        modelInput.value = selected;
        setWidgetValue(modelWidget, selected, node);
    }

    function setManualMode(enabled) {
        manualMode = Boolean(enabled);
        modelSelect.style.display = manualMode ? "none" : "block";
        modelInput.style.display = manualMode ? "block" : "none";
        manualModeButton.textContent = manualMode ? "列表" : "手填";
        manualModeButton.title = manualMode ? "返回已获取的模型列表" : "切换为手工填写模型名称";
        if (manualMode) {
            modelInput.focus();
            modelInput.select();
        } else {
            populateModels(availableModels);
        }
    }

    function normalizedNumber(value, fallback, minimum, maximum, integer = false) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        const clamped = Math.min(maximum, Math.max(minimum, parsed));
        return integer ? Math.round(clamped) : clamped;
    }

    function commitNumber(input, widget, fallback, minimum, maximum, integer = false) {
        const value = normalizedNumber(input.value, fallback, minimum, maximum, integer);
        input.value = String(value);
        setWidgetValue(widget, value, node);
    }

    async function fetchModels() {
        const provider = providerSelect.value;
        const apiKey = keyInput.value.trim();
        const baseUrl = baseInput.value.trim();
        if (!apiKey && provider !== "自定义 OpenAI 兼容") {
            setStatus("请先填写 API Key", "error");
            keyInput.focus();
            return;
        }
        if (!baseUrl) {
            setStatus("请先填写 Base URL", "error");
            baseInput.focus();
            return;
        }
        fetchButton.disabled = true;
        fetchButton.textContent = "连接中";
        setStatus(`正在连接 ${provider} 并读取模型列表...`, "loading");
        try {
            const response = await api.fetchApi("/jindouyun_design/llm/models", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({provider, api_key: apiKey, base_url: baseUrl}),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(safeMessage(payload, `HTTP ${response.status}`));
            const models = Array.isArray(payload.models) ? payload.models : [];
            populateModels(models);
            setManualMode(false);
            setStatus(`已获取 ${models.length} 个模型，点击模型下拉框选择`, "success");
        } catch (error) {
            populateModels([]);
            setStatus(`${safeMessage({error: error?.message}, "获取失败")}；仍可手工填写模型`, "error");
        } finally {
            fetchButton.disabled = false;
            fetchButton.textContent = "获取模型";
        }
    }

    function syncFromWidgets() {
        let provider = PROVIDERS[providerWidget.value] ? providerWidget.value : "OpenAI";
        const recentProvider = storedProvider();
        if (!node.__jindouyunLoadedFromWorkflow && recentProvider) {
            provider = recentProvider;
            setWidgetValue(providerWidget, provider, node);
        }
        providerSelect.value = provider;
        const savedKey = storedProviderValue(API_KEYS_STORAGE_KEY, provider);
        const savedBaseUrl = storedProviderValue(BASE_URLS_STORAGE_KEY, provider);
        const rawWidgetBaseUrl = String(baseWidget.value || "");
        const repairedProviderBase = isForeignProviderPreset(provider, rawWidgetBaseUrl)
            || isForeignProviderPreset(provider, savedBaseUrl);
        keyInput.value = String(keyWidget.value || savedKey);
        baseInput.value = resolvedProviderBaseUrl(provider, rawWidgetBaseUrl, savedBaseUrl);
        setWidgetValue(keyWidget, keyInput.value, node);
        setWidgetValue(baseWidget, baseInput.value, node);
        modelInput.value = String(modelWidget.value || "");
        populateModels([]);
        setManualMode(false);
        systemInput.value = String(systemWidget.value || "");
        promptInput.value = String(promptWidget.value || "");
        const temperature = normalizedNumber(temperatureWidget.value, 0.7, 0, 2);
        let maxTokens = normalizedNumber(maxTokensWidget.value, 2048, 1, 131072, true);
        let timeout = normalizedNumber(timeoutWidget.value, 120, 5, 7200, true);
        const repairedLegacyNumbers = maxTokens <= 4 && timeout >= 256;
        if (repairedLegacyNumbers) {
            maxTokens = timeout;
            timeout = 120;
        }
        temperatureInput.value = String(temperature);
        maxTokensInput.value = String(maxTokens);
        timeoutInput.value = String(timeout);
        setWidgetValue(temperatureWidget, temperature, node);
        setWidgetValue(maxTokensWidget, maxTokens, node);
        setWidgetValue(timeoutWidget, timeout, node);
        node.properties ||= {};
        node.properties.jindouyunMultimodalNumericVersion = 2;
        rememberProvider(provider);
        rememberProviderValue(API_KEYS_STORAGE_KEY, provider, keyInput.value);
        rememberProviderValue(BASE_URLS_STORAGE_KEY, provider, baseInput.value);
        updateProviderAccent();
        updateLockReplyButton();
        renderPromptPresets();
        setStatus(
            repairedProviderBase
                ? `已修复供应商地址：${provider} → ${baseInput.value}`
                : repairedLegacyNumbers
                ? `已自动修复旧工作流参数：最大输出 ${maxTokens} Token，超时 ${timeout} 秒`
                : `${provider} 已就绪；填写 Key 后获取模型`,
            repairedProviderBase || repairedLegacyNumbers ? "success" : "info",
        );
    }

    providerSelect.addEventListener("change", () => {
        const preset = currentPreset();
        rememberProvider(providerSelect.value);
        setWidgetValue(providerWidget, providerSelect.value, node);
        const savedKey = storedProviderValue(API_KEYS_STORAGE_KEY, providerSelect.value);
        const savedBaseUrl = storedProviderValue(BASE_URLS_STORAGE_KEY, providerSelect.value);
        keyInput.value = savedKey;
        setWidgetValue(keyWidget, savedKey, node);
        baseInput.value = resolvedProviderBaseUrl(providerSelect.value, savedBaseUrl, preset.baseUrl);
        setWidgetValue(baseWidget, baseInput.value, node);
        modelInput.value = "";
        setWidgetValue(modelWidget, "", node);
        populateModels([]);
        setManualMode(false);
        updateProviderAccent();
        setStatus(
            savedKey
                ? `已切换到 ${providerSelect.value}，并自动填写已保存的 Key`
                : `已切换到 ${providerSelect.value}；填写 Key 后获取模型`,
            savedKey ? "success" : "info",
        );
    });
    baseInput.addEventListener("change", () => {
        setWidgetValue(baseWidget, baseInput.value.trim(), node);
        rememberProviderValue(BASE_URLS_STORAGE_KEY, providerSelect.value, baseInput.value);
    });
    keyInput.addEventListener("input", () => {
        setWidgetValue(keyWidget, keyInput.value, node);
        rememberProviderValue(API_KEYS_STORAGE_KEY, providerSelect.value, keyInput.value);
    });
    keyInput.addEventListener("change", () => {
        setWidgetValue(keyWidget, keyInput.value, node);
        if (keyInput.value.trim()) fetchModels();
    });
    keyInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            fetchModels();
        }
    });
    keyInput.addEventListener("paste", () => window.setTimeout(() => {
        setWidgetValue(keyWidget, keyInput.value, node);
        if (keyInput.value.trim()) fetchModels();
    }, 100));
    modelSelect.addEventListener("change", () => {
        modelInput.value = modelSelect.value;
        setWidgetValue(modelWidget, modelSelect.value, node);
    });
    modelInput.addEventListener("input", () => setWidgetValue(modelWidget, modelInput.value.trim(), node));
    manualModeButton.addEventListener("click", () => setManualMode(!manualMode));
    systemInput.addEventListener("input", () => setWidgetValue(systemWidget, systemInput.value, node));
    promptInput.addEventListener("input", () => setWidgetValue(promptWidget, promptInput.value, node));
    presetSelect.addEventListener("change", applySelectedPromptPreset);
    savePresetButton.addEventListener("click", saveCurrentPromptPreset);
    presetNameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            saveCurrentPromptPreset();
        }
    });
    deletePresetButton.addEventListener("click", () => {
        const selectedId = presetSelect.value;
        const selectedName = readPromptPresets().find((item) => item.id === selectedId)?.name || "";
        if (!selectedId) return;
        writePromptPresets(deletePromptPreset(readPromptPresets(), selectedId));
        presetNameInput.value = "";
        renderPromptPresets();
        setStatus(`已删除提示词预设：${selectedName}`, "info");
    });
    temperatureInput.addEventListener("change", () => {
        commitNumber(temperatureInput, temperatureWidget, 0.7, 0, 2);
    });
    maxTokensInput.addEventListener("change", () => {
        commitNumber(maxTokensInput, maxTokensWidget, 2048, 1, 131072, true);
    });
    timeoutInput.addEventListener("change", () => {
        commitNumber(timeoutInput, timeoutWidget, 120, 5, 7200, true);
    });
    lockReplyButton.addEventListener("click", () => {
        setWidgetValue(lockReplyWidget, !booleanValue(lockReplyWidget.value), node);
        updateLockReplyButton();
        const locked = booleanValue(lockReplyWidget.value);
        setStatus(
            locked
                ? "固定种子已启用：输入不变时复用上次成功结果，不再调用 API"
                : "随机种子已启用：每次运行都会重新调用 API",
            locked ? "success" : "info",
        );
    });
    fetchButton.addEventListener("click", fetchModels);
    revealButton.addEventListener("click", () => {
        const reveal = keyInput.type === "password";
        keyInput.type = reveal ? "text" : "password";
        revealButton.textContent = reveal ? "隐藏" : "显示";
    });
    keyPageButton.addEventListener("click", () => {
        const preset = currentPreset();
        window.open(preset.keyUrl, "_blank", "noopener,noreferrer");
    });

    const domWidget = node.addDOMWidget("模型服务设置", "jindouyun_multimodal_llm", wrapper, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => PANEL_HEIGHT,
        getMaxHeight: () => PANEL_HEIGHT,
    });
    domWidget.computeSize = (width) => [Math.max(320, Number(width || node.size?.[0] || 440) - 24), PANEL_HEIGHT];
    domWidget.serialize = false;
    node.__jindouyunMultimodalSync = syncFromWidgets;
    syncFromWidgets();
    node.setSize?.([
        Math.max(440, Number(node.size?.[0] || 440)),
        Math.max(790, Number(node.size?.[1] || 790)),
    ]);
}

app.registerExtension({
    name: "comfyui-jindouyun-design.multimodal-llm",
    nodeCreated(node) {
        if ((node.comfyClass || node.type) === NODE_TYPE) {
            window.setTimeout(() => addMultimodalSettings(node), 0);
        }
    },
    loadedGraphNode(node) {
        if ((node.comfyClass || node.type) !== NODE_TYPE) return;
        node.__jindouyunLoadedFromWorkflow = true;
        addMultimodalSettings(node);
        window.setTimeout(() => node.__jindouyunMultimodalSync?.(), 0);
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            window.setTimeout(() => addMultimodalSettings(this), 0);
        };
        const originalOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function() {
            this.__jindouyunLoadedFromWorkflow = true;
            const result = originalOnConfigure?.apply(this, arguments);
            window.setTimeout(() => {
                addMultimodalSettings(this);
                this.__jindouyunMultimodalSync?.();
            }, 0);
            return result;
        };
    },
});
