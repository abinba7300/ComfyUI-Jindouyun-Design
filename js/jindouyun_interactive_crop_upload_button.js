import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE = "JindouyunInteractiveCrop";
const RANDOM_FOLDER_ENDPOINT = "/jindouyun_design/select_random_crop_image_folder";
const UPLOAD_BUTTON_HEIGHT = 42;
const RANDOM_FOLDER_BUTTON_HEIGHT = 36;
const MAX_PATCH_ATTEMPTS = 120;

function findUploadButton(node) {
    const widgets = node.widgets || [];
    return widgets.find((widget) => (
        widget.name === "upload"
        || /选择.*上传|choose.*upload/i.test(String(widget.label || widget.name || ""))
    )) || widgets.find((widget) => (
        !widget.__jindouyunRandomFolderButton
        && (widget.type === "button" || widget.constructor?.name === "ButtonWidget")
    ));
}

function findUploadImageWidget(node) {
    return (node.widgets || []).find((widget) => widget.name === "上传图片");
}

function findFolderWidget(node) {
    return (node.widgets || []).find((widget) => widget.name === "图片文件夹");
}

function setFolderWidgetValue(node, folderWidget, folderPath) {
    if (!folderWidget) return;
    const value = String(folderPath || "");
    folderWidget.value = value;
    folderWidget.callback?.(value, app.canvas, node, folderWidget);
    node.properties ||= {};
    node.properties.jindouyunCropImageFolder = value;
}

function hideFolderWidget(node) {
    const widget = findFolderWidget(node);
    if (!widget || widget.__jindouyunRandomFolderHidden) return;
    widget.__jindouyunRandomFolderHidden = true;
    widget.hidden = true;
    widget.draw = function() {};
    widget.mouse = function() { return false; };
    widget.computeSize = function() { return [0, 0]; };
}

function setUploadWidgetValue(node, uploadWidget, nextImage) {
    const values = uploadWidget?.options?.values;
    if (Array.isArray(values) && !values.includes(nextImage)) values.push(nextImage);
    uploadWidget.value = nextImage;
    uploadWidget.callback?.(nextImage, app.canvas, node, uploadWidget);
    node.imgs = null;
    node.__jindouyunCropExecutionPreview = null;
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
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
    hideFolderWidget(node);
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
    if (widget.__jindouyunUploadButtonPatched) {
        addRandomFolderButton(node, widget);
        return;
    }

    widget.__jindouyunUploadButtonPatched = true;
    widget.label = "选择要上传的图片";
    widget.computeSize = (width) => [Number(width) || Number(node.size?.[0]) || 380, UPLOAD_BUTTON_HEIGHT];
    widget.draw = (ctx, currentNode, width, y, _height, lowQuality) => {
        drawUploadButton(widget, ctx, currentNode, width, y, lowQuality);
    };
    addRandomFolderButton(node, widget);
    node.graph?.setDirtyCanvas?.(true, true);
}

function drawRandomFolderButton(widget, ctx, node, width, y, lowQuality) {
    const left = 12;
    const top = y + 2;
    const buttonWidth = Math.max(0, width - left * 2);
    const buttonHeight = RANDOM_FOLDER_BUTTON_HEIGHT - 4;
    const hovered = node?.mouseOver?.overWidget === widget;
    const pressed = Boolean(widget.clicked);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, buttonWidth, buttonHeight, 6);
    ctx.fillStyle = pressed ? "#173B2A" : hovered ? "#254D38" : "#202D27";
    ctx.fill();
    ctx.strokeStyle = hovered ? "#8BE6AA" : "#52C878";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (!lowQuality) {
        ctx.fillStyle = widget.__jindouyunFolderStatus === "error" ? "#FFB4A6" : "#DDF8E6";
        ctx.font = "600 13px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(widget.label || "从图片文件夹随机加载"), width / 2, top + buttonHeight / 2 + 1);
    }
    ctx.restore();
    if (pressed) widget.clicked = false;
}

function addRandomFolderButton(node, uploadButton) {
    if (node.__jindouyunRandomCropFolderButton || !node.addWidget) return;
    node.properties ||= {};
    const folderWidget = findFolderWidget(node);
    const savedFolder = String(folderWidget?.value || node.properties.jindouyunCropImageFolder || "").trim();
    if (savedFolder) setFolderWidgetValue(node, folderWidget, savedFolder);

    const folderButton = node.addWidget("button", "从图片文件夹随机加载", null, async () => {
        const uploadWidget = findUploadImageWidget(node);
        if (!uploadWidget || folderButton.__jindouyunFolderLoading) return;
        folderButton.__jindouyunFolderLoading = true;
        folderButton.__jindouyunFolderStatus = "loading";
        folderButton.label = "正在选择图片文件夹...";
        node.setDirtyCanvas?.(true, true);
        try {
            const response = await api.fetchApi(RANDOM_FOLDER_ENDPOINT, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    initial_path: node.properties.jindouyunCropImageFolder || "",
                }),
            });
            const result = await response.json();
            if (!response.ok || result?.error) {
                throw new Error(result?.error || `HTTP ${response.status}`);
            }
            if (result?.cancelled) {
                folderButton.label = "从图片文件夹随机加载";
                folderButton.__jindouyunFolderStatus = "idle";
                return;
            }
            if (!result?.image || !result?.folder_path) {
                throw new Error("文件夹已选择，但没有返回可加载的图片");
            }
            setFolderWidgetValue(node, folderWidget, result.folder_path);
            node.__jindouyunApplyingRandomFolderImage = true;
            try {
                setUploadWidgetValue(node, uploadWidget, result.image);
            } finally {
                node.__jindouyunApplyingRandomFolderImage = false;
            }
            const count = Math.max(1, Number(result.folder_image_count) || 1);
            folderButton.label = `文件夹随机已开启（共 ${count} 张）`;
            folderButton.__jindouyunFolderStatus = "success";
            folderButton.options ||= {};
            folderButton.options.tooltip = `${result.folder_path}\n本次随机：${result.image_name || result.image}`;
        } catch (error) {
            console.error("[筋斗云-交互裁剪] 文件夹随机加载失败", error);
            folderButton.label = "文件夹加载失败，点击重试";
            folderButton.__jindouyunFolderStatus = "error";
            window.alert?.(`文件夹随机加载失败：${error?.message || error}`);
        } finally {
            folderButton.__jindouyunFolderLoading = false;
            node.setDirtyCanvas?.(true, true);
            app.graph?.setDirtyCanvas?.(true, true);
        }
    });
    folderButton.__jindouyunRandomFolderButton = true;
    folderButton.serialize = false;
    folderButton.__jindouyunFolderStatus = "idle";
    folderButton.label = savedFolder ? "文件夹随机已开启（每次运行换图）" : "从图片文件夹随机加载";
    folderButton.computeSize = (width) => [Number(width) || Number(node.size?.[0]) || 380, RANDOM_FOLDER_BUTTON_HEIGHT];
    folderButton.draw = (ctx, currentNode, width, y, _height, lowQuality) => {
        drawRandomFolderButton(folderButton, ctx, currentNode, width, y, lowQuality);
    };
    node.__jindouyunRandomCropFolderButton = folderButton;

    const widgets = node.widgets || [];
    const currentIndex = widgets.indexOf(folderButton);
    const uploadIndex = widgets.indexOf(uploadButton);
    if (currentIndex >= 0 && uploadIndex >= 0 && currentIndex !== uploadIndex + 1) {
        widgets.splice(currentIndex, 1);
        widgets.splice(uploadIndex + 1, 0, folderButton);
    }
}

function randomFolderPayload(output) {
    const payload = output?.jindouyun_random_folder_image;
    return Array.isArray(payload) ? payload[0] : payload;
}

function applyExecutedRandomFolderImage(node, result) {
    if (!result?.image || !result?.folder_path) return;
    const uploadWidget = findUploadImageWidget(node);
    const folderWidget = findFolderWidget(node);
    if (!uploadWidget || !folderWidget) return;

    setFolderWidgetValue(node, folderWidget, result.folder_path);
    node.__jindouyunApplyingRandomFolderImage = true;
    node.__jindouyunPreserveCropForRandomFolder = true;
    try {
        setUploadWidgetValue(node, uploadWidget, result.image);
    } finally {
        node.__jindouyunPreserveCropForRandomFolder = false;
        node.__jindouyunApplyingRandomFolderImage = false;
    }
    const count = Math.max(1, Number(result.folder_image_count) || 1);
    const button = node.__jindouyunRandomCropFolderButton;
    if (button) {
        button.label = `本次：${result.image_name || "图片"}（目录 ${count} 张）`;
        button.__jindouyunFolderStatus = "success";
    }
    window.setTimeout(() => node.__jindouyunRefreshInlineCrop?.({quiet: true}), 0);
}

let executionEventsBound = false;

function bindRandomFolderExecutionEvents() {
    if (executionEventsBound) return;
    executionEventsBound = true;
    api.addEventListener("executed", ({detail}) => {
        const result = randomFolderPayload(detail?.output);
        if (!result) return;
        const node = (app.graph?._nodes || []).find((item) =>
            String(item.id) === String(detail?.node)
            && (item.comfyClass || item.type) === NODE_TYPE
        );
        if (node) applyExecutedRandomFolderImage(node, result);
    });
}

app.registerExtension({
    name: "comfyui-jindouyun-design.interactive-crop-upload-button",

    setup() {
        bindRandomFolderExecutionEvents();
    },

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
