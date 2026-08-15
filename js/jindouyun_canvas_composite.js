import { app } from "../../scripts/app.js";
import {
    CANVAS_PERCENT_MAX,
    normalizeScaleMode,
    resolvePreviewArea,
    resolvePreviewWidgetHeight,
    resizeLayerFromCorner,
    resolveLayerSize,
    scaleValuesFromPreview,
    SCALE_MODE_FIT,
    SCALE_MODE_HEIGHT,
    SCALE_MODE_MANUAL,
    SCALE_MODE_WIDTH,
} from "./jindouyun_canvas_geometry.mjs?v=20260815-canvas-overflow1";
import {
    hueSliderColorAt,
    hueSliderPositionForColor,
} from "./jindouyun_color_slider.mjs?v=20260814-direct-color-slider1";

const NODE_TYPE = "JindouyunCanvasComposite";
const SNAP_DISTANCE = 2.5;
const POSITION_WIDGET_MIN_HEIGHT = 230;
const POSITION_WIDGET_MAX_HEIGHT = 560;
const RESIZE_HANDLE_SIZE = 8;
const RESIZE_HIT_SIZE = 14;

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function setWidgetValue(widget, value, node) {
    if (!widget) {
        return;
    }
    widget.value = value;
    widget.callback?.(value, app.canvas, node, widget);
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, number));
}

function axisCenterLimits(areaStart, areaSize, layerSize) {
    if (layerSize <= areaSize) {
        return {
            min: areaStart + layerSize / 2,
            max: areaStart + areaSize - layerSize / 2,
        };
    }
    return {
        min: areaStart + areaSize - layerSize / 2,
        max: areaStart + layerSize / 2,
    };
}

function axisPercentLimits(areaSize, layerSize) {
    const half = (layerSize / 2 / areaSize) * 100;
    if (layerSize <= areaSize) {
        return {min: half, max: 100 - half};
    }
    return {min: 100 - half, max: half};
}

function layerPreviewRect(node, widgetWidth, y, widgetHeight = POSITION_WIDGET_MIN_HEIGHT) {
    const xWidget = findWidget(node, "图片X");
    const yWidget = findWidget(node, "图片Y");
    const geometry = computePreviewRects(node, widgetWidth, y, widgetHeight);
    const xLimits = axisCenterLimits(geometry.areaX, geometry.areaW, geometry.layerW);
    const yLimits = axisCenterLimits(geometry.areaY, geometry.areaH, geometry.layerH);
    const centerX = Math.max(
        xLimits.min,
        Math.min(xLimits.max, geometry.areaX + (Number(xWidget?.value ?? 50) / 100) * geometry.areaW),
    );
    const centerY = Math.max(
        yLimits.min,
        Math.min(yLimits.max, geometry.areaY + (Number(yWidget?.value ?? 50) / 100) * geometry.areaH),
    );
    return {
        ...geometry,
        centerX,
        centerY,
        left: centerX - geometry.layerW / 2,
        top: centerY - geometry.layerH / 2,
        right: centerX + geometry.layerW / 2,
        bottom: centerY + geometry.layerH / 2,
    };
}

function resizeHandles(rect) {
    return [
        {name: "nw", x: rect.left, y: rect.top, signX: -1, signY: -1, anchorX: rect.right, anchorY: rect.bottom},
        {name: "ne", x: rect.right, y: rect.top, signX: 1, signY: -1, anchorX: rect.left, anchorY: rect.bottom},
        {name: "se", x: rect.right, y: rect.bottom, signX: 1, signY: 1, anchorX: rect.left, anchorY: rect.top},
        {name: "sw", x: rect.left, y: rect.bottom, signX: -1, signY: 1, anchorX: rect.right, anchorY: rect.top},
    ];
}

function visibleResizeHandles(rect) {
    const inset = RESIZE_HANDLE_SIZE / 2;
    return resizeHandles(rect).map((handle) => ({
        ...handle,
        displayX: Math.max(rect.areaX + inset, Math.min(rect.areaX + rect.areaW - inset, handle.x)),
        displayY: Math.max(rect.areaY + inset, Math.min(rect.areaY + rect.areaH - inset, handle.y)),
    }));
}

function hitResizeHandle(rect, x, y) {
    const half = RESIZE_HIT_SIZE / 2;
    return visibleResizeHandles(rect).find((handle) =>
        x >= handle.displayX - half && x <= handle.displayX + half &&
        y >= handle.displayY - half && y <= handle.displayY + half
    );
}

function setScaleFromPreview(node, width, height, areaWidth, areaHeight) {
    const mode = normalizeScaleMode(findWidget(node, "缩放方式")?.value);
    const image = getPreviewImageDimensions(node);
    const canvas = getCanvasDimensions(node);
    const values = scaleValuesFromPreview({
        width,
        height,
        areaWidth,
        areaHeight,
        imageWidth: image.width,
        imageHeight: image.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        scaleMode: mode,
    });
    if (values.canvasPercent != null) {
        setWidgetValue(
            findWidget(node, "画布占比"),
            Number(values.canvasPercent.toFixed(1)),
            node,
        );
        return;
    }
    setWidgetValue(
        findWidget(node, "图片缩放"),
        Number(values.manualScale.toFixed(2)),
        node,
    );
}

function normalizeHexColor(value) {
    const text = String(value || "").trim();
    const match = text.match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) {
        return "#FFFFFF";
    }
    return `#${match[1].toUpperCase()}`;
}

function parsePreviewDrawingData(node) {
    const widget = findWidget(node, "绘画数据");
    try {
        const payload = JSON.parse(String(widget?.value || ""));
        if (payload && Array.isArray(payload.strokes)) {
            return payload.strokes.filter((stroke) => {
                if (stroke?.visible === false || stroke?.groupVisible === false) {
                    return false;
                }
                if (stroke?.tool !== "lasso") {
                    return true;
                }
                if (!Array.isArray(stroke.points) || stroke.points.length < 3) {
                    return false;
                }
                const first = stroke.points[0];
                const last = stroke.points[stroke.points.length - 1];
                return Math.hypot(Number(last?.[0]) - Number(first?.[0]), Number(last?.[1]) - Number(first?.[1])) <= 0.03;
            });
        }
    } catch (_) {
        // Invalid or legacy drawing data is shown as an empty drawing.
    }
    return [];
}

function isPreviewInputVisible(node) {
    const widget = findWidget(node, "绘画数据");
    try {
        const payload = JSON.parse(String(widget?.value || ""));
        return !payload || payload.inputVisible !== false;
    } catch (_) {
        return true;
    }
}

function drawSinglePreviewStroke(ctx, stroke, width, height) {
    const points = Array.isArray(stroke?.points) ? stroke.points : [];
    if (!points.length) {
        return;
    }
    const pixelPoints = points.map((point) => [
        clampNumber(point?.[0], -20, 20, 0) * Math.max(0, width - 1),
        clampNumber(point?.[1], -20, 20, 0) * Math.max(0, height - 1),
    ]);

    ctx.save();
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = normalizeHexColor(stroke.color || "#FF6A00");
    ctx.fillStyle = normalizeHexColor(stroke.color || "#FF6A00");
    ctx.lineWidth = Math.max(1, clampNumber(stroke.size, 0.0005, 0.5, 0.02) * Math.min(width, height));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pixelPoints[0][0], pixelPoints[0][1]);
    for (let index = 1; index < pixelPoints.length; index += 1) {
        ctx.lineTo(pixelPoints[index][0], pixelPoints[index][1]);
    }

    if (stroke.tool === "lasso" && pixelPoints.length >= 3) {
        ctx.closePath();
        ctx.fill();
    } else if (pixelPoints.length === 1) {
        ctx.arc(pixelPoints[0][0], pixelPoints[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.stroke();
    }
    ctx.restore();
}

function drawPreviewStroke(ctx, stroke, width, height) {
    drawSinglePreviewStroke(ctx, stroke, width, height);
    if (Array.isArray(stroke?.mirrorPoints)) {
        drawSinglePreviewStroke(ctx, {...stroke, mirrorX: false, points: stroke.mirrorPoints}, width, height);
    } else if (stroke?.mirrorX === true) {
        drawSinglePreviewStroke(ctx, {
            ...stroke,
            mirrorX: false,
            points: (stroke.points || []).map((point) => [1 - Number(point[0]), Number(point[1])]),
        }, width, height);
    }
}

function drawSavedDrawingPreview(ctx, node, areaX, areaY, areaW, areaH) {
    const layerWidth = Math.max(1, Math.round(areaW));
    const layerHeight = Math.max(1, Math.round(areaH));
    const drawingValue = String(findWidget(node, "绘画数据")?.value || "");
    const cacheKey = `${layerWidth}x${layerHeight}:${drawingValue}`;
    let preview = node.__jindouyunDrawingPreview;
    if (!preview || preview.key !== cacheKey) {
        const strokes = parsePreviewDrawingData(node);
        const layer = document.createElement("canvas");
        layer.width = layerWidth;
        layer.height = layerHeight;
        const layerContext = layer.getContext("2d");
        for (const stroke of strokes) {
            drawPreviewStroke(layerContext, stroke, layer.width, layer.height);
        }
        preview = {key: cacheKey, layer, count: strokes.length};
        node.__jindouyunDrawingPreview = preview;
    }
    if (!preview.count) {
        return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(areaX, areaY, areaW, areaH);
    ctx.clip();
    ctx.drawImage(preview.layer, areaX, areaY, areaW, areaH);
    ctx.restore();

    ctx.save();
    ctx.font = "bold 11px sans-serif";
    const label = `绘画 ${preview.count} 项`;
    const labelWidth = ctx.measureText(label).width + 14;
    ctx.fillStyle = "rgba(20, 24, 30, 0.78)";
    ctx.fillRect(areaX + 7, areaY + areaH - 25, labelWidth, 18);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(label, areaX + 14, areaY + areaH - 12);
    ctx.restore();
}

function syncColorDom(node) {
    const colorWidget = findWidget(node, "背景颜色");
    const input = node.__jindouyunColorNativeInput;
    const text = node.__jindouyunColorText;
    const chip = node.__jindouyunColorChip;
    const color = normalizeHexColor(colorWidget?.value);
    if (input && input.value !== color) {
        input.value = color;
    }
    if (chip) {
        chip.style.background = color;
        const position = Number.isFinite(node.__jindouyunColorSliderPosition)
            ? node.__jindouyunColorSliderPosition
            : hueSliderPositionForColor(color, 0.5);
        chip.style.left = `${position * 100}%`;
    }
    if (text) {
        text.textContent = color;
    }
}

function ratioFromPreset(preset) {
    const text = String(preset || "");
    if (!text.includes(":") || text === "自定义") {
        return null;
    }
    const [w, h] = text.split(":").map((value) => Number.parseFloat(value));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        return null;
    }
    return h / w;
}

function getCanvasRatio(node) {
    const preset = findWidget(node, "画布比例");
    const width = findWidget(node, "画布宽度");
    const height = findWidget(node, "画布高度");
    const presetRatio = ratioFromPreset(preset?.value);
    if (presetRatio) {
        return 1 / presetRatio;
    }
    const w = Math.max(1, Number(width?.value || 1));
    const h = Math.max(1, Number(height?.value || 1));
    return w / h;
}

function getCanvasDimensions(node) {
    const width = Math.max(1, Number(findWidget(node, "画布宽度")?.value || 1));
    const preset = findWidget(node, "画布比例");
    const presetRatio = ratioFromPreset(preset?.value);
    const height = presetRatio
        ? Math.max(1, Math.round(width * presetRatio))
        : Math.max(1, Number(findWidget(node, "画布高度")?.value || 1));
    return {width, height};
}

function getPreviewImageRatio(node) {
    updateImageRatioFromInput(node);
    if (Number.isFinite(node.__jindouyunImageRatio) && node.__jindouyunImageRatio > 0) {
        return node.__jindouyunImageRatio;
    }
    return 1;
}

function getPreviewImageDimensions(node) {
    updateImageRatioFromInput(node);
    if (
        Number.isFinite(node.__jindouyunImageWidth) && node.__jindouyunImageWidth > 0 &&
        Number.isFinite(node.__jindouyunImageHeight) && node.__jindouyunImageHeight > 0
    ) {
        return {width: node.__jindouyunImageWidth, height: node.__jindouyunImageHeight};
    }
    const ratio = getPreviewImageRatio(node);
    return {width: ratio * 1000, height: 1000};
}

function getInputPreviewSource(node) {
    const imageInput = node.inputs?.find((input) => input.name === "图像");
    const link = imageInput?.link != null ? app.graph.links[imageInput.link] : null;
    const originNode = link ? app.graph.getNodeById(link.origin_id) : null;
    const candidates = [
        originNode?.imgs?.[0],
        originNode?.image,
        originNode?.preview,
        originNode?.canvas,
    ];
    return candidates.find((candidate) => {
        const width = candidate?.naturalWidth || candidate?.videoWidth || candidate?.width;
        const height = candidate?.naturalHeight || candidate?.videoHeight || candidate?.height;
        return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    }) || null;
}

function updateImageRatioFromInput(node) {
    const candidate = getInputPreviewSource(node);
    if (candidate) {
        const width = candidate.naturalWidth || candidate.videoWidth || candidate.width;
        const height = candidate.naturalHeight || candidate.videoHeight || candidate.height;
        const nextRatio = width / height;
        node.__jindouyunImageWidth = width;
        node.__jindouyunImageHeight = height;
        if (Math.abs((node.__jindouyunImageRatio || 0) - nextRatio) > 0.001) {
            node.__jindouyunImageRatio = nextRatio;
            app.graph.setDirtyCanvas(true, true);
        }
        return true;
    }
    return false;
}

function computePreviewRects(node, widgetWidth, y, widgetHeight = POSITION_WIDGET_MIN_HEIGHT) {
    const image = getPreviewImageDimensions(node);
    const canvas = getCanvasDimensions(node);
    const previewArea = resolvePreviewArea({
        widgetWidth: node.size?.[0] || widgetWidth || 420,
        widgetHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
    });
    const areaX = previewArea.x;
    const areaY = y + previewArea.y;
    const areaW = previewArea.width;
    const areaH = previewArea.height;
    const scaleMode = normalizeScaleMode(findWidget(node, "缩放方式")?.value);
    const target = resolveLayerSize({
        imageWidth: image.width,
        imageHeight: image.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        scale: findWidget(node, "图片缩放")?.value,
        scaleMode,
        canvasPercent: findWidget(node, "画布占比")?.value,
    });
    const layerW = Math.max(16, target.width / canvas.width * areaW);
    const layerH = Math.max(16, target.height / canvas.height * areaH);

    return {areaX, areaY, areaW, areaH, layerW, layerH};
}

function preferredPreviewHeight(node, widgetWidth) {
    const canvas = getCanvasDimensions(node);
    return resolvePreviewWidgetHeight({
        widgetWidth: node.size?.[0] || widgetWidth || 360,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        minHeight: POSITION_WIDGET_MIN_HEIGHT,
        maxHeight: POSITION_WIDGET_MAX_HEIGHT,
    });
}

function previewCanvasBlendMode(mode) {
    const normalized = String(mode || "normal").replaceAll(" ", "-");
    const supported = new Set([
        "multiply", "screen", "overlay", "darken", "lighten", "color-dodge",
        "color-burn", "hard-light", "soft-light", "difference", "exclusion",
        "hue", "saturation", "color", "luminosity",
    ]);
    return supported.has(normalized) ? normalized : "source-over";
}

function drawInputImagePreview(ctx, node, rect) {
    if (!isPreviewInputVisible(node)) return false;
    const source = getInputPreviewSource(node);
    if (!source) return false;
    const rotation = clampNumber(findWidget(node, "图片旋转")?.value, -180, 180, 0);

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.areaX, rect.areaY, rect.areaW, rect.areaH);
    ctx.clip();
    ctx.globalAlpha = clampNumber(findWidget(node, "透明度")?.value, 0, 1, 1);
    ctx.globalCompositeOperation = previewCanvasBlendMode(findWidget(node, "混合模式")?.value);
    try {
        ctx.translate(rect.centerX, rect.centerY);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.drawImage(source, -rect.layerW / 2, -rect.layerH / 2, rect.layerW, rect.layerH);
    } catch (_) {
        ctx.restore();
        return false;
    }
    ctx.restore();
    return true;
}

function applyRatioPreset(node) {
    const preset = findWidget(node, "画布比例");
    const width = findWidget(node, "画布宽度");
    const height = findWidget(node, "画布高度");
    const ratio = ratioFromPreset(preset?.value);
    if (!ratio || !width || !height) {
        return;
    }
    const nextHeight = Math.max(1, Math.round(Number(width.value || 1) * ratio));
    setWidgetValue(height, nextHeight, node);
    app.graph.setDirtyCanvas(true, true);
}

function patchColorWidget(node) {
    const colorWidget = findWidget(node, "背景颜色");
    if (!colorWidget || colorWidget.__jindouyunColorPatched) {
        return;
    }
    colorWidget.__jindouyunColorPatched = true;
    colorWidget.value = normalizeHexColor(colorWidget.value);
    colorWidget.hidden = true;
    colorWidget.draw = function() {};
    colorWidget.mouse = function() { return false; };
    colorWidget.computeSize = function() { return [0, 0]; };
}

function addColorPickerDomWidget(node) {
    if (node.__jindouyunColorDomPatched || !node.addDOMWidget) {
        return;
    }
    const colorWidget = findWidget(node, "背景颜色");
    if (!colorWidget) {
        return;
    }
    node.__jindouyunColorDomPatched = true;

    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "8px";
    wrapper.style.boxSizing = "border-box";
    wrapper.style.width = "100%";
    wrapper.style.height = "30px";
    wrapper.style.padding = "3px 10px";
    wrapper.style.pointerEvents = "auto";

    const label = document.createElement("span");
    label.textContent = "背景颜色";
    label.style.color = "var(--fg-color, #ddd)";
    label.style.fontSize = "12px";
    label.style.whiteSpace = "nowrap";

    const input = document.createElement("input");
    input.type = "color";
    input.value = normalizeHexColor(colorWidget.value);
    input.style.position = "fixed";
    input.style.left = "-100px";
    input.style.top = "-100px";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";

    const bar = document.createElement("button");
    bar.type = "button";
    bar.title = "按住白点或彩色条左右拖动，实时选择背景颜色";
    bar.setAttribute("aria-label", "拖动选择背景颜色");
    bar.style.flex = "1";
    bar.style.minWidth = "120px";
    bar.style.height = "24px";
    bar.style.padding = "0";
    bar.style.border = "1px solid #777";
    bar.style.borderRadius = "4px";
    bar.style.cursor = "pointer";
    bar.style.touchAction = "none";
    bar.style.position = "relative";
    bar.style.overflow = "hidden";
    bar.style.background = "linear-gradient(90deg, #ff0000 0%, #ffff00 16%, #00ff00 33%, #00ffff 50%, #0000ff 66%, #ff00ff 83%, #ff0000 100%)";

    const chip = document.createElement("span");
    chip.style.position = "absolute";
    chip.style.left = "50%";
    chip.style.top = "50%";
    chip.style.width = "18px";
    chip.style.height = "18px";
    chip.style.border = "2px solid #fff";
    chip.style.borderRadius = "50%";
    chip.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.55)";
    chip.style.transform = "translate(-50%, -50%)";
    chip.style.background = normalizeHexColor(colorWidget.value);
    bar.appendChild(chip);

    const text = document.createElement("span");
    text.textContent = input.value;
    text.style.color = "var(--fg-color, #ddd)";
    text.style.fontSize = "12px";
    text.style.minWidth = "70px";
    text.style.textAlign = "right";
    text.style.cursor = "pointer";
    text.title = "点击色号可精确选择白色、灰色或自定义颜色";
    text.setAttribute("role", "button");

    const applyColor = (value) => {
        const color = normalizeHexColor(value);
        input.value = color;
        setWidgetValue(colorWidget, color, node);
        text.textContent = color;
        chip.style.background = color;
        app.graph.setDirtyCanvas(true, true);
    };
    const onColorChange = () => applyColor(input.value);
    input.addEventListener("input", onColorChange);
    input.addEventListener("change", onColorChange);
    text.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        input.click();
    });

    let dragging = false;
    const updateFromPointer = (event) => {
        const rect = bar.getBoundingClientRect();
        if (rect.width <= 0) {
            return;
        }
        const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        node.__jindouyunColorSliderPosition = position;
        chip.style.left = `${position * 100}%`;
        applyColor(hueSliderColorAt(position));
    };
    bar.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        dragging = true;
        bar.setPointerCapture?.(event.pointerId);
        updateFromPointer(event);
    });
    bar.addEventListener("pointermove", (event) => {
        if (!dragging) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        updateFromPointer(event);
    });
    const finishDragging = (event) => {
        if (!dragging) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        updateFromPointer(event);
        dragging = false;
        if (bar.hasPointerCapture?.(event.pointerId)) {
            bar.releasePointerCapture(event.pointerId);
        }
    };
    bar.addEventListener("pointerup", finishDragging);
    bar.addEventListener("pointercancel", () => {
        dragging = false;
    });

    wrapper.append(label, bar, input, text);
    node.__jindouyunColorNativeInput = input;
    node.__jindouyunColorChip = chip;
    node.__jindouyunColorText = text;

    const domWidget = node.addDOMWidget("背景色选择器", "jindouyun_color_picker", wrapper, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 34,
        getMaxHeight: () => 34,
    });
    domWidget.computeSize = () => [node.size?.[0] || 360, 34];
    syncColorDom(node);
}

function patchImageInputRatio(node) {
    if (node.__jindouyunConnectionPatched) {
        return;
    }
    node.__jindouyunConnectionPatched = true;
    const original = node.onConnectionsChange;
    node.onConnectionsChange = function() {
        original?.apply(this, arguments);
        updateImageRatioFromInput(this);
        app.graph.setDirtyCanvas(true, true);
    };
}

function patchRatioWidgets(node) {
    const preset = findWidget(node, "画布比例");
    const width = findWidget(node, "画布宽度");
    if (preset && !preset.__jindouyunRatioPatched) {
        preset.__jindouyunRatioPatched = true;
        const original = preset.callback;
        preset.callback = function(value) {
            original?.apply(this, arguments);
            applyRatioPreset(node);
        };
    }
    if (width && !width.__jindouyunRatioPatched) {
        width.__jindouyunRatioPatched = true;
        const original = width.callback;
        width.callback = function(value) {
            original?.apply(this, arguments);
            applyRatioPreset(node);
        };
    }
}

function patchScaleWidgets(node) {
    const modeWidget = findWidget(node, "缩放方式");
    const rawMode = String(modeWidget?.value || "").trim();
    const validModes = new Set([SCALE_MODE_FIT, SCALE_MODE_HEIGHT, SCALE_MODE_WIDTH, SCALE_MODE_MANUAL]);
    if (modeWidget && !validModes.has(rawMode)) {
        setWidgetValue(modeWidget, SCALE_MODE_FIT, node);
        setWidgetValue(findWidget(node, "画布占比"), 90, node);
        setWidgetValue(findWidget(node, "图片X"), 50, node);
        setWidgetValue(findWidget(node, "图片Y"), 50, node);
    }
    for (const name of ["缩放方式", "画布占比", "图片缩放"]) {
        const widget = findWidget(node, name);
        if (!widget || widget.__jindouyunScalePatched) {
            continue;
        }
        widget.__jindouyunScalePatched = true;
        const original = widget.callback;
        widget.callback = function(value) {
            original?.apply(this, arguments);
            app.graph.setDirtyCanvas(true, true);
        };
    }
}

function patchRotationWidget(node) {
    const widget = findWidget(node, "图片旋转");
    if (!widget) {
        return;
    }
    const rawValue = String(widget.value ?? "").trim();
    const numericValue = Number(rawValue);
    const normalizedNumber = rawValue === "" || !Number.isFinite(numericValue)
        ? 0
        : Math.max(-180, Math.min(180, numericValue));
    const normalizedValue = normalizedNumber.toFixed(1);
    if (String(widget.value) !== normalizedValue) {
        setWidgetValue(widget, normalizedValue, node);
    }
}

function addPositionWidget(node) {
    if (node.widgets?.some((widget) => widget.name === "位置画布")) {
        return;
    }

    let interaction = null;
    const widget = {
        name: "位置画布",
        type: "jindouyun_canvas_position",
        value: "",
        draw(ctx, node, widgetWidth, y, allocatedHeight) {
            widget.last_y = y;
            widget.last_height = Math.max(
                preferredPreviewHeight(node, widgetWidth),
                Number(allocatedHeight) || 0,
                Number(node.size?.[1] || 0) - y - 8,
            );
            const inputVisible = isPreviewInputVisible(node);
            const xWidget = findWidget(node, "图片X");
            const yWidget = findWidget(node, "图片Y");
            const colorWidget = findWidget(node, "背景颜色");
            const rect = layerPreviewRect(node, widgetWidth, y, widget.last_height);
            const {areaX, areaY, areaW, areaH, layerW, layerH} = rect;
            const centerX = areaX + areaW / 2;
            const centerY = areaY + areaH / 2;
            const px = rect.centerX;
            const py = rect.centerY;

            ctx.save();
            ctx.fillStyle = colorWidget?.value || "#FFFFFF";
            ctx.strokeStyle = "#777";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect?.(areaX, areaY, areaW, areaH, 6);
            if (!ctx.roundRect) {
                ctx.rect(areaX, areaY, areaW, areaH);
            }
            ctx.fill();
            ctx.stroke();

            drawInputImagePreview(ctx, node, rect);

            const snappedX = Math.abs((Number(xWidget?.value ?? 50)) - 50) <= SNAP_DISTANCE;
            const snappedY = Math.abs((Number(yWidget?.value ?? 50)) - 50) <= SNAP_DISTANCE;
            if (snappedX || snappedY) {
                ctx.strokeStyle = "#4da3ff";
                ctx.setLineDash([5, 4]);
                if (snappedX) {
                    ctx.beginPath();
                    ctx.moveTo(centerX, areaY);
                    ctx.lineTo(centerX, areaY + areaH);
                    ctx.stroke();
                }
                if (snappedY) {
                    ctx.beginPath();
                    ctx.moveTo(areaX, centerY);
                    ctx.lineTo(areaX + areaW, centerY);
                    ctx.stroke();
                }
                ctx.setLineDash([]);
            }

            ctx.save();
            ctx.globalAlpha = inputVisible ? 1 : 0;
            ctx.beginPath();
            ctx.rect(areaX, areaY, areaW, areaH);
            ctx.clip();
            ctx.fillStyle = "rgba(40, 120, 255, 0.07)";
            ctx.strokeStyle = "#2878ff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(px - layerW / 2, py - layerH / 2, layerW, layerH);
            ctx.fill();
            ctx.stroke();
            for (const handle of visibleResizeHandles(rect)) {
                ctx.fillStyle = "#FFFFFF";
                ctx.strokeStyle = "#2878ff";
                ctx.lineWidth = 1.5;
                ctx.fillRect(
                    handle.displayX - RESIZE_HANDLE_SIZE / 2,
                    handle.displayY - RESIZE_HANDLE_SIZE / 2,
                    RESIZE_HANDLE_SIZE,
                    RESIZE_HANDLE_SIZE,
                );
                ctx.strokeRect(
                    handle.displayX - RESIZE_HANDLE_SIZE / 2,
                    handle.displayY - RESIZE_HANDLE_SIZE / 2,
                    RESIZE_HANDLE_SIZE,
                    RESIZE_HANDLE_SIZE,
                );
            }
            ctx.restore();
            ctx.globalAlpha = 1;
            ctx.fillStyle = "#111";
            ctx.font = "11px sans-serif";
            ctx.fillText("拖动移动 · 四角缩放", areaX + 8, areaY + 18);
            drawSavedDrawingPreview(ctx, node, areaX, areaY, areaW, areaH);
            ctx.restore();
        },
        mouse(event, pos, node) {
            const xWidget = findWidget(node, "图片X");
            const yWidget = findWidget(node, "图片Y");
            const rect = layerPreviewRect(
                node,
                node.size?.[0] || 420,
                widget.last_y || 0,
                widget.last_height || POSITION_WIDGET_MIN_HEIGHT,
            );
            const {areaX, areaY, areaW, areaH, layerW, layerH} = rect;
            const isDown = event.type === "pointerdown" || event.type === "mousedown";
            const isUp = event.type === "pointerup" || event.type === "mouseup";

            if (isDown) {
                const handle = hitResizeHandle(rect, pos[0], pos[1]);
                interaction = handle
                    ? {type: "resize", handle, aspectRatio: layerW / layerH}
                    : {type: "move"};
            }
            if (isUp) {
                interaction = null;
                return true;
            }
            if (!interaction) {
                return false;
            }

            if (interaction.type === "resize") {
                const resized = resizeLayerFromCorner({
                    pointerX: pos[0],
                    pointerY: pos[1],
                    anchorX: interaction.handle.anchorX,
                    anchorY: interaction.handle.anchorY,
                    signX: interaction.handle.signX,
                    signY: interaction.handle.signY,
                    aspectRatio: interaction.aspectRatio,
                    areaX,
                    areaY,
                    areaWidth: areaW,
                    areaHeight: areaH,
                });
                setScaleFromPreview(node, resized.width, resized.height, areaW, areaH);
                setWidgetValue(xWidget, Number(((resized.centerX - areaX) / areaW * 100).toFixed(1)), node);
                setWidgetValue(yWidget, Number(((resized.centerY - areaY) / areaH * 100).toFixed(1)), node);
                app.graph.setDirtyCanvas(true, true);
                return true;
            }

            const xLimits = axisPercentLimits(areaW, layerW);
            const yLimits = axisPercentLimits(areaH, layerH);
            let nextX = ((pos[0] - areaX) / areaW) * 100;
            let nextY = ((pos[1] - areaY) / areaH) * 100;
            if (Math.abs(nextX - 50) <= SNAP_DISTANCE) {
                nextX = 50;
            }
            if (Math.abs(nextY - 50) <= SNAP_DISTANCE) {
                nextY = 50;
            }
            nextX = Math.max(xLimits.min, Math.min(xLimits.max, nextX));
            nextY = Math.max(yLimits.min, Math.min(yLimits.max, nextY));
            setWidgetValue(xWidget, Number(nextX.toFixed(1)), node);
            setWidgetValue(yWidget, Number(nextY.toFixed(1)), node);
            app.graph.setDirtyCanvas(true, true);
            return true;
        },
        computeSize(width) {
            return [width || node.size?.[0] || 360, preferredPreviewHeight(node, width)];
        },
        computeLayoutSize(ownerNode) {
            const height = preferredPreviewHeight(ownerNode, ownerNode.size?.[0]);
            return {minHeight: height, maxHeight: height, minWidth: 0};
        },
    };

    node.widgets.push(widget);
    node.setSize?.([
        Math.max(node.size?.[0] || 320, 360),
        (node.size?.[1] || 300) + preferredPreviewHeight(node, node.size?.[0]),
    ]);
}

function repairInflatedCanvasNode(node) {
    if (node.__jindouyunCanvasSizeRepairPending || !node.computeSize) return;
    node.__jindouyunCanvasSizeRepairPending = true;
    window.requestAnimationFrame(() => {
        node.__jindouyunCanvasSizeRepairPending = false;
        const minimum = node.computeSize?.();
        const minimumHeight = Number(minimum?.[1] || 0);
        const currentHeight = Number(node.size?.[1] || 0);
        if (!Number.isFinite(minimumHeight) || !Number.isFinite(currentHeight)) return;
        const runawayThreshold = Math.max(minimumHeight * 2, minimumHeight + 800);
        if (currentHeight > runawayThreshold) {
            node.setSize?.([Math.max(360, Number(node.size?.[0] || 360)), minimumHeight]);
            node.setDirtyCanvas?.(true, true);
        }
    });
}

function patchCanvasNode(node) {
    if ((node.comfyClass || node.type) !== NODE_TYPE) {
        return;
    }
    patchRotationWidget(node);
    patchColorWidget(node);
    addColorPickerDomWidget(node);
    patchRatioWidgets(node);
    patchScaleWidgets(node);
    patchImageInputRatio(node);
    addPositionWidget(node);
    repairInflatedCanvasNode(node);
}

app.registerExtension({
    name: "comfyui-jindouyun-design.canvas-composite",

    nodeCreated(node) {
        patchCanvasNode(node);
    },

    loadedGraphNode(node) {
        patchCanvasNode(node);
    },

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) {
            return;
        }

        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            patchCanvasNode(this);
        };
    },
});
