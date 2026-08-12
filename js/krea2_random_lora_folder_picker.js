import { app } from "../../scripts/app.js";

const NODE_TYPES = new Set([
    "JindouyunRandomLora",
    "Krea2RandomLoraAuto",
    "Krea2RandomLoraModelOnly",
    "NunchakuRandomLoraModelOnly",
]);

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
    }
}

app.registerExtension({
    name: "comfyui-jindouyun-design.folder-picker",
    nodeCreated(node) {
        patchNode(node);
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (!NODE_TYPES.has(nodeData.name)) {
            return;
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
