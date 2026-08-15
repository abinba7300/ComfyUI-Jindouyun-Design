import { app } from "../../scripts/app.js";
import {
    MAX_SEGMENTS,
    addScheme,
    addSegment,
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
    serializeRouterConfig,
    setDefaultScheme,
    updateScheme,
    updateSegmentText,
} from "./jindouyun_string_router_config.mjs?v=20260815-string-router8";


const NODE_TYPE = "JindouyunStringRouter";
const EDITOR_HEIGHT = 590;

function serializedRouterConfigFromNode(node, info = null) {
    return findSerializedRouterConfig(info?.widgets_values)
        || findSerializedRouterConfig(node?.widgets_values)
        || findSerializedRouterConfig(node?.widgets?.map((widget) => widget?.value))
        || String(node?.properties?.jindouyunStringRouterConfig || "");
}

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function connectedLoraSource(node) {
    const input = node.inputs?.find((item) => item.name === "LoRA名称");
    const link = input?.link != null ? app.graph?.links?.[input.link] : null;
    return link ? app.graph?.getNodeById?.(link.origin_id) : null;
}

function fixedLoraName(sourceNode) {
    if ((sourceNode?.comfyClass || sourceNode?.type) !== "JindouyunRandomLora") return "";
    const randomWidget = findWidget(sourceNode, "随机");
    if (randomWidget?.value !== false) return "";
    const fixedWidget = findWidget(sourceNode, "固定");
    const normalized = normalizeLoraSignal(fixedWidget?.value);
    if (!normalized || normalized === "无") return "";
    return normalized.split("/").filter(Boolean).at(-1) || normalized;
}

function watchLoraSourceWidgets(sourceNode, listener) {
    if (!sourceNode) return;
    sourceNode.__jindouyunPromptNameListeners ||= new Set();
    sourceNode.__jindouyunPromptNameListeners.add(listener);
    for (const widgetName of ["随机", "固定"]) {
        const widget = findWidget(sourceNode, widgetName);
        if (!widget || widget.__jindouyunPromptNamePatched) continue;
        widget.__jindouyunPromptNamePatched = true;
        const originalCallback = widget.callback;
        widget.callback = function() {
            const result = originalCallback?.apply(this, arguments);
            window.setTimeout(() => {
                for (const callback of sourceNode.__jindouyunPromptNameListeners || []) callback();
            }, 0);
            return result;
        };
    }
}

function unwatchLoraSourceWidgets(sourceNode, listener) {
    sourceNode?.__jindouyunPromptNameListeners?.delete(listener);
}

function firstValue(value) {
    return Array.isArray(value) ? value[0] : value;
}

function hideNativeWidget(widget) {
    if (!widget || widget.__jindouyunStringRouterHidden) return;
    widget.__jindouyunStringRouterHidden = true;
    widget.hidden = true;
    widget.draw = function() {};
    widget.mouse = function() { return false; };
    widget.computeSize = function() { return [0, 0]; };
}

function applyStyle(element, values) {
    Object.assign(element.style, values);
    return element;
}

function makeButton(text, title, accent = "#4D5968") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = title;
    applyStyle(button, {
        minHeight: "30px",
        padding: "0 10px",
        border: `1px solid ${accent}`,
        borderRadius: "5px",
        background: "#242A32",
        color: "#F4F6F8",
        fontSize: "12px",
        fontWeight: "600",
        cursor: "pointer",
        whiteSpace: "nowrap",
    });
    return button;
}

function makeTextInput(placeholder = "") {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    applyStyle(input, {
        width: "100%",
        minWidth: "0",
        height: "32px",
        boxSizing: "border-box",
        border: "1px solid #4B5563",
        borderRadius: "5px",
        background: "#181C22",
        color: "#F4F6F8",
        padding: "0 9px",
        fontSize: "12px",
    });
    return input;
}

function makeTextarea(placeholder, height = 70) {
    const textarea = document.createElement("textarea");
    textarea.placeholder = placeholder;
    textarea.spellcheck = false;
    applyStyle(textarea, {
        width: "100%",
        minWidth: "0",
        height: `${height}px`,
        resize: "vertical",
        boxSizing: "border-box",
        border: "1px solid #4B5563",
        borderRadius: "5px",
        background: "#171B20",
        color: "#F4F6F8",
        padding: "7px 9px",
        fontSize: "12px",
        lineHeight: "1.4",
        letterSpacing: "0",
    });
    return textarea;
}

function schemeOptionLabel(scheme) {
    const keywords = scheme.bindings.length ? scheme.bindings.join(" / ") : "未设置关键词";
    const fallback = scheme.isDefault ? "[兜底] " : "";
    return `${fallback}${keywords} → ${scheme.name || "未命名方案"}`;
}

function addStringRouterEditor(node) {
    if (node.__jindouyunStringRouterAdded || !node.addDOMWidget) return;
    node.properties ||= {};

    const configWidget = findWidget(node, "配置数据");
    if (!configWidget) return;
    node.__jindouyunStringRouterAdded = true;
    hideNativeWidget(configWidget);

    let config = normalizeRouterConfig(serializedRouterConfigFromNode(node) || configWidget.value);
    let lastLora = String(node.properties.jindouyunStringRouterLastLora || "");
    let matchMode = String(node.properties.jindouyunStringRouterMatchMode || "waiting");
    let matchedSchemeName = String(node.properties.jindouyunStringRouterSchemeName || "");
    let matchedKeyword = String(node.properties.jindouyunStringRouterMatchedKeyword || "");
    let connectionMode = "disconnected";
    let isRoutePreview = false;
    let watchedLoraSource = null;
    let localNotice = "";
    let noticeTimer = null;

    const wrapper = document.createElement("div");
    applyStyle(wrapper, {
        display: "flex",
        flexDirection: "column",
        gap: "7px",
        width: "100%",
        height: `${EDITOR_HEIGHT}px`,
        padding: "7px 8px 9px",
        boxSizing: "border-box",
        overflow: "hidden",
        color: "#F4F6F8",
        fontFamily: "system-ui, sans-serif",
    });

    const status = document.createElement("div");
    applyStyle(status, {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minHeight: "48px",
        padding: "6px 10px",
        boxSizing: "border-box",
        border: "1px solid #586272",
        borderRadius: "6px",
        background: "rgba(88,98,114,0.14)",
        overflow: "hidden",
    });
    const statusTitle = document.createElement("strong");
    applyStyle(statusTitle, {fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"});
    const statusDetail = document.createElement("span");
    applyStyle(statusDetail, {fontSize: "11px", color: "#B8C0CB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"});
    status.append(statusTitle, statusDetail);

    const editor = document.createElement("div");
    applyStyle(editor, {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        minHeight: "0",
        flex: "1",
        overflowY: "auto",
        overflowX: "hidden",
        paddingRight: "2px",
    });
    wrapper.append(status, editor);

    function persist(nextConfig, rerender = false) {
        config = normalizeRouterConfig(nextConfig);
        const serialized = serializeRouterConfig(config);
        configWidget.value = serialized;
        node.properties.jindouyunStringRouterConfig = serialized;
        configWidget.callback?.(serialized, app.canvas, node, configWidget);
        app.graph?.setDirtyCanvas?.(true, true);
        if (rerender) renderEditor();
        if (connectionMode === "fixed" && lastLora) updateFixedRoutePreview(lastLora);
    }

    function showNotice(message) {
        localNotice = message;
        if (noticeTimer) window.clearTimeout(noticeTimer);
        renderStatus();
        noticeTimer = window.setTimeout(() => {
            if (localNotice !== message) return;
            localNotice = "";
            renderStatus();
        }, 1600);
    }

    function renderStatus() {
        let color = "#697586";
        let background = "rgba(105,117,134,0.14)";
        let title = "等待 LoRA 名称信号";
        let detail = "连接筋斗云随机LORA节点的“LoRA名称”输出";
        if (localNotice) {
            color = "#E5A84B";
            background = "rgba(229,168,75,0.13)";
            title = localNotice;
            detail = lastLora || "配置会随工作流保存";
        } else if (matchMode === "matched") {
            color = "#58C982";
            background = "rgba(88,201,130,0.14)";
            title = `${isRoutePreview ? "预计分流" : "已自动分流"}：${matchedSchemeName || "未命名方案"}`;
            detail = matchedKeyword ? `命中关键词 ${matchedKeyword} · LoRA ${lastLora}` : lastLora;
        } else if (matchMode === "conflict") {
            color = "#E5A84B";
            background = "rgba(229,168,75,0.13)";
            title = `${isRoutePreview ? "预计分流" : "已自动分流"}：${matchedSchemeName || "第一个方案"}（多重命中）`;
            detail = matchedKeyword ? `优先关键词 ${matchedKeyword} · LoRA ${lastLora}` : lastLora;
        } else if (matchMode === "random-waiting") {
            color = "#5A9BEF";
            background = "rgba(90,155,239,0.14)";
            title = "随机 LoRA：运行时自动分流";
            detail = "每次运行后显示实际命中的关键词与提示词方案";
        } else if (matchMode === "connected-waiting") {
            color = "#5A9BEF";
            background = "rgba(90,155,239,0.14)";
            title = "已连接，运行后获取 LoRA 名称";
            detail = connectionMode === "fixed" ? "请先选择固定 LoRA" : "等待上游节点运行";
        } else if (matchMode === "default") {
            color = "#5A9BEF";
            background = "rgba(90,155,239,0.14)";
            title = isRoutePreview ? "预计使用兜底方案" : "未匹配，使用默认方案";
            detail = matchedSchemeName ? `${matchedSchemeName} · ${lastLora}` : lastLora;
        } else if (matchMode === "unmatched") {
            color = "#EF78A8";
            background = "rgba(239,120,168,0.12)";
            title = isRoutePreview ? "当前 LoRA 没有对应方案" : "未找到关键词方案";
            detail = lastLora || "当前没有可用的默认方案";
        }
        status.style.borderColor = color;
        status.style.background = background;
        statusTitle.style.color = color;
        statusTitle.textContent = title;
        statusDetail.textContent = detail;
        status.title = detail;
    }

    function renderEditor() {
        editor.replaceChildren();
        const active = config.schemes.find((scheme) => scheme.id === config.activeSchemeId) || config.schemes[0];
        config.activeSchemeId = active.id;

        const schemeToolbar = document.createElement("div");
        applyStyle(schemeToolbar, {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto auto",
            gap: "6px",
            alignItems: "center",
        });
        const schemeSelect = document.createElement("select");
        applyStyle(schemeSelect, {
            width: "100%",
            height: "32px",
            minWidth: "0",
            border: "1px solid #586272",
            borderRadius: "5px",
            background: "#1A1F26",
            color: "#F4F6F8",
            padding: "0 8px",
            fontSize: "12px",
        });
        for (const scheme of config.schemes) {
            const option = document.createElement("option");
            option.value = scheme.id;
            option.textContent = schemeOptionLabel(scheme);
            schemeSelect.append(option);
        }
        schemeSelect.value = active.id;
        schemeSelect.addEventListener("change", () => {
            config = {...config, activeSchemeId: schemeSelect.value};
            persist(config, true);
        });
        const addSchemeButton = makeButton("＋ 分流方案", "新增分流方案", "#58C982");
        addSchemeButton.addEventListener("click", () => {
            persist(addScheme(config), true);
            showNotice("已新增一套分流方案");
        });
        const deleteSchemeButton = makeButton("×", "删除当前方案", "#C85C72");
        deleteSchemeButton.setAttribute("aria-label", "删除当前方案");
        deleteSchemeButton.addEventListener("click", () => {
            if (config.schemes.length <= 1) {
                showNotice("至少保留一个分流方案");
                return;
            }
            persist(removeScheme(config, active.id), true);
            showNotice("已删除当前分流方案");
        });
        schemeToolbar.append(schemeSelect, addSchemeButton, deleteSchemeButton);

        const nameLabel = document.createElement("span");
        nameLabel.textContent = "对应提示词方案名称（可选）";
        applyStyle(nameLabel, {fontSize: "12px", fontWeight: "700", color: "#CDD3DC"});
        const nameInput = makeTextInput("例如：简笔画手绘");
        nameInput.value = active.name;
        nameInput.title = "方案名称仅用于识别，由你手工命名，不会被 LoRA 名称覆盖";
        nameInput.addEventListener("input", () => {
            config = updateScheme(config, active.id, {name: nameInput.value});
            persist(config);
            const currentOption = [...schemeSelect.options].find((option) => option.value === active.id);
            const currentScheme = config.schemes.find((scheme) => scheme.id === active.id);
            if (currentOption && currentScheme) currentOption.textContent = schemeOptionLabel(currentScheme);
        });

        const bindingHeader = document.createElement("div");
        applyStyle(bindingHeader, {display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px"});
        const bindingLabel = document.createElement("span");
        bindingLabel.textContent = "LoRA 名称关键词";
        applyStyle(bindingLabel, {fontSize: "12px", fontWeight: "700", color: "#CDD3DC"});
        const autoSaveLabel = document.createElement("span");
        autoSaveLabel.textContent = "自动保存";
        applyStyle(autoSaveLabel, {
            padding: "2px 7px",
            border: "1px solid #58C982",
            borderRadius: "10px",
            color: "#75D99A",
            fontSize: "10px",
            whiteSpace: "nowrap",
        });
        const bindingsInput = makeTextarea("每行一个关键词，例如 V1.1", 58);
        bindingsInput.value = active.bindings.join("\n");
        bindingsInput.title = "从 LoRA 名称中查找字面关键词；忽略英文大小写，不做模糊推断";
        bindingsInput.addEventListener("input", () => {
            const lines = bindingsInput.value.split(/\r?\n/);
            config = replaceSchemeBindings(config, active.id, lines);
            persist(config);
        });
        bindingHeader.append(bindingLabel, autoSaveLabel);
        bindingsInput.addEventListener("blur", () => renderEditor());

        const bindingHint = document.createElement("div");
        bindingHint.textContent = "每行一个关键词，例如 V1.1 或 V1.0；只按名称字面内容区分。";
        applyStyle(bindingHint, {fontSize: "10px", lineHeight: "1.35", color: "#8F99A7"});

        const segmentHeader = document.createElement("div");
        applyStyle(segmentHeader, {display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px"});
        const segmentTitle = document.createElement("span");
        segmentTitle.textContent = `命中后输出的提示词 ${active.segments.length}/${MAX_SEGMENTS}`;
        applyStyle(segmentTitle, {fontSize: "12px", fontWeight: "700", color: "#CDD3DC"});
        const addSegmentButton = makeButton("＋ 提示词段", "新增文本段；最多保留 12 个文本段", "#5A9BEF");
        addSegmentButton.disabled = active.segments.length >= MAX_SEGMENTS;
        addSegmentButton.style.opacity = addSegmentButton.disabled ? "0.48" : "1";
        addSegmentButton.addEventListener("click", () => {
            if (active.segments.length >= MAX_SEGMENTS) {
                showNotice("最多保留 12 个文本段");
                return;
            }
            persist(addSegment(config, active.id), true);
        });
        segmentHeader.append(segmentTitle, addSegmentButton);

        const segments = document.createElement("div");
        applyStyle(segments, {display: "flex", flexDirection: "column", gap: "7px"});
        active.segments.forEach((segment, index) => {
            const segmentShell = document.createElement("div");
            applyStyle(segmentShell, {
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 30px",
                gap: "6px",
                alignItems: "start",
            });
            const text = makeTextarea(`提示词段 ${index + 1}`, 66);
            text.value = segment.text;
            text.addEventListener("input", () => {
                config = updateSegmentText(config, active.id, segment.id, text.value);
                persist(config);
            });
            const removeButton = makeButton("×", `删除文本段 ${index + 1}`, "#C85C72");
            removeButton.setAttribute("aria-label", "删除文本段");
            removeButton.disabled = active.segments.length <= 1;
            removeButton.style.opacity = removeButton.disabled ? "0.4" : "1";
            removeButton.addEventListener("click", () => {
                if (active.segments.length <= 1) {
                    showNotice("每套方案至少保留一个文本段");
                    return;
                }
                persist(removeSegment(config, active.id, segment.id), true);
            });
            segmentShell.append(text, removeButton);
            segments.append(segmentShell);
        });

        const optionsRow = document.createElement("div");
        applyStyle(optionsRow, {
            display: "grid",
            gridTemplateColumns: "72px minmax(0, 1fr) auto",
            gap: "7px",
            alignItems: "center",
        });
        const delimiterLabel = document.createElement("span");
        delimiterLabel.textContent = "拼接分隔符";
        applyStyle(delimiterLabel, {fontSize: "11px", color: "#AAB3BF"});
        const delimiterInput = makeTextInput("例如：, ");
        delimiterInput.value = active.delimiter;
        delimiterInput.addEventListener("input", () => {
            config = updateScheme(config, active.id, {delimiter: delimiterInput.value});
            persist(config);
        });
        const defaultLabel = document.createElement("label");
        applyStyle(defaultLabel, {display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#CDD3DC", whiteSpace: "nowrap"});
        const defaultInput = document.createElement("input");
        defaultInput.type = "checkbox";
        defaultInput.checked = active.isDefault;
        defaultInput.title = "没有任何关键词匹配时，输出此方案的提示词";
        defaultInput.addEventListener("change", () => persist(setDefaultScheme(config, active.id, defaultInput.checked), true));
        defaultLabel.append(defaultInput, document.createTextNode("未命中时使用"));
        optionsRow.append(delimiterLabel, delimiterInput, defaultLabel);

        editor.append(
            schemeToolbar,
            nameLabel,
            nameInput,
            bindingHeader,
            bindingsInput,
            bindingHint,
            segmentHeader,
            segments,
            optionsRow,
        );
    }

    function updateFixedRoutePreview(loraName) {
        const preview = matchLoraScheme(config, loraName);
        lastLora = preview.loraName;
        matchMode = preview.matchMode;
        matchedSchemeName = preview.schemeName;
        matchedKeyword = preview.matchedKeyword;
        isRoutePreview = true;
        renderStatus();
    }

    function refreshConnectedLora() {
        const sourceNode = connectedLoraSource(node);
        if (sourceNode !== watchedLoraSource) {
            unwatchLoraSourceWidgets(watchedLoraSource, refreshConnectedLora);
            watchedLoraSource = sourceNode;
            watchLoraSourceWidgets(watchedLoraSource, refreshConnectedLora);
        }
        localNotice = "";
        if (!sourceNode) {
            connectionMode = "disconnected";
            isRoutePreview = false;
            matchMode = "waiting";
            lastLora = "";
            renderStatus();
            return;
        }

        const sourceType = sourceNode.comfyClass || sourceNode.type;
        if (sourceType !== "JindouyunRandomLora") {
            connectionMode = "connected";
            isRoutePreview = false;
            matchMode = "connected-waiting";
            renderStatus();
            return;
        }

        const randomWidget = findWidget(sourceNode, "随机");
        if (randomWidget?.value !== false) {
            connectionMode = "random";
            isRoutePreview = false;
            matchMode = "random-waiting";
            lastLora = "";
            renderStatus();
            return;
        }

        connectionMode = "fixed";
        const previewName = fixedLoraName(sourceNode);
        if (!previewName) {
            isRoutePreview = false;
            matchMode = "connected-waiting";
            lastLora = "";
            renderStatus();
            return;
        }
        updateFixedRoutePreview(previewName);
    }

    const domWidget = node.addDOMWidget("提示词方案编辑器", "jindouyun_string_router", wrapper, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => EDITOR_HEIGHT,
    });
    domWidget.computeSize = (width) => [width || node.size?.[0] || 420, EDITOR_HEIGHT];
    node.setSize?.([Math.max(400, Number(node.size?.[0] || 420)), Math.max(660, Number(node.size?.[1] || 660))]);

    const originalConnectionsChange = node.onConnectionsChange;
    node.onConnectionsChange = function() {
        originalConnectionsChange?.apply(this, arguments);
        window.setTimeout(refreshConnectedLora, 0);
    };

    node.__jindouyunStringRouterExecuted = (message) => {
        lastLora = String(firstValue(message?.lora_name) || "");
        matchMode = String(firstValue(message?.match_mode) || "unmatched");
        matchedSchemeName = String(firstValue(message?.scheme_name) || "");
        matchedKeyword = String(firstValue(message?.matched_keyword) || "");
        isRoutePreview = false;
        localNotice = "";
        node.properties.jindouyunStringRouterLastLora = lastLora;
        node.properties.jindouyunStringRouterMatchMode = matchMode;
        node.properties.jindouyunStringRouterSchemeName = matchedSchemeName;
        node.properties.jindouyunStringRouterMatchedKeyword = matchedKeyword;
        const executedSchemeId = resolveExecutedSchemeId(config, {
            loraName: lastLora,
            matchMode,
            schemeName: matchedSchemeName,
            matchedKeyword,
        });
        if (executedSchemeId) config = {...config, activeSchemeId: executedSchemeId};
        renderStatus();
        renderEditor();
    };

    node.__jindouyunReloadStringRouterConfig = (savedConfig = "") => {
        config = normalizeRouterConfig(savedConfig || node.properties.jindouyunStringRouterConfig || configWidget.value);
        const serialized = serializeRouterConfig(config);
        configWidget.value = serialized;
        node.properties.jindouyunStringRouterConfig = serialized;
        lastLora = String(node.properties.jindouyunStringRouterLastLora || "");
        matchMode = String(node.properties.jindouyunStringRouterMatchMode || "waiting");
        matchedSchemeName = String(node.properties.jindouyunStringRouterSchemeName || "");
        matchedKeyword = String(node.properties.jindouyunStringRouterMatchedKeyword || "");
        localNotice = "";
        renderStatus();
        renderEditor();
        window.setTimeout(refreshConnectedLora, 0);
    };

    renderStatus();
    renderEditor();
    window.setTimeout(refreshConnectedLora, 0);
}

app.registerExtension({
    name: "comfyui-jindouyun-design.string-router",

    beforeConfigureGraph(graphData) {
        migrateRouterWorkflowGraphData(graphData, NODE_TYPE);
    },

    nodeCreated(node) {
        if ((node.comfyClass || node.type) === NODE_TYPE) {
            window.setTimeout(() => addStringRouterEditor(node), 0);
        }
    },

    loadedGraphNode(node) {
        if ((node.comfyClass || node.type) !== NODE_TYPE) return;
        const savedConfig = serializedRouterConfigFromNode(node);
        addStringRouterEditor(node);
        node.__jindouyunReloadStringRouterConfig?.(savedConfig);
    },

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const originalConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function(info) {
            migrateRouterNodeData(info, NODE_TYPE);
            return originalConfigure?.apply(this, arguments);
        };

        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            window.setTimeout(() => addStringRouterEditor(this), 0);
        };

        const originalOnExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(message) {
            originalOnExecuted?.apply(this, arguments);
            this.__jindouyunStringRouterExecuted?.(message);
        };

        const originalOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function() {
            const savedConfig = serializedRouterConfigFromNode(this, arguments[0]);
            const result = originalOnConfigure?.apply(this, arguments);
            window.setTimeout(() => {
                addStringRouterEditor(this);
                if (savedConfig) this.__jindouyunReloadStringRouterConfig?.(savedConfig);
            }, 0);
            return result;
        };
    },
});
