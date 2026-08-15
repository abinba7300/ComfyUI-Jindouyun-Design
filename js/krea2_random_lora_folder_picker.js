import { app } from "../../scripts/app.js";

const NODE_TYPES = new Set([
    "JindouyunRandomLora",
    "Krea2RandomLoraAuto",
    "Krea2RandomLoraModelOnly",
    "NunchakuRandomLoraModelOnly",
]);
const MODE_BADGE_NODE_TYPE = "JindouyunRandomLora";

function fixedLoraLabel(value) {
    const text = String(value || "").trim();
    if (!text || text === "无") {
        return "尚未选择固定 LoRA";
    }
    const parts = text.split(/[\\/]/);
    return parts[parts.length - 1] || text;
}

function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, width, height, radius);
    } else {
        ctx.rect(x, y, width, height);
    }
}

function drawModeCard(ctx, node, width, y, randomWidget, fixedWidget) {
    const randomMode = randomWidget.value !== false;
    const cardX = 15;
    const cardY = y + 1;
    const cardWidth = Math.max(80, width - 30);
    const cardHeight = 48;
    const accent = randomMode ? "#39C77A" : "#58A6FF";
    const iconAccent = randomMode ? "#67D391" : "#72B7FF";
    const title = randomMode ? "随机目录模式" : "固定 LoRA 模式";
    const detail = randomMode
        ? "目录内全部 LoRA · 每次随机 1 个"
        : fixedLoraLabel(fixedWidget.value);

    ctx.save();
    roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 6);
    ctx.fillStyle = randomMode ? "rgba(57, 199, 122, 0.14)" : "rgba(88, 166, 255, 0.14)";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    const iconX = cardX + 26;
    const iconY = cardY + cardHeight / 2;
    ctx.beginPath();
    ctx.arc(iconX, iconY, 15, 0, Math.PI * 2);
    ctx.fillStyle = randomMode ? "rgba(57, 199, 122, 0.10)" : "rgba(88, 166, 255, 0.10)";
    ctx.strokeStyle = iconAccent;
    ctx.fill();
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = iconAccent;
    ctx.font = "800 14px Arial";
    ctx.fillText(randomMode ? "随" : "固", iconX, iconY);

    const textX = cardX + 52;
    const textWidth = Math.max(0, cardWidth - 62);
    ctx.textAlign = "left";
    ctx.fillStyle = "#F7F8FA";
    ctx.font = "700 13px Arial";
    ctx.fillText(fitText(ctx, title, textWidth), textX, cardY + 18);
    ctx.fillStyle = "#C8CED8";
    ctx.font = "10px Arial";
    ctx.fillText(fitText(ctx, detail, textWidth), textX, cardY + 35);
    ctx.restore();
}

function patchModeBadge(node) {
    if ((node.comfyClass || node.type) !== MODE_BADGE_NODE_TYPE) return;

    const randomWidget = node.widgets?.find((item) => item.name === "随机");
    const fixedWidget = node.widgets?.find((item) => item.name === "固定");
    if (!randomWidget || !fixedWidget || randomWidget.__jindouyunModeCard) return;
    randomWidget.__jindouyunModeCard = true;

    randomWidget.computeSize = (width) => [width || node.size?.[0] || 320, 60];
    randomWidget.draw = function(ctx, currentNode, width, y) {
        drawModeCard(ctx, currentNode || node, width, y, randomWidget, fixedWidget);
    };

    const originalMouse = randomWidget.mouse;
    randomWidget.mouse = function(event) {
        const type = String(event?.type || "").toLowerCase();
        if (type === "pointerdown" || type === "mousedown" || type === "click") {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            const nextValue = !(randomWidget.value !== false);
            randomWidget.value = nextValue;
            randomWidget.callback?.(nextValue, app.canvas, node, randomWidget);
            node.setDirtyCanvas?.(true, true);
            app.graph?.setDirtyCanvas?.(true, true);
            return true;
        }
        return originalMouse?.apply(this, arguments);
    };
}

function migrateSavedModeBadgeValue(info) {
    if (Array.isArray(info?.inputs)) {
        info.inputs = info.inputs.filter((input) => (
            input?.name !== "启用" && input?.localized_name !== "启用"
        ));
    }

    let values = info?.widgets_values;
    if (!Array.isArray(values)) return;

    if (
        values.length >= 15 &&
        (values[0] === "" || values[0] == null) &&
        typeof values[1] === "boolean" &&
        typeof values[2] === "boolean" &&
        typeof values[3] === "string" &&
        typeof values[4] === "string"
    ) {
        values = values.slice(1);
    }

    if (
        typeof values[0] === "boolean" &&
        typeof values[1] === "boolean" &&
        typeof values[2] === "string"
    ) {
        values = values.slice(1);
    }
    info.widgets_values = values;
}

function migrateWorkflowGraphData(graphData) {
    const visitNodes = (nodes) => {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
            if (node?.type === MODE_BADGE_NODE_TYPE) {
                migrateSavedModeBadgeValue(node);
            }
        }
    };

    visitNodes(graphData?.nodes);
    for (const subgraph of graphData?.definitions?.subgraphs || []) {
        visitNodes(subgraph?.nodes);
    }
}

async function chooseFolder(widget, node) {
    if (widget.__jindouyunFolderDialogOpen) {
        return;
    }
    widget.__jindouyunFolderDialogOpen = true;
    try {
        const response = await fetch("/jindouyun_design/select_folder", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({initial_path: widget.value || ""}),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data?.error || "打开文件夹选择框失败");
        }
        if (!data.path) {
            return;
        }
        widget.value = data.path;
        widget.callback?.(data.path, app.canvas, node, widget);
        app.graph.setDirtyCanvas(true, true);
    } finally {
        widget.__jindouyunFolderDialogOpen = false;
    }
}

function showError(error) {
    console.error("[Jindouyun Random LoRA] folder picker failed:", error);
    alert(error.message || error);
}

function fitText(ctx, value, maxWidth) {
    const text = String(value || "");
    if (!text || ctx.measureText(text).width <= maxWidth) {
        return text;
    }
    const ellipsis = "...";
    let start = 0;
    let end = text.length;
    while (start < end) {
        const middle = Math.ceil((start + end) / 2);
        if (ctx.measureText(`${ellipsis}${text.slice(-middle)}`).width <= maxWidth) {
            start = middle;
        } else {
            end = middle - 1;
        }
    }
    return `${ellipsis}${text.slice(-start)}`;
}

function drawFolderWidget(ctx, node, width, y, height) {
    const rowX = 15;
    const rowY = y + 1;
    const rowWidth = Math.max(80, width - 30);
    const rowHeight = Math.max(20, (height || 20) - 2);
    const labelX = rowX + 12;
    const arrowX = rowX + rowWidth - 16;
    const label = "LoRA目录";
    const displayValue = this.value || "点击选择文件夹";

    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
        ctx.roundRect(rowX, rowY, rowWidth, rowHeight, rowHeight / 2);
    } else {
        ctx.rect(rowX, rowY, rowWidth, rowHeight);
    }
    ctx.fillStyle = "#222222";
    ctx.strokeStyle = "#666666";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    ctx.font = "14px Arial";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#b8b8b8";
    ctx.textAlign = "left";
    ctx.fillText(label, labelX, rowY + rowHeight / 2);

    const valueX = labelX + ctx.measureText(label).width + 14;
    const valueWidth = Math.max(0, arrowX - valueX - 10);
    if (valueWidth > 12) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(valueX, rowY, valueWidth, rowHeight);
        ctx.clip();
        ctx.fillStyle = this.value ? "#dddddd" : "#999999";
        ctx.textAlign = "right";
        ctx.fillText(fitText(ctx, displayValue, valueWidth), valueX + valueWidth, rowY + rowHeight / 2);
        ctx.restore();
    }

    ctx.fillStyle = "#dddddd";
    ctx.beginPath();
    ctx.moveTo(arrowX - 4, rowY + rowHeight / 2 - 5);
    ctx.lineTo(arrowX + 4, rowY + rowHeight / 2);
    ctx.lineTo(arrowX - 4, rowY + rowHeight / 2 + 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function patchFolderWidget(node) {
    const widget = node.widgets?.find((item) => item.name === "LoRA目录");
    if (!widget || widget.__jindouyunFolderPicker) {
        return;
    }
    widget.__jindouyunFolderPicker = true;
    widget.options ||= {};
    widget.options.placeholder = "点击此处选择 LoRA 文件夹";
    widget.draw = drawFolderWidget;

    const openPicker = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        chooseFolder(widget, node).catch(showError);
        return true;
    };
    const originalMouse = widget.mouse;
    widget.mouse = function(event) {
        const type = String(event?.type || "").toLowerCase();
        if (type === "pointerdown" || type === "mousedown" || type === "click") {
            return openPicker(event);
        }
        return originalMouse?.apply(this, arguments);
    };
    widget.onPointerDown = openPicker;
    widget.onClick = openPicker;
}

function patchNode(node) {
    if (NODE_TYPES.has(node.comfyClass || node.type)) {
        patchFolderWidget(node);
        patchModeBadge(node);
    }
}

app.registerExtension({
    name: "comfyui-jindouyun-design.folder-picker",
    beforeConfigureGraph(graphData) {
        migrateWorkflowGraphData(graphData);
    },
    nodeCreated(node) {
        patchNode(node);
    },
    loadedGraphNode(node) {
        patchNode(node);
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (!NODE_TYPES.has(nodeData.name)) {
            return;
        }
        if (nodeData.name === MODE_BADGE_NODE_TYPE) {
            const originalConfigure = nodeType.prototype.configure;
            nodeType.prototype.configure = function(info) {
                migrateSavedModeBadgeValue(info);
                const result = originalConfigure?.apply(this, arguments);
                if (Array.isArray(this.inputs)) {
                    this.inputs = this.inputs.filter((input) => (
                        input?.name !== "启用" && input?.localized_name !== "启用"
                    ));
                }
                return result;
            };
        }
        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            patchNode(this);
        };
        const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function(_, options) {
            originalGetExtraMenuOptions?.apply(this, arguments);
            const widget = this.widgets?.find((item) => item.name === "LoRA目录");
            if (widget) {
                options.push({content: "选择 LoRA 文件夹", callback: () => chooseFolder(widget, this)});
            }
        };
    },
});
