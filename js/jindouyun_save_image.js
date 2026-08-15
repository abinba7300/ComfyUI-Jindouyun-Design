import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
    containImageRect,
    featuredPreviewRects,
    interpolateRect,
    pointInRect,
} from "./jindouyun_save_preview_geometry.mjs";

const NODE_TYPE = "JindouyunSaveImage";

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function setWidgetValue(widget, value, node) {
    if (!widget) return;
    widget.value = value;
    widget.callback?.(value, app.canvas, node, widget);
    app.graph?.setDirtyCanvas?.(true, true);
}

function hideInternalWidget(widget) {
    if (!widget || widget.__jindouyunHidden) return;
    widget.__jindouyunHidden = true;
    widget.hidden = true;
    widget.draw = function() {};
    widget.mouse = function() { return false; };
    widget.computeSize = function() { return [0, 0]; };
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

function roundedRectPath(ctx, x, y, width, height, radius = 5) {
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, width, height, safeRadius);
        return;
    }
    ctx.moveTo(x + safeRadius, y);
    ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
    ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
    ctx.arcTo(x, y + height, x, y, safeRadius);
    ctx.arcTo(x, y, x + width, y, safeRadius);
    ctx.closePath();
}

function drawPreviewTile(ctx, image, rect, featured, selected = false) {
    ctx.save();
    roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, 5);
    ctx.fillStyle = featured ? "#171B21" : "#1C2128";
    ctx.fill();
    ctx.clip();

    const imageWidth = Number(image?.naturalWidth || image?.width || 0);
    const imageHeight = Number(image?.naturalHeight || image?.height || 0);
    if (image && imageWidth > 0 && imageHeight > 0) {
        const drawRect = containImageRect(imageWidth, imageHeight, rect, featured ? 6 : 3);
        ctx.drawImage(image, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
    }
    ctx.restore();

    ctx.save();
    roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, 5);
    ctx.strokeStyle = selected ? "#FF7082" : (featured ? "#67D391" : "#59616D");
    ctx.lineWidth = selected ? 3 : (featured ? 1.5 : 1);
    ctx.stroke();
    if (featured && rect.width >= 92 && rect.height >= 44) {
        const badgeWidth = 38;
        const badgeHeight = 18;
        roundedRectPath(ctx, rect.x + 8, rect.y + 8, badgeWidth, badgeHeight, 4);
        ctx.fillStyle = "rgba(23, 107, 70, 0.92)";
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "700 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("最新", rect.x + 8 + badgeWidth / 2, rect.y + 8 + badgeHeight / 2 + 0.5);
    }
    if (selected) {
        const centerX = rect.x + rect.width - 13;
        const centerY = rect.y + 13;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 9, 0, Math.PI * 2);
        ctx.fillStyle = "#E4475B";
        ctx.fill();
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX - 4, centerY);
        ctx.lineTo(centerX - 1, centerY + 3);
        ctx.lineTo(centerX + 5, centerY - 4);
        ctx.stroke();
    }
    ctx.restore();
}

function drawTrashButton(ctx, rect, deleting = false) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 8;
    roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, 6);
    ctx.fillStyle = deleting ? "#7B2F39" : "#B63E4D";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#FF8B99";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const iconX = rect.x + 15;
    const iconY = rect.y + rect.height / 2;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(iconX - 5, iconY - 6);
    ctx.lineTo(iconX + 5, iconY - 6);
    ctx.moveTo(iconX - 3, iconY - 8);
    ctx.lineTo(iconX + 3, iconY - 8);
    ctx.rect(iconX - 4, iconY - 4, 8, 10);
    ctx.stroke();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(deleting ? "处理中" : "删除", rect.x + 29, iconY + 0.5);
    ctx.restore();
}

function drawDeleteAnimation(ctx, image, animation, trashRect) {
    if (!animation || !image || !trashRect) return;
    const target = {
        x: trashRect.x + 13,
        y: trashRect.y + trashRect.height / 2 - 3,
        width: 6,
        height: 6,
    };
    const rect = interpolateRect(animation.fromRect, target, animation.progress);
    ctx.save();
    ctx.globalAlpha = Math.max(0.12, 1 - animation.progress * 0.82);
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.rotate(animation.progress * Math.PI * 0.65);
    roundedRectPath(ctx, -rect.width / 2, -rect.height / 2, rect.width, rect.height, 4);
    ctx.clip();
    const imageWidth = Number(image.naturalWidth || image.width || 1);
    const imageHeight = Number(image.naturalHeight || image.height || 1);
    const drawRect = containImageRect(
        imageWidth,
        imageHeight,
        {x: -rect.width / 2, y: -rect.height / 2, width: rect.width, height: rect.height},
        0,
    );
    ctx.drawImage(image, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
    ctx.restore();
}

function drawFeaturedPreview(ctx, node, widget, images, x, y, width, height) {
    if (!ctx || !Array.isArray(images) || images.length === 0 || node.flags?.collapsed) return [];
    if (width < 120 || height < 100) return [];

    const visibleImages = images.slice(0, 4);
    const rects = featuredPreviewRects(x, y, width, height, visibleImages.length, 6);
    node.imageIndex = null;
    node.imageRects = [];
    for (let index = 0; index < rects.length; index += 1) {
        if (widget.deleteAnimation?.index === index) continue;
        drawPreviewTile(ctx, visibleImages[index], rects[index], index === 0, widget.selectedIndex === index);
    }

    widget.trashRect = null;
    if (widget.selectedIndex >= 0 && widget.selectedIndex < rects.length) {
        widget.trashRect = {
            x: x + width - 76,
            y: y + height - 38,
            width: 70,
            height: 32,
        };
        drawTrashButton(ctx, widget.trashRect, widget.deleting);
        drawDeleteAnimation(
            ctx,
            visibleImages[widget.deleteAnimation?.index],
            widget.deleteAnimation,
            widget.trashRect,
        );
    }
    return rects;
}

function previewImageUrl(imageData, cacheKey) {
    const query = new URLSearchParams({
        filename: String(imageData?.filename || ""),
        subfolder: String(imageData?.subfolder || ""),
        type: String(imageData?.type || "temp"),
        t: String(cacheKey),
    });
    return api.apiURL(`/view?${query.toString()}`);
}

function pointerPositions(pos, node, widget) {
    const x = Number(pos?.[0]);
    const y = Number(pos?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];

    const positions = [{x, y}];
    const nodeX = Number(node?.pos?.[0]);
    const nodeY = Number(node?.pos?.[1]);
    if (Number.isFinite(nodeX) && Number.isFinite(nodeY)) {
        positions.push({x: x - nodeX, y: y - nodeY});
    }
    const widgetY = Number(widget?.last_y);
    if (Number.isFinite(widgetY) && widgetY > 0) {
        positions.push({x, y: y + widgetY});
    }
    return positions;
}

function hitRectIndex(positions, rects) {
    if (!Array.isArray(rects)) return -1;
    return rects.findIndex((rect) => (
        positions.some((position) => pointInRect(position.x, position.y, rect))
    ));
}

function hitsRect(positions, rect) {
    return positions.some((position) => pointInRect(position.x, position.y, rect));
}

function promotePreviewImage(node, widget, index) {
    if (index <= 0) return false;
    const imageData = node.__jindouyunRecentImageData;
    const images = node.__jindouyunRecentImages;
    if (!Array.isArray(imageData) || !Array.isArray(images)) return false;
    if (index >= imageData.length || index >= images.length) return false;

    [imageData[0], imageData[index]] = [imageData[index], imageData[0]];
    [images[0], images[index]] = [images[index], images[0]];
    widget.selectedIndex = 0;
    widget.lastClickIndex = -1;
    widget.lastClickAt = 0;
    node.setDirtyCanvas?.(true, true);
    return true;
}

function setFeaturedPreviewImages(node, imageData) {
    const entries = Array.isArray(imageData) ? imageData.slice(0, 4) : [];
    node.__jindouyunRecentImageData = entries;
    node.__jindouyunOwnsPreview = true;
    const cacheKey = Date.now();
    node.__jindouyunRecentImages = entries.map((entry, index) => {
        const image = new Image();
        image.__jindouyunImageData = entry;
        image.onload = image.onerror = () => node.setDirtyCanvas?.(true, true);
        image.src = previewImageUrl(entry, `${cacheKey}-${index}`);
        return image;
    });
    // ComfyUI renders node.imgs as its own preview. Keep our images separate so
    // the native grid and the custom featured preview are not both displayed.
    node.imgs = [];
    node.imageIndex = null;
    node.imageRects = [];
    const widget = ensureFeaturedPreviewWidget(node);
    widget.selectedIndex = -1;
    widget.deleteAnimation = null;
    widget.deleting = false;
    node.setDirtyCanvas?.(true, true);
}

async function deleteSelectedPreview(node, widget) {
    if (widget.deleting || widget.selectedIndex < 0) return;
    const index = widget.selectedIndex;
    const imageData = node.__jindouyunRecentImageData?.[index];
    const fromRect = widget.hitRects?.[index];
    if (!imageData || !fromRect || !widget.trashRect) return;

    const directory = String(node.__jindouyunEffectiveSaveDirectory?.() || "").trim();
    if (!directory) {
        node.__jindouyunSetSaveStatus?.("删除失败：找不到保存目录", "error");
        return;
    }

    widget.deleting = true;
    widget.deleteAnimation = {index, fromRect: {...fromRect}, progress: 0};
    const startedAt = performance.now();
    await new Promise((resolve) => {
        const tick = (now) => {
            widget.deleteAnimation.progress = Math.min(1, (now - startedAt) / 420);
            node.setDirtyCanvas?.(true, true);
            if (widget.deleteAnimation.progress < 1) {
                window.requestAnimationFrame(tick);
            } else {
                resolve();
            }
        };
        window.requestAnimationFrame(tick);
    });

    try {
        const result = await node.__jindouyunPostSaveJson?.(
            "/jindouyun_design/delete_saved_image",
            {directory, filename: imageData.filename},
        );
        if (!result) throw new Error("删除接口不可用，请刷新页面后重试");
        setFeaturedPreviewImages(node, result.images);
        node.__jindouyunSetSaveStatus?.(
            `已移入回收站：${result.filename}`,
            "success",
            result.directory,
        );
    } catch (error) {
        widget.deleting = false;
        widget.deleteAnimation = null;
        node.__jindouyunSetSaveStatus?.(`删除失败：${error.message}`, "error");
        node.setDirtyCanvas?.(true, true);
    }
}

function ensureFeaturedPreviewWidget(node) {
    if (node.__jindouyunFeaturedPreviewWidget) return node.__jindouyunFeaturedPreviewWidget;
    const previewWidget = {
        type: "custom",
        name: "最近保存预览",
        serialize: false,
        selectedIndex: -1,
        deleting: false,
        hitRects: [],
        trashRect: null,
        deleteAnimation: null,
        lastClickIndex: -1,
        lastClickAt: 0,
        draw(ctx, ownerNode, widgetWidth, widgetY) {
            ownerNode.imgs = [];
            ownerNode.imageIndex = null;
            ownerNode.imageRects = [];
            const height = Math.max(220, Number(ownerNode.size?.[1] || 0) - widgetY - 10);
            this.hitRects = drawFeaturedPreview(
                ctx,
                ownerNode,
                this,
                ownerNode.__jindouyunRecentImages,
                10,
                widgetY + 4,
                Math.max(0, widgetWidth - 20),
                height - 8,
            );
        },
        mouse(event, pos, ownerNode) {
            if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
            if (this.deleting) return true;
            const positions = pointerPositions(pos, ownerNode, this);
            if (hitsRect(positions, this.trashRect) && this.selectedIndex >= 0) {
                void deleteSelectedPreview(ownerNode, this);
                return true;
            }
            const index = hitRectIndex(positions, this.hitRects);
            if (index < 0) {
                this.selectedIndex = -1;
                this.lastClickIndex = -1;
                this.lastClickAt = 0;
                ownerNode.setDirtyCanvas?.(true, true);
                return false;
            }

            const clickedAt = Number.isFinite(Number(event.timeStamp))
                ? Number(event.timeStamp)
                : Date.now();
            const isDoubleClick = index === this.lastClickIndex
                && clickedAt >= this.lastClickAt
                && clickedAt - this.lastClickAt <= 360;
            this.selectedIndex = index;
            if (isDoubleClick && index > 0) {
                promotePreviewImage(ownerNode, this, index);
                return true;
            }
            this.lastClickIndex = index;
            this.lastClickAt = clickedAt;
            ownerNode.setDirtyCanvas?.(true, true);
            return true;
        },
        computeSize(width) {
            return [width, Math.max(260, Math.min(520, Number(width || 360) * 0.78))];
        },
        computeLayoutSize(ownerNode) {
            const height = Math.max(260, Math.min(520, Number(ownerNode.size?.[0] || 360) * 0.78));
            return {minHeight: height, maxHeight: height};
        },
    };
    node.__jindouyunFeaturedPreviewWidget = node.addCustomWidget(previewWidget);
    window.requestAnimationFrame(() => {
        const computed = node.computeSize?.();
        if (!computed) return;
        node.setSize?.([
            Math.max(Number(node.size?.[0] || 0), 320),
            Math.max(Number(node.size?.[1] || 0), Number(computed[1] || 0)),
        ]);
        node.setDirtyCanvas?.(true, true);
    });
    return node.__jindouyunFeaturedPreviewWidget;
}

function patchFeaturedPreview(node) {
    if (node.__jindouyunFeaturedPreviewPatched) return;
    node.__jindouyunFeaturedPreviewPatched = true;
    const originalOnDrawBackground = node.onDrawBackground;
    node.onDrawBackground = function(ctx) {
        if (this.__jindouyunOwnsPreview) return undefined;
        return originalOnDrawBackground?.apply(this, arguments);
    };
}

function addSaveFolderControls(node) {
    if (node.__jindouyunSaveFolderControls || !node.addDOMWidget) return;
    const pathWidget = findWidget(node, "保存目录");
    const overrideWidget = findWidget(node, "目录覆盖");
    if (!pathWidget || !overrideWidget) return;
    node.__jindouyunSaveFolderControls = true;

    const defaultDirectory = String(
        pathWidget?.options?.default ?? pathWidget?.default_value ?? "",
    ).trim();
    if (!String(pathWidget.value || "").trim() && defaultDirectory) {
        setWidgetValue(pathWidget, defaultDirectory, node);
    }

    hideInternalWidget(overrideWidget);
    patchFeaturedPreview(node);

    function connectedLoadImageDirectory() {
        const input = node.inputs?.find((item) => item.name === "保存目录");
        const link = input?.link != null ? app.graph?.links?.[input.link] : null;
        const originNode = link ? app.graph?.getNodeById?.(link.origin_id) : null;
        if (!originNode || Number(link.origin_slot) !== 2) return "";
        if ((originNode.comfyClass || originNode.type) !== "JindouyunLoadImage") return "";
        const sourcePath = String(findWidget(originNode, "原始图片路径")?.value || "").trim();
        const separatorIndex = Math.max(sourcePath.lastIndexOf("\\"), sourcePath.lastIndexOf("/"));
        return separatorIndex > 0 ? sourcePath.slice(0, separatorIndex) : "";
    }

    function effectiveDirectory() {
        const overrideValue = String(overrideWidget.value || "").trim();
        if (overrideValue) return overrideValue;
        const input = node.inputs?.find((item) => item.name === "保存目录");
        const connected = input?.link != null;
        const widgetValue = String(pathWidget.value || "").trim();
        const executedValue = String(node.__jindouyunLastSaveDirectory || "").trim();
        return connected
            ? (connectedLoadImageDirectory() || executedValue)
            : (widgetValue || executedValue);
    }

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        display: "grid", gridTemplateRows: "26px 34px 34px 28px", gap: "7px",
        width: "100%", height: "157px", padding: "7px 8px",
        boxSizing: "border-box", overflow: "hidden",
    });
    const pathTailText = document.createElement("input");
    pathTailText.type = "text";
    pathTailText.readOnly = true;
    pathTailText.dataset.jindouyunPathTail = "true";
    pathTailText.value = "跟随输入目录";
    pathTailText.title = "当前实际保存目录";
    Object.assign(pathTailText.style, {
        width: "100%", minWidth: "0", height: "26px", lineHeight: "24px",
        boxSizing: "border-box", padding: "0 8px",
        border: "1px solid #525A66", borderRadius: "5px", background: "#181C22",
        color: "#D8DEE8", fontSize: "12px", whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "clip", textAlign: "left", direction: "ltr",
        cursor: "default", outline: "none",
    });
    const browseButton = makeButton("浏览", "选择本地保存文件夹");
    Object.assign(browseButton.style, {background: "#176B46", borderColor: "#39C77A"});
    const openFolderButton = makeButton("打开文件夹", "使用资源管理器打开当前保存目录");
    Object.assign(openFolderButton.style, {background: "#153A63", borderColor: "#4DA3FF"});
    const browseRow = document.createElement("div");
    Object.assign(browseRow.style, {display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px"});
    browseRow.append(browseButton, openFolderButton);
    const folderNameInput = document.createElement("input");
    folderNameInput.type = "text";
    folderNameInput.placeholder = "新文件夹名称";
    Object.assign(folderNameInput.style, {
        width: "100%", minWidth: "0", height: "34px", boxSizing: "border-box",
        border: "1px solid #525A66", borderRadius: "5px", background: "#181C22",
        color: "#FFFFFF", padding: "0 9px", fontSize: "13px",
    });
    const createButton = makeButton("新建并进入", "在当前保存目录中新建文件夹，并作为真正的运行保存目录");
    const followButton = makeButton("跟随输入", "清除自定义子目录，重新使用连接线传入的保存目录");
    Object.assign(followButton.style, {height: "28px", padding: "0 8px", fontSize: "12px"});
    const createRow = document.createElement("div");
    Object.assign(createRow.style, {display: "grid", gridTemplateColumns: "minmax(0, 1fr) 104px", gap: "7px"});
    createRow.append(folderNameInput, createButton);
    const statusLabel = document.createElement("div");
    Object.assign(statusLabel.style, {
        minWidth: "0", height: "28px", display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 82px", gap: "7px", alignItems: "center",
    });
    const statusText = document.createElement("span");
    statusText.textContent = "当前：跟随输入目录";
    statusText.title = "当前实际保存目录";
    Object.assign(statusText.style, {
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        color: "#AEB6C2", fontSize: "11px",
    });
    statusLabel.append(statusText, followButton);
    wrapper.append(pathTailText, browseRow, createRow, statusLabel);

    function updatePathTail(path = effectiveDirectory()) {
        const value = String(path || "").trim();
        pathTailText.value = value || "跟随输入目录";
        pathTailText.title = value || "当前实际保存目录";
        window.requestAnimationFrame(() => {
            pathTailText.scrollLeft = pathTailText.scrollWidth;
        });
    }
    const pathResizeObserver = new ResizeObserver(() => {
        pathTailText.scrollLeft = pathTailText.scrollWidth;
    });
    pathResizeObserver.observe(pathTailText);
    node.__jindouyunUpdateSavePathTail = updatePathTail;
    wrapper.addEventListener("mouseenter", () => {
        if (!String(overrideWidget.value || "").trim()) updatePathTail(effectiveDirectory());
    });

    function setStatus(message, kind = "info", fullPath = "") {
        statusText.textContent = message;
        statusText.title = fullPath || message;
        statusText.style.color = kind === "success"
            ? "#67D391"
            : kind === "error" ? "#FF7B88" : "#AEB6C2";
    }
    node.__jindouyunSetSaveStatus = setStatus;
    node.__jindouyunEnsureFeaturedPreview = () => ensureFeaturedPreviewWidget(node);
    node.__jindouyunEffectiveSaveDirectory = effectiveDirectory;
    const restoredOverride = String(overrideWidget.value || "").trim();
    const saveDirectoryInput = node.inputs?.find((item) => item.name === "保存目录");
    const saveDirectoryConnected = saveDirectoryInput?.link != null;
    updatePathTail(restoredOverride || effectiveDirectory());
    if (restoredOverride) setStatus("已进入：当前目录", "success", restoredOverride);
    else if (defaultDirectory && !saveDirectoryConnected) {
        setStatus("当前：ComfyUI output目录", "info", defaultDirectory);
    }

    async function postJson(endpoint, body) {
        const response = await fetch(endpoint, {
            method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
        return result;
    }
    node.__jindouyunPostSaveJson = postJson;

    browseButton.addEventListener("click", async () => {
        browseButton.disabled = true;
        browseButton.textContent = "选择中...";
        try {
            const result = await postJson("/jindouyun_design/select_save_folder", {initial_path: effectiveDirectory()});
            if (result.path) {
                setWidgetValue(overrideWidget, result.path, node);
                updatePathTail(result.path);
                setStatus("已切换到当前目录", "success", result.path);
            }
        } catch (error) {
            setStatus(`选择失败：${error.message}`, "error");
        } finally {
            browseButton.disabled = false;
            browseButton.textContent = "浏览";
        }
    });

    openFolderButton.addEventListener("click", async () => {
        openFolderButton.disabled = true;
        openFolderButton.textContent = "打开中...";
        try {
            await postJson("/jindouyun_design/open_folder", {path: effectiveDirectory()});
        } catch (error) {
            window.alert?.(`打开文件夹失败：${error.message}`);
        } finally {
            openFolderButton.disabled = false;
            openFolderButton.textContent = "打开文件夹";
        }
    });

    createButton.addEventListener("click", async () => {
        const name = folderNameInput.value.trim();
        if (!name) {
            setStatus("新建失败：请输入文件夹名称", "error");
            folderNameInput.focus();
            return;
        }
        createButton.disabled = true;
        createButton.textContent = "创建中...";
        setStatus(`正在创建：${name}`, "info");
        try {
            const result = await postJson("/jindouyun_design/create_folder", {
                parent_path: effectiveDirectory(), folder_name: name,
            });
            setWidgetValue(overrideWidget, result.path, node);
            folderNameInput.value = "";
            updatePathTail(result.path);
            setStatus("已创建并进入当前目录", "success", result.path);
        } catch (error) {
            setStatus(`新建失败：${error.message}`, "error");
        } finally {
            createButton.disabled = false;
            createButton.textContent = "新建并进入";
        }
    });

    folderNameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") createButton.click();
    });

    followButton.addEventListener("click", () => {
        setWidgetValue(overrideWidget, "", node);
        node.__jindouyunLastSaveDirectory = "";
        updatePathTail(connectedLoadImageDirectory() || String(pathWidget.value || "").trim());
        setStatus("当前：跟随输入目录", "info");
    });

    const domWidget = node.addDOMWidget("保存目录管理", "jindouyun_save_folder", wrapper, {
        serialize: false, hideOnZoom: false,
        getMinHeight: () => 157, getMaxHeight: () => 157,
    });
    domWidget.computeSize = () => [Math.max(280, Number(node.size?.[0] || 320) - 28), 157];
    node.setSize?.([Math.max(node.size?.[0] || 320, 320), Math.max(node.size?.[1] || 120, 298)]);
}

app.registerExtension({
    name: "comfyui-jindouyun-design.save-image",
    nodeCreated(node) {
        if ((node.comfyClass || node.type) === NODE_TYPE) addSaveFolderControls(node);
    },
    loadedGraphNode(node) {
        if ((node.comfyClass || node.type) === NODE_TYPE) addSaveFolderControls(node);
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const originalOnExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(message) {
            const result = originalOnExecuted?.apply(this, arguments);
            if (Array.isArray(message?.images)) {
                setFeaturedPreviewImages(this, message.images);
            }
            const directory = Array.isArray(message?.save_directory)
                ? message.save_directory[0]
                : message?.save_directory;
            if (directory) {
                this.__jindouyunLastSaveDirectory = String(directory);
                this.__jindouyunUpdateSavePathTail?.(String(directory));
                this.__jindouyunSetSaveStatus?.(
                    "保存成功：当前目录",
                    "success",
                    String(directory),
                );
            }
            return result;
        };
        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            addSaveFolderControls(this);
        };
    },
});
