import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { droppedSourcePath } from "./jindouyun_load_image_drop.mjs?v=20260814-drop-path1";

const NODE_TYPE = "JindouyunLoadImage";
const SIBLINGS_ENDPOINT = "/jindouyun_design/image_siblings";
const SELECT_LOCAL_ENDPOINT = "/jindouyun_design/select_local_image";
const NAVIGATE_LOCAL_ENDPOINT = "/jindouyun_design/navigate_local_image";
const RESOLVE_DROPPED_ENDPOINT = "/jindouyun_design/resolve_dropped_image";

function findImageWidget(node) {
    return node.widgets?.find((widget) => widget.name === "image");
}

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function makeButton(label, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    Object.assign(button.style, {
        height: "34px", minWidth: "0", padding: "0 10px",
        border: "1px solid #59616D", borderRadius: "5px",
        background: "#252A31", color: "#F5F7FA",
        fontSize: "13px", fontWeight: "700", cursor: "pointer",
    });
    return button;
}

function setImageWidgetValue(node, imageWidget, nextImage) {
    const values = imageWidget?.options?.values;
    if (Array.isArray(values) && !values.includes(nextImage)) values.push(nextImage);
    imageWidget.value = nextImage;
    imageWidget.callback?.(nextImage, app.canvas, node, imageWidget);
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function isDroppedImageFile(file) {
    if (!file) return false;
    if (String(file.type || "").toLowerCase().startsWith("image/")) return true;
    return /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/i.test(String(file.name || ""));
}

function droppedImageFiles(event) {
    return Array.from(event?.dataTransfer?.files || []).filter(isDroppedImageFile);
}

function hasDroppedImage(event) {
    if (droppedImageFiles(event).length) return true;
    return Array.from(event?.dataTransfer?.items || []).some((item) =>
        item.kind === "file" && String(item.type || "").toLowerCase().startsWith("image/")
    );
}

function addImageBrowser(node) {
    if (node.__jindouyunLoadImageBrowser || !node.addDOMWidget) return;
    const imageWidget = findImageWidget(node);
    const sourcePathWidget = findWidget(node, "原始图片路径");
    if (!imageWidget || !sourcePathWidget) return;
    node.__jindouyunLoadImageBrowser = true;

    sourcePathWidget.type = "hidden";
    sourcePathWidget.computeSize = () => [0, -4];

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        display: "grid", gridTemplateRows: "38px 34px", gap: "7px",
        alignItems: "center", width: "100%", height: "93px",
        padding: "7px 8px", boxSizing: "border-box", overflow: "hidden",
    });
    const selectButton = makeButton("选择本地图像", "选择图片并保留其原始文件夹路径");
    Object.assign(selectButton.style, {height: "38px", background: "#176B46", borderColor: "#39C77A"});
    const previousButton = makeButton("← 上一张", "切换到当前文件夹中的上一张图片");
    const nextButton = makeButton("下一张 →", "切换到当前文件夹中的下一张图片");
    const positionLabel = document.createElement("span");
    positionLabel.textContent = "- / -";
    positionLabel.title = "当前图片在文件夹中的位置";
    Object.assign(positionLabel.style, {
        minWidth: "0", color: "#AEB6C2", fontSize: "12px",
        fontWeight: "700", textAlign: "center", whiteSpace: "nowrap",
    });
    const navigationRow = document.createElement("div");
    Object.assign(navigationRow.style, {
        display: "grid", gridTemplateColumns: "1fr 72px 1fr", gap: "7px", alignItems: "center",
    });
    navigationRow.append(previousButton, positionLabel, nextButton);
    wrapper.append(selectButton, navigationRow);

    let images = [];
    let currentIndex = -1;
    let requestVersion = 0;
    let applyingLocalImage = false;
    let directoryStatus = "";

    async function postJson(endpoint, body) {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
        return result;
    }

    async function uploadDroppedImage(file, directSourcePath) {
        const body = new FormData();
        body.append("image", file, file.name || "jindouyun_dropped_image.png");
        body.append("type", "input");
        const response = await api.fetchApi("/upload/image", {method: "POST", body});
        if (!response.ok) throw new Error(`图片上传失败（${response.status}）`);

        const uploaded = await response.json();
        const filename = String(uploaded?.name || uploaded?.filename || "");
        if (!filename) throw new Error("图片上传成功，但没有返回文件名");
        const subfolder = String(uploaded?.subfolder || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
        const imageValue = subfolder ? `${subfolder}/${filename}` : filename;

        let resolved = {resolved: false, source_path: ""};
        try {
            resolved = await postJson(RESOLVE_DROPPED_ENDPOINT, {
                image: imageValue,
                file_name: String(file.name || filename),
                file_size: Number(file.size || 0),
                direct_source_path: directSourcePath,
            });
        } catch (error) {
            console.warn("[筋斗云-加载图像] 未能确认拖入图片的原始目录", error);
        }

        applyingLocalImage = true;
        try {
            sourcePathWidget.value = resolved?.resolved ? String(resolved.source_path || "") : "";
            sourcePathWidget.callback?.(sourcePathWidget.value, app.canvas, node, sourcePathWidget);
            setImageWidgetValue(node, imageWidget, imageValue);
        } finally {
            applyingLocalImage = false;
        }

        images = [];
        currentIndex = -1;
        if (resolved?.resolved && sourcePathWidget.value) {
            directoryStatus = "";
            window.setTimeout(refreshSiblings, 0);
        } else {
            directoryStatus = "原目录未识别";
            renderState();
        }
    }

    function applyLocalImage(result) {
        if (!result?.image || !result?.source_path) return;
        applyingLocalImage = true;
        sourcePathWidget.value = result.source_path;
        sourcePathWidget.callback?.(result.source_path, app.canvas, node, sourcePathWidget);
        setImageWidgetValue(node, imageWidget, result.image);
        applyingLocalImage = false;
        directoryStatus = "";
        currentIndex = Number.isInteger(result.index) ? result.index : -1;
        images = Number(result.total) > 0 ? new Array(Number(result.total)).fill(null) : [];
        renderState();
    }

    function renderState() {
        const available = images.length > 0 && currentIndex >= 0;
        previousButton.disabled = !available;
        nextButton.disabled = !available;
        previousButton.style.opacity = available ? "1" : "0.45";
        nextButton.style.opacity = available ? "1" : "0.45";
        if (directoryStatus) {
            positionLabel.textContent = directoryStatus;
            positionLabel.title = "浏览器没有提供绝对路径，且未能从 Windows 资源管理器确认原文件";
            positionLabel.style.color = "#FF9B73";
        } else {
            positionLabel.textContent = available ? `${currentIndex + 1} / ${images.length}` : "- / -";
            positionLabel.title = "当前图片在文件夹中的位置";
            positionLabel.style.color = "#AEB6C2";
        }
    }

    async function refreshSiblings() {
        const sourcePath = String(sourcePathWidget.value || "").trim();
        if (sourcePath) {
            const version = ++requestVersion;
            try {
                const result = await postJson(NAVIGATE_LOCAL_ENDPOINT, {
                    source_path: sourcePath,
                    direction: 0,
                });
                if (version !== requestVersion) return;
                currentIndex = Number.isInteger(result.index) ? result.index : -1;
                images = Number(result.total) > 0 ? new Array(Number(result.total)).fill(null) : [];
            } catch (_) {
                if (version !== requestVersion) return;
                images = [];
                currentIndex = -1;
            }
            renderState();
            return;
        }
        const image = String(imageWidget.value || "").trim();
        const version = ++requestVersion;
        if (!image) {
            images = [];
            currentIndex = -1;
            renderState();
            return;
        }
        try {
            const response = await fetch(SIBLINGS_ENDPOINT, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({image}),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            if (version !== requestVersion) return;
            images = Array.isArray(result.images) ? result.images : [];
            currentIndex = Number.isInteger(result.index) ? result.index : images.indexOf(image);
        } catch (_) {
            if (version !== requestVersion) return;
            images = [];
            currentIndex = -1;
        }
        renderState();
    }

    async function switchImage(direction) {
        const sourcePath = String(sourcePathWidget.value || "").trim();
        if (sourcePath) {
            try {
                const result = await postJson(NAVIGATE_LOCAL_ENDPOINT, {source_path: sourcePath, direction});
                applyLocalImage(result);
            } catch (error) {
                window.alert?.(`切换图片失败：${error.message}`);
            }
            return;
        }
        if (!images.length || currentIndex < 0) return;
        currentIndex = (currentIndex + direction + images.length) % images.length;
        const nextImage = images[currentIndex];
        setImageWidgetValue(node, imageWidget, nextImage);
        renderState();
    }

    previousButton.addEventListener("click", () => switchImage(-1));
    nextButton.addEventListener("click", () => switchImage(1));
    selectButton.addEventListener("click", async () => {
        selectButton.disabled = true;
        selectButton.textContent = "选择中...";
        try {
            const result = await postJson(SELECT_LOCAL_ENDPOINT, {
                initial_path: String(sourcePathWidget.value || "").trim(),
            });
            if (!result.cancelled) applyLocalImage(result);
        } catch (error) {
            window.alert?.(`选择图片失败：${error.message}`);
        } finally {
            selectButton.disabled = false;
            selectButton.textContent = "选择本地图像";
        }
    });
    const originalCallback = imageWidget.callback;
    imageWidget.callback = function() {
        const result = originalCallback?.apply(this, arguments);
        if (!applyingLocalImage) {
            sourcePathWidget.value = "";
            directoryStatus = "";
        }
        window.setTimeout(refreshSiblings, 0);
        return result;
    };

    const originalOnDragOver = node.onDragOver;
    node.onDragOver = function(event) {
        if (hasDroppedImage(event)) return true;
        return originalOnDragOver?.apply(this, arguments) ?? false;
    };
    const originalOnDragDrop = node.onDragDrop;
    node.onDragDrop = async function(event) {
        const files = droppedImageFiles(event);
        if (!files.length) return (await originalOnDragDrop?.apply(this, arguments)) ?? false;
        const directSourcePath = droppedSourcePath(event, files[0]);
        try {
            await uploadDroppedImage(files[0], directSourcePath);
            return true;
        } catch (error) {
            console.error("[筋斗云-加载图像] 拖入图片失败", error);
            window.alert?.(error?.message || "拖入图片失败，请重新尝试。");
            return true;
        }
    };

    const domWidget = node.addDOMWidget("图片浏览", "jindouyun_load_image_browser", wrapper, {
        serialize: false, hideOnZoom: false,
        getMinHeight: () => 93, getMaxHeight: () => 93,
    });
    domWidget.computeSize = () => [Math.max(250, Number(node.size?.[0] || 300) - 28), 93];
    node.setSize?.([Math.max(node.size?.[0] || 300, 300), Math.max(node.size?.[1] || 100, 235)]);
    renderState();
    refreshSiblings();
}

app.registerExtension({
    name: "comfyui-jindouyun-design.load-image",
    nodeCreated(node) {
        if ((node.comfyClass || node.type) === NODE_TYPE) addImageBrowser(node);
    },
    loadedGraphNode(node) {
        if ((node.comfyClass || node.type) === NODE_TYPE) addImageBrowser(node);
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            addImageBrowser(this);
        };
    },
});
