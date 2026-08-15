import { app } from "../../scripts/app.js";

const NODE_TYPE = "JindouyunInteractiveCrop";
const UPLOAD_BUTTON_HEIGHT = 42;
const MAX_PATCH_ATTEMPTS = 120;

function findUploadButton(node) {
    return (node.widgets || []).find((widget) => (
        widget.type === "button"
        || widget.constructor?.name === "ButtonWidget"
        || /选择.*上传|choose.*upload/i.test(String(widget.label || ""))
    ));
}

function drawUploadButton(widget, ctx, node, width, y, lowQuality) {
    const left = 12;
    const top = y + 2;
    const buttonWidth = Math.max(0, width - left * 2);
    const buttonHeight = UPLOAD_BUTTON_HEIGHT - 4;
    const hovered = node?.mouseOver?.overWidget === widget;
    const pressed = Boolean(widget.clicked);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, buttonWidth, buttonHeight, 6);
    ctx.fillStyle = pressed ? "#1F6B43" : hovered ? "#3EAF72" : "#2E8B57";
    ctx.fill();
    ctx.strokeStyle = hovered ? "#9AF0B8" : "#61C98A";
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!lowQuality) {
        const centerX = width / 2;
        const iconX = Math.max(left + 18, centerX - 79);
        const iconY = top + buttonHeight / 2;
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(iconX, iconY + 5);
        ctx.lineTo(iconX, iconY - 6);
        ctx.moveTo(iconX - 4, iconY - 2);
        ctx.lineTo(iconX, iconY - 6);
        ctx.lineTo(iconX + 4, iconY - 2);
        ctx.moveTo(iconX - 6, iconY + 5);
        ctx.lineTo(iconX + 6, iconY + 5);
        ctx.stroke();

        ctx.fillStyle = "#FFFFFF";
        ctx.font = "600 14px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(widget.label, centerX + 8, iconY + 1);
    }
    ctx.restore();
    if (pressed) widget.clicked = false;
}

function patchUploadButton(node) {
    if ((node.comfyClass || node.type) !== NODE_TYPE) return;
    const widget = findUploadButton(node);
    if (!widget) {
        const attempts = Number(node.__jindouyunUploadButtonAttempts || 0);
        if (!node.__jindouyunUploadButtonTimer && attempts < MAX_PATCH_ATTEMPTS) {
            node.__jindouyunUploadButtonAttempts = attempts + 1;
            node.__jindouyunUploadButtonTimer = window.setTimeout(() => {
                node.__jindouyunUploadButtonTimer = null;
                patchUploadButton(node);
            }, 100);
        }
        return;
    }
    if (widget.__jindouyunUploadButtonPatched) return;

    widget.__jindouyunUploadButtonPatched = true;
    widget.label = "选择要上传的图片";
    widget.computeSize = (width) => [Number(width) || Number(node.size?.[0]) || 380, UPLOAD_BUTTON_HEIGHT];
    widget.draw = (ctx, currentNode, width, y, _height, lowQuality) => {
        drawUploadButton(widget, ctx, currentNode, width, y, lowQuality);
    };
    node.graph?.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "comfyui-jindouyun-design.interactive-crop-upload-button",

    nodeCreated(node) {
        patchUploadButton(node);
    },

    loadedGraphNode(node) {
        patchUploadButton(node);
    },

    afterConfigureGraph() {
        for (const node of app.graph?._nodes || []) patchUploadButton(node);
    },

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            patchUploadButton(this);
        };
    },
});
