import { app } from "../../scripts/app.js";

const NODE_TYPE = "JindouyunShowAnything";
const BASE_FONT_SIZE = 12;
const DISPLAY_TOP_OFFSET = 146;
const MIN_DISPLAY_HEIGHT = 120;

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function booleanValue(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return ["true", "1", "yes", "on", "开启"].includes(String(value ?? "").trim().toLowerCase());
}

function resolveFontSize(enabled, scale) {
    const number = Number(scale);
    const safeScale = Number.isFinite(number) ? Math.max(1, Math.min(10, number)) : 3;
    return enabled ? BASE_FONT_SIZE * safeScale : BASE_FONT_SIZE;
}

function normalizeTextLines(value) {
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    return values.map((item) => String(item ?? ""));
}

function syncDisplayWidth(node, shell) {
    const width = Math.max(160, Number(node.size?.[0] || 320) - 28);
    shell.style.width = `${width}px`;
    shell.style.maxWidth = `${width}px`;
    const host = shell.parentElement;
    if (host) {
        host.style.width = `${width}px`;
        host.style.maxWidth = `${width}px`;
    }
    return width;
}

function syncDisplayHeight(node, shell) {
    const height = Math.max(MIN_DISPLAY_HEIGHT, Number(node.size?.[1] || 266) - DISPLAY_TOP_OFFSET);
    shell.style.height = `${height}px`;
    shell.style.minHeight = `${MIN_DISPLAY_HEIGHT}px`;
    const host = shell.parentElement;
    if (host) {
        host.style.height = `${height}px`;
        host.style.minHeight = `${MIN_DISPLAY_HEIGHT}px`;
    }
    return height;
}

function installWidgetCallback(widget, callback) {
    if (!widget || widget.__jindouyunShowAnythingCallback) return;
    widget.__jindouyunShowAnythingCallback = true;
    const original = widget.callback;
    widget.callback = function() {
        const result = original?.apply(this, arguments);
        callback();
        return result;
    };
}

function addDisplayWidget(node) {
    if (node.__jindouyunShowAnythingWidget || !node.addDOMWidget) return;
    node.__jindouyunShowAnythingWidget = true;
    node.properties ||= {};

    const shell = document.createElement("div");
    Object.assign(shell.style, {
        width: "100%", minHeight: "120px", padding: "6px 8px 8px",
        boxSizing: "border-box", pointerEvents: "auto",
    });

    const content = document.createElement("div");
    Object.assign(content.style, {
        width: "100%", height: "100%", minHeight: "106px", padding: "8px",
        boxSizing: "border-box", overflow: "auto", whiteSpace: "pre-wrap",
        overflowWrap: "anywhere", wordBreak: "break-word", userSelect: "text",
        background: "#181B20", border: "1px solid #4A515C", borderRadius: "6px",
        color: "#F4F6F8", fontFamily: "system-ui, sans-serif", letterSpacing: "0",
    });
    shell.appendChild(content);

    const domWidget = node.addDOMWidget("显示内容", "jindouyun_show_anything", shell, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 120,
    });
    syncDisplayWidth(node, shell);
    syncDisplayHeight(node, shell);
    domWidget.computeSize = () => [syncDisplayWidth(node, shell), syncDisplayHeight(node, shell)];
    const originalOnResize = node.onResize;
    node.onResize = function() {
        originalOnResize?.apply(this, arguments);
        syncDisplayWidth(node, shell);
        syncDisplayHeight(node, shell);
    };

    const magnifyWidget = findWidget(node, "放大文字");
    const scaleWidget = findWidget(node, "放大倍数");

    function render(lines = node.properties.jindouyunShowAnythingText) {
        const normalized = normalizeTextLines(lines);
        node.properties.jindouyunShowAnythingText = normalized;
        const enabled = booleanValue(magnifyWidget?.value);
        content.style.fontSize = `${resolveFontSize(enabled, scaleWidget?.value)}px`;
        content.style.lineHeight = enabled ? "1.15" : "1.4";
        content.textContent = normalized.length ? normalized.join("\n\n") : "等待运行...";
        content.style.color = normalized.length ? "#F4F6F8" : "#8B939F";
        app.graph?.setDirtyCanvas(true, false);
    }

    node.__jindouyunRenderShowAnything = render;
    installWidgetCallback(magnifyWidget, render);
    installWidgetCallback(scaleWidget, render);
    render();
}

app.registerExtension({
    name: "comfyui-jindouyun-design.show-anything",

    nodeCreated(node) {
        if ((node.comfyClass || node.type) === NODE_TYPE) addDisplayWidget(node);
    },

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            addDisplayWidget(this);
        };

        const originalOnExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(message) {
            originalOnExecuted?.apply(this, arguments);
            this.properties ||= {};
            const lines = normalizeTextLines(message?.text);
            this.properties.jindouyunShowAnythingText = lines;
            this.__jindouyunRenderShowAnything?.(lines);
        };

        const originalOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function() {
            originalOnConfigure?.apply(this, arguments);
            window.setTimeout(() => {
                addDisplayWidget(this);
                this.__jindouyunRenderShowAnything?.(this.properties?.jindouyunShowAnythingText);
            }, 0);
        };
    },
});
