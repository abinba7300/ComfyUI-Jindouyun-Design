import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE = "JindouyunInteractiveCrop";
const DEFAULT_CROP = {version: 1, x: 0, y: 0, width: 1, height: 1};
const HANDLE_SIZE = 10;
const HANDLE_HIT_SIZE = 20;
const MIN_CROP_PIXELS = 12;
const UPLOAD_BUTTON_HEIGHT = 42;
const CROP_PANEL_HEIGHT = 525;
const RESIZE_METHODS = [
    "双三次 bicubic（推荐·通用）",
    "Lanczos（推荐·清晰锐利）",
    "区域 area（推荐·缩小）",
    "双线性 bilinear（快速）",
    "最近邻 nearest-exact（像素画/蒙版）",
];

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function finiteNumberOrDefault(value, fallback) {
    if (value == null || (typeof value === "string" && value.trim() === "")) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeNumericWidget(node, name, fallback, minimum, maximum, round = false) {
    const widget = findWidget(node, name);
    if (!widget) return fallback;
    let value = clamp(finiteNumberOrDefault(widget.value, fallback), minimum, maximum);
    if (round) value = Math.round(value);
    const rawValueIsEmpty = widget.value == null
        || (typeof widget.value === "string" && widget.value.trim() === "");
    const rawNumber = Number(widget.value);
    if (rawValueIsEmpty || !Number.isFinite(rawNumber) || rawNumber !== value) {
        widget.value = value;
        widget.callback?.(value, app.canvas, node, widget);
        app.graph?.setDirtyCanvas?.(true, true);
    }
    return value;
}

function normalizeCropNumericWidgets(node) {
    if ((node.comfyClass || node.type) !== NODE_TYPE) return;
    normalizeNumericWidget(node, "图片旋转", 0, -180, 180);
    normalizeNumericWidget(node, "宽度比例", 100, 1, 2000);
    normalizeNumericWidget(node, "高度比例", 100, 1, 2000);
    normalizeNumericWidget(node, "分流标准最大边", 1024, 1, 16384, true);
}

function widgetBooleanValue(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return ["true", "1", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function parseCrop(value) {
    try {
        const payload = JSON.parse(String(value || ""));
        let x = clamp(payload?.x, 0, 1);
        let y = clamp(payload?.y, 0, 1);
        let width = clamp(payload?.width, 0, 1 - x);
        let height = clamp(payload?.height, 0, 1 - y);
        if (width <= 0) {
            x = 0;
            width = 1;
        }
        if (height <= 0) {
            y = 0;
            height = 1;
        }
        return {version: 1, x, y, width, height};
    } catch (_) {
        return {...DEFAULT_CROP};
    }
}

function parseCropRatio(value) {
    try {
        const ratio = JSON.parse(String(value || ""))?.ratio;
        const number = Number(ratio);
        return Number.isFinite(number) && number > 0 ? number : null;
    } catch (_) {
        return null;
    }
}

function serializeCrop(crop, ratio = null) {
    const rounded = {};
    for (const key of ["x", "y", "width", "height"]) {
        rounded[key] = Number(clamp(crop[key], 0, 1).toFixed(6));
    }
    return JSON.stringify({version: 1, ...rounded, ratio: ratio || "free"});
}

function setWidgetValue(widget, value, node) {
    if (!widget) return;
    widget.value = value;
    widget.callback?.(value, app.canvas, node, widget);
    app.graph.setDirtyCanvas(true, true);
}

function hideCropDataWidget(node) {
    const widget = findWidget(node, "裁剪数据");
    if (!widget || widget.__jindouyunHidden) return;
    widget.__jindouyunHidden = true;
    widget.hidden = true;
    widget.draw = function() {};
    widget.mouse = function() { return false; };
    widget.computeSize = function() { return [0, 0]; };
}

function hideRotationWidget(node) {
    const widget = findWidget(node, "图片旋转");
    if (!widget || widget.__jindouyunRotationHidden) return;
    widget.__jindouyunRotationHidden = true;
    widget.hidden = true;
    widget.draw = function() {};
    widget.mouse = function() { return false; };
    widget.computeSize = function() { return [0, 0]; };
}

function hideMirrorWidgets(node) {
    for (const name of ["左右镜像", "上下镜像"]) {
        const widget = findWidget(node, name);
        if (!widget || widget.__jindouyunMirrorHidden) continue;
        widget.__jindouyunMirrorHidden = true;
        widget.hidden = true;
        widget.draw = function() {};
        widget.mouse = function() { return false; };
        widget.computeSize = function() { return [0, 0]; };
    }
}

function hideTransformWidgets(node) {
    for (const name of [
        "最大边分辨率",
        "锁定长宽比",
        "宽度比例",
        "高度比例",
        "分流标准最大边",
        "启用最大边分辨率",
    ]) {
        const widget = findWidget(node, name);
        if (!widget || widget.__jindouyunTransformHidden) continue;
        widget.__jindouyunTransformHidden = true;
        widget.hidden = true;
        widget.draw = function() {};
        widget.mouse = function() { return false; };
        widget.computeSize = function() { return [0, 0]; };
    }
}

function connectedSource(node) {
    const input = node.inputs?.find((item) => item.name === "图像");
    const link = input?.link != null ? app.graph.links[input.link] : null;
    const origin = link ? app.graph.getNodeById(link.origin_id) : null;
    const source = [
        origin?.imgs?.[0],
        origin?.image,
        origin?.preview,
        origin?.canvas,
    ].find((candidate) => candidate && sourceDimensions(candidate));
    return {connected: Boolean(link), originId: link?.origin_id, source};
}

function executionPreviewUrl(output) {
    const image = output?.images?.[0];
    if (!image?.filename) return "";
    const query = new URLSearchParams({
        filename: String(image.filename),
        type: String(image.type || "temp"),
        t: String(Date.now()),
    });
    if (image.subfolder) query.set("subfolder", String(image.subfolder));
    return api.apiURL(`/view?${query.toString()}`);
}

function scheduleCropSourceRefresh(node, delay = 80) {
    window.clearTimeout(node.__jindouyunCropRefreshTimer);
    node.__jindouyunCropRefreshTimer = window.setTimeout(
        () => node.__jindouyunRefreshInlineCrop?.({quiet: true}),
        delay,
    );
}

function sourceDimensions(source) {
    if (!source) return null;
    const width = source.naturalWidth || source.videoWidth || source.width;
    const height = source.naturalHeight || source.videoHeight || source.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }
    return {width, height};
}

function normalizeRotationDegrees(value) {
    const angle = Number(value);
    if (!Number.isFinite(angle)) return 0;
    const wrapped = ((angle + 180) % 360 + 360) % 360 - 180;
    return wrapped === -180 && angle > 0 ? 180 : wrapped;
}

function parseRotationInputValue(value, badInput = false) {
    if (badInput || value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
}

function shouldSyncRotationWidget(raw, next) {
    const current = parseRotationInputValue(raw);
    const target = Number(next);
    return current === null || !Number.isFinite(target) || current !== target;
}

function rotatedImageSize(width, height, angle) {
    const radians = normalizeRotationDegrees(angle) * Math.PI / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    return {
        width: Math.max(1, Math.ceil(width * cosine + height * sine - 1e-6)),
        height: Math.max(1, Math.ceil(width * sine + height * cosine - 1e-6)),
    };
}

function rotationHandleGeometry(canvasHeight) {
    const radius = Math.min(7, Math.max(0.5, canvasHeight / 2));
    const y = Math.min(18, Math.max(radius, canvasHeight - radius));
    return {radius, y};
}

function drawCheckerboard(ctx, width, height) {
    const cellSize = 12;
    ctx.save();
    for (let y = 0; y < height; y += cellSize) {
        for (let x = 0; x < width; x += cellSize) {
            ctx.fillStyle = ((x / cellSize) + (y / cellSize)) % 2 === 0 ? "#D7DBE0" : "#AEB6C2";
            ctx.fillRect(x, y, cellSize, cellSize);
        }
    }
    ctx.restore();
}

function decodeUploadValue(value) {
    if (value && typeof value === "object") {
        return {
            filename: String(value.filename || value.name || value.value || ""),
            subfolder: String(value.subfolder || ""),
            type: String(value.type || "input"),
        };
    }

    let text = String(value || "").trim();
    let type = "input";
    const annotation = text.match(/\s*\[(input|output|temp)\]\s*$/i);
    if (annotation) {
        type = annotation[1].toLowerCase();
        text = text.slice(0, annotation.index).trim();
    }
    if (text.startsWith("blake3:")) {
        return {filename: text, subfolder: "", type};
    }

    const normalized = text.replaceAll("\\", "/");
    const slash = normalized.lastIndexOf("/");
    return {
        filename: slash >= 0 ? normalized.slice(slash + 1) : normalized,
        subfolder: slash >= 0 ? normalized.slice(0, slash) : "",
        type,
    };
}

function uploadImageUrl(node) {
    const uploaded = decodeUploadValue(findWidget(node, "上传图片")?.value);
    if (!uploaded.filename) return "";
    const query = new URLSearchParams({
        filename: uploaded.filename,
        type: uploaded.type || "input",
    });
    if (uploaded.subfolder) query.set("subfolder", uploaded.subfolder);
    return api.apiURL(`/view?${query.toString()}`);
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("上传图片无法读取，请重新选择图片。"));
        image.src = url;
    });
}

async function resolveEditorSource(node) {
    const linked = connectedSource(node);
    if (linked.connected) {
        const executedPreview = node.__jindouyunCropExecutionPreview;
        if (
            executedPreview?.url &&
            String(executedPreview.originId) === String(linked.originId)
        ) {
            return await loadImage(executedPreview.url);
        }
        if (!linked.source) {
            throw new Error("上游图像还没有预览，请先运行一次上游节点。");
        }
        return linked.source;
    }

    const url = uploadImageUrl(node);
    if (!url) {
        throw new Error("请先上传图片，或连接上游图像输入。");
    }
    if (node.__jindouyunCropUpload?.url === url) {
        return node.__jindouyunCropUpload.image;
    }
    const image = await loadImage(url);
    node.__jindouyunCropUpload = {url, image};
    return image;
}

function makeButton(label, title = label) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    Object.assign(button.style, {
        height: "34px",
        padding: "0 12px",
        border: "1px solid #48515D",
        borderRadius: "5px",
        background: "#252A31",
        color: "#F5F7FA",
        font: "13px system-ui, sans-serif",
        cursor: "pointer",
        whiteSpace: "nowrap",
    });
    return button;
}

function makeTransformHandle(axis, side) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.dataset.axis = axis;
    handle.dataset.side = side;
    const adjustsWidth = axis === "width";
    handle.title = adjustsWidth
        ? "拖动调整整图宽度；锁定长宽比时等比例缩放"
        : "拖动调整整图高度；锁定长宽比时等比例缩放";
    handle.setAttribute("aria-label", handle.title);
    Object.assign(handle.style, {
        position: "absolute",
        width: adjustsWidth ? "12px" : "28px",
        height: adjustsWidth ? "28px" : "12px",
        padding: "0",
        border: "2px solid #D9F2FF",
        borderRadius: "4px",
        background: "#168FD1",
        boxShadow: "0 0 0 1px rgba(5, 18, 28, .9), 0 1px 6px rgba(0, 0, 0, .65)",
        cursor: adjustsWidth ? "ew-resize" : "ns-resize",
        pointerEvents: "auto",
        touchAction: "none",
        boxSizing: "border-box",
        zIndex: "2",
    });
    return handle;
}

function syncCropPanelWidth(node, wrapper) {
    const width = Math.max(160, Number(node.size?.[0] || 380) - 28);
    wrapper.style.width = `${width}px`;
    wrapper.style.maxWidth = `${width}px`;
    const host = wrapper.parentElement;
    if (host?.classList?.contains("dom-widget")) {
        host.style.width = `${width}px`;
        host.style.maxWidth = `${width}px`;
    }
    return width;
}

function cropPixelSize(crop, sourceWidth, sourceHeight) {
    return {
        width: Math.max(1, Math.ceil((crop.x + crop.width) * sourceWidth) - Math.floor(crop.x * sourceWidth)),
        height: Math.max(1, Math.ceil((crop.y + crop.height) * sourceHeight) - Math.floor(crop.y * sourceHeight)),
    };
}

function maxEdgePixelSize(width, height, maxEdge) {
    const target = Math.max(0, Math.round(Number(maxEdge) || 0));
    const current = Math.max(width, height);
    if (!target || !current || target === current) return {width, height};
    const scale = target / current;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

function scaledPixelSize(width, height, widthPercent, heightPercent, aspectLocked) {
    const safeWidthPercent = clamp(widthPercent, 1, 2000);
    const safeHeightPercent = aspectLocked
        ? safeWidthPercent
        : clamp(heightPercent, 1, 2000);
    return {
        width: Math.max(1, Math.round(width * safeWidthPercent / 100)),
        height: Math.max(1, Math.round(height * safeHeightPercent / 100)),
    };
}

function isMaxEdgeEnabled(node) {
    return widgetBooleanValue(findWidget(node, "启用最大边分辨率")?.value ?? false);
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

async function uploadDroppedImage(node, file) {
    if (!isDroppedImageFile(file)) return false;
    const body = new FormData();
    body.append("image", file, file.name || "jindouyun_crop_image.png");
    body.append("type", "input");
    const response = await api.fetchApi("/upload/image", {method: "POST", body});
    if (!response.ok) {
        throw new Error(`图片上传失败（${response.status}）`);
    }
    const uploaded = await response.json();
    const filename = String(uploaded?.name || uploaded?.filename || "");
    if (!filename) throw new Error("图片上传成功，但未返回文件名。");
    const subfolder = String(uploaded?.subfolder || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    const value = subfolder ? `${subfolder}/${filename}` : filename;
    const widget = findWidget(node, "上传图片");
    if (!widget) throw new Error("找不到上传图片控件，请刷新 ComfyUI 页面后重试。");
    if (Array.isArray(widget.options?.values) && !widget.options.values.includes(value)) {
        widget.options.values.push(value);
    }
    setWidgetValue(widget, value, node);
    return true;
}

function patchWholeNodeImageDrop(node) {
    if (node.__jindouyunWholeNodeDropPatched) return;
    node.__jindouyunWholeNodeDropPatched = true;
    const originalOnDragOver = node.onDragOver;
    node.onDragOver = function(event) {
        if (hasDroppedImage(event)) return true;
        return originalOnDragOver?.apply(this, arguments) ?? false;
    };
    const originalOnDragDrop = node.onDragDrop;
    node.onDragDrop = async function(event) {
        const files = droppedImageFiles(event);
        if (!files.length) return await originalOnDragDrop?.apply(this, arguments) ?? false;
        try {
            await uploadDroppedImage(this, files[0]);
            return true;
        } catch (error) {
            console.error("[筋斗云交互裁剪] 拖入图片失败", error);
            window.alert?.(error?.message || "拖入图片失败，请重新尝试。");
            return true;
        }
    };
}

function cropRect(crop, canvas) {
    return {
        left: crop.x * canvas.width,
        top: crop.y * canvas.height,
        width: crop.width * canvas.width,
        height: crop.height * canvas.height,
        right: (crop.x + crop.width) * canvas.width,
        bottom: (crop.y + crop.height) * canvas.height,
    };
}

function cropHandles(rect) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return [
        {name: "nw", x: rect.left, y: rect.top},
        {name: "n", x: centerX, y: rect.top},
        {name: "ne", x: rect.right, y: rect.top},
        {name: "e", x: rect.right, y: centerY},
        {name: "se", x: rect.right, y: rect.bottom},
        {name: "s", x: centerX, y: rect.bottom},
        {name: "sw", x: rect.left, y: rect.bottom},
        {name: "w", x: rect.left, y: centerY},
    ];
}

function hitHandle(rect, x, y) {
    const half = HANDLE_HIT_SIZE / 2;
    return cropHandles(rect).find((handle) =>
        x >= handle.x - half && x <= handle.x + half &&
        y >= handle.y - half && y <= handle.y + half
    );
}

function pointInRect(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isFullCrop(crop) {
    return crop.x <= 0.000001 && crop.y <= 0.000001
        && crop.width >= 0.999999 && crop.height >= 0.999999;
}

function shouldCreateCropFromPointer(crop, rect, x, y, boxSelectArmed, forceCreate = false) {
    if (forceCreate) return true;
    return boxSelectArmed && (isFullCrop(crop) || !pointInRect(rect, x, y));
}

function pointerOnCanvas(canvas, event) {
    const bounds = canvas.getBoundingClientRect();
    return {
        x: clamp((event.clientX - bounds.left) * canvas.width / Math.max(1, bounds.width), 0, canvas.width),
        y: clamp((event.clientY - bounds.top) * canvas.height / Math.max(1, bounds.height), 0, canvas.height),
    };
}

function resizeCropFree(start, handle, dx, dy, canvas) {
    const minWidth = MIN_CROP_PIXELS / Math.max(1, canvas.width);
    const minHeight = MIN_CROP_PIXELS / Math.max(1, canvas.height);
    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;

    if (handle.includes("w")) left = clamp(start.x + dx, 0, right - minWidth);
    if (handle.includes("e")) right = clamp(start.x + start.width + dx, left + minWidth, 1);
    if (handle.includes("n")) top = clamp(start.y + dy, 0, bottom - minHeight);
    if (handle.includes("s")) bottom = clamp(start.y + start.height + dy, top + minHeight, 1);
    return {version: 1, x: left, y: top, width: right - left, height: bottom - top};
}

function resizeCropWithRatio(start, handle, pointer, ratio, canvas, sourceWidth, sourceHeight) {
    const isEast = handle.includes("e");
    const isSouth = handle.includes("s");
    const anchorX = isEast ? start.x : start.x + start.width;
    const anchorY = isSouth ? start.y : start.y + start.height;
    const pointerX = pointer.x / canvas.width;
    const pointerY = pointer.y / canvas.height;
    const normalizedRatio = ratio * sourceHeight / sourceWidth;
    const minWidth = MIN_CROP_PIXELS / Math.max(1, canvas.width);
    const minHeight = MIN_CROP_PIXELS / Math.max(1, canvas.height);

    let width = Math.max(minWidth, Math.abs(pointerX - anchorX));
    let height = Math.max(minHeight, Math.abs(pointerY - anchorY));
    if (width / height > normalizedRatio) {
        height = width / normalizedRatio;
    } else {
        width = height * normalizedRatio;
    }

    const maxWidth = isEast ? 1 - anchorX : anchorX;
    const maxHeight = isSouth ? 1 - anchorY : anchorY;
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    width *= scale;
    height *= scale;
    return {
        version: 1,
        x: isEast ? anchorX : anchorX - width,
        y: isSouth ? anchorY : anchorY - height,
        width,
        height,
    };
}

function applyRatio(crop, ratio, sourceWidth, sourceHeight) {
    if (!ratio) return {...crop};
    const normalizedRatio = ratio * sourceHeight / sourceWidth;
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    let width = crop.width;
    let height = crop.height;
    if (width / height > normalizedRatio) {
        width = height * normalizedRatio;
    } else {
        height = width / normalizedRatio;
    }
    width = Math.min(width, 2 * Math.min(centerX, 1 - centerX));
    height = width / normalizedRatio;
    if (height > 2 * Math.min(centerY, 1 - centerY)) {
        height = 2 * Math.min(centerY, 1 - centerY);
        width = height * normalizedRatio;
    }
    return {
        version: 1,
        x: clamp(centerX - width / 2, 0, 1 - width),
        y: clamp(centerY - height / 2, 0, 1 - height),
        width,
        height,
    };
}

function openCropEditor(node, source) {
    if (node.__jindouyunCropEditor) return;
    const dimensions = sourceDimensions(source);
    if (!dimensions) {
        window.alert("无法获取图片尺寸。");
        return;
    }

    const dataWidget = findWidget(node, "裁剪数据");
    let crop = parseCrop(dataWidget?.value);
    let ratioLock = null;
    let interaction = null;

    const overlay = document.createElement("div");
    node.__jindouyunCropEditor = overlay;
    overlay.tabIndex = -1;
    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "100000",
        display: "grid",
        gridTemplateRows: "54px minmax(0, 1fr) 34px",
        background: "#111419",
        color: "#F5F7FA",
        fontFamily: "system-ui, sans-serif",
    });

    const toolbar = document.createElement("header");
    Object.assign(toolbar.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "0 12px",
        borderBottom: "1px solid #343B45",
        background: "#1B1F25",
        overflowX: "auto",
    });
    const title = document.createElement("strong");
    title.textContent = "筋斗云交互裁剪";
    Object.assign(title.style, {fontSize: "15px", marginRight: "8px", whiteSpace: "nowrap"});

    const ratioButtons = new Map();
    const ratioOptions = [
        ["自由", null],
        ["1:1", 1],
        ["4:3", 4 / 3],
        ["3:4", 3 / 4],
        ["16:9", 16 / 9],
        ["9:16", 9 / 16],
    ];
    const ratioGroup = document.createElement("div");
    Object.assign(ratioGroup.style, {display: "flex", gap: "5px", alignItems: "center"});
    for (const [label, ratio] of ratioOptions) {
        const button = makeButton(label, ratio ? `锁定为 ${label} 裁剪比例` : "自由调整裁剪比例");
        Object.assign(button.style, {height: "30px", padding: "0 9px"});
        ratioButtons.set(ratio, button);
        button.addEventListener("click", () => {
            ratioLock = ratio;
            if (ratio) crop = applyRatio(crop, ratio, dimensions.width, dimensions.height);
            refreshRatioButtons();
            render();
        });
        ratioGroup.append(button);
    }

    const resetButton = makeButton("还原整图", "裁剪框恢复为整张图片");
    const cancelButton = makeButton("取消", "关闭且不保存本次调整");
    const saveButton = makeButton("✓ 保存裁剪区域", "保存裁剪区域到节点");
    Object.assign(saveButton.style, {
        height: "38px",
        padding: "0 18px",
        background: "#E85D04",
        borderColor: "#FF7A24",
        fontWeight: "700",
    });
    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    const sizeText = document.createElement("span");
    Object.assign(sizeText.style, {
        minWidth: "150px",
        textAlign: "right",
        color: "#C8D0DA",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
    });
    toolbar.append(title, ratioGroup, resetButton, spacer, sizeText, cancelButton, saveButton);

    const workspace = document.createElement("main");
    Object.assign(workspace.style, {
        minWidth: "0",
        minHeight: "0",
        display: "grid",
        placeItems: "center",
        padding: "18px",
        overflow: "hidden",
        background: "#0E1115",
    });
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
        display: "block",
        maxWidth: "100%",
        maxHeight: "100%",
        boxShadow: "0 12px 42px rgba(0,0,0,.55)",
        outline: "1px solid #4A535F",
        touchAction: "none",
        cursor: "crosshair",
    });
    workspace.append(canvas);

    const footer = document.createElement("footer");
    footer.textContent = "拖动框内移动裁剪区域，拖动边角调整大小；也可在框外拖出新的裁剪区域";
    Object.assign(footer.style, {
        display: "grid",
        placeItems: "center",
        borderTop: "1px solid #343B45",
        background: "#1B1F25",
        color: "#AEB6C2",
        fontSize: "12px",
    });
    overlay.append(toolbar, workspace, footer);
    (document.fullscreenElement || document.body).append(overlay);

    function refreshRatioButtons() {
        for (const [ratio, button] of ratioButtons) {
            const active = ratio === ratioLock;
            button.style.background = active ? "#245B91" : "#252A31";
            button.style.borderColor = active ? "#58A6FF" : "#48515D";
        }
    }

    function fitCanvas() {
        const maxWidth = Math.max(240, workspace.clientWidth - 36);
        const maxHeight = Math.max(180, workspace.clientHeight - 36);
        const scale = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height);
        canvas.width = Math.max(1, Math.round(dimensions.width * scale));
        canvas.height = Math.max(1, Math.round(dimensions.height * scale));
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;
        render();
    }

    function render() {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

        const rect = cropRect(crop, canvas);
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,.58)";
        ctx.beginPath();
        ctx.rect(0, 0, canvas.width, canvas.height);
        ctx.rect(rect.left, rect.top, rect.width, rect.height);
        ctx.fill("evenodd");

        ctx.beginPath();
        ctx.rect(rect.left, rect.top, rect.width, rect.height);
        ctx.clip();
        ctx.strokeStyle = "rgba(255,255,255,.48)";
        ctx.lineWidth = 1;
        for (let index = 1; index <= 2; index += 1) {
            const x = rect.left + rect.width * index / 3;
            const y = rect.top + rect.height * index / 3;
            ctx.beginPath();
            ctx.moveTo(x, rect.top);
            ctx.lineTo(x, rect.bottom);
            ctx.moveTo(rect.left, y);
            ctx.lineTo(rect.right, y);
            ctx.stroke();
        }
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = "#7EE787";
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
        for (const handle of cropHandles(rect)) {
            ctx.fillStyle = "#15251B";
            ctx.strokeStyle = "#7EE787";
            ctx.lineWidth = 2;
            ctx.fillRect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
            ctx.strokeRect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        }
        ctx.restore();

        const pixels = cropPixelSize(crop, dimensions.width, dimensions.height);
        sizeText.textContent = `输出 ${pixels.width} × ${pixels.height}`;
    }

    function closeEditor() {
        window.removeEventListener("resize", fitCanvas);
        window.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        node.__jindouyunCropEditor = null;
    }

    function saveCrop() {
        setWidgetValue(dataWidget, serializeCrop(crop), node);
        updateCropStatus(node);
        closeEditor();
    }

    function onKeyDown(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeEditor();
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.stopPropagation();
            saveCrop();
        }
    }

    canvas.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const pointer = pointerOnCanvas(canvas, event);
        const rect = cropRect(crop, canvas);
        const handle = hitHandle(rect, pointer.x, pointer.y);
        const start = {...crop};
        if (handle) {
            interaction = {mode: "resize", handle: handle.name, start, pointer};
        } else if (pointInRect(rect, pointer.x, pointer.y)) {
            interaction = {mode: "move", start, pointer};
        } else {
            ratioLock = null;
            refreshRatioButtons();
            const x = pointer.x / canvas.width;
            const y = pointer.y / canvas.height;
            crop = {version: 1, x, y, width: 0, height: 0};
            interaction = {mode: "create", startX: x, startY: y};
        }
        canvas.setPointerCapture?.(event.pointerId);
        render();
    });

    canvas.addEventListener("pointermove", (event) => {
        const pointer = pointerOnCanvas(canvas, event);
        if (!interaction) {
            const rect = cropRect(crop, canvas);
            const handle = hitHandle(rect, pointer.x, pointer.y);
            canvas.style.cursor = handle
                ? (handle.name === "n" || handle.name === "s" ? "ns-resize"
                    : handle.name === "e" || handle.name === "w" ? "ew-resize"
                    : handle.name === "ne" || handle.name === "sw" ? "nesw-resize" : "nwse-resize")
                : pointInRect(rect, pointer.x, pointer.y) ? "move" : "crosshair";
            return;
        }

        event.preventDefault();
        if (interaction.mode === "move") {
            const dx = (pointer.x - interaction.pointer.x) / canvas.width;
            const dy = (pointer.y - interaction.pointer.y) / canvas.height;
            crop = {
                ...interaction.start,
                x: clamp(interaction.start.x + dx, 0, 1 - interaction.start.width),
                y: clamp(interaction.start.y + dy, 0, 1 - interaction.start.height),
            };
        } else if (interaction.mode === "resize") {
            const dx = (pointer.x - interaction.pointer.x) / canvas.width;
            const dy = (pointer.y - interaction.pointer.y) / canvas.height;
            const corner = interaction.handle.length === 2;
            crop = ratioLock && corner
                ? resizeCropWithRatio(
                    interaction.start,
                    interaction.handle,
                    pointer,
                    ratioLock,
                    canvas,
                    dimensions.width,
                    dimensions.height,
                )
                : resizeCropFree(interaction.start, interaction.handle, dx, dy, canvas);
        } else if (interaction.mode === "create") {
            const x = pointer.x / canvas.width;
            const y = pointer.y / canvas.height;
            const minWidth = MIN_CROP_PIXELS / canvas.width;
            const minHeight = MIN_CROP_PIXELS / canvas.height;
            const left = Math.min(interaction.startX, x);
            const top = Math.min(interaction.startY, y);
            crop = {
                version: 1,
                x: left,
                y: top,
                width: Math.max(minWidth, Math.abs(x - interaction.startX)),
                height: Math.max(minHeight, Math.abs(y - interaction.startY)),
            };
            crop.width = Math.min(crop.width, 1 - crop.x);
            crop.height = Math.min(crop.height, 1 - crop.y);
        }
        render();
    });

    const finishInteraction = (event) => {
        if (!interaction) return;
        interaction = null;
        canvas.releasePointerCapture?.(event.pointerId);
        render();
    };
    canvas.addEventListener("pointerup", finishInteraction);
    canvas.addEventListener("pointercancel", finishInteraction);

    resetButton.addEventListener("click", () => {
        crop = {...DEFAULT_CROP};
        ratioLock = null;
        refreshRatioButtons();
        render();
    });
    cancelButton.addEventListener("click", closeEditor);
    saveButton.addEventListener("click", saveCrop);
    window.addEventListener("resize", fitCanvas);
    window.addEventListener("keydown", onKeyDown, true);
    refreshRatioButtons();
    requestAnimationFrame(fitCanvas);
    overlay.focus();
}

function updateCropStatus(node) {
    const status = node.__jindouyunCropStatus;
    if (!status) return;
    const crop = parseCrop(findWidget(node, "裁剪数据")?.value);
    const widthPercent = Math.round(crop.width * 100);
    const heightPercent = Math.round(crop.height * 100);
    const rotation = Number(normalizeRotationDegrees(findWidget(node, "图片旋转")?.value).toFixed(1));
    const rotationText = rotation ? ` · 旋转 ${rotation}°` : "";
    const horizontal = widgetBooleanValue(findWidget(node, "左右镜像")?.value);
    const vertical = widgetBooleanValue(findWidget(node, "上下镜像")?.value);
    const mirrorText = horizontal && vertical
        ? " · 左右+上下镜像"
        : horizontal
            ? " · 左右镜像"
            : vertical ? " · 上下镜像" : "";
    status.textContent = crop.width >= 0.999999 && crop.height >= 0.999999
        ? `当前：整张图片${mirrorText}${rotationText}`
        : `当前裁剪：宽 ${widthPercent}% · 高 ${heightPercent}%${mirrorText}${rotationText}`;
}

function addCropControls(node) {
    if (node.__jindouyunCropControlsAdded) return;
    node.__jindouyunCropControlsAdded = true;

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        width: "100%",
        maxWidth: "100%",
        height: `${CROP_PANEL_HEIGHT}px`,
        padding: "5px 3px",
        boxSizing: "border-box",
        overflow: "hidden",
    });
    const rotationWidget = findWidget(node, "图片旋转");
    const rotationAvailable = Boolean(rotationWidget);
    const horizontalMirrorWidget = findWidget(node, "左右镜像");
    const verticalMirrorWidget = findWidget(node, "上下镜像");
    const mirrorAvailable = Boolean(horizontalMirrorWidget && verticalMirrorWidget);
    const aspectLockWidget = findWidget(node, "锁定长宽比");
    const widthPercentWidget = findWidget(node, "宽度比例");
    const heightPercentWidget = findWidget(node, "高度比例");
    const splitThresholdWidget = findWidget(node, "分流标准最大边");
    const maxEdgeWidget = findWidget(node, "最大边分辨率");
    const maxEdgeEnabledWidget = findWidget(node, "启用最大边分辨率");

    const maxEdgeGroup = document.createElement("div");
    Object.assign(maxEdgeGroup.style, {
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        height: "69px",
    });
    const maxEdgeToggleRow = document.createElement("div");
    Object.assign(maxEdgeToggleRow.style, {
        display: "grid",
        gridTemplateColumns: "44px minmax(0, 1fr)",
        gap: "6px",
        alignItems: "center",
        height: "32px",
    });
    const maxEdgeLabel = document.createElement("span");
    maxEdgeLabel.textContent = "缩放";
    Object.assign(maxEdgeLabel.style, {fontSize: "12px", color: "#D8DEE7", textAlign: "center"});
    const maxEdgeToggleButton = makeButton("最大边缩放：关闭", "打开后按下方最大边分辨率缩放输出图像");
    Object.assign(maxEdgeToggleButton.style, {height: "30px", padding: "0 8px"});
    maxEdgeToggleRow.append(maxEdgeLabel, maxEdgeToggleButton);

    const maxEdgeValueRow = document.createElement("div");
    Object.assign(maxEdgeValueRow.style, {
        display: "grid",
        gridTemplateColumns: "44px minmax(0, 1fr) 24px",
        gap: "6px",
        alignItems: "center",
        height: "32px",
    });
    const maxEdgeValueLabel = document.createElement("span");
    maxEdgeValueLabel.textContent = "最大边";
    Object.assign(maxEdgeValueLabel.style, {fontSize: "12px", color: "#D8DEE7", textAlign: "center"});
    const maxEdgeInput = document.createElement("input");
    maxEdgeInput.type = "number";
    maxEdgeInput.min = "0";
    maxEdgeInput.max = "16384";
    maxEdgeInput.step = "1";
    maxEdgeInput.title = "最大边分辨率；0 表示保持当前裁剪尺寸，打开缩放后输入数值即可生效";
    Object.assign(maxEdgeInput.style, {
        width: "100%",
        height: "30px",
        minWidth: "0",
        boxSizing: "border-box",
        border: "1px solid #59616D",
        borderRadius: "4px",
        background: "#191D23",
        color: "#FFFFFF",
        padding: "0 7px",
        fontSize: "12px",
    });
    const maxEdgeUnit = document.createElement("span");
    maxEdgeUnit.textContent = "px";
    Object.assign(maxEdgeUnit.style, {fontSize: "11px", color: "#AEB6C2", textAlign: "center"});
    maxEdgeValueRow.append(maxEdgeValueLabel, maxEdgeInput, maxEdgeUnit);
    maxEdgeGroup.append(maxEdgeToggleRow, maxEdgeValueRow);

    const rotationRow = document.createElement("div");
    Object.assign(rotationRow.style, {
        display: "grid",
        gridTemplateColumns: "38px minmax(62px, 1fr) 12px 52px 52px 42px",
        gap: "4px",
        alignItems: "center",
        height: "32px",
    });
    const rotationLabel = document.createElement("span");
    rotationLabel.textContent = "旋转";
    Object.assign(rotationLabel.style, {fontSize: "12px", color: "#D8DEE7", textAlign: "center"});
    const rotationNumber = document.createElement("input");
    rotationNumber.type = "number";
    rotationNumber.min = "-180";
    rotationNumber.max = "180";
    rotationNumber.step = "0.1";
    rotationNumber.title = "图片旋转角度";
    Object.assign(rotationNumber.style, {
        width: "100%",
        height: "30px",
        minWidth: "0",
        boxSizing: "border-box",
        border: "1px solid #59616D",
        borderRadius: "4px",
        background: "#191D23",
        color: "#FFFFFF",
        padding: "0 7px",
        fontSize: "12px",
    });
    const degreeLabel = document.createElement("span");
    degreeLabel.textContent = "°";
    Object.assign(degreeLabel.style, {fontSize: "14px", color: "#D8DEE7", textAlign: "center"});
    const rotateLeftButton = makeButton("↶ 90°", "快速向左旋转 90°");
    const rotateRightButton = makeButton("↷ 90°", "快速向右旋转 90°");
    const resetRotationButton = makeButton("归零", "将旋转角度重置为 0°");
    for (const button of [rotateLeftButton, rotateRightButton, resetRotationButton]) {
        Object.assign(button.style, {height: "30px", padding: "0 3px", fontSize: "11px"});
    }
    if (!rotationAvailable) {
        const unavailableTitle = "图片旋转控件不可用，请重启 ComfyUI 后再使用旋转功能。";
        rotationNumber.disabled = true;
        rotationNumber.title = unavailableTitle;
        for (const button of [rotateLeftButton, rotateRightButton, resetRotationButton]) {
            button.disabled = true;
            button.title = unavailableTitle;
        }
    }
    rotationRow.append(
        rotationLabel,
        rotationNumber,
        degreeLabel,
        rotateLeftButton,
        rotateRightButton,
        resetRotationButton,
    );

    const mirrorRow = document.createElement("div");
    Object.assign(mirrorRow.style, {
        display: "grid",
        gridTemplateColumns: "44px minmax(0, 1fr) minmax(0, 1fr)",
        gap: "6px",
        alignItems: "center",
        height: "32px",
    });
    const mirrorLabel = document.createElement("span");
    mirrorLabel.textContent = "镜像";
    Object.assign(mirrorLabel.style, {fontSize: "12px", color: "#D8DEE7", textAlign: "center"});
    const mirrorHorizontalButton = makeButton("↔ 左右", "快速左右镜像图片");
    const mirrorVerticalButton = makeButton("↕ 上下", "快速上下镜像图片");
    for (const button of [mirrorHorizontalButton, mirrorVerticalButton]) {
        Object.assign(button.style, {height: "30px", padding: "0 8px"});
        if (!mirrorAvailable) {
            button.disabled = true;
            button.title = "镜像控件不可用，请重启 ComfyUI 后再使用镜像功能。";
        }
    }
    mirrorRow.append(mirrorLabel, mirrorHorizontalButton, mirrorVerticalButton);

    const transformRow = document.createElement("div");
    Object.assign(transformRow.style, {
        display: "grid",
        gridTemplateColumns: "38px 64px 44px minmax(0, 1fr) minmax(0, 1fr)",
        gap: "4px",
        alignItems: "center",
        height: "32px",
    });
    const transformLabel = document.createElement("span");
    transformLabel.textContent = "变形";
    Object.assign(transformLabel.style, {fontSize: "12px", color: "#D8DEE7", textAlign: "center"});
    const aspectLockButton = makeButton("🔗 锁定", "锁定时禁止拖动画布变形抓手；解锁后可分别拉伸宽度和高度");
    Object.assign(aspectLockButton.style, {height: "30px", padding: "0 4px", fontSize: "11px"});
    const resetTransformButton = makeButton("重置", "将整图变形宽度和高度恢复为 100%");
    Object.assign(resetTransformButton.style, {height: "30px", padding: "0 3px", fontSize: "11px"});

    const makePercentField = (label, title) => {
        const shell = document.createElement("label");
        shell.title = title;
        Object.assign(shell.style, {
            display: "grid",
            gridTemplateColumns: "18px minmax(0, 1fr) 14px",
            alignItems: "center",
            height: "30px",
            minWidth: "0",
            border: "1px solid #59616D",
            borderRadius: "4px",
            background: "#191D23",
            boxSizing: "border-box",
            overflow: "hidden",
        });
        const prefix = document.createElement("span");
        prefix.textContent = label;
        Object.assign(prefix.style, {fontSize: "11px", color: "#AEB6C2", textAlign: "right"});
        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.max = "2000";
        input.step = "1";
        Object.assign(input.style, {
            width: "100%",
            height: "28px",
            minWidth: "0",
            border: "0",
            outline: "0",
            background: "transparent",
            color: "#FFFFFF",
            padding: "0 2px",
            fontSize: "12px",
            boxSizing: "border-box",
        });
        const suffix = document.createElement("span");
        suffix.textContent = "%";
        Object.assign(suffix.style, {fontSize: "11px", color: "#AEB6C2"});
        shell.append(prefix, input, suffix);
        return {shell, input};
    };
    const widthField = makePercentField("宽", "裁剪后整图宽度比例，范围 1% 至 2000%");
    const heightField = makePercentField("高", "裁剪后整图高度比例，范围 1% 至 2000%");
    transformRow.append(
        transformLabel,
        aspectLockButton,
        resetTransformButton,
        widthField.shell,
        heightField.shell,
    );

    const splitRow = document.createElement("div");
    Object.assign(splitRow.style, {
        display: "grid",
        gridTemplateColumns: "44px minmax(0, 1fr) 76px",
        gap: "6px",
        alignItems: "center",
        height: "32px",
    });
    const splitLabel = document.createElement("span");
    splitLabel.textContent = "分流";
    Object.assign(splitLabel.style, {fontSize: "12px", color: "#D8DEE7", textAlign: "center"});
    const splitInputShell = document.createElement("label");
    splitInputShell.title = "最终图片最大边达到此尺寸走“符合尺寸”，否则走“不符合尺寸”";
    Object.assign(splitInputShell.style, {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 24px",
        alignItems: "center",
        height: "30px",
        minWidth: "0",
        border: "1px solid #59616D",
        borderRadius: "4px",
        background: "#191D23",
        boxSizing: "border-box",
        overflow: "hidden",
    });
    const splitThresholdInput = document.createElement("input");
    splitThresholdInput.type = "number";
    splitThresholdInput.min = "1";
    splitThresholdInput.max = "16384";
    splitThresholdInput.step = "1";
    Object.assign(splitThresholdInput.style, {
        width: "100%",
        height: "28px",
        minWidth: "0",
        border: "0",
        outline: "0",
        background: "transparent",
        color: "#FFFFFF",
        padding: "0 7px",
        fontSize: "12px",
        boxSizing: "border-box",
    });
    const pixelSuffix = document.createElement("span");
    pixelSuffix.textContent = "px";
    Object.assign(pixelSuffix.style, {fontSize: "11px", color: "#AEB6C2"});
    splitInputShell.append(splitThresholdInput, pixelSuffix);
    const branchBadge = document.createElement("span");
    branchBadge.textContent = "符合尺寸";
    Object.assign(branchBadge.style, {
        height: "26px",
        borderRadius: "4px",
        color: "#8FF0A4",
        background: "#20252B",
        border: "1px solid #52C878",
        fontSize: "11px",
        lineHeight: "26px",
        textAlign: "center",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
    });
    splitRow.append(splitLabel, splitInputShell, branchBadge);

    const controlRow = document.createElement("div");
    Object.assign(controlRow.style, {
        display: "grid",
        gridTemplateColumns: "44px minmax(0, 1fr) 72px 58px",
        gap: "6px",
        alignItems: "center",
        height: "32px",
    });
    const ratioLabel = document.createElement("span");
    ratioLabel.textContent = "比例";
    Object.assign(ratioLabel.style, {fontSize: "12px", color: "#D8DEE7", textAlign: "center"});
    const ratioSelect = document.createElement("select");
    ratioSelect.title = "选择自由裁剪或固定裁剪比例";
    const ratioOptions = [
        ["free", "自由比例", null],
        ["1", "1:1", 1],
        ["1.333333", "4:3", 4 / 3],
        ["0.75", "3:4", 3 / 4],
        ["1.777778", "16:9", 16 / 9],
        ["0.5625", "9:16", 9 / 16],
    ];
    for (const [value, label] of ratioOptions) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        ratioSelect.append(option);
    }
    Object.assign(ratioSelect.style, {
        width: "100%",
        height: "30px",
        minWidth: "0",
        border: "1px solid #59616D",
        borderRadius: "4px",
        background: "#191D23",
        color: "#FFFFFF",
        padding: "0 7px",
        fontSize: "12px",
    });
    const boxSelectButton = makeButton("▣ 框选", "点击后可在图片任意位置拖出新的裁剪框；也可按住 Shift 直接拖动框选");
    Object.assign(boxSelectButton.style, {width: "72px", height: "30px", padding: "0 5px"});
    const resetButton = makeButton("还原", "恢复为整张图片");
    Object.assign(resetButton.style, {width: "58px", height: "30px", padding: "0 7px"});
    controlRow.append(ratioLabel, ratioSelect, boxSelectButton, resetButton);

    const canvasShell = document.createElement("div");
    Object.assign(canvasShell.style, {
        position: "relative",
        display: "grid",
        placeItems: "center",
        width: "100%",
        height: "338px",
        minHeight: "338px",
        overflow: "hidden",
        border: "1px solid #4A535F",
        borderRadius: "4px",
        background: "#101318",
        boxSizing: "border-box",
    });
    const previewWorkspace = document.createElement("div");
    previewWorkspace.dataset.layout = "crop-side-tools";
    Object.assign(previewWorkspace.style, {
        display: "grid",
        gridTemplateColumns: "86px minmax(140px, 1fr) 86px",
        gap: "6px",
        alignItems: "stretch",
        width: "100%",
        height: "338px",
        minWidth: "0",
        overflow: "hidden",
        boxSizing: "border-box",
    });
    const makeToolRail = (side, title) => {
        const rail = document.createElement("div");
        rail.dataset.toolRail = side;
        rail.title = title;
        Object.assign(rail.style, {
            display: "flex",
            flexDirection: "column",
            gap: "5px",
            minWidth: "0",
            height: "100%",
            padding: "6px 5px",
            border: "1px solid #414A56",
            borderRadius: "4px",
            background: "#171B21",
            boxSizing: "border-box",
            overflow: "hidden",
        });
        return rail;
    };
    const leftToolRail = makeToolRail("left", "旋转与镜像");
    const rightToolRail = makeToolRail("right", "图片变形");

    Object.assign(rotationRow.style, {
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        width: "100%",
        height: "auto",
        minWidth: "0",
    });
    Object.assign(rotationLabel.style, {
        width: "100%",
        height: "18px",
        lineHeight: "18px",
        color: "#D8DEE7",
        fontWeight: "600",
    });
    const angleShell = document.createElement("label");
    angleShell.title = "图片旋转角度";
    Object.assign(angleShell.style, {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 14px",
        alignItems: "center",
        width: "100%",
        height: "30px",
        minWidth: "0",
    });
    Object.assign(rotationNumber.style, {height: "30px", padding: "0 4px", textAlign: "center"});
    angleShell.append(rotationNumber, degreeLabel);
    for (const button of [rotateLeftButton, rotateRightButton, resetRotationButton]) {
        Object.assign(button.style, {width: "100%", height: "28px", padding: "0 2px", fontSize: "11px"});
    }
    rotationRow.replaceChildren(
        rotationLabel,
        angleShell,
        rotateLeftButton,
        rotateRightButton,
        resetRotationButton,
    );

    Object.assign(mirrorRow.style, {
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        width: "100%",
        height: "auto",
        minWidth: "0",
        marginTop: "4px",
        paddingTop: "7px",
        borderTop: "1px solid #38414C",
    });
    Object.assign(mirrorLabel.style, {
        width: "100%",
        height: "18px",
        lineHeight: "18px",
        color: "#D8DEE7",
        fontWeight: "600",
    });
    for (const button of [mirrorHorizontalButton, mirrorVerticalButton]) {
        Object.assign(button.style, {width: "100%", height: "28px", padding: "0 2px", fontSize: "11px"});
    }
    mirrorRow.replaceChildren(mirrorLabel, mirrorHorizontalButton, mirrorVerticalButton);
    leftToolRail.append(rotationRow, mirrorRow);

    Object.assign(transformRow.style, {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        width: "100%",
        height: "auto",
        minWidth: "0",
    });
    Object.assign(transformLabel.style, {
        width: "100%",
        height: "18px",
        lineHeight: "18px",
        color: "#D8DEE7",
        fontWeight: "600",
    });
    for (const button of [aspectLockButton, resetTransformButton]) {
        Object.assign(button.style, {width: "100%", height: "30px", padding: "0 2px", fontSize: "11px"});
    }
    for (const field of [widthField.shell, heightField.shell]) {
        Object.assign(field.style, {
            width: "100%",
            gridTemplateColumns: "18px minmax(0, 1fr) 12px",
        });
    }
    transformRow.replaceChildren(
        transformLabel,
        aspectLockButton,
        resetTransformButton,
        widthField.shell,
        heightField.shell,
    );
    rightToolRail.append(transformRow);
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
        display: "none",
        maxWidth: "100%",
        maxHeight: "100%",
        touchAction: "none",
        cursor: "crosshair",
        boxShadow: "0 0 0 1px rgba(255,255,255,.12)",
    });
    const transformHandleLayer = document.createElement("div");
    Object.assign(transformHandleLayer.style, {
        position: "absolute",
        inset: "0",
        display: "none",
        pointerEvents: "none",
        zIndex: "3",
    });
    const transformHandles = {
        left: makeTransformHandle("width", "left"),
        right: makeTransformHandle("width", "right"),
        top: makeTransformHandle("height", "top"),
        bottom: makeTransformHandle("height", "bottom"),
    };
    transformHandleLayer.append(...Object.values(transformHandles));
    const placeholder = document.createElement("span");
    placeholder.textContent = "正在读取图片…";
    Object.assign(placeholder.style, {
        maxWidth: "85%",
        color: "#AEB6C2",
        fontSize: "12px",
        textAlign: "center",
        lineHeight: "20px",
    });
    canvasShell.append(canvas, transformHandleLayer, placeholder);
    previewWorkspace.append(leftToolRail, canvasShell, rightToolRail);

    const status = document.createElement("span");
    Object.assign(status.style, {
        height: "18px",
        color: "#AEB6C2",
        fontSize: "12px",
        textAlign: "center",
        lineHeight: "18px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    });
    node.__jindouyunCropStatus = status;
    wrapper.append(maxEdgeGroup, splitRow, controlRow, previewWorkspace, status);

    const domWidget = node.addDOMWidget("交互裁剪", "jindouyun_interactive_crop", wrapper, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => CROP_PANEL_HEIGHT,
        getMaxHeight: () => CROP_PANEL_HEIGHT,
    });
    syncCropPanelWidth(node, wrapper);
    domWidget.computeSize = () => [syncCropPanelWidth(node, wrapper), CROP_PANEL_HEIGHT];
    const originalOnResize = node.onResize;
    node.onResize = function() {
        originalOnResize?.apply(this, arguments);
        syncCropPanelWidth(node, wrapper);
        requestAnimationFrame(fitCanvas);
    };

    const dataWidget = findWidget(node, "裁剪数据");
    let crop = parseCrop(dataWidget?.value);
    let ratioLock = parseCropRatio(dataWidget?.value);
    let source = null;
    let sourceDimensionsValue = null;
    let dimensions = null;
    let rotation = rotationAvailable ? Number(normalizeRotationDegrees(rotationWidget.value).toFixed(1)) : 0;
    let mirrorHorizontal = mirrorAvailable ? widgetBooleanValue(horizontalMirrorWidget.value) : false;
    let mirrorVertical = mirrorAvailable ? widgetBooleanValue(verticalMirrorWidget.value) : false;
    let aspectLocked = widgetBooleanValue(aspectLockWidget?.value ?? true);
    let widthPercent = clamp(widthPercentWidget?.value ?? 100, 1, 2000);
    let heightPercent = aspectLocked
        ? widthPercent
        : clamp(heightPercentWidget?.value ?? 100, 1, 2000);
    let splitThreshold = Math.round(clamp(splitThresholdWidget?.value ?? 1024, 1, 16384));
    let maxEdgeValue = Math.round(clamp(maxEdgeWidget?.value ?? 0, 0, 16384));
    let maxEdgeEnabled = widgetBooleanValue(maxEdgeEnabledWidget?.value ?? false);
    let interaction = null;
    let boxSelectArmed = true;
    let transformInteraction = null;
    let loadToken = 0;
    let syncingRotationWidget = false;
    let syncingMirrorWidgets = false;
    let syncingTransformWidgets = false;
    let syncingSplitWidget = false;
    let syncingMaxEdgeWidget = false;
    rotationNumber.value = String(rotation);
    widthField.input.value = String(widthPercent);
    heightField.input.value = String(heightPercent);
    splitThresholdInput.value = String(splitThreshold);
    maxEdgeInput.value = String(maxEdgeValue);

    function refreshMirrorButtons() {
        for (const [button, active] of [
            [mirrorHorizontalButton, mirrorHorizontal],
            [mirrorVerticalButton, mirrorVertical],
        ]) {
            button.setAttribute("aria-pressed", String(active));
            button.style.background = "#252A31";
            button.style.borderColor = active ? "#4EA1FF" : "#48515D";
            button.style.color = active ? "#9DCEFF" : "#F5F7FA";
        }
    }

    function syncPreviewTransformFromWidgets() {
        if (mirrorAvailable) {
            mirrorHorizontal = widgetBooleanValue(horizontalMirrorWidget?.value);
            mirrorVertical = widgetBooleanValue(verticalMirrorWidget?.value);
            refreshMirrorButtons();
        }
    }

    function refreshTransformControls() {
        aspectLockButton.textContent = aspectLocked ? "🔗 锁定" : "🔓 解锁";
        aspectLockButton.setAttribute("aria-pressed", String(aspectLocked));
        aspectLockButton.style.background = "#252A31";
        aspectLockButton.style.borderColor = aspectLocked ? "#A78BFA" : "#6D5A91";
        aspectLockButton.style.color = aspectLocked ? "#C4B5FD" : "#AFA0CA";
        aspectLockButton.style.boxShadow = aspectLocked ? "inset 0 0 0 1px rgba(167,139,250,.18)" : "none";
        widthField.input.value = String(widthPercent);
        heightField.input.value = String(heightPercent);
        for (const handle of Object.values(transformHandles)) {
            handle.disabled = aspectLocked;
            handle.setAttribute("aria-disabled", String(aspectLocked));
            handle.style.background = aspectLocked ? "#53606B" : "#168FD1";
            handle.style.borderColor = aspectLocked ? "#8B96A1" : "#D9F2FF";
            handle.style.opacity = aspectLocked ? "0.62" : "1";
            handle.style.cursor = aspectLocked
                ? "not-allowed"
                : handle.dataset.axis === "width" ? "ew-resize" : "ns-resize";
            handle.title = aspectLocked
                ? "当前已锁定，请先点击解锁再拖动变形抓手"
                : handle.dataset.axis === "width"
                    ? "拖动调整整图宽度"
                    : "拖动调整整图高度";
        }
    }

    function refreshMaxEdgeToggle() {
        maxEdgeToggleButton.textContent = maxEdgeEnabled ? "最大边缩放：开启" : "最大边缩放：关闭";
        maxEdgeToggleButton.setAttribute("aria-pressed", String(maxEdgeEnabled));
        maxEdgeToggleButton.style.background = "#252A31";
        maxEdgeToggleButton.style.borderColor = maxEdgeEnabled ? "#52C878" : "#48515D";
        maxEdgeToggleButton.style.color = maxEdgeEnabled ? "#8FF0A4" : "#F5F7FA";
    }

    function updateMaxEdgeEnabled(value, {fromWidget = false} = {}) {
        maxEdgeEnabled = widgetBooleanValue(value);
        if (!fromWidget && maxEdgeEnabledWidget?.value !== maxEdgeEnabled) {
            setWidgetValue(maxEdgeEnabledWidget, maxEdgeEnabled, node);
        }
        refreshMaxEdgeToggle();
        updateInlineStatus();
        app.graph.setDirtyCanvas(true, true);
    }

    function updateMaxEdgeValue(value, {fromWidget = false} = {}) {
        const next = Math.round(clamp(finiteNumberOrDefault(value, maxEdgeValue), 0, 16384));
        maxEdgeValue = next;
        maxEdgeInput.value = String(next);
        if (!fromWidget && Number(maxEdgeWidget?.value) !== next && !syncingMaxEdgeWidget) {
            syncingMaxEdgeWidget = true;
            setWidgetValue(maxEdgeWidget, next, node);
            syncingMaxEdgeWidget = false;
        }
        updateInlineStatus();
        app.graph.setDirtyCanvas(true, true);
    }

    function syncTransformWidget(widget, value) {
        if (!widget || widget.value === value || Number(widget.value) === Number(value)) return;
        syncingTransformWidgets = true;
        setWidgetValue(widget, value, node);
        syncingTransformWidgets = false;
    }

    function updateAspectLock(value, {fromWidget = false} = {}) {
        aspectLocked = widgetBooleanValue(value);
        if (!fromWidget) syncTransformWidget(aspectLockWidget, aspectLocked);
        if (aspectLocked) {
            heightPercent = widthPercent;
            syncTransformWidget(heightPercentWidget, heightPercent);
        }
        refreshTransformControls();
        if (source && dimensions) fitCanvas();
        else updateInlineStatus();
        app.graph.setDirtyCanvas(true, true);
    }

    function updateTransformScale(axis, value, {fromWidget = false} = {}) {
        const fallback = axis === "width" ? widthPercent : heightPercent;
        const numeric = Number(value);
        const next = Number.isFinite(numeric) ? clamp(numeric, 1, 2000) : fallback;
        if (aspectLocked) {
            widthPercent = next;
            heightPercent = next;
            syncTransformWidget(widthPercentWidget, next);
            syncTransformWidget(heightPercentWidget, next);
        } else if (axis === "width") {
            widthPercent = next;
            if (!fromWidget || Number(widthPercentWidget?.value) !== next) {
                syncTransformWidget(widthPercentWidget, next);
            }
        } else {
            heightPercent = next;
            if (!fromWidget || Number(heightPercentWidget?.value) !== next) {
                syncTransformWidget(heightPercentWidget, next);
            }
        }
        refreshTransformControls();
        if (source && dimensions) fitCanvas();
        else updateInlineStatus();
        app.graph.setDirtyCanvas(true, true);
    }

    function resetTransformScale() {
        widthPercent = 100;
        heightPercent = 100;
        syncTransformWidget(widthPercentWidget, widthPercent);
        syncTransformWidget(heightPercentWidget, heightPercent);
        refreshTransformControls();
        if (source && dimensions) fitCanvas();
        else updateInlineStatus();
        app.graph.setDirtyCanvas(true, true);
    }

    function updateSplitThreshold(value, {fromWidget = false} = {}) {
        const numeric = Number(value);
        splitThreshold = Math.round(Number.isFinite(numeric) ? clamp(numeric, 1, 16384) : splitThreshold);
        splitThresholdInput.value = String(splitThreshold);
        if (!fromWidget && splitThresholdWidget && Number(splitThresholdWidget.value) !== splitThreshold) {
            syncingSplitWidget = true;
            setWidgetValue(splitThresholdWidget, splitThreshold, node);
            syncingSplitWidget = false;
        }
        updateInlineStatus();
        app.graph.setDirtyCanvas(true, true);
    }

    function syncRatioSelect() {
        if (!ratioLock) {
            ratioSelect.value = "free";
            return;
        }
        const match = ratioOptions.find(([, , ratio]) => ratio && Math.abs(ratio - ratioLock) < 0.0001);
        ratioSelect.value = match?.[0] || "free";
    }

    function setBoxSelectArmed(active) {
        boxSelectArmed = Boolean(active);
        boxSelectButton.textContent = boxSelectArmed ? "▣ 框选中" : "▣ 框选";
        boxSelectButton.style.background = "#252A31";
        boxSelectButton.style.borderColor = boxSelectArmed ? "#7EE787" : "#48515D";
        boxSelectButton.style.color = boxSelectArmed ? "#A7F3B4" : "#F5F7FA";
        boxSelectButton.style.boxShadow = boxSelectArmed ? "inset 0 0 0 1px rgba(126,231,135,.16)" : "none";
        boxSelectButton.setAttribute("aria-pressed", String(boxSelectArmed));
        canvas.style.cursor = boxSelectArmed ? "crosshair" : "default";
    }

    function activeHandles(rect) {
        const handles = cropHandles(rect);
        return ratioLock ? handles.filter((handle) => handle.name.length === 2) : handles;
    }

    function hitActiveHandle(rect, x, y) {
        const half = HANDLE_HIT_SIZE / 2;
        return activeHandles(rect).find((handle) =>
            x >= handle.x - half && x <= handle.x + half &&
            y >= handle.y - half && y <= handle.y + half
        );
    }

    function rotationHandlePosition() {
        return {x: canvas.width / 2, ...rotationHandleGeometry(canvas.height)};
    }

    function hitRotationHandle(x, y) {
        if (!rotationAvailable) return false;
        const handle = rotationHandlePosition();
        return Math.hypot(x - handle.x, y - handle.y) <= HANDLE_HIT_SIZE / 2;
    }

    function updateInlineStatus() {
        if (dimensions) {
            const pixels = cropPixelSize(crop, dimensions.width, dimensions.height);
            const transformed = scaledPixelSize(
                pixels.width,
                pixels.height,
                widthPercent,
                heightPercent,
                aspectLocked,
            );
            const maxEdge = maxEdgeEnabled ? maxEdgeValue : 0;
            const output = maxEdgePixelSize(transformed.width, transformed.height, maxEdge);
            const branch = Math.max(pixels.width, pixels.height) >= splitThreshold
                ? "符合尺寸"
                : "不符合尺寸";
            branchBadge.textContent = branch;
            const branchMatches = branch === "符合尺寸";
            branchBadge.style.background = "#20252B";
            branchBadge.style.borderColor = branchMatches ? "#52C878" : "#F472B6";
            branchBadge.style.color = branchMatches ? "#8FF0A4" : "#F9A8D4";
            const rotationText = rotation ? ` · 旋转 ${rotation}°` : "";
            const mirrorText = mirrorHorizontal && mirrorVertical
                ? " · 左右+上下镜像"
                : mirrorHorizontal
                    ? " · 左右镜像"
                    : mirrorVertical ? " · 上下镜像" : "";
            const transformText = transformed.width !== pixels.width || transformed.height !== pixels.height
                ? ` → 变形 ${transformed.width} × ${transformed.height}`
                : "";
            const resizeText = maxEdgeEnabled
                ? ` → 输出 ${output.width} × ${output.height} · 最大边缩放已开启`
                : `${transformText} · 最大边缩放已关闭`;
            status.textContent = `原始裁剪 ${pixels.width} × ${pixels.height}（判断）${resizeText} · ${branch}${mirrorText}${rotationText}`;
        } else {
            updateCropStatus(node);
        }
    }

    function commitCrop() {
        setWidgetValue(dataWidget, serializeCrop(crop, ratioLock), node);
        updateInlineStatus();
    }

    function fitCanvas() {
        if (!source || !sourceDimensionsValue || !dimensions) return;
        const availableWidth = Math.max(120, canvasShell.clientWidth - 40);
        const availableHeight = Math.max(120, canvasShell.clientHeight - 40);
        const previewDimensions = scaledPixelSize(
            dimensions.width,
            dimensions.height,
            widthPercent,
            heightPercent,
            aspectLocked,
        );
        const scale = Math.min(
            availableWidth / previewDimensions.width,
            availableHeight / previewDimensions.height,
        );
        canvas.width = Math.max(1, Math.round(previewDimensions.width * scale));
        canvas.height = Math.max(1, Math.round(previewDimensions.height * scale));
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;
        renderInline();
    }

    function updateTransformHandlePositions() {
        if (!source || canvas.style.display === "none" || !canvas.clientWidth || !canvas.clientHeight) {
            transformHandleLayer.style.display = "none";
            return;
        }
        const shellWidth = canvasShell.clientWidth;
        const shellHeight = canvasShell.clientHeight;
        const canvasLeft = canvas.offsetLeft;
        const canvasTop = canvas.offsetTop;
        const canvasWidth = canvas.clientWidth;
        const canvasHeight = canvas.clientHeight;
        const place = (handle, left, top) => {
            const handleWidth = parseFloat(handle.style.width) || 12;
            const handleHeight = parseFloat(handle.style.height) || 12;
            handle.style.left = `${clamp(left, 2, Math.max(2, shellWidth - handleWidth - 2))}px`;
            handle.style.top = `${clamp(top, 2, Math.max(2, shellHeight - handleHeight - 2))}px`;
        };
        place(transformHandles.left, canvasLeft - 16, canvasTop + (canvasHeight - 28) / 2);
        place(transformHandles.right, canvasLeft + canvasWidth + 4, canvasTop + (canvasHeight - 28) / 2);
        place(transformHandles.top, canvasLeft + (canvasWidth - 28) / 2, canvasTop - 16);
        place(transformHandles.bottom, canvasLeft + (canvasWidth - 28) / 2, canvasTop + canvasHeight + 4);
        transformHandleLayer.style.display = "block";
    }

    function updateRotation(value, {fromWidget = false} = {}) {
        const nextRotation = rotationAvailable
            ? Number(normalizeRotationDegrees(value).toFixed(1))
            : 0;
        rotation = nextRotation;
        rotationNumber.value = String(nextRotation);
        const rawRotation = rotationWidget?.value;
        if (rotationWidget && shouldSyncRotationWidget(rawRotation, nextRotation) && !syncingRotationWidget) {
            syncingRotationWidget = true;
            setWidgetValue(rotationWidget, nextRotation, node);
            syncingRotationWidget = false;
        }
        if (sourceDimensionsValue) {
            dimensions = rotatedImageSize(
                sourceDimensionsValue.width,
                sourceDimensionsValue.height,
                nextRotation,
            );
            fitCanvas();
        } else {
            updateInlineStatus();
        }
        app.graph.setDirtyCanvas(true, true);
    }

    function updateMirror(axis, value, {fromWidget = false} = {}) {
        if (!mirrorAvailable) return;
        const next = widgetBooleanValue(value);
        const widget = axis === "horizontal" ? horizontalMirrorWidget : verticalMirrorWidget;
        if (axis === "horizontal") mirrorHorizontal = next;
        else mirrorVertical = next;
        if (!fromWidget && widgetBooleanValue(widget?.value) !== next && !syncingMirrorWidgets) {
            syncingMirrorWidgets = true;
            setWidgetValue(widget, next, node);
            syncingMirrorWidgets = false;
        }
        refreshMirrorButtons();
        renderInline();
        app.graph.setDirtyCanvas(true, true);
    }

    function renderInline() {
        if (!source || !sourceDimensionsValue || !dimensions) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawCheckerboard(ctx, canvas.width, canvas.height);
        if (rotation === 0 && !mirrorHorizontal && !mirrorVertical) {
            ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        } else {
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(canvas.width / dimensions.width, canvas.height / dimensions.height);
            ctx.rotate(rotation * Math.PI / 180);
            ctx.scale(mirrorHorizontal ? -1 : 1, mirrorVertical ? -1 : 1);
            ctx.drawImage(
                source,
                -sourceDimensionsValue.width / 2,
                -sourceDimensionsValue.height / 2,
                sourceDimensionsValue.width,
                sourceDimensionsValue.height,
            );
            ctx.restore();
        }

        const rect = cropRect(crop, canvas);
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,.56)";
        ctx.beginPath();
        ctx.rect(0, 0, canvas.width, canvas.height);
        ctx.rect(rect.left, rect.top, rect.width, rect.height);
        ctx.fill("evenodd");
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.left, rect.top, rect.width, rect.height);
        ctx.clip();
        ctx.strokeStyle = "rgba(255,255,255,.48)";
        ctx.lineWidth = 1;
        for (let index = 1; index <= 2; index += 1) {
            const x = rect.left + rect.width * index / 3;
            const y = rect.top + rect.height * index / 3;
            ctx.beginPath();
            ctx.moveTo(x, rect.top);
            ctx.lineTo(x, rect.bottom);
            ctx.moveTo(rect.left, y);
            ctx.lineTo(rect.right, y);
            ctx.stroke();
        }
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = "#7EE787";
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
        for (const handle of activeHandles(rect)) {
            ctx.fillStyle = "#15251B";
            ctx.strokeStyle = "#7EE787";
            ctx.lineWidth = 2;
            ctx.fillRect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
            ctx.strokeRect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        }
        ctx.restore();

        if (rotationAvailable) {
            const rotationHandle = rotationHandlePosition();
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = "rgba(78, 161, 255, 0.42)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(canvas.width / 2, canvas.height / 2);
            ctx.lineTo(rotationHandle.x, rotationHandle.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#4EA1FF";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(rotationHandle.x, rotationHandle.y, rotationHandle.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#DCEEFF";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        }
        updateTransformHandlePositions();
        updateInlineStatus();
    }

    function cropFromDrag(startX, startY, pointerX, pointerY) {
        const currentX = pointerX / canvas.width;
        const currentY = pointerY / canvas.height;
        const east = currentX >= startX;
        const south = currentY >= startY;
        let width = Math.max(MIN_CROP_PIXELS / canvas.width, Math.abs(currentX - startX));
        let height = Math.max(MIN_CROP_PIXELS / canvas.height, Math.abs(currentY - startY));
        if (ratioLock) {
            const normalizedRatio = ratioLock * dimensions.height / dimensions.width;
            if (width / height > normalizedRatio) height = width / normalizedRatio;
            else width = height * normalizedRatio;
        }
        const maxWidth = east ? 1 - startX : startX;
        const maxHeight = south ? 1 - startY : startY;
        const scale = Math.min(1, maxWidth / width, maxHeight / height);
        width *= scale;
        height *= scale;
        return {
            version: 1,
            x: east ? startX : startX - width,
            y: south ? startY : startY - height,
            width,
            height,
        };
    }

    async function refreshSource(options = {}) {
        const quiet = Boolean(options?.quiet);
        const token = ++loadToken;
        if (!quiet) {
            placeholder.style.display = "block";
            placeholder.textContent = "正在读取图片…";
            canvas.style.display = "none";
        }
        try {
            const nextSource = await resolveEditorSource(node);
            if (token !== loadToken) return;
            const nextSourceDimensions = sourceDimensions(nextSource);
            if (!nextSourceDimensions) throw new Error("无法获取图片尺寸。");
            source = nextSource;
            sourceDimensionsValue = nextSourceDimensions;
            syncPreviewTransformFromWidgets();
            updateRotation(rotationWidget?.value, {fromWidget: true});
            node.imgs = null;
            canvas.style.display = "block";
            placeholder.style.display = "none";
            requestAnimationFrame(fitCanvas);
        } catch (error) {
            if (token !== loadToken) return;
            if (quiet && source) return;
            source = null;
            sourceDimensionsValue = null;
            dimensions = null;
            rotation = 0;
            transformHandleLayer.style.display = "none";
            placeholder.style.display = "block";
            placeholder.textContent = error?.message || "请上传图片或运行上游节点";
            canvas.style.display = "none";
            updateCropStatus(node);
        }
    }

    canvas.addEventListener("pointerdown", (event) => {
        if (!source) return;
        event.preventDefault();
        event.stopPropagation();
        const pointer = pointerOnCanvas(canvas, event);
        const rect = cropRect(crop, canvas);
        const handle = hitActiveHandle(rect, pointer.x, pointer.y);
        if (!event.shiftKey && hitRotationHandle(pointer.x, pointer.y)) {
            interaction = {
                mode: "rotate",
                rotation,
                startAngle: Math.atan2(pointer.y - canvas.height / 2, pointer.x - canvas.width / 2),
            };
            canvas.style.cursor = "grabbing";
        } else if (!event.shiftKey && handle) {
            interaction = {mode: "resize", handle: handle.name, start: {...crop}, pointer};
        } else if (shouldCreateCropFromPointer(
            crop,
            rect,
            pointer.x,
            pointer.y,
            boxSelectArmed,
            event.shiftKey,
        )) {
            const x = clamp(pointer.x / canvas.width, 0, 1);
            const y = clamp(pointer.y / canvas.height, 0, 1);
            interaction = {
                mode: "create",
                startX: x,
                startY: y,
                previous: {...crop},
            };
            crop = {version: 1, x, y, width: 0, height: 0};
        } else if (pointInRect(rect, pointer.x, pointer.y)) {
            interaction = {mode: "move", start: {...crop}, pointer};
        } else {
            const x = pointer.x / canvas.width;
            const y = pointer.y / canvas.height;
            const previous = {...crop};
            crop = {version: 1, x, y, width: 0, height: 0};
            interaction = {mode: "create", startX: x, startY: y, previous};
        }
        canvas.setPointerCapture?.(event.pointerId);
        renderInline();
    });

    canvas.addEventListener("pointermove", (event) => {
        if (!source) return;
        const pointer = pointerOnCanvas(canvas, event);
        if (!interaction) {
            const rect = cropRect(crop, canvas);
            const handle = hitActiveHandle(rect, pointer.x, pointer.y);
            canvas.style.cursor = hitRotationHandle(pointer.x, pointer.y) ? "grab" : handle
                ? (handle.name === "n" || handle.name === "s" ? "ns-resize"
                    : handle.name === "e" || handle.name === "w" ? "ew-resize"
                    : handle.name === "ne" || handle.name === "sw" ? "nesw-resize" : "nwse-resize")
                : pointInRect(rect, pointer.x, pointer.y) && !isFullCrop(crop) ? "move" : "crosshair";
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (interaction.mode === "rotate") {
            const current = Math.atan2(
                pointer.y - canvas.height / 2,
                pointer.x - canvas.width / 2,
            );
            const delta = (current - interaction.startAngle) * 180 / Math.PI;
            updateRotation(interaction.rotation + delta);
        } else if (interaction.mode === "move") {
            const dx = (pointer.x - interaction.pointer.x) / canvas.width;
            const dy = (pointer.y - interaction.pointer.y) / canvas.height;
            crop = {
                ...interaction.start,
                x: clamp(interaction.start.x + dx, 0, 1 - interaction.start.width),
                y: clamp(interaction.start.y + dy, 0, 1 - interaction.start.height),
            };
        } else if (interaction.mode === "resize") {
            const dx = (pointer.x - interaction.pointer.x) / canvas.width;
            const dy = (pointer.y - interaction.pointer.y) / canvas.height;
            crop = ratioLock
                ? resizeCropWithRatio(
                    interaction.start,
                    interaction.handle,
                    pointer,
                    ratioLock,
                    canvas,
                    dimensions.width,
                    dimensions.height,
                )
                : resizeCropFree(interaction.start, interaction.handle, dx, dy, canvas);
        } else {
            crop = cropFromDrag(interaction.startX, interaction.startY, pointer.x, pointer.y);
        }
        renderInline();
    });

    const finishInteraction = (event) => {
        if (!interaction) return;
        event.preventDefault();
        event.stopPropagation();
        const completed = interaction;
        const mode = completed.mode;
        if (mode === "create") {
            if (event.type === "pointercancel") {
                crop = completed.previous;
            } else {
                const pointer = pointerOnCanvas(canvas, event);
                const distance = Math.hypot(
                    pointer.x - completed.startX * canvas.width,
                    pointer.y - completed.startY * canvas.height,
                );
                crop = distance >= 3
                    ? cropFromDrag(completed.startX, completed.startY, pointer.x, pointer.y)
                    : completed.previous;
            }
        }
        interaction = null;
        canvas.releasePointerCapture?.(event.pointerId);
        if (mode !== "rotate" && event.type !== "pointercancel") commitCrop();
        renderInline();
    };
    canvas.addEventListener("pointerup", finishInteraction);
    canvas.addEventListener("pointercancel", finishInteraction);

    const moveTransformInteraction = (event) => {
        if (!transformInteraction || transformInteraction.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const currentClient = transformInteraction.axis === "width" ? event.clientX : event.clientY;
        const delta = (currentClient - transformInteraction.startClient) * transformInteraction.direction;
        const next = transformInteraction.startPercent + delta / transformInteraction.referencePixels * 100;
        updateTransformScale(transformInteraction.axis, Number(next.toFixed(1)));
    };
    const finishTransformInteraction = (event) => {
        if (!transformInteraction || transformInteraction.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        transformInteraction = null;
        window.removeEventListener("pointermove", moveTransformInteraction, true);
        window.removeEventListener("pointerup", finishTransformInteraction, true);
        window.removeEventListener("pointercancel", finishTransformInteraction, true);
    };
    for (const handle of Object.values(transformHandles)) {
        handle.addEventListener("pointerdown", (event) => {
            if (!source || aspectLocked) return;
            event.preventDefault();
            event.stopPropagation();
            const axis = handle.dataset.axis;
            const side = handle.dataset.side;
            transformInteraction = {
                mode: "transform-scale",
                axis,
                direction: side === "left" || side === "top" ? -1 : 1,
                startClient: axis === "width" ? event.clientX : event.clientY,
                startPercent: axis === "width" ? widthPercent : heightPercent,
                referencePixels: Math.max(1, axis === "width" ? canvas.clientWidth : canvas.clientHeight),
                pointerId: event.pointerId,
            };
            window.addEventListener("pointermove", moveTransformInteraction, true);
            window.addEventListener("pointerup", finishTransformInteraction, true);
            window.addEventListener("pointercancel", finishTransformInteraction, true);
        });
    }

    ratioSelect.addEventListener("change", () => {
        ratioLock = ratioSelect.value === "free" ? null : Number(ratioSelect.value);
        if (ratioLock && dimensions) {
            crop = applyRatio(crop, ratioLock, dimensions.width, dimensions.height);
        }
        commitCrop();
        renderInline();
    });
    boxSelectButton.addEventListener("click", () => setBoxSelectArmed(!boxSelectArmed));
    resetButton.addEventListener("click", () => {
        crop = {...DEFAULT_CROP};
        commitCrop();
        renderInline();
    });
    rotationNumber.addEventListener("input", () => {
        const parsedRotation = parseRotationInputValue(
            rotationNumber.value,
            rotationNumber.validity?.badInput,
        );
        if (parsedRotation !== null) updateRotation(parsedRotation);
    });
    rotationNumber.addEventListener("change", () => {
        const parsedRotation = parseRotationInputValue(
            rotationNumber.value,
            rotationNumber.validity?.badInput,
        );
        if (parsedRotation === null) {
            rotationNumber.value = String(rotation);
            return;
        }
        updateRotation(parsedRotation);
    });
    resetRotationButton.addEventListener("click", () => updateRotation(0));
    rotateLeftButton.addEventListener("click", () => updateRotation(rotation - 90));
    rotateRightButton.addEventListener("click", () => updateRotation(rotation + 90));
    mirrorHorizontalButton.addEventListener("click", () => updateMirror("horizontal", !mirrorHorizontal));
    mirrorVerticalButton.addEventListener("click", () => updateMirror("vertical", !mirrorVertical));
    maxEdgeToggleButton.addEventListener("click", () => updateMaxEdgeEnabled(!maxEdgeEnabled));
    maxEdgeInput.addEventListener("input", () => {
        if (maxEdgeInput.value.trim() !== "") updateMaxEdgeValue(maxEdgeInput.value);
    });
    maxEdgeInput.addEventListener("change", () => {
        if (maxEdgeInput.value.trim() === "") maxEdgeInput.value = String(maxEdgeValue);
        else updateMaxEdgeValue(maxEdgeInput.value);
    });
    aspectLockButton.addEventListener("click", () => updateAspectLock(!aspectLocked));
    resetTransformButton.addEventListener("click", resetTransformScale);
    for (const [axis, input] of [
        ["width", widthField.input],
        ["height", heightField.input],
    ]) {
        input.addEventListener("input", () => {
            if (input.value.trim() !== "") updateTransformScale(axis, input.value);
        });
        input.addEventListener("change", () => {
            if (input.value.trim() === "") refreshTransformControls();
            else updateTransformScale(axis, input.value);
        });
    }
    splitThresholdInput.addEventListener("input", () => {
        if (splitThresholdInput.value.trim() !== "") updateSplitThreshold(splitThresholdInput.value);
    });
    splitThresholdInput.addEventListener("change", () => {
        if (splitThresholdInput.value.trim() === "") splitThresholdInput.value = String(splitThreshold);
        else updateSplitThreshold(splitThresholdInput.value);
    });
    if (rotationWidget && !rotationWidget.__jindouyunRotationPatched) {
        rotationWidget.__jindouyunRotationPatched = true;
        const originalRotationCallback = rotationWidget.callback;
        rotationWidget.callback = function(value) {
            const result = originalRotationCallback?.apply(this, arguments);
            if (!syncingRotationWidget) updateRotation(value, {fromWidget: true});
            return result;
        };
    }
    for (const [widget, axis] of [
        [horizontalMirrorWidget, "horizontal"],
        [verticalMirrorWidget, "vertical"],
    ]) {
        if (!widget || widget.__jindouyunMirrorPatched) continue;
        widget.__jindouyunMirrorPatched = true;
        const originalMirrorCallback = widget.callback;
        widget.callback = function(value) {
            const result = originalMirrorCallback?.apply(this, arguments);
            if (!syncingMirrorWidgets) updateMirror(axis, value, {fromWidget: true});
            return result;
        };
    }
    if (aspectLockWidget && !aspectLockWidget.__jindouyunAspectLockPatched) {
        aspectLockWidget.__jindouyunAspectLockPatched = true;
        const originalAspectLockCallback = aspectLockWidget.callback;
        aspectLockWidget.callback = function(value) {
            const result = originalAspectLockCallback?.apply(this, arguments);
            if (!syncingTransformWidgets) updateAspectLock(value, {fromWidget: true});
            return result;
        };
    }
    for (const [widget, axis] of [
        [widthPercentWidget, "width"],
        [heightPercentWidget, "height"],
    ]) {
        if (!widget || widget.__jindouyunTransformScalePatched) continue;
        widget.__jindouyunTransformScalePatched = true;
        const originalTransformCallback = widget.callback;
        widget.callback = function(value) {
            const result = originalTransformCallback?.apply(this, arguments);
            if (!syncingTransformWidgets) updateTransformScale(axis, value, {fromWidget: true});
            return result;
        };
    }
    if (splitThresholdWidget && !splitThresholdWidget.__jindouyunSplitPatched) {
        splitThresholdWidget.__jindouyunSplitPatched = true;
        const originalSplitCallback = splitThresholdWidget.callback;
        splitThresholdWidget.callback = function(value) {
            const result = originalSplitCallback?.apply(this, arguments);
            if (!syncingSplitWidget) updateSplitThreshold(value, {fromWidget: true});
            return result;
        };
    }
    wrapper.addEventListener("pointerenter", () => {
        node.imgs = null;
        refreshSource({quiet: Boolean(source)});
    });
    wrapper.addEventListener("dragover", (event) => {
        if (!hasDroppedImage(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        wrapper.style.outline = "2px solid #52C878";
        wrapper.style.outlineOffset = "-2px";
    });
    wrapper.addEventListener("dragleave", (event) => {
        if (wrapper.contains(event.relatedTarget)) return;
        wrapper.style.outline = "none";
    });
    wrapper.addEventListener("drop", async (event) => {
        const files = droppedImageFiles(event);
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        wrapper.style.outline = "none";
        try {
            await uploadDroppedImage(node, files[0]);
        } catch (error) {
            console.error("[筋斗云交互裁剪] 拖入图片失败", error);
            window.alert?.(error?.message || "拖入图片失败，请重新尝试。");
        }
    });
    node.__jindouyunRefreshInlineCrop = refreshSource;
    node.__jindouyunRefreshInlineCropStatus = updateInlineStatus;
    node.__jindouyunSetMaxEdgeEnabled = (value) => updateMaxEdgeEnabled(value, {fromWidget: true});
    node.__jindouyunSetMaxEdgeValue = (value) => updateMaxEdgeValue(value, {fromWidget: true});
    node.__jindouyunResetForNewImage = () => {
        crop = {...DEFAULT_CROP};
        ratioLock = null;
        syncRatioSelect();
        updateRotation(0);
        commitCrop();
        renderInline();
    };
    syncRatioSelect();
    setBoxSelectArmed(true);
    refreshMirrorButtons();
    refreshMaxEdgeToggle();
    updateAspectLock(aspectLocked);
    updateSplitThreshold(splitThreshold, {fromWidget: true});
    updateCropStatus(node);
    requestAnimationFrame(refreshSource);
    node.setSize?.([Math.max(node.size?.[0] || 340, 380), Math.max((node.size?.[1] || 150) + CROP_PANEL_HEIGHT, 655)]);
    requestAnimationFrame(() => syncCropPanelWidth(node, wrapper));
    window.setTimeout(() => syncCropPanelWidth(node, wrapper), 120);
}

function patchUploadWidget(node) {
    const widget = findWidget(node, "上传图片");
    if (!widget || widget.__jindouyunCropPatched) return;
    widget.__jindouyunCropPatched = true;
    let previousValue = String(widget.value ?? "");
    let resetReady = false;
    window.setTimeout(() => { resetReady = true; }, 0);
    const original = widget.callback;
    widget.callback = function(value) {
        original?.apply(this, arguments);
        const currentValue = String(value ?? "");
        node.__jindouyunCropUpload = null;
        if (resetReady && currentValue && currentValue !== previousValue) {
            if (node.__jindouyunResetForNewImage) {
                node.__jindouyunResetForNewImage();
            } else {
                setWidgetValue(findWidget(node, "图片旋转"), 0, node);
                setWidgetValue(findWidget(node, "裁剪数据"), serializeCrop(DEFAULT_CROP), node);
                updateCropStatus(node);
            }
        }
        previousValue = currentValue;
        window.setTimeout(() => node.__jindouyunRefreshInlineCrop?.(), 0);
    };
}

function patchUploadButton(node) {
    const widgets = node.widgets || [];
    const widget = widgets.find((item) => (
        item.type === "button"
        || item.constructor?.name === "ButtonWidget"
        || /选择.*上传|choose.*upload/i.test(String(item.label || ""))
    ));
    if (!widget) {
        const retryCount = Number(node.__jindouyunUploadButtonRetryCount || 0);
        if (!node.__jindouyunUploadButtonRetry && retryCount < 120) {
            node.__jindouyunUploadButtonRetryCount = retryCount + 1;
            node.__jindouyunUploadButtonRetry = window.setTimeout(() => {
                node.__jindouyunUploadButtonRetry = null;
                patchUploadButton(node);
            }, 100);
        }
        return;
    }
    if (widget.__jindouyunUploadButtonPatched) return;
    node.__jindouyunUploadButtonRetryCount = 0;
    widget.__jindouyunUploadButtonPatched = true;
    widget.label = "选择要上传的图片";
    widget.computeSize = (width) => [Number(width) || Number(node.size?.[0]) || 380, UPLOAD_BUTTON_HEIGHT];
    widget.draw = function(ctx, currentNode, width, y, _height, lowQuality) {
        const left = 12;
        const top = y + 2;
        const buttonWidth = Math.max(0, width - left * 2);
        const buttonHeight = UPLOAD_BUTTON_HEIGHT - 4;
        const hovered = currentNode?.mouseOver?.overWidget === widget;
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
    };

    node.graph?.setDirtyCanvas?.(true, true);
}

function patchMaxEdgeWidget(node) {
    const widget = findWidget(node, "最大边分辨率");
    if (!widget || widget.__jindouyunMaxEdgePatched) return;
    widget.__jindouyunMaxEdgePatched = true;
    const original = widget.callback;
    widget.callback = function(value) {
        original?.apply(this, arguments);
        node.__jindouyunSetMaxEdgeValue?.(value);
        window.setTimeout(() => node.__jindouyunRefreshInlineCropStatus?.(), 0);
    };
}

function patchMaxEdgeEnabledWidget(node) {
    const widget = findWidget(node, "启用最大边分辨率");
    if (!widget || widget.__jindouyunMaxEdgeEnabledPatched) return;
    widget.__jindouyunMaxEdgeEnabledPatched = true;
    const original = widget.callback;
    widget.callback = function() {
        const result = original?.apply(this, arguments);
        node.__jindouyunSetMaxEdgeEnabled?.(widget.value);
        window.setTimeout(() => node.__jindouyunRefreshInlineCropStatus?.(), 0);
        return result;
    };
}

function patchResizeMethodWidget(node) {
    const widget = findWidget(node, "放大方法");
    if (!widget || widget.__jindouyunResizeMethodPatched) return;
    widget.__jindouyunResizeMethodPatched = true;
    const normalizeValue = () => {
        if (!RESIZE_METHODS.includes(String(widget.value || ""))) {
            widget.value = RESIZE_METHODS[0];
            app.graph.setDirtyCanvas(true, true);
        }
    };
    normalizeValue();
    window.setTimeout(normalizeValue, 0);
    const original = widget.callback;
    widget.callback = function(value) {
        if (!RESIZE_METHODS.includes(String(value || ""))) {
            widget.value = RESIZE_METHODS[0];
            value = RESIZE_METHODS[0];
        }
        return original?.call(this, value, ...Array.from(arguments).slice(1));
    };
}

function patchNativeImagePreview(node) {
    if (node.__jindouyunNativePreviewPatched) return;
    node.__jindouyunNativePreviewPatched = true;
    node.imgs = null;
    const originalOnDrawBackground = node.onDrawBackground;
    node.onDrawBackground = function() {
        this.imgs = null;
        return originalOnDrawBackground?.apply(this, arguments);
    };
    const originalConnectionsChange = node.onConnectionsChange;
    node.onConnectionsChange = function() {
        originalConnectionsChange?.apply(this, arguments);
        this.__jindouyunCropExecutionPreview = null;
        window.setTimeout(() => this.__jindouyunRefreshInlineCrop?.(), 0);
    };
}

let executionEventsBound = false;

function bindExecutionRefreshEvents() {
    if (executionEventsBound) return;
    executionEventsBound = true;

    api.addEventListener("executed", ({detail}) => {
        const executedNodeId = detail?.node;
        if (executedNodeId == null) return;
        for (const node of app.graph?._nodes || []) {
            if ((node.comfyClass || node.type) !== NODE_TYPE) continue;
            const linked = connectedSource(node);
            if (
                !linked.connected ||
                String(linked.originId) !== String(executedNodeId)
            ) {
                continue;
            }
            const url = executionPreviewUrl(detail?.output);
            node.__jindouyunCropExecutionPreview = url
                ? {originId: linked.originId, url}
                : null;
            scheduleCropSourceRefresh(node);
        }
    });

    api.addEventListener("execution_success", () => {
        for (const node of app.graph?._nodes || []) {
            if ((node.comfyClass || node.type) === NODE_TYPE) {
                scheduleCropSourceRefresh(node, 160);
            }
        }
    });
}

function patchCropNode(node) {
    if ((node.comfyClass || node.type) !== NODE_TYPE) return;
    normalizeCropNumericWidgets(node);
    hideCropDataWidget(node);
    hideRotationWidget(node);
    hideMirrorWidgets(node);
    hideTransformWidgets(node);
    patchNativeImagePreview(node);
    patchUploadWidget(node);
    patchUploadButton(node);
    patchWholeNodeImageDrop(node);
    patchMaxEdgeWidget(node);
    patchMaxEdgeEnabledWidget(node);
    patchResizeMethodWidget(node);
    addCropControls(node);
}

app.registerExtension({
    name: "comfyui-jindouyun-design.interactive-crop",

    setup() {
        bindExecutionRefreshEvents();
    },

    nodeCreated(node) {
        patchCropNode(node);
    },

    loadedGraphNode(node) {
        normalizeCropNumericWidgets(node);
        patchCropNode(node);
    },

    afterConfigureGraph() {
        for (const node of app.graph?._nodes || []) {
            normalizeCropNumericWidgets(node);
        }
    },

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            patchCropNode(this);
        };
        const originalOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function() {
            const result = originalOnConfigure?.apply(this, arguments);
            normalizeCropNumericWidgets(this);
            return result;
        };
    },
});
