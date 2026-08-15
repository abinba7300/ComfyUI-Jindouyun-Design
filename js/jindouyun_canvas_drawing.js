import { app } from "../../scripts/app.js";
import * as canvasGeometry from "./jindouyun_canvas_geometry.mjs?v=20260815-canvas-overflow1";

const {
    normalizeScaleMode,
    resolveDraggedLayerPosition,
    resolveLayerSize,
    SCALE_MODE_MANUAL,
} = canvasGeometry;

const smoothStrokePoints = canvasGeometry.smoothStrokePoints || ((points) => (points || []).map((point) => [...point]));
const smoothDrawingStrokes = canvasGeometry.smoothDrawingStrokes || ((strokes) => ({
    strokes: structuredClone(strokes || []),
    optimizedCount: 0,
}));
const resolveSmoothingProfile = canvasGeometry.resolveSmoothingProfile || (() => ({strength: 0.95, passes: 3}));
const translateStrokeLayer = canvasGeometry.translateStrokeLayer || ((stroke) => structuredClone(stroke));
const drawingGroupBounds = canvasGeometry.drawingGroupBounds || (() => null);
const transformDrawingGroup = canvasGeometry.transformDrawingGroup || ((strokes) => structuredClone(strokes || []));
const createShapeStrokePoints = canvasGeometry.createShapeStrokePoints || (() => []);
const regularizeStrokePoints = canvasGeometry.regularizeStrokePoints || (() => null);
const scaleDrawingStrokes = canvasGeometry.scaleDrawingStrokes || ((strokes) => ({
    scale: 1,
    centerX: 0.5,
    centerY: 0.5,
    strokes: structuredClone(strokes || []),
}));

const normalizeRotationDegrees = canvasGeometry.normalizeRotationDegrees || ((value) => {
    const degrees = Number(value);
    return Number.isFinite(degrees) ? ((degrees + 180) % 360 + 360) % 360 - 180 : 0;
});

const resolveRotatedBounds = canvasGeometry.resolveRotatedBounds || ((width, height, rotationDegrees) => {
    const radians = normalizeRotationDegrees(rotationDegrees) * Math.PI / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    return {
        width: Math.max(1, Math.ceil(width * cosine + height * sine - 1e-6)),
        height: Math.max(1, Math.ceil(width * sine + height * cosine - 1e-6)),
    };
});

const NODE_TYPE = "JindouyunCanvasComposite";
const DEFAULT_DATA = {version: 7, smoothing: true, smoothingStrength: 50, smartRegularize: false, regularizeSensitivity: 50, brushColor: "#FF6A00", eyedropperColor: "#FF6A00", savedColors: [], brushType: "solid", inputVisible: true, groups: [], strokes: []};
const COLOR_PRESETS = [
    ["金色", "#D4AF37"],
    ["银色", "#C0C0C0"],
    ["黑色", "#111111"],
    ["白色", "#FFFFFF"],
    ["灰色", "#808080"],
    ["蓝色", "#2387FF"],
    ["橙色", "#FF6A00"],
    ["咖啡色", "#6F4E37"],
    ["绿色", "#34A853"],
];
const COLORS = COLOR_PRESETS.map(([, color]) => color);
const LASSO_CLOSE_DISTANCE = 24;
const BRUSH_COLOR_STORAGE_KEY = "jindouyun.canvas.brushColor";
const EYEDROPPER_COLOR_STORAGE_KEY = "jindouyun.canvas.eyedropperColor";
const SAVED_COLORS_STORAGE_KEY = "jindouyun.canvas.savedColors";
const MAX_SAVED_COLORS = 20;

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function isWidgetEnabled(widget) {
    const value = widget?.value;
    return value !== false && value !== 0 && String(value).toLowerCase() !== "false";
}

function setWidgetValue(widget, value, node) {
    if (!widget) {
        return;
    }
    widget.value = value;
    widget.callback?.(value, app.canvas, node, widget);
    app.graph.setDirtyCanvas(true, true);
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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function clampLayerOffset(value, canvasSize, layerSize) {
    if (layerSize <= canvasSize) {
        return clamp(value, 0, canvasSize - layerSize);
    }
    return clamp(value, canvasSize - layerSize, 0);
}

function normalizeColor(value, fallback = "#FF6A00") {
    const match = String(value || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
    return match ? `#${match[1].toUpperCase()}` : fallback;
}

function rgbaToHex(red, green, blue) {
    const hex = [red, green, blue]
        .map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, "0"))
        .join("");
    return `#${hex.toUpperCase()}`;
}

function preferredBrushColor(node, drawing) {
    try {
        const stored = window.localStorage?.getItem(BRUSH_COLOR_STORAGE_KEY);
        if (stored) return normalizeColor(stored);
    } catch (_) {
        // Browser privacy settings can disable local storage.
    }
    return normalizeColor(node.__jindouyunBrushColor || drawing.brushColor || "#FF6A00");
}

function rememberBrushColor(node, drawing, color) {
    const normalized = normalizeColor(color);
    drawing.brushColor = normalized;
    node.__jindouyunBrushColor = normalized;
    try {
        window.localStorage?.setItem(BRUSH_COLOR_STORAGE_KEY, normalized);
    } catch (_) {
        // Keep the node-local preference when local storage is unavailable.
    }
    return normalized;
}

function preferredEyedropperColor(node, drawing, fallback) {
    try {
        const stored = window.localStorage?.getItem(EYEDROPPER_COLOR_STORAGE_KEY);
        if (stored) return normalizeColor(stored, fallback);
    } catch (_) {
        // Browser privacy settings can disable local storage.
    }
    return normalizeColor(node.__jindouyunEyedropperColor || drawing.eyedropperColor, fallback);
}

function rememberEyedropperColor(node, drawing, color) {
    const normalized = normalizeColor(color);
    drawing.eyedropperColor = normalized;
    node.__jindouyunEyedropperColor = normalized;
    try {
        window.localStorage?.setItem(EYEDROPPER_COLOR_STORAGE_KEY, normalized);
    } catch (_) {
        // Keep the node-local preference when local storage is unavailable.
    }
    return normalized;
}

function normalizeSavedColors(values) {
    const normalized = [];
    for (const value of Array.isArray(values) ? values : []) {
        const match = String(value || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
        if (!match) continue;
        const color = `#${match[1].toUpperCase()}`;
        if (COLORS.includes(color) || normalized.includes(color)) continue;
        normalized.push(color);
    }
    return normalized.slice(-MAX_SAVED_COLORS);
}

function preferredSavedColors(node, drawing) {
    let storedColors = [];
    try {
        storedColors = JSON.parse(window.localStorage?.getItem(SAVED_COLORS_STORAGE_KEY) || "[]");
    } catch (_) {
        // Browser privacy settings can disable local storage.
    }
    return normalizeSavedColors([
        ...(drawing.savedColors || []),
        ...(node.__jindouyunSavedColors || []),
        ...storedColors,
    ]);
}

function rememberSavedColors(node, drawing, colors) {
    const normalized = normalizeSavedColors(colors);
    drawing.savedColors = normalized;
    node.__jindouyunSavedColors = normalized;
    try {
        window.localStorage?.setItem(SAVED_COLORS_STORAGE_KEY, JSON.stringify(normalized));
    } catch (_) {
        // Keep the node-local colors when local storage is unavailable.
    }
    return normalized;
}

function parseDrawingData(value) {
    try {
        const parsed = JSON.parse(String(value || ""));
        if (parsed && Array.isArray(parsed.strokes)) {
            const strokes = structuredClone(parsed.strokes).filter((stroke) => {
                if (stroke?.tool !== "lasso") {
                    return true;
                }
                if (!Array.isArray(stroke.points) || stroke.points.length < 3) {
                    return false;
                }
                const first = stroke.points[0];
                const last = stroke.points[stroke.points.length - 1];
                const closeDistance = Math.hypot(Number(last[0]) - Number(first[0]), Number(last[1]) - Number(first[1]));
                if (!Number.isFinite(closeDistance) || closeDistance > 0.03) {
                    return false;
                }
                stroke.points[stroke.points.length - 1] = [...first];
                return true;
            });
            const parsedVersion = Number(parsed.version) || 1;
            const storedStrength = Number(parsed.smoothingStrength);
            const smoothingStrength = parsedVersion >= 4
                ? clamp(Number.isFinite(storedStrength) ? storedStrength : 50, 0, 100)
                : Number.isFinite(storedStrength)
                    ? clamp((storedStrength - 10) * 50 / 85, 0, 100)
                    : 50;
            const groups = Array.isArray(parsed.groups) ? structuredClone(parsed.groups) : [];
            const hiddenGroups = new Set(groups.filter((group) => group?.visible === false).map((group) => group.id));
            for (const stroke of strokes) {
                if (hiddenGroups.has(stroke?.groupId)) stroke.groupVisible = false;
            }
            return {
                version: 7,
                smoothing: parsed.smoothing !== false,
                smoothingStrength,
                smartRegularize: parsed.smartRegularize === true,
                regularizeSensitivity: clamp(parsed.regularizeSensitivity ?? 50, 0, 100),
                brushColor: normalizeColor(parsed.brushColor || "#FF6A00"),
                eyedropperColor: normalizeColor(parsed.eyedropperColor || parsed.brushColor || "#FF6A00"),
                savedColors: normalizeSavedColors(parsed.savedColors),
                brushType: parsed.brushType === "pencil" ? "pencil" : "solid",
                inputVisible: parsed.inputVisible !== false,
                groups,
                strokes,
            };
        }
    } catch (_) {
        // Invalid legacy values start with an empty drawing.
    }
    return structuredClone(DEFAULT_DATA);
}

function hideDrawingWidget(node) {
    const widget = findWidget(node, "绘画数据");
    if (!widget || widget.__jindouyunDrawingHidden) {
        return;
    }
    widget.__jindouyunDrawingHidden = true;
    widget.hidden = true;
    widget.draw = function() {};
    widget.mouse = function() { return false; };
    widget.computeSize = function() { return [0, 0]; };
}

function makeButton(label, title = label) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    Object.assign(button.style, {
        height: "34px",
        padding: "0 13px",
        border: "1px solid #3f4650",
        borderRadius: "5px",
        background: "#252a31",
        color: "#f5f7fa",
        font: "13px system-ui, sans-serif",
        cursor: "pointer",
        whiteSpace: "nowrap",
    });
    return button;
}

function decorateIconButton(button, icon, label) {
    button.textContent = "";
    const iconElement = document.createElement("span");
    iconElement.textContent = icon;
    Object.assign(iconElement.style, {fontSize: "22px", lineHeight: "22px", fontWeight: "700"});
    const labelElement = document.createElement("span");
    labelElement.textContent = label;
    Object.assign(labelElement.style, {fontSize: "12px", lineHeight: "14px"});
    button.append(iconElement, labelElement);
    Object.assign(button.style, {
        height: "56px", padding: "5px 7px", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: "4px", boxSizing: "border-box",
    });
}

function setActive(button, active, color = "#FF6A00") {
    button.style.background = active ? color : "#252a31";
    button.style.borderColor = active ? color : "#3f4650";
    button.style.color = active && color === "#FFFFFF" ? "#111111" : "#FFFFFF";
}

function getCanvasSize(node) {
    const width = Math.max(1, Number(findWidget(node, "画布宽度")?.value || 1024));
    let height = Math.max(1, Number(findWidget(node, "画布高度")?.value || 1024));
    const preset = String(findWidget(node, "画布比例")?.value || "自定义");
    if (preset !== "自定义" && preset.includes(":")) {
        const [rw, rh] = preset.split(":").map(Number);
        if (rw > 0 && rh > 0) {
            height = Math.max(1, Math.round(width * rh / rw));
        }
    }
    return {width, height};
}

function getSourceImage(node) {
    const imageInput = node.inputs?.find((input) => input.name === "图像");
    const link = imageInput?.link != null ? app.graph.links[imageInput.link] : null;
    const origin = link ? app.graph.getNodeById(link.origin_id) : null;
    return origin?.imgs?.[0] || origin?.image || origin?.preview || null;
}

function canvasBlendMode(mode) {
    const supported = new Set([
        "multiply", "screen", "overlay", "darken", "lighten", "color-dodge",
        "color-burn", "hard-light", "soft-light", "difference", "exclusion",
        "hue", "saturation", "color", "luminosity",
    ]);
    const normalized = String(mode || "normal").replaceAll(" ", "-");
    return supported.has(normalized) ? normalized : "source-over";
}

function getSourceImageLayout(node, displayWidth, displayHeight) {
    const source = getSourceImage(node);
    const sourceWidth = source?.naturalWidth || source?.videoWidth || source?.width;
    const sourceHeight = source?.naturalHeight || source?.videoHeight || source?.height;
    if (!source || !sourceWidth || !sourceHeight) {
        return null;
    }

    const mode = normalizeScaleMode(findWidget(node, "缩放方式")?.value);
    const {width: outputWidth, height: outputHeight} = getCanvasSize(node);
    const target = resolveLayerSize({
        imageWidth: sourceWidth,
        imageHeight: sourceHeight,
        canvasWidth: outputWidth,
        canvasHeight: outputHeight,
        scale: findWidget(node, "图片缩放")?.value,
        scaleMode: mode,
        canvasPercent: findWidget(node, "画布占比")?.value,
    });
    const outputTargetWidth = Math.max(1, Math.round(target.width));
    const outputTargetHeight = Math.max(1, Math.round(target.height));
    const rotation = normalizeRotationDegrees(findWidget(node, "图片旋转")?.value);
    const outputBounds = resolveRotatedBounds(outputTargetWidth, outputTargetHeight, rotation);
    const targetWidth = outputTargetWidth * displayWidth / outputWidth;
    const targetHeight = outputTargetHeight * displayHeight / outputHeight;
    const boundsWidth = outputBounds.width * displayWidth / outputWidth;
    const boundsHeight = outputBounds.height * displayHeight / outputHeight;

    const xPercent = Number(findWidget(node, "图片X")?.value ?? 50) / 100;
    const yPercent = Number(findWidget(node, "图片Y")?.value ?? 50) / 100;
    const left = clampLayerOffset(displayWidth * xPercent - boundsWidth / 2, displayWidth, boundsWidth);
    const top = clampLayerOffset(displayHeight * yPercent - boundsHeight / 2, displayHeight, boundsHeight);

    return {
        source,
        left,
        top,
        width: boundsWidth,
        height: boundsHeight,
        drawWidth: targetWidth,
        drawHeight: targetHeight,
        rotation,
        centerX: left + boundsWidth / 2,
        centerY: top + boundsHeight / 2,
    };
}

function drawSourceImage(ctx, node, displayWidth, displayHeight) {
    if (node.__jindouyunInputVisible === false) {
        return;
    }
    const layout = getSourceImageLayout(node, displayWidth, displayHeight);
    if (!layout) {
        return;
    }

    ctx.save();
    ctx.globalAlpha = clamp(findWidget(node, "透明度")?.value ?? 1, 0, 1);
    ctx.globalCompositeOperation = canvasBlendMode(findWidget(node, "混合模式")?.value);
    try {
        ctx.translate(layout.centerX, layout.centerY);
        ctx.rotate(layout.rotation * Math.PI / 180);
        ctx.drawImage(layout.source, -layout.drawWidth / 2, -layout.drawHeight / 2, layout.drawWidth, layout.drawHeight);
    } catch (_) {
        // A source preview may not be drawable until its first ComfyUI execution.
    }
    ctx.restore();
}

function drawSingleStroke(ctx, stroke, width, height, preview = false) {
    const points = stroke.points || [];
    if (!points.length) {
        return;
    }
    const pixelPoints = points.map((point) => [
        clamp(point[0], -20, 20) * Math.max(0, width - 1),
        clamp(point[1], -20, 20) * Math.max(0, height - 1),
    ]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = normalizeColor(stroke.color);
    ctx.fillStyle = normalizeColor(stroke.color);
    ctx.lineWidth = Math.max(1, Number(stroke.size || 0.02) * Math.min(width, height));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (stroke.tool === "brush" && stroke.brushType === "pencil" && !stroke.shape) {
        drawPencilStroke(ctx, pixelPoints, ctx.lineWidth);
        ctx.restore();
        return;
    }
    ctx.beginPath();
    ctx.moveTo(pixelPoints[0][0], pixelPoints[0][1]);
    for (let index = 1; index < pixelPoints.length; index += 1) {
        ctx.lineTo(pixelPoints[index][0], pixelPoints[index][1]);
    }
    if (stroke.tool === "lasso") {
        if (!preview || (stroke.canClose && points.length >= 3)) {
            ctx.closePath();
        }
        if (preview && stroke.canClose && points.length >= 3) {
            ctx.fillStyle = "#20E070";
            ctx.globalAlpha = 0.3;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.setLineDash([8, 6]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#39FF88";
            ctx.stroke();
        } else if (preview) {
            ctx.setLineDash([8, 6]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#39FF88";
            ctx.stroke();
        } else if (!preview && points.length >= 3) {
            ctx.fill();
        }
        if (preview) {
            ctx.setLineDash([]);
            ctx.fillStyle = stroke.canClose ? "#39FF88" : "#101318";
            ctx.strokeStyle = "#39FF88";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(pixelPoints[0][0], pixelPoints[0][1], 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    } else if (points.length === 1) {
        ctx.arc(pixelPoints[0][0], pixelPoints[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.stroke();
    }
    ctx.restore();
}

function pencilNoise(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return (value - Math.floor(value)) - 0.5;
}

function pencilPointNormal(points, index) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next[0] - previous[0];
    const dy = next[1] - previous[1];
    const length = Math.hypot(dx, dy) || 1;
    return [-dy / length, dx / length];
}

function drawPencilStroke(ctx, pixelPoints, lineWidth) {
    const seed = pixelPoints.reduce((total, point, index) => total + point[0] * 0.017 + point[1] * 0.031 + index * 7.13, 11.7);
    ctx.globalAlpha = 0.08;
    ctx.lineWidth = Math.max(0.7, lineWidth * 0.82);
    if (pixelPoints.length === 1) {
        ctx.beginPath();
        ctx.arc(pixelPoints[0][0], pixelPoints[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
    }

    ctx.beginPath();
    ctx.moveTo(pixelPoints[0][0], pixelPoints[0][1]);
    for (let index = 1; index < pixelPoints.length; index += 1) ctx.lineTo(pixelPoints[index][0], pixelPoints[index][1]);
    ctx.stroke();

    const normals = pixelPoints.map((_, index) => pencilPointNormal(pixelPoints, index));
    const fiberCount = Math.round(clamp(lineWidth * 0.8, 3, 15));
    for (let fiberIndex = 0; fiberIndex < fiberCount; fiberIndex += 1) {
        const fiberNoise = pencilNoise(seed + fiberIndex * 17.37) + 0.5;
        const offset = ((fiberIndex + 0.5) / fiberCount - 0.5) * lineWidth * 0.88;
        const fiberPoints = pixelPoints.map((point, index) => {
            const localOffset = offset + pencilNoise(seed + fiberIndex * 29.1 + index * 4.7) * lineWidth * 0.07;
            return [point[0] + normals[index][0] * localOffset, point[1] + normals[index][1] * localOffset];
        });
        ctx.globalAlpha = 0.18 + fiberNoise * 0.34;
        ctx.lineWidth = Math.max(0.45, lineWidth * (0.035 + fiberNoise * 0.045));
        ctx.setLineDash([
            Math.max(4, lineWidth * (1.4 + fiberNoise * 2.2)),
            Math.max(1, lineWidth * (0.10 + (1 - fiberNoise) * 0.24)),
        ]);
        ctx.lineDashOffset = pencilNoise(seed + fiberIndex * 41.9) * lineWidth * 2;
        ctx.beginPath();
        ctx.moveTo(fiberPoints[0][0], fiberPoints[0][1]);
        for (let index = 1; index < fiberPoints.length; index += 1) ctx.lineTo(fiberPoints[index][0], fiberPoints[index][1]);
        ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
}

function drawStroke(ctx, stroke, width, height, preview = false) {
    if (stroke?.visible === false || stroke?.groupVisible === false) {
        return;
    }
    drawSingleStroke(ctx, stroke, width, height, preview);
    if (Array.isArray(stroke?.mirrorPoints)) {
        drawSingleStroke(ctx, {...stroke, mirrorX: false, points: stroke.mirrorPoints}, width, height, preview);
    } else if (stroke?.mirrorX === true) {
        drawSingleStroke(ctx, {
            ...stroke,
            mirrorX: false,
            points: (stroke.points || []).map((point) => [1 - Number(point[0]), Number(point[1])]),
        }, width, height, preview);
    }
}

function strokePixelPointSets(stroke, width, height) {
    const primary = (stroke?.points || []).map((point) => [
        clamp(point?.[0], -20, 20) * Math.max(0, width - 1),
        clamp(point?.[1], -20, 20) * Math.max(0, height - 1),
    ]);
    const sets = [primary];
    if (Array.isArray(stroke?.mirrorPoints)) {
        sets.push(stroke.mirrorPoints.map((point) => [
            clamp(point?.[0], -20, 20) * Math.max(0, width - 1),
            clamp(point?.[1], -20, 20) * Math.max(0, height - 1),
        ]));
    } else if (stroke?.mirrorX === true) {
        sets.push(primary.map((point) => [Math.max(0, width - 1) - point[0], point[1]]));
    }
    return sets;
}

function strokeVisibilityGuideColor(stroke) {
    const color = normalizeColor(stroke?.color, "#111111");
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    const luminance = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
    const pencil = stroke?.brushType === "pencil";
    if (luminance < 0.55) {
        return pencil ? "rgba(210, 232, 255, 0.66)" : "rgba(210, 232, 255, 0.92)";
    }
    return pencil ? "rgba(4, 10, 18, 0.62)" : "rgba(4, 10, 18, 0.88)";
}

function paintStrokeVisibilityShape(ctx, points, lineWidth) {
    if (!points.length) {
        return;
    }
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    if (points.length === 1) {
        ctx.arc(points[0][0], points[0][1], lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    ctx.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
        ctx.lineTo(points[index][0], points[index][1]);
    }
    ctx.stroke();
}

function drawStrokeVisibilityGuide(ctx, stroke, width, height) {
    if (stroke?.visible === false || stroke?.groupVisible === false || stroke?.tool !== "brush") {
        return;
    }
    const pointSets = strokePixelPointSets(stroke, width, height);
    const baseWidth = Math.max(1, Number(stroke.size || 0.02) * Math.min(width, height));
    const pencil = stroke?.brushType === "pencil";
    const guideThickness = clamp(baseWidth * (pencil ? 0.22 : 0.32), 2.5, pencil ? 5.5 : 8);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = strokeVisibilityGuideColor(stroke);
    ctx.fillStyle = strokeVisibilityGuideColor(stroke);
    for (const points of pointSets) {
        paintStrokeVisibilityShape(ctx, points, baseWidth + guideThickness * 2);
    }

    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0, 0, 0, 1)";
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    for (const points of pointSets) {
        paintStrokeVisibilityShape(ctx, points, baseWidth + 0.5);
    }
    ctx.restore();
}

function drawStrokeVisibilityGuides(targetContext, strokes, width, height, guideCanvas) {
    if (guideCanvas.width !== width || guideCanvas.height !== height) {
        guideCanvas.width = width;
        guideCanvas.height = height;
    }
    const guideContext = guideCanvas.getContext("2d");
    guideContext.clearRect(0, 0, width, height);
    for (const stroke of strokes) {
        drawStrokeVisibilityGuide(guideContext, stroke, width, height);
    }
    targetContext.drawImage(guideCanvas, 0, 0);
}

function pointSegmentDistance(x, y, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) {
        return Math.hypot(x - start[0], y - start[1]);
    }
    const amount = clamp(((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared, 0, 1);
    return Math.hypot(x - (start[0] + amount * dx), y - (start[1] + amount * dy));
}

function pointInsidePolygon(x, y, points) {
    let inside = false;
    for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
        const a = points[current];
        const b = points[previous];
        const crosses = (a[1] > y) !== (b[1] > y) &&
            x < (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 1e-9) + a[0];
        if (crosses) inside = !inside;
    }
    return inside;
}

function hitTestStroke(stroke, x, y, width, height) {
    const tolerance = Math.max(10, Number(stroke?.size || 0.02) * Math.min(width, height) / 2 + 7);
    for (const points of strokePixelPointSets(stroke, width, height)) {
        if (!points.length) continue;
        if (stroke?.tool === "lasso" && points.length >= 3 && pointInsidePolygon(x, y, points)) {
            return true;
        }
        if (points.length === 1 && Math.hypot(x - points[0][0], y - points[0][1]) <= tolerance) {
            return true;
        }
        for (let index = 1; index < points.length; index += 1) {
            if (pointSegmentDistance(x, y, points[index - 1], points[index]) <= tolerance) {
                return true;
            }
        }
    }
    return false;
}

function drawStrokeSelection(ctx, stroke, width, height) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#39FF88";
    ctx.lineWidth = Math.max(3, Number(stroke?.size || 0.02) * Math.min(width, height) + 5);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([9, 6]);
    for (const points of strokePixelPointSets(stroke, width, height)) {
        if (!points.length) continue;
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (let index = 1; index < points.length; index += 1) {
            ctx.lineTo(points[index][0], points[index][1]);
        }
        if (stroke?.tool === "lasso") ctx.closePath();
        if (points.length === 1) {
            ctx.arc(points[0][0], points[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        }
        ctx.stroke();
    }
    ctx.restore();
}

function normalizedRect(start, end) {
    return {
        minX: Math.min(start[0], end[0]),
        minY: Math.min(start[1], end[1]),
        maxX: Math.max(start[0], end[0]),
        maxY: Math.max(start[1], end[1]),
    };
}

function groupBoxPixels(bounds, width, height) {
    return {
        left: bounds.minX * width,
        top: bounds.minY * height,
        right: bounds.maxX * width,
        bottom: bounds.maxY * height,
    };
}

function groupResizeHandles(bounds, width, height) {
    const box = groupBoxPixels(bounds, width, height);
    return [
        {name: "nw", x: box.left, y: box.top, anchorX: bounds.maxX, anchorY: bounds.maxY},
        {name: "ne", x: box.right, y: box.top, anchorX: bounds.minX, anchorY: bounds.maxY},
        {name: "se", x: box.right, y: box.bottom, anchorX: bounds.minX, anchorY: bounds.minY},
        {name: "sw", x: box.left, y: box.bottom, anchorX: bounds.maxX, anchorY: bounds.minY},
    ];
}

function hitGroupHandle(bounds, pointerX, pointerY, width, height) {
    return groupResizeHandles(bounds, width, height).find((handle) =>
        Math.hypot(pointerX - handle.x, pointerY - handle.y) <= 13
    ) || null;
}

function pointInGroupBounds(bounds, point) {
    return point[0] >= bounds.minX && point[0] <= bounds.maxX &&
        point[1] >= bounds.minY && point[1] <= bounds.maxY;
}

function drawGroupBox(ctx, bounds, width, height, draft = false) {
    const box = groupBoxPixels(bounds, width, height);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = draft ? "#39FF88" : "#2387FF";
    ctx.fillStyle = draft ? "rgba(57,255,136,0.10)" : "rgba(35,135,255,0.08)";
    ctx.lineWidth = 2;
    ctx.setLineDash(draft ? [7, 5] : [10, 6]);
    ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    ctx.setLineDash([]);
    if (!draft) {
        for (const handle of groupResizeHandles(bounds, width, height)) {
            ctx.fillStyle = "#FFFFFF";
            ctx.strokeStyle = "#2387FF";
            ctx.lineWidth = 3;
            ctx.fillRect(handle.x - 6, handle.y - 6, 12, 12);
            ctx.strokeRect(handle.x - 6, handle.y - 6, 12, 12);
        }
    }
    ctx.restore();
}

function layerTransformHandles(bounds, width, height) {
    const box = groupBoxPixels(bounds, width, height);
    return {
        corners: groupResizeHandles(bounds, width, height),
        rotate: {x: (box.left + box.right) / 2, y: box.top - 24},
    };
}

function hitLayerTransformHandle(bounds, pointerX, pointerY, width, height) {
    const handles = layerTransformHandles(bounds, width, height);
    for (const handle of handles.corners) {
        if (Math.hypot(pointerX - handle.x, pointerY - handle.y) <= 14) {
            return {...handle, mode: "scale"};
        }
    }
    if (Math.hypot(pointerX - handles.rotate.x, pointerY - handles.rotate.y) <= 14) {
        return {...handles.rotate, mode: "rotate"};
    }
    return null;
}

function drawLayerTransformBox(ctx, bounds, width, height) {
    const box = groupBoxPixels(bounds, width, height);
    const handles = layerTransformHandles(bounds, width, height);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#58A6FF";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo((box.left + box.right) / 2, box.top);
    ctx.lineTo(handles.rotate.x, handles.rotate.y);
    ctx.stroke();
    for (const handle of handles.corners) {
        ctx.fillStyle = "#FFFFFF";
        ctx.strokeStyle = "#2387FF";
        ctx.lineWidth = 3;
        ctx.fillRect(handle.x - 6, handle.y - 6, 12, 12);
        ctx.strokeRect(handle.x - 6, handle.y - 6, 12, 12);
    }
    ctx.beginPath();
    ctx.arc(handles.rotate.x, handles.rotate.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function openDrawingEditor(node) {
    const dataWidget = findWidget(node, "绘画数据");
    const includeInputWidget = findWidget(node, "输出输入图像");
    const rotationWidget = findWidget(node, "图片旋转");
    if (!dataWidget || node.__jindouyunDrawingEditor) {
        return;
    }

    const drawing = parseDrawingData(dataWidget.value);
    node.__jindouyunInputVisible = drawing.inputVisible !== false;
    const undoStack = [];
    const redoStack = [];
    let tool = "brush";
    let brushColor = preferredBrushColor(node, drawing);
    let eyedropperColor = preferredEyedropperColor(node, drawing, brushColor);
    let savedColors = preferredSavedColors(node, drawing);
    let brushType = drawing.brushType === "pencil" ? "pencil" : "solid";
    let fillColor = "#FFFFFF";
    let brushSize = 10;
    let queueCount = Math.round(clamp(node.__jindouyunQueueCount ?? 1, 1, 999));
    let mirrorEnabled = node.__jindouyunMirrorEnabled === true;
    let smoothingEnabled = drawing.smoothing !== false;
    let smoothingStrength = clamp(drawing.smoothingStrength ?? 50, 0, 100);
    let smartRegularizeEnabled = drawing.smartRegularize === true;
    let regularizeSensitivity = clamp(drawing.regularizeSensitivity ?? 50, 0, 100);
    let drawingScale = 1;
    let currentStroke = null;
    let currentStrokeHasHistory = false;
    let eraserDrag = null;
    let imageDrag = null;
    let selectedStrokeIndex = -1;
    let strokeDrag = null;
    let groupSelection = null;
    let groupDraft = null;
    let groupDrag = null;
    let selectedGroupId = null;
    let selectionAnchorIndex = -1;
    let shapeType = "circle";
    let shapeSides = 6;
    let shapeDraft = null;

    const overlay = document.createElement("div");
    node.__jindouyunDrawingEditor = overlay;
    overlay.tabIndex = -1;
    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "100000",
        display: "grid",
        gridTemplateRows: "minmax(0, 1fr) 42px",
        gridTemplateColumns: "minmax(0, 1fr)",
        background: "#121519",
        color: "#F6F7F9",
        fontFamily: "system-ui, sans-serif",
    });

    const toolbar = document.createElement("div");
    Object.assign(toolbar.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "8px",
        padding: "12px 10px",
        borderRight: "1px solid #323842",
        background: "#1B1F25",
        minWidth: "0",
        minHeight: "0",
        overflowY: "auto",
        overflowX: "hidden",
    });

    const title = document.createElement("strong");
    title.textContent = "筋斗云画布绘画";
    Object.assign(title.style, {fontSize: "15px", marginBottom: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"});

    const brushButton = makeButton("普通画笔", "使用平滑、均匀的普通画笔笔触");
    const pencilBrushButton = makeButton("铅笔质感", "使用带石墨纤维纹理的铅笔笔触");
    const eyedropperButton = makeButton("吸管", "点击画布吸取颜色并自动保存到画笔颜色");
    const moveImageButton = makeButton("移动图片", "自由拖动输入图并参考画布中心线对齐");
    const selectStrokeButton = makeButton("选择线条", "点击选择单笔曲线，拖动只移动这一笔");
    const eraserButton = makeButton("橡皮", "触碰绘画线条即可删除整笔，不影响输入图像");
    const lassoButton = makeButton("套索填充", "拖动圈出区域，松开后自动闭合并填充颜色");
    const shapeButton = makeButton("几何图形", "选择标准图形后在画布上从中心拖动创建");
    const undoButton = makeButton("撤销", "撤销 Ctrl+Z");
    const redoButton = makeButton("重做", "重做 Ctrl+Y");
    const clearButton = makeButton("清空", "清空全部涂鸦");

    const groupSelectButton = makeButton("整体图层", "框选多笔图层后，可拖动整体或拖角等比例缩放");

    decorateIconButton(brushButton, "●", "普通画笔");
    decorateIconButton(pencilBrushButton, "✎", "铅笔质感");
    decorateIconButton(eyedropperButton, "⌾", "颜色吸管");
    decorateIconButton(lassoButton, "⌁", "套索");
    decorateIconButton(undoButton, "↶", "撤销");
    decorateIconButton(redoButton, "↷", "重做");
    decorateIconButton(clearButton, "×", "清空");

    const shapeControl = document.createElement("div");
    Object.assign(shapeControl.style, {
        display: "flex", alignItems: "center", gap: "6px", height: "34px",
        padding: "0 6px 0 0", border: "1px solid #3F4650", borderRadius: "5px",
        background: "#252A31", color: "#F5F7FA", fontSize: "13px", whiteSpace: "nowrap",
    });
    Object.assign(shapeButton.style, {border: "0", borderRight: "1px solid #3F4650", borderRadius: "4px 0 0 4px"});
    const shapeSelect = document.createElement("select");
    for (const [value, label] of [["circle", "圆形"], ["square", "方形"], ["polygon", "多边形"], ["star", "星型"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        shapeSelect.appendChild(option);
    }
    Object.assign(shapeSelect.style, {
        height: "26px", border: "1px solid #59616D", borderRadius: "4px",
        background: "#15191E", color: "#FFFFFF", padding: "0 5px",
    });
    const shapeSidesLabel = document.createElement("label");
    Object.assign(shapeSidesLabel.style, {display: "none", alignItems: "center", gap: "4px"});
    const shapeSidesText = document.createElement("span");
    shapeSidesText.textContent = "顶点";
    const shapeSidesInput = document.createElement("input");
    shapeSidesInput.type = "number";
    shapeSidesInput.min = "3";
    shapeSidesInput.max = "12";
    shapeSidesInput.step = "1";
    shapeSidesInput.value = String(shapeSides);
    Object.assign(shapeSidesInput.style, {
        width: "42px", height: "26px", padding: "0 4px", border: "1px solid #59616D",
        borderRadius: "4px", background: "#15191E", color: "#FFFFFF", boxSizing: "border-box",
    });
    shapeSidesLabel.append(shapeSidesText, shapeSidesInput);
    shapeControl.append(shapeButton, shapeSelect, shapeSidesLabel);

    const rotationControl = document.createElement("div");
    Object.assign(rotationControl.style, {
        display: "flex", alignItems: "center", gap: "6px", height: "34px",
        padding: "0 8px", border: "1px solid #3F4650", borderRadius: "5px",
        background: "#252A31", color: "#F5F7FA", fontSize: "13px", whiteSpace: "nowrap",
    });
    const rotationText = document.createElement("span");
    rotationText.textContent = "旋转";
    const rotationRange = document.createElement("input");
    rotationRange.type = "range";
    rotationRange.min = "-180";
    rotationRange.max = "180";
    rotationRange.step = "0.1";
    rotationRange.value = String(clamp(rotationWidget?.value ?? 0, -180, 180));
    rotationRange.style.width = "110px";
    rotationRange.title = "拖动调整输入图片角度";
    const rotationNumber = document.createElement("input");
    rotationNumber.type = "number";
    rotationNumber.min = "-180";
    rotationNumber.max = "180";
    rotationNumber.step = "0.1";
    rotationNumber.value = Number(rotationRange.value).toFixed(1);
    Object.assign(rotationNumber.style, {
        width: "62px", height: "26px", padding: "0 5px", border: "1px solid #59616D",
        borderRadius: "4px", background: "#15191E", color: "#FFFFFF", boxSizing: "border-box",
    });
    const rotationUnit = document.createElement("span");
    rotationUnit.textContent = "°";
    const resetRotationButton = makeButton("归零", "旋转角度恢复为 0°");
    Object.assign(resetRotationButton.style, {height: "28px", padding: "0 8px"});
    rotationControl.append(rotationText, rotationRange, rotationNumber, rotationUnit, resetRotationButton);

    const outputToggleLabel = document.createElement("label");
    Object.assign(outputToggleLabel.style, {
        display: "flex", alignItems: "center", gap: "7px", padding: "0 9px",
        height: "34px", border: "1px solid #3F4650", borderRadius: "5px",
        background: "#252A31", color: "#F5F7FA", fontSize: "13px",
        whiteSpace: "nowrap", cursor: "pointer", boxSizing: "border-box",
    });
    const outputToggle = document.createElement("input");
    outputToggle.type = "checkbox";
    outputToggle.checked = isWidgetEnabled(includeInputWidget);
    outputToggle.title = "关闭后输入图作为绘画背景，不进入最终输出";
    outputToggle.style.accentColor = "#E85D04";
    const outputToggleText = document.createElement("span");
    outputToggleText.textContent = "输出输入图像";
    outputToggleLabel.append(outputToggle, outputToggleText);

    const mirrorToggleLabel = document.createElement("label");
    Object.assign(mirrorToggleLabel.style, {
        display: "flex", alignItems: "center", gap: "7px", padding: "0 9px",
        height: "34px", border: "1px solid #59616D", borderRadius: "5px",
        background: "#252A31", color: "#F5F7FA", fontSize: "13px",
        whiteSpace: "nowrap", cursor: "pointer", boxSizing: "border-box",
    });
    const mirrorToggle = document.createElement("input");
    mirrorToggle.type = "checkbox";
    mirrorToggle.checked = mirrorEnabled;
    mirrorToggle.title = "以画布垂直中心线镜像当前及后续新笔画";
    mirrorToggle.style.accentColor = "#2387FF";
    const mirrorToggleText = document.createElement("span");
    mirrorToggleText.textContent = "垂直镜像";
    mirrorToggleLabel.append(mirrorToggle, mirrorToggleText);

    const smoothingToggleLabel = document.createElement("label");
    Object.assign(smoothingToggleLabel.style, {
        display: "flex", alignItems: "center", gap: "7px", padding: "0 9px",
        height: "34px", border: "1px solid #59616D", borderRadius: "5px",
        background: "#252A31", color: "#F5F7FA", fontSize: "13px",
        whiteSpace: "nowrap", cursor: "pointer", boxSizing: "border-box",
    });
    const smoothingToggle = document.createElement("input");
    smoothingToggle.type = "checkbox";
    smoothingToggle.checked = smoothingEnabled;
    smoothingToggle.title = "自动减少鼠标抖动，让画笔和橡皮轨迹更平顺";
    smoothingToggle.style.accentColor = "#39C77A";
    const smoothingToggleText = document.createElement("span");
    smoothingToggleText.textContent = "曲线优化";
    smoothingToggleLabel.append(smoothingToggle, smoothingToggleText);

    const smoothingStrengthLabel = document.createElement("label");
    Object.assign(smoothingStrengthLabel.style, {
        display: "flex", alignItems: "center", gap: "6px", height: "34px",
        padding: "0 8px", border: "1px solid #3F4650", borderRadius: "5px",
        background: "#252A31", color: "#F5F7FA", fontSize: "13px", whiteSpace: "nowrap",
    });
    const smoothingStrengthText = document.createElement("span");
    smoothingStrengthText.textContent = `强度 ${Math.round(smoothingStrength)}%`;
    const smoothingStrengthInput = document.createElement("input");
    smoothingStrengthInput.type = "range";
    smoothingStrengthInput.min = "0";
    smoothingStrengthInput.max = "100";
    smoothingStrengthInput.step = "1";
    smoothingStrengthInput.value = String(Math.round(smoothingStrength));
    smoothingStrengthInput.style.width = "100px";
    smoothingStrengthInput.title = "调整新笔画自动稳定和优化全部的处理强度";
    smoothingStrengthLabel.append(smoothingStrengthText, smoothingStrengthInput);
    const smartRegularizeToggleLabel = document.createElement("label");
    Object.assign(smartRegularizeToggleLabel.style, {
        display: "flex", alignItems: "center", gap: "7px", padding: "0 9px",
        height: "34px", border: "1px solid #59616D", borderRadius: "5px",
        background: "#252A31", color: "#F5F7FA", fontSize: "13px",
        whiteSpace: "nowrap", cursor: "pointer", boxSizing: "border-box",
    });
    const smartRegularizeToggle = document.createElement("input");
    smartRegularizeToggle.type = "checkbox";
    smartRegularizeToggle.checked = smartRegularizeEnabled;
    smartRegularizeToggle.title = "自动将近似手绘直线、圆形、椭圆和圆弧规整为标准形态";
    smartRegularizeToggle.style.accentColor = "#2387FF";
    const smartRegularizeText = document.createElement("span");
    smartRegularizeText.textContent = "智能规整";
    smartRegularizeToggleLabel.append(smartRegularizeToggle, smartRegularizeText);

    const regularizeSensitivityLabel = document.createElement("label");
    Object.assign(regularizeSensitivityLabel.style, {
        display: "flex", alignItems: "center", gap: "6px", height: "34px",
        padding: "0 8px", border: "1px solid #3F4650", borderRadius: "5px",
        background: "#252A31", color: "#F5F7FA", fontSize: "13px", whiteSpace: "nowrap",
    });
    const regularizeSensitivityText = document.createElement("span");
    regularizeSensitivityText.textContent = `识别灵敏度 ${Math.round(regularizeSensitivity)}%`;
    const regularizeSensitivityInput = document.createElement("input");
    regularizeSensitivityInput.type = "range";
    regularizeSensitivityInput.min = "0";
    regularizeSensitivityInput.max = "100";
    regularizeSensitivityInput.step = "1";
    regularizeSensitivityInput.value = String(Math.round(regularizeSensitivity));
    regularizeSensitivityInput.title = "调高更容易识别规整，调低则更谨慎保留自由笔画";
    regularizeSensitivityLabel.append(regularizeSensitivityText, regularizeSensitivityInput);
    const optimizeAllButton = makeButton("优化全部", "按当前强度修复全部已完成曲线，可撤销");
    const optimizeSelectedButton = makeButton("优化选中", "只修复当前选中的曲线，可撤销");

    const drawingScaleControl = document.createElement("div");
    Object.assign(drawingScaleControl.style, {
        display: "flex", alignItems: "center", gap: "6px", height: "34px",
        padding: "0 8px", border: "1px solid #3F4650", borderRadius: "5px",
        background: "#252A31", color: "#F5F7FA", fontSize: "13px", whiteSpace: "nowrap",
    });
    const drawingScaleText = document.createElement("span");
    drawingScaleText.textContent = "图形 100%";
    const drawingScaleRange = document.createElement("input");
    drawingScaleRange.type = "range";
    drawingScaleRange.min = "10";
    drawingScaleRange.max = "300";
    drawingScaleRange.step = "1";
    drawingScaleRange.value = "100";
    drawingScaleRange.style.width = "110px";
    drawingScaleRange.title = "以整个绘画图形的中心等比例缩放";
    const resetDrawingScaleButton = makeButton("还原", "整体绘画缩放恢复为 100%");
    Object.assign(resetDrawingScaleButton.style, {height: "28px", padding: "0 8px"});
    drawingScaleControl.append(drawingScaleText, drawingScaleRange, resetDrawingScaleButton);

    const sizeLabel = document.createElement("div");
    Object.assign(sizeLabel.style, {
        display: "flex", alignItems: "center", gap: "7px", whiteSpace: "nowrap", fontSize: "13px",
        padding: "7px 8px", border: "1px solid #3F4650", borderRadius: "5px", background: "#252A31",
    });
    const sizeText = document.createElement("span");
    sizeText.textContent = `画笔大小 ${brushSize}`;
    Object.assign(sizeText.style, {flex: "1 1 auto"});
    const customSizeLabel = document.createElement("label");
    Object.assign(customSizeLabel.style, {display: "flex", alignItems: "center", gap: "5px", color: "#AEB6C2", fontSize: "12px"});
    const customSizeText = document.createElement("span");
    customSizeText.textContent = "自定义";
    const customSizeInput = document.createElement("input");
    customSizeInput.type = "number";
    customSizeInput.min = "1";
    customSizeInput.max = "5000";
    customSizeInput.step = "1";
    customSizeInput.value = String(brushSize);
    customSizeInput.title = "直接输入特殊画笔大小，范围 1-5000";
    Object.assign(customSizeInput.style, {
        width: "58px", height: "27px", padding: "0 5px", border: "1px solid #59616D",
        borderRadius: "4px", background: "#15191E", color: "#FFFFFF", boxSizing: "border-box",
    });
    customSizeLabel.append(customSizeText, customSizeInput);
    const sizeInput = document.createElement("input");
    sizeInput.type = "range";
    sizeInput.min = "2";
    sizeInput.max = "20";
    sizeInput.step = "1";
    sizeInput.value = String(brushSize);
    sizeInput.style.width = "160px";
    sizeInput.title = "常用画笔大小 2-20；特殊大小请直接输入数值";
    sizeLabel.append(sizeText, customSizeLabel, sizeInput);

    const colorGroup = document.createElement("div");
    Object.assign(colorGroup.style, {display: "flex", flexDirection: "column", alignItems: "stretch", gap: "6px", width: "100%", boxSizing: "border-box"});
    const colorHeader = document.createElement("div");
    Object.assign(colorHeader.style, {display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: "44px"});
    const colorTitle = document.createElement("span");
    colorTitle.textContent = "画笔颜色";
    Object.assign(colorTitle.style, {color: "#AEB6C2", fontSize: "12px"});
    colorHeader.appendChild(colorTitle);
    colorGroup.appendChild(colorHeader);
    const colorPresetGrid = document.createElement("div");
    Object.assign(colorPresetGrid.style, {
        display: "grid", gridTemplateColumns: "repeat(5, 30px)", gridAutoRows: "30px",
        alignItems: "center", gap: "6px", width: "100%", boxSizing: "border-box",
    });
    colorGroup.appendChild(colorPresetGrid);
    const colorButtons = COLORS.map((presetColor, index) => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.title = `${COLOR_PRESETS[index][0]} ${presetColor}`;
        swatch.setAttribute("aria-label", swatch.title);
        Object.assign(swatch.style, {
            width: "30px", height: "30px", padding: "0", borderRadius: "50%",
            background: presetColor, border: "2px solid transparent", cursor: "pointer",
            boxShadow: presetColor === "#FFFFFF" || presetColor === "#C0C0C0" ? "inset 0 0 0 1px #777" : "none",
        });
        swatch.addEventListener("click", () => {
            if (tool === "lasso") {
                fillColor = presetColor;
            } else {
                brushColor = rememberBrushColor(node, drawing, presetColor);
                if (tool !== "shape") tool = "brush";
            }
            refreshControls();
            render();
        });
        colorPresetGrid.appendChild(swatch);
        return swatch;
    });
    const savedColorButtons = [];
    function rebuildSavedColorButtons() {
        savedColorButtons.splice(0).forEach((button) => button.remove());
        savedColors.forEach((savedColor) => {
            const swatch = document.createElement("button");
            swatch.type = "button";
            swatch.title = `已保存颜色 ${savedColor}，点击重新使用`;
            swatch.setAttribute("aria-label", swatch.title);
            Object.assign(swatch.style, {
                width: "30px", height: "30px", padding: "0", borderRadius: "50%",
                background: savedColor, border: "2px solid transparent", cursor: "pointer",
                boxShadow: "0 0 0 1px #15191E, 0 1px 4px rgba(0,0,0,.35)",
            });
            swatch.addEventListener("click", () => {
                if (tool === "lasso") {
                    fillColor = savedColor;
                } else {
                    brushColor = rememberBrushColor(node, drawing, savedColor);
                    if (tool !== "shape") tool = "brush";
                }
                selectedStrokeIndex = -1;
                refreshControls();
                render();
            });
            savedColorButtons.push(swatch);
            colorPresetGrid.appendChild(swatch);
        });
    }
    function addSavedColor(color) {
        const previous = savedColors.join(",");
        savedColors = rememberSavedColors(node, drawing, [...savedColors, color]);
        if (savedColors.join(",") !== previous) rebuildSavedColorButtons();
    }
    function applyPickedColor(color, message) {
        const selectedColor = normalizeColor(color, brushColor);
        brushColor = rememberBrushColor(node, drawing, selectedColor);
        eyedropperColor = rememberEyedropperColor(node, drawing, selectedColor);
        addSavedColor(selectedColor);
        tool = "brush";
        selectedStrokeIndex = -1;
        groupSelection = null;
        refreshControls();
        render();
        statusMessage.textContent = `${message} ${selectedColor}，已新增颜色球`;
        statusMessage.style.color = "#39FF88";
    }
    rebuildSavedColorButtons();
    const customColorWrapper = document.createElement("div");
    customColorWrapper.title = "打开自定义调色盘";
    Object.assign(customColorWrapper.style, {
        position: "relative", width: "44px", height: "44px", flex: "0 0 44px", borderRadius: "50%",
        background: "conic-gradient(#FF3B30, #FFCC00, #34C759, #00C7BE, #2387FF, #AF52DE, #FF2D55, #FF3B30)",
        border: "2px solid #F5F7FA", boxShadow: "0 0 0 1px #15191E, 0 2px 7px rgba(0,0,0,.35)",
        boxSizing: "border-box", cursor: "pointer", overflow: "hidden",
    });
    const customColorPreview = document.createElement("span");
    Object.assign(customColorPreview.style, {
        position: "absolute", inset: "7px", borderRadius: "50%", background: brushColor,
        border: "2px solid rgba(255,255,255,.9)", boxShadow: "0 0 0 1px rgba(0,0,0,.65)",
        pointerEvents: "none", boxSizing: "border-box",
    });
    const customColor = document.createElement("input");
    let nativeColorPickerActive = false;
    let screenEyedropperActive = false;
    customColor.type = "color";
    customColor.value = brushColor;
    customColor.title = "自定义当前工具颜色";
    Object.assign(customColor.style, {
        position: "absolute", inset: "0", width: "100%", height: "100%", opacity: "0",
        border: "0", padding: "0", cursor: "pointer",
    });
    function applyCustomColor(event) {
        const selectedColor = normalizeColor(customColor.value, tool === "lasso" ? "#FFFFFF" : brushColor);
        if (tool === "lasso") {
            fillColor = selectedColor;
        } else {
            brushColor = rememberBrushColor(node, drawing, selectedColor);
            if (tool !== "shape") tool = "brush";
        }
        if (event?.type === "change") {
            addSavedColor(selectedColor);
        }
        refreshControls();
        render();
        if (event?.type === "change") {
            window.setTimeout(() => {
                nativeColorPickerActive = false;
                customColor.blur();
            }, 800);
        }
    }
    customColor.addEventListener("pointerdown", () => { nativeColorPickerActive = true; });
    customColor.addEventListener("input", applyCustomColor);
    customColor.addEventListener("change", applyCustomColor);
    customColorWrapper.append(customColorPreview, customColor);
    const screenEyedropperButton = makeButton("屏幕取色", "直接吸取屏幕任意位置的颜色并自动新增颜色球");
    Object.assign(screenEyedropperButton.style, {
        width: "82px", height: "38px", padding: "0 8px", flex: "0 0 82px",
        background: "#153A63", borderColor: "#4DA3FF", color: "#FFFFFF", fontWeight: "700",
    });
    screenEyedropperButton.textContent = "⌾ 屏幕取色";
    const colorHeaderActions = document.createElement("div");
    Object.assign(colorHeaderActions.style, {display: "flex", alignItems: "center", gap: "7px"});
    colorHeaderActions.append(screenEyedropperButton, customColorWrapper);
    colorHeader.appendChild(colorHeaderActions);

    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    const saveButton = makeButton("保存到节点");
    const runButton = makeButton("保存并运行");
    const closeButton = makeButton("关闭", "关闭且不保存本次修改 Esc");
    decorateIconButton(runButton, "▶", "保存并运行");
    Object.assign(saveButton.style, {background: "#E85D04", borderColor: "#FF6A00"});
    Object.assign(runButton.style, {
        background: "#1468C8", borderColor: "#4DA3FF", flexDirection: "row", gap: "10px",
        boxShadow: "0 0 0 1px rgba(77, 163, 255, 0.2)",
    });
    Object.assign(runButton.firstElementChild.style, {fontSize: "28px", lineHeight: "28px"});
    Object.assign(runButton.lastElementChild.style, {fontSize: "14px", lineHeight: "18px", fontWeight: "700"});
    const queueCountControl = document.createElement("div");
    Object.assign(queueCountControl.style, {
        display: "grid", gridTemplateColumns: "1fr 28px 50px 28px", alignItems: "center", gap: "5px",
        minHeight: "32px", padding: "3px 5px 3px 8px", border: "1px solid #3F4650", borderRadius: "5px",
        background: "#252A31", boxSizing: "border-box",
    });
    const queueCountText = document.createElement("span");
    queueCountText.textContent = "队列数量";
    Object.assign(queueCountText.style, {fontSize: "12px", color: "#F5F7FA", whiteSpace: "nowrap"});
    const queueMinusButton = makeButton("−", "队列数量减一");
    const queuePlusButton = makeButton("+", "队列数量加一");
    for (const button of [queueMinusButton, queuePlusButton]) {
        Object.assign(button.style, {width: "28px", height: "26px", padding: "0", fontSize: "18px", lineHeight: "24px"});
    }
    const queueCountInput = document.createElement("input");
    queueCountInput.type = "number";
    queueCountInput.min = "1";
    queueCountInput.max = "999";
    queueCountInput.step = "1";
    queueCountInput.value = String(queueCount);
    queueCountInput.title = "直接输入需要加入队列的图片数量";
    Object.assign(queueCountInput.style, {
        width: "50px", height: "26px", padding: "0 4px", border: "1px solid #59616D", borderRadius: "4px",
        background: "#15191E", color: "#FFFFFF", textAlign: "center", boxSizing: "border-box", fontSize: "13px",
    });
    queueCountControl.append(queueCountText, queueMinusButton, queueCountInput, queuePlusButton);

    function setQueueCount(value) {
        queueCount = Math.round(clamp(value, 1, 999));
        node.__jindouyunQueueCount = queueCount;
        queueCountInput.value = String(queueCount);
        runButton.lastElementChild.textContent = `保存并运行 ×${queueCount}`;
    }
    setQueueCount(queueCount);

    const leftToolControls = [
        moveImageButton, selectStrokeButton, groupSelectButton, rotationControl,
        brushButton, pencilBrushButton, eyedropperButton, eraserButton, lassoButton, shapeControl,
    ];
    for (const control of leftToolControls) {
        Object.assign(control.style, {width: "100%", boxSizing: "border-box", flex: "0 0 auto"});
    }
    Object.assign(rotationControl.style, {
        height: "auto", minHeight: "34px", flexWrap: "wrap", padding: "7px", justifyContent: "space-between",
    });
    rotationRange.style.width = "76px";
    rotationNumber.style.width = "52px";
    resetRotationButton.style.flex = "1 1 52px";
    Object.assign(shapeControl.style, {
        height: "auto", minHeight: "34px", flexWrap: "wrap", padding: "0", overflow: "hidden",
    });
    Object.assign(shapeSelect.style, {flex: "1 1 70px", minWidth: "0", marginRight: "5px"});
    shapeSidesLabel.style.padding = "0 6px 6px";

    const rightPanel = document.createElement("aside");
    Object.assign(rightPanel.style, {
        display: "flex", flexDirection: "column", alignItems: "stretch", gap: "9px",
        minWidth: "0", minHeight: "0", padding: "12px 10px", overflowY: "auto", overflowX: "hidden",
        borderLeft: "1px solid #323842", background: "#1B1F25", boxSizing: "border-box",
    });
    const commandSection = document.createElement("section");
    Object.assign(commandSection.style, {
        display: "flex", flexDirection: "column", gap: "7px", paddingBottom: "10px",
        borderBottom: "1px solid #3F4650",
    });
    const commandTitle = document.createElement("strong");
    commandTitle.textContent = "工作流操作";
    Object.assign(commandTitle.style, {fontSize: "14px"});
    const commandGrid = document.createElement("div");
    Object.assign(commandGrid.style, {display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px"});
    Object.assign(outputToggleLabel.style, {width: "100%", height: "34px", boxSizing: "border-box"});
    Object.assign(closeButton.style, {width: "100%", height: "34px", padding: "0 7px", boxSizing: "border-box"});
    Object.assign(saveButton.style, {width: "100%", height: "34px", padding: "0 7px", boxSizing: "border-box"});
    Object.assign(queueCountControl.style, {gridColumn: "1 / -1", width: "100%"});
    Object.assign(runButton.style, {gridColumn: "1 / -1", width: "100%", height: "54px", padding: "0 10px", boxSizing: "border-box", fontWeight: "700"});
    commandGrid.append(closeButton, saveButton, queueCountControl, runButton);
    commandSection.append(commandTitle, outputToggleLabel, commandGrid);
    const propertiesTitle = document.createElement("strong");
    propertiesTitle.textContent = "属性与编辑";
    Object.assign(propertiesTitle.style, {fontSize: "14px", marginBottom: "2px"});
    const layersTitle = document.createElement("strong");
    layersTitle.textContent = "图层";
    Object.assign(layersTitle.style, {fontSize: "14px", marginTop: "3px"});
    const layerList = document.createElement("div");
    Object.assign(layerList.style, {
        display: "flex", flexDirection: "column", gap: "4px", height: "min(620px, 52vh)", maxHeight: "70vh", minHeight: "80px",
        resize: "vertical", overflowY: "auto", padding: "5px", border: "1px solid #3F4650", borderRadius: "5px",
        background: "#15191E", boxSizing: "border-box",
    });
    layerList.title = "可拖动图层面板右下角调整列表高度";
    const inputLayerToggle = document.createElement("input");
    inputLayerToggle.type = "checkbox";
    inputLayerToggle.checked = drawing.inputVisible !== false;
    inputLayerToggle.title = "显示或隐藏输入底图";
    inputLayerToggle.style.accentColor = "#E85D04";
    const inputLayerRow = document.createElement("div");
    Object.assign(inputLayerRow.style, {
        display: "flex", alignItems: "center", gap: "6px", minHeight: "30px", padding: "3px 5px",
        borderRadius: "4px", background: "#252A31", color: "#F5F7FA", fontSize: "12px", boxSizing: "border-box",
    });
    const inputLayerLabel = document.createElement("span");
    inputLayerLabel.textContent = "底图（输入图像）";
    inputLayerRow.append(inputLayerToggle, inputLayerLabel);
    layerList.appendChild(inputLayerRow);
    const groupActionRow = document.createElement("div");
    Object.assign(groupActionRow.style, {display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px"});
    const createGroupButton = makeButton("建组", "将当前选中的一个或多个图层放入新群组");
    const ungroupButton = makeButton("解组", "移除当前选中图层的群组关系");
    for (const button of [createGroupButton, ungroupButton]) Object.assign(button.style, {height: "30px", padding: "0 6px"});
    groupActionRow.append(createGroupButton, ungroupButton);
    Object.assign(sizeLabel.style, {width: "100%", flexWrap: "wrap", boxSizing: "border-box"});
    sizeInput.style.width = "100%";
    for (const control of [smoothingToggleLabel, smoothingStrengthLabel, smartRegularizeToggleLabel, regularizeSensitivityLabel, drawingScaleControl]) {
        Object.assign(control.style, {width: "100%", height: "auto", minHeight: "34px", flexWrap: "wrap", boxSizing: "border-box"});
    }
    Object.assign(mirrorToggleLabel.style, {
        position: "absolute", left: "50%", top: "0", transform: "translateX(-50%)", zIndex: "8",
        width: "146px", maxWidth: "calc(100% - 8px)", height: "22px", minHeight: "22px",
        justifyContent: "center", gap: "4px", padding: "0 6px", flexWrap: "nowrap", fontSize: "11px",
        borderWidth: "1px", borderTopWidth: "0", borderRadius: "0 0 4px 4px",
        background: "rgba(27,31,37,.94)", boxShadow: "0 2px 5px rgba(0,0,0,.35)",
    });
    Object.assign(mirrorToggle.style, {width: "12px", height: "12px", margin: "0"});
    const mirrorIcon = document.createElement("span");
    mirrorIcon.textContent = "↔";
    Object.assign(mirrorIcon.style, {fontSize: "14px", lineHeight: "14px", fontWeight: "700"});
    mirrorToggleLabel.prepend(mirrorIcon);
    smoothingStrengthInput.style.width = "100%";
    regularizeSensitivityInput.style.width = "100%";
    drawingScaleRange.style.width = "100%";
    resetDrawingScaleButton.style.width = "100%";
    for (const button of [optimizeSelectedButton, optimizeAllButton, undoButton, redoButton, clearButton]) {
        Object.assign(button.style, {width: "100%", boxSizing: "border-box"});
    }
    const historyRow = document.createElement("div");
    Object.assign(historyRow.style, {display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "7px"});
    historyRow.append(undoButton, redoButton, clearButton);
    Object.assign(undoButton.style, {background: "#244A70", borderColor: "#4DA3FF"});
    Object.assign(clearButton.style, {background: "#512B2B", borderColor: "#D85A5A"});
    rightPanel.append(
        commandSection, layersTitle, groupActionRow, layerList, propertiesTitle, colorGroup, sizeLabel,
        smartRegularizeToggleLabel, regularizeSensitivityLabel, smoothingToggleLabel, smoothingStrengthLabel,
        optimizeSelectedButton, optimizeAllButton, drawingScaleControl,
        historyRow,
    );

    toolbar.append(
        title, moveImageButton, selectStrokeButton, groupSelectButton, rotationControl,
        brushButton, pencilBrushButton, eyedropperButton, eraserButton, lassoButton, shapeControl,
    );

    const workspace = document.createElement("div");
    Object.assign(workspace.style, {
        position: "relative", minWidth: "0", minHeight: "0", display: "grid", placeItems: "center",
        padding: "0", overflow: "hidden", background: "transparent",
    });
    const canvas = document.createElement("canvas");
    const artworkCanvas = document.createElement("canvas");
    const visibilityGuideCanvas = document.createElement("canvas");
    Object.assign(canvas.style, {
        display: "block", touchAction: "none", cursor: "crosshair",
        boxShadow: "0 10px 38px rgba(0,0,0,.45)", outline: "1px solid #454B55",
    });
    workspace.append(canvas, mirrorToggleLabel);

    const stage = document.createElement("div");
    Object.assign(stage.style, {
        display: "grid", gridTemplateColumns: "132px minmax(0, 1fr) 190px", columnGap: "8px",
        minWidth: "0", minHeight: "0", width: "100%", height: "100%", justifyContent: "center",
    });
    stage.append(toolbar, workspace, rightPanel);

    const status = document.createElement("div");
    Object.assign(status.style, {
        gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "8px",
        minWidth: "0", padding: "0 10px", borderTop: "1px solid #323842", background: "#1B1F25",
        color: "#AEB6C2", fontSize: "12px",
    });
    const {width: outputWidth, height: outputHeight} = getCanvasSize(node);
    const statusSize = document.createElement("span");
    statusSize.textContent = `${outputWidth} x ${outputHeight}`;
    const statusMessage = document.createElement("span");
    statusMessage.textContent = "绘画叠加在输入图像上方";
    Object.assign(statusSize.style, {flex: "0 0 auto", whiteSpace: "nowrap"});
    Object.assign(statusMessage.style, {minWidth: "0", flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"});
    Object.assign(spacer.style, {flex: "0 0 8px"});
    Object.assign(outputToggleLabel.style, {height: "34px", flex: "0 0 auto"});
    Object.assign(closeButton.style, {height: "34px", flex: "0 0 auto"});
    Object.assign(saveButton.style, {height: "34px", flex: "0 0 auto"});
    Object.assign(runButton.style, {height: "54px", flex: "0 0 auto"});
    status.append(statusSize, statusMessage);

    overlay.append(stage, status);
    document.body.appendChild(overlay);
    overlay.focus({preventScroll: true});

    function cloneDrawingStrokes() {
        return structuredClone(drawing.strokes);
    }

    function cloneHistoryState() {
        return {
            strokes: cloneDrawingStrokes(),
            inputVisible: drawing.inputVisible !== false,
            groups: structuredClone(drawing.groups || []),
        };
    }

    function restoreHistoryState(state) {
        if (Array.isArray(state)) {
            drawing.strokes = state;
            return;
        }
        drawing.strokes = structuredClone(state?.strokes || []);
        drawing.inputVisible = state?.inputVisible !== false;
        drawing.groups = structuredClone(state?.groups || []);
        inputLayerToggle.checked = drawing.inputVisible;
        node.__jindouyunInputVisible = drawing.inputVisible;
    }

    function recordHistory() {
        undoStack.push(cloneHistoryState());
        if (undoStack.length > 80) {
            undoStack.shift();
        }
        redoStack.length = 0;
    }

    function defaultLayerName(stroke, index) {
        if (stroke?.layerName) return String(stroke.layerName);
        if (stroke?.shape) return `${stroke.shape === "circle" ? "圆形" : stroke.shape === "square" ? "方形" : stroke.shape === "star" ? "星形" : "多边形"} ${index + 1}`;
        if (stroke?.regularizedKind) {
            const labels = {line: "智能直线", circle: "智能圆形", ellipse: "智能椭圆", arc: "智能圆弧"};
            return `${labels[stroke.regularizedKind] || "智能规整"} ${index + 1}`;
        }
        if (stroke?.tool === "lasso") return `套索填充 ${index + 1}`;
        if (stroke?.tool === "eraser") return `橡皮 ${index + 1}`;
        if (stroke?.brushType === "pencil") return `铅笔 ${index + 1}`;
        return `画笔 ${index + 1}`;
    }

    function moveLayer(index, direction) {
        const target = index + direction;
        if (target < 0 || target >= drawing.strokes.length) return;
        recordHistory();
        const [stroke] = drawing.strokes.splice(index, 1);
        drawing.strokes.splice(target, 0, stroke);
        if (selectedStrokeIndex === index) selectedStrokeIndex = target;
        else if (selectedStrokeIndex === target) selectedStrokeIndex = index;
        if (selectionAnchorIndex === index) selectionAnchorIndex = target;
        else if (selectionAnchorIndex === target) selectionAnchorIndex = index;
        refreshLayerPanel();
        refreshControls();
        render();
    }

    function refreshLayerPanelLegacy() {
        while (layerList.children.length > 1) layerList.removeChild(layerList.lastChild);
        for (let index = drawing.strokes.length - 1; index >= 0; index -= 1) {
            const stroke = drawing.strokes[index];
            const row = document.createElement("div");
            Object.assign(row.style, {
                display: "flex", alignItems: "center", gap: "4px", minHeight: "30px", padding: "3px 4px",
                borderRadius: "4px", background: selectedStrokeIndex === index ? "#153A63" : "#252A31",
                border: selectedStrokeIndex === index ? "1px solid #2387FF" : "1px solid transparent",
                color: stroke.visible === false ? "#737C88" : "#F5F7FA", boxSizing: "border-box",
            });
            const visibilityButton = document.createElement("button");
            visibilityButton.type = "button";
            visibilityButton.textContent = stroke.visible === false ? "○" : "●";
            visibilityButton.title = stroke.visible === false ? "显示图层" : "隐藏图层";
            Object.assign(visibilityButton.style, {width: "24px", height: "24px", padding: "0", border: "0", background: "transparent", color: stroke.visible === false ? "#6E7781" : "#79B7FF", cursor: "pointer", fontSize: "16px"});
            visibilityButton.addEventListener("click", (event) => {
                event.stopPropagation();
                recordHistory();
                stroke.visible = stroke.visible === false;
                refreshLayerPanel();
                render();
            });
            const nameButton = document.createElement("button");
            nameButton.type = "button";
            nameButton.textContent = defaultLayerName(stroke, index);
            nameButton.title = "选择图层并显示自由变换框";
            Object.assign(nameButton.style, {flex: "1 1 auto", minWidth: "0", height: "26px", padding: "0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", border: "0", background: "transparent", color: "inherit", cursor: "pointer", fontSize: "12px"});
            nameButton.addEventListener("click", () => {
                selectedStrokeIndex = index;
                tool = "select";
                groupSelection = null;
                refreshLayerPanel();
                refreshControls();
                render();
            });
            const upButton = makeButton("↑", "上移图层");
            const downButton = makeButton("↓", "下移图层");
            for (const button of [upButton, downButton]) Object.assign(button.style, {width: "24px", height: "24px", padding: "0", fontSize: "14px"});
            upButton.disabled = index >= drawing.strokes.length - 1;
            downButton.disabled = index <= 0;
            upButton.addEventListener("click", (event) => { event.stopPropagation(); moveLayer(index, 1); });
            downButton.addEventListener("click", (event) => { event.stopPropagation(); moveLayer(index, -1); });
            row.append(visibilityButton, nameButton, upButton, downButton);
            layerList.appendChild(row);
        }
    }

    function getLayerSelection() {
        if (groupSelection?.indices?.length) return [...new Set(groupSelection.indices)];
        return selectedStrokeIndex >= 0 ? [selectedStrokeIndex] : [];
    }

    function groupForStroke(stroke) {
        return drawing.groups?.find((group) => group.id === stroke?.groupId) || null;
    }

    function eraseStrokeAt(pointerX, pointerY) {
        let hitIndex = -1;
        for (let index = drawing.strokes.length - 1; index >= 0; index -= 1) {
            const stroke = drawing.strokes[index];
            if (stroke?.visible !== false && stroke?.groupVisible !== false &&
                hitTestStroke(stroke, pointerX, pointerY, canvas.width, canvas.height)) {
                hitIndex = index;
                break;
            }
        }
        if (hitIndex < 0) return false;
        if (!eraserDrag?.historyRecorded) {
            recordHistory();
            if (eraserDrag) eraserDrag.historyRecorded = true;
        }
        drawing.strokes.splice(hitIndex, 1);
        if (selectedStrokeIndex === hitIndex) selectedStrokeIndex = -1;
        else if (selectedStrokeIndex > hitIndex) selectedStrokeIndex -= 1;
        if (selectionAnchorIndex === hitIndex) selectionAnchorIndex = -1;
        else if (selectionAnchorIndex > hitIndex) selectionAnchorIndex -= 1;
        if (groupSelection?.indices?.length) {
            groupSelection.indices = groupSelection.indices
                .filter((index) => index !== hitIndex)
                .map((index) => index > hitIndex ? index - 1 : index);
            if (!groupSelection.indices.length) groupSelection = null;
        }
        removeUnusedGroups();
        statusMessage.textContent = "已删除整笔绘画，可撤销恢复";
        statusMessage.style.color = "#FF9B73";
        refreshLayerPanel();
        render();
        return true;
    }

    function selectLayer(index, event) {
        const hasSelectionAnchor = selectionAnchorIndex >= 0 && selectionAnchorIndex < drawing.strokes.length;
        if (event?.shiftKey && hasSelectionAnchor) {
            const start = Math.min(selectionAnchorIndex, index);
            const end = Math.max(selectionAnchorIndex, index);
            const indices = [];
            for (let current = start; current <= end; current += 1) indices.push(current);
            selectedStrokeIndex = -1;
            selectedGroupId = null;
            groupSelection = {indices};
            tool = "group";
        } else {
            selectionAnchorIndex = index;
            selectedStrokeIndex = index;
            selectedGroupId = null;
            groupSelection = null;
            tool = "select";
        }
        refreshControls();
        render();
    }

    function selectGroup(group, event) {
        const indices = drawing.strokes.map((stroke, index) => stroke.groupId === group.id ? index : -1).filter((index) => index >= 0);
        if (event?.shiftKey) {
            const next = new Set(getLayerSelection());
            for (const index of indices) next.add(index);
            selectedStrokeIndex = -1;
            selectedGroupId = null;
            groupSelection = {indices: [...next]};
            tool = "group";
        } else {
            selectedStrokeIndex = -1;
            selectedGroupId = group.id;
            groupSelection = {indices};
            tool = "group";
        }
        refreshControls();
        render();
    }

    function removeUnusedGroups() {
        const used = new Set(drawing.strokes.map((stroke) => stroke.groupId).filter(Boolean));
        drawing.groups = (drawing.groups || []).filter((group) => used.has(group.id));
    }

    function refreshLayerPanel() {
        while (layerList.children.length > 1) layerList.removeChild(layerList.lastChild);
        const groups = drawing.groups || [];
        const renderedGroups = new Set();
        const createRow = (index, indented = false) => {
            const stroke = drawing.strokes[index];
            const row = document.createElement("div");
            const selected = getLayerSelection().includes(index);
            Object.assign(row.style, {
                display: "flex", alignItems: "center", gap: "4px", minHeight: "30px", padding: indented ? "3px 4px 3px 20px" : "3px 4px",
                borderRadius: "4px", background: selected ? "#153A63" : "#252A31",
                border: selected ? "1px solid #2387FF" : "1px solid transparent",
                color: stroke.visible === false || stroke.groupVisible === false ? "#737C88" : "#F5F7FA", boxSizing: "border-box",
            });
            const visibilityButton = document.createElement("button");
            visibilityButton.type = "button";
            visibilityButton.textContent = stroke.visible === false || stroke.groupVisible === false ? "○" : "●";
            visibilityButton.title = stroke.visible === false ? "显示图层" : "隐藏图层";
            Object.assign(visibilityButton.style, {width: "24px", height: "24px", padding: "0", border: "0", background: "transparent", color: stroke.visible === false || stroke.groupVisible === false ? "#6E7781" : "#79B7FF", cursor: "pointer", fontSize: "16px"});
            visibilityButton.addEventListener("click", (event) => {
                event.stopPropagation();
                recordHistory();
                stroke.visible = stroke.visible === false;
                refreshLayerPanel();
                render();
            });
            const nameButton = document.createElement("button");
            nameButton.type = "button";
            nameButton.textContent = defaultLayerName(stroke, index);
            nameButton.title = "选择图层并显示自由变换框，按住 Shift 可多选";
            Object.assign(nameButton.style, {flex: "1 1 auto", minWidth: "0", height: "26px", padding: "0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", border: "0", background: "transparent", color: "inherit", cursor: "pointer", fontSize: "12px"});
            nameButton.addEventListener("click", (event) => { event.stopPropagation(); selectLayer(index, event); });
            const upButton = makeButton("↑", "上移图层");
            const downButton = makeButton("↓", "下移图层");
            for (const button of [upButton, downButton]) Object.assign(button.style, {width: "24px", height: "24px", padding: "0", fontSize: "14px"});
            upButton.disabled = index >= drawing.strokes.length - 1;
            downButton.disabled = index <= 0;
            upButton.addEventListener("click", (event) => { event.stopPropagation(); moveLayer(index, 1); });
            downButton.addEventListener("click", (event) => { event.stopPropagation(); moveLayer(index, -1); });
            row.append(visibilityButton, nameButton, upButton, downButton);
            layerList.appendChild(row);
        };
        for (let index = drawing.strokes.length - 1; index >= 0; index -= 1) {
            const group = groupForStroke(drawing.strokes[index]);
            if (group) {
                if (renderedGroups.has(group.id)) continue;
                renderedGroups.add(group.id);
                const indices = drawing.strokes.map((stroke, childIndex) => stroke.groupId === group.id ? childIndex : -1).filter((childIndex) => childIndex >= 0);
                const groupRow = document.createElement("div");
                const selected = selectedGroupId === group.id || indices.some((childIndex) => getLayerSelection().includes(childIndex));
                Object.assign(groupRow.style, {display: "flex", alignItems: "center", gap: "4px", minHeight: "31px", padding: "3px 4px", borderRadius: "4px", background: selected ? "#153A63" : "#303640", border: selected ? "1px solid #2387FF" : "1px solid transparent", color: group.visible === false ? "#737C88" : "#F5F7FA", boxSizing: "border-box"});
                const groupVisibility = document.createElement("button");
                groupVisibility.type = "button";
                groupVisibility.textContent = group.visible === false ? "○" : "●";
                groupVisibility.title = group.visible === false ? "显示群组" : "隐藏群组";
                Object.assign(groupVisibility.style, {width: "24px", height: "24px", padding: "0", border: "0", background: "transparent", color: group.visible === false ? "#6E7781" : "#79B7FF", cursor: "pointer", fontSize: "16px"});
                groupVisibility.addEventListener("click", (event) => {
                    event.stopPropagation();
                    recordHistory();
                    group.visible = group.visible === false;
                    for (const childIndex of indices) drawing.strokes[childIndex].groupVisible = group.visible;
                    refreshLayerPanel();
                    render();
                });
                const collapseButton = makeButton(group.collapsed !== true ? "▾" : "▸", group.collapsed !== true ? "折叠群组" : "展开群组");
                Object.assign(collapseButton.style, {width: "24px", height: "24px", padding: "0", fontSize: "14px"});
                collapseButton.addEventListener("click", (event) => { event.stopPropagation(); group.collapsed = group.collapsed === false; refreshLayerPanel(); });
                const groupName = document.createElement("button");
                groupName.type = "button";
                groupName.textContent = `${group.name || "群组"} (${indices.length})`;
                groupName.title = "选择群组，按住 Shift 可与其他图层合并选择";
                Object.assign(groupName.style, {flex: "1 1 auto", minWidth: "0", height: "26px", padding: "0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", border: "0", background: "transparent", color: "inherit", cursor: "pointer", fontSize: "12px"});
                groupName.addEventListener("click", (event) => { event.stopPropagation(); selectGroup(group, event); });
                groupRow.append(groupVisibility, collapseButton, groupName);
                layerList.appendChild(groupRow);
                if (group.collapsed !== true) for (const childIndex of indices) createRow(childIndex, true);
            } else {
                createRow(index);
            }
        }
    }

    function createGroupFromSelection() {
        const indices = getLayerSelection().filter((index) => index >= 0 && index < drawing.strokes.length);
        if (!indices.length) {
            statusMessage.textContent = "请先选择一个或多个绘画图层";
            statusMessage.style.color = "#FF9B73";
            return;
        }
        recordHistory();
        const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        drawing.groups = drawing.groups || [];
        drawing.groups.push({id, name: `群组 ${drawing.groups.length + 1}`, visible: true, collapsed: false});
        for (const index of indices) {
            drawing.strokes[index].groupId = id;
            drawing.strokes[index].groupVisible = true;
        }
        removeUnusedGroups();
        selectedStrokeIndex = -1;
        selectedGroupId = id;
        groupSelection = {indices};
        tool = "group";
        refreshControls();
        render();
    }

    function ungroupSelection() {
        const groupIds = new Set();
        if (selectedGroupId) groupIds.add(selectedGroupId);
        for (const index of getLayerSelection()) {
            const id = drawing.strokes[index]?.groupId;
            if (id) groupIds.add(id);
        }
        if (!groupIds.size) return;
        recordHistory();
        for (const stroke of drawing.strokes) {
            if (!groupIds.has(stroke.groupId)) continue;
            delete stroke.groupId;
            delete stroke.groupVisible;
        }
        drawing.groups = (drawing.groups || []).filter((group) => !groupIds.has(group.id));
        selectedGroupId = null;
        refreshControls();
        render();
    }

    function currentSmoothingProfile() {
        return resolveSmoothingProfile(smoothingStrength);
    }

    function smoothWithCurrentStrength(points) {
        const profile = currentSmoothingProfile();
        return smoothStrokePoints(points, profile.strength, profile.passes);
    }

    function shapePointsAt(pointerX, pointerY, useDefaultSize = false) {
        if (!shapeDraft) return [];
        let targetX = pointerX;
        let targetY = pointerY;
        if (useDefaultSize && Math.hypot(pointerX - shapeDraft.centerX, pointerY - shapeDraft.centerY) < 4) {
            targetX = shapeDraft.centerX + Math.min(canvas.width, canvas.height) * 0.12;
            targetY = shapeDraft.centerY;
        }
        return createShapeStrokePoints({
            shape: shapeDraft.shape,
            centerX: shapeDraft.centerX,
            centerY: shapeDraft.centerY,
            pointerX: targetX,
            pointerY: targetY,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            sides: shapeDraft.sides,
        });
    }

    function refreshControls() {
        if (tool !== "group") {
            groupSelection = null;
            groupDraft = null;
            groupDrag = null;
        }
        if (selectedStrokeIndex >= drawing.strokes.length) selectedStrokeIndex = -1;
        if (groupSelection) {
            groupSelection.indices = groupSelection.indices.filter((index) => index >= 0 && index < drawing.strokes.length);
            if (!groupSelection.indices.length) groupSelection = null;
        }
        refreshLayerPanel();
        const selectedStroke = selectedStrokeIndex >= 0 ? drawing.strokes[selectedStrokeIndex] : null;
        const activeColor = tool === "lasso" ? fillColor : brushColor;
        setActive(moveImageButton, tool === "move", "#1468C8");
        setActive(selectStrokeButton, tool === "select", "#167A55");
        setActive(groupSelectButton, tool === "group", "#2387FF");
        setActive(brushButton, tool === "brush" && brushType === "solid", "#E85D04");
        setActive(pencilBrushButton, tool === "brush" && brushType === "pencil", "#E85D04");
        setActive(eyedropperButton, tool === "eyedropper", "#1468C8");
        setActive(eraserButton, tool === "eraser", "#59616D");
        setActive(lassoButton, tool === "lasso", "#167A55");
        setActive(shapeButton, tool === "shape", "#7A4FC2");
        sizeLabel.style.display = tool === "lasso" || tool === "eraser" || tool === "eyedropper" || tool === "move" || tool === "select" || tool === "group" ? "none" : "flex";
        colorGroup.style.display = tool === "eraser" || tool === "move" || tool === "select" || tool === "group" ? "none" : "flex";
        customColor.value = activeColor;
        customColorPreview.style.background = activeColor;
        customColor.title = tool === "lasso" ? "自定义套索填充颜色" : "自定义画笔颜色";
        customColorWrapper.title = customColor.title;
        undoButton.disabled = undoStack.length === 0 && drawing.strokes.length === 0 && Math.abs(drawingScale - 1) < 0.0001;
        redoButton.disabled = redoStack.length === 0;
        optimizeAllButton.disabled = !drawing.strokes.some((stroke) => stroke?.tool !== "lasso" && !stroke?.shape && !stroke?.regularizedKind && stroke?.points?.length >= 3);
        optimizeSelectedButton.disabled = !selectedStroke || selectedStroke.tool === "lasso" || selectedStroke.shape || selectedStroke.regularizedKind || selectedStroke.points?.length < 3;
        drawingScaleRange.disabled = drawing.strokes.length === 0;
        undoButton.style.opacity = undoButton.disabled ? "0.45" : "1";
        redoButton.style.opacity = redoButton.disabled ? "0.45" : "1";
        optimizeAllButton.style.opacity = optimizeAllButton.disabled ? "0.45" : "1";
        optimizeSelectedButton.style.opacity = optimizeSelectedButton.disabled ? "0.45" : "1";
        drawingScaleControl.style.opacity = drawingScaleRange.disabled ? "0.45" : "1";
        colorButtons.forEach((button, index) => {
            button.style.borderColor = activeColor === COLORS[index] && tool !== "eraser" ? "#FFFFFF" : "transparent";
        });
        savedColorButtons.forEach((button, index) => {
            button.style.borderColor = activeColor === savedColors[index] && tool !== "eraser" ? "#FFFFFF" : "transparent";
        });
        canvas.style.cursor = tool === "move"
            ? (imageDrag ? "grabbing" : "grab")
            : tool === "select"
                ? (strokeDrag?.mode === "rotate" ? "crosshair" : strokeDrag?.mode === "scale" ? "nwse-resize" : strokeDrag ? "grabbing" : "pointer")
                : tool === "group"
                    ? (groupDrag?.mode === "rotate" ? "crosshair" : groupDrag?.mode === "scale" ? "nwse-resize" : groupDrag ? "grabbing" : "crosshair")
                : tool === "eraser" ? "cell" : tool === "eyedropper" ? "copy" : "crosshair";
        outputToggleText.textContent = outputToggle.checked ? "输出输入图像" : "输入图作背景";
        outputToggleLabel.style.borderColor = outputToggle.checked ? "#E85D04" : "#59616D";
        mirrorToggleText.textContent = mirrorToggle.checked ? "垂直镜像：开" : "垂直镜像：关";
        mirrorToggleLabel.style.borderColor = mirrorToggle.checked ? "#2387FF" : "#59616D";
        mirrorToggleLabel.style.background = mirrorToggle.checked ? "#153A63" : "#252A31";
        smoothingToggleText.textContent = smoothingToggle.checked ? "曲线优化：开" : "曲线优化：关";
        smoothingToggleLabel.style.borderColor = smoothingToggle.checked ? "#39C77A" : "#59616D";
        smoothingToggleLabel.style.background = smoothingToggle.checked ? "#173C2A" : "#252A31";
        smoothingStrengthText.textContent = `强度 ${Math.round(smoothingStrength)}%`;
        smartRegularizeText.textContent = smartRegularizeToggle.checked ? "智能规整：开" : "智能规整：关";
        smartRegularizeToggleLabel.style.borderColor = smartRegularizeToggle.checked ? "#2387FF" : "#59616D";
        smartRegularizeToggleLabel.style.background = smartRegularizeToggle.checked ? "#153A63" : "#252A31";
        regularizeSensitivityText.textContent = `识别灵敏度 ${Math.round(regularizeSensitivity)}%`;
        regularizeSensitivityLabel.style.opacity = smartRegularizeToggle.checked ? "1" : "0.45";
        regularizeSensitivityInput.disabled = !smartRegularizeToggle.checked;
        drawingScaleText.textContent = `图形 ${Math.round(drawingScale * 100)}%`;
        shapeSidesLabel.style.display = shapeType === "polygon" || shapeType === "star" ? "flex" : "none";
        if (!currentStroke && tool === "group") {
            statusMessage.textContent = groupSelection
                ? `已框选 ${groupSelection.indices.length} 个图层：拖框移动，拖四角等比例缩放`
                : "拖动画框选择多个绘画图层";
            statusMessage.style.color = groupSelection ? "#79B7FF" : "#AEB6C2";
            return;
        }
        if (!currentStroke) {
            statusMessage.textContent = tool === "lasso"
                ? "套索需回到绿色起点后松开"
                : tool === "eyedropper"
                    ? "点击画布吸取颜色，取色后自动切回画笔"
                : tool === "move"
                    ? "自由拖动输入图片，参考垂直中心线微调位置"
                : tool === "select"
                    ? selectedStroke
                        ? `已选中第 ${selectedStrokeIndex + 1} 笔，拖动可移动或点击优化选中`
                        : "点击一条线进行选择，每一笔都是独立图层"
                : tool === "shape"
                    ? `从中心拖动添加${shapeSelect.options[shapeSelect.selectedIndex]?.text || "几何图形"}`
                : tool === "eraser"
                    ? "触碰绘画线条即可删除整笔，可拖动连续删除"
                : mirrorToggle.checked
                    ? "垂直镜像已开启，沿中心线一侧绘画即可"
                    : outputToggle.checked
                        ? "绘画叠加在输入图像上方"
                        : "输入图作为绘画背景，最终输出不包含输入图";
            statusMessage.style.color = "#AEB6C2";
        }
    }

    function resizeCanvas() {
        const ratio = outputWidth / outputHeight;
        const viewportWidth = Math.max(1, overlay.clientWidth);
        const viewportHeight = Math.max(1, overlay.clientHeight - 42);
        const leftWidth = Math.max(132, Math.min(170, viewportWidth * 0.12));
        const rightWidth = Math.max(190, Math.min(250, viewportWidth * 0.17));
        const gap = 8;
        const availableWidth = Math.max(1, viewportWidth - leftWidth - rightWidth - gap * 2);
        const availableHeight = Math.max(1, viewportHeight - 8);
        let cssWidth = availableWidth;
        let cssHeight = cssWidth / ratio;
        if (cssHeight > availableHeight) {
            cssHeight = availableHeight;
            cssWidth = cssHeight * ratio;
        }
        stage.style.gridTemplateColumns = `${Math.round(leftWidth)}px ${Math.max(1, Math.round(cssWidth))}px ${Math.round(rightWidth)}px`;
        stage.style.columnGap = `${gap}px`;
        workspace.style.width = `${Math.max(1, Math.round(cssWidth))}px`;
        workspace.style.height = `${Math.max(1, Math.round(availableHeight))}px`;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        mirrorToggleLabel.style.top = `${Math.max(0, (availableHeight - cssHeight) / 2)}px`;
        canvas.width = Math.max(1, Math.round(cssWidth * dpr));
        canvas.height = Math.max(1, Math.round(cssHeight * dpr));
        render();
    }

    function commitDrawingScale() {
        if (Math.abs(drawingScale - 1) < 0.0001 || !drawing.strokes.length) {
            drawingScale = 1;
            drawingScaleRange.value = "100";
            return;
        }
        drawing.strokes = scaleDrawingStrokes(drawing.strokes, drawingScale).strokes;
        drawingScale = 1;
        drawingScaleRange.value = "100";
    }

    function render() {
        const ctx = canvas.getContext("2d");
        if (artworkCanvas.width !== canvas.width || artworkCanvas.height !== canvas.height) {
            artworkCanvas.width = canvas.width;
            artworkCanvas.height = canvas.height;
        }
        const drawingContext = artworkCanvas.getContext("2d", {willReadFrequently: true});
        drawingContext.clearRect(0, 0, canvas.width, canvas.height);
        drawingContext.fillStyle = normalizeColor(findWidget(node, "背景颜色")?.value, "#FFFFFF");
        drawingContext.fillRect(0, 0, canvas.width, canvas.height);
        drawSourceImage(drawingContext, node, canvas.width, canvas.height);

        const visibleStrokes = Math.abs(drawingScale - 1) < 0.0001
            ? drawing.strokes
            : scaleDrawingStrokes(drawing.strokes, drawingScale).strokes;
        for (const stroke of visibleStrokes) {
            drawStroke(drawingContext, stroke, canvas.width, canvas.height);
        }
        let previewStroke = null;
        if (currentStroke) {
            previewStroke = smoothingToggle.checked && currentStroke.tool !== "lasso" && !currentStroke.shape
                ? {...currentStroke, points: smoothWithCurrentStrength(currentStroke.points)}
                : currentStroke;
            drawStroke(drawingContext, previewStroke, canvas.width, canvas.height, true);
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(artworkCanvas, 0, 0);
        drawStrokeVisibilityGuides(
            ctx,
            previewStroke ? [...visibleStrokes, previewStroke] : visibleStrokes,
            canvas.width,
            canvas.height,
            visibilityGuideCanvas,
        );
        if (selectedStrokeIndex >= 0 && selectedStrokeIndex < visibleStrokes.length && visibleStrokes[selectedStrokeIndex]?.visible !== false) {
            drawStrokeSelection(ctx, visibleStrokes[selectedStrokeIndex], canvas.width, canvas.height);
            if (tool === "select") {
                const bounds = drawingGroupBounds(visibleStrokes, [selectedStrokeIndex]);
                if (bounds) drawLayerTransformBox(ctx, bounds, canvas.width, canvas.height);
            }
        }
        if (groupSelection) {
            const bounds = drawingGroupBounds(visibleStrokes, groupSelection.indices);
            if (bounds) drawLayerTransformBox(ctx, bounds, canvas.width, canvas.height);
        }
        if (groupDraft) {
            drawGroupBox(ctx, normalizedRect(groupDraft.start, groupDraft.end), canvas.width, canvas.height, true);
        }
        if (mirrorToggle.checked || tool === "move") {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const centerX = canvas.width / 2;
            ctx.save();
            ctx.setLineDash([14 * dpr, 9 * dpr]);
            ctx.lineWidth = 6 * dpr;
            ctx.strokeStyle = "rgba(8, 12, 16, 0.9)";
            ctx.beginPath();
            ctx.moveTo(centerX, 0);
            ctx.lineTo(centerX, canvas.height);
            ctx.stroke();
            ctx.lineWidth = 3 * dpr;
            ctx.strokeStyle = "#39FF88";
            ctx.shadowColor = "rgba(57, 255, 136, 0.75)";
            ctx.shadowBlur = 5 * dpr;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
            ctx.fillStyle = "#39FF88";
            ctx.strokeStyle = "#081016";
            ctx.lineWidth = 2 * dpr;
            for (const [tipY, baseY] of [[12 * dpr, 2 * dpr], [canvas.height - 12 * dpr, canvas.height - 2 * dpr]]) {
                ctx.beginPath();
                ctx.moveTo(centerX, tipY);
                ctx.lineTo(centerX - 8 * dpr, baseY);
                ctx.lineTo(centerX + 8 * dpr, baseY);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    function eventPoint(event) {
        const bounds = canvas.getBoundingClientRect();
        return [
            clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
            clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
        ];
    }

    function eventCanvasPoint(event) {
        const point = eventPoint(event);
        return [point[0] * canvas.width, point[1] * canvas.height];
    }

    function sampleArtworkColor(event) {
        const [pointerX, pointerY] = eventCanvasPoint(event);
        const sampleX = Math.max(0, Math.min(artworkCanvas.width - 1, Math.floor(pointerX)));
        const sampleY = Math.max(0, Math.min(artworkCanvas.height - 1, Math.floor(pointerY)));
        try {
            const ctx = artworkCanvas.getContext("2d", {willReadFrequently: true});
            const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
            const sampledColor = rgbaToHex(pixel[0], pixel[1], pixel[2]);
            applyPickedColor(sampledColor, "已从画布吸取颜色");
        } catch (_) {
            statusMessage.textContent = "当前画面无法读取颜色，请等待输入图预览加载完成";
            statusMessage.style.color = "#FF9B73";
        }
    }

    function updateLassoClosure(stroke) {
        if (stroke?.tool !== "lasso" || stroke.points.length < 3) {
            return false;
        }
        const first = stroke.points[0];
        const last = stroke.points[stroke.points.length - 1];
        const distance = Math.hypot(
            (last[0] - first[0]) * canvas.clientWidth,
            (last[1] - first[1]) * canvas.clientHeight,
        );
        stroke.canClose = distance <= LASSO_CLOSE_DISTANCE;
        statusMessage.textContent = stroke.canClose ? "已闭合，松开鼠标完成填充" : "沿边界圈选，并回到绿色起点";
        statusMessage.style.color = stroke.canClose ? "#39FF88" : "#AEB6C2";
        return stroke.canClose;
    }

    function startStroke(event) {
        if (event.button !== 0 && event.pointerType !== "touch") {
            return;
        }
        event.preventDefault();
        if (tool === "eyedropper") {
            sampleArtworkColor(event);
            return;
        }
        if (tool === "group") {
            let historyRecorded = false;
            if (Math.abs(drawingScale - 1) >= 0.0001) {
                recordHistory();
                commitDrawingScale();
                historyRecorded = true;
            }
            const point = eventPoint(event);
            const [pointerX, pointerY] = eventCanvasPoint(event);
            const bounds = groupSelection ? drawingGroupBounds(drawing.strokes, groupSelection.indices) : null;
            const handle = bounds ? hitLayerTransformHandle(bounds, pointerX, pointerY, canvas.width, canvas.height) : null;
            canvas.setPointerCapture?.(event.pointerId);
            selectedStrokeIndex = -1;
            if (handle) {
                groupDrag = {
                    mode: handle.mode,
                    handle,
                    bounds,
                    startPoint: point,
                    centerX: (bounds.minX + bounds.maxX) / 2,
                    centerY: (bounds.minY + bounds.maxY) / 2,
                    startAngle: Math.atan2(
                        point[1] - (bounds.minY + bounds.maxY) / 2,
                        point[0] - (bounds.minX + bounds.maxX) / 2,
                    ),
                    originalStrokes: cloneDrawingStrokes(),
                    historyRecorded,
                };
                groupDraft = null;
            } else if (bounds && pointInGroupBounds(bounds, point)) {
                groupDrag = {
                    mode: "move",
                    startPoint: point,
                    bounds,
                    originalStrokes: cloneDrawingStrokes(),
                    historyRecorded,
                };
                groupDraft = null;
            } else {
                groupSelection = null;
                groupDrag = null;
                groupDraft = {start: point, end: point};
            }
            refreshControls();
            render();
            return;
        }
        if (tool === "select") {
            let historyRecorded = false;
            if (Math.abs(drawingScale - 1) >= 0.0001) {
                recordHistory();
                commitDrawingScale();
                historyRecorded = true;
            }
            const [pointerX, pointerY] = eventCanvasPoint(event);
            const point = eventPoint(event);
            const currentIndex = selectedStrokeIndex;
            const currentBounds = currentIndex >= 0 ? drawingGroupBounds(drawing.strokes, [currentIndex]) : null;
            const transformHandle = currentBounds
                ? hitLayerTransformHandle(currentBounds, pointerX, pointerY, canvas.width, canvas.height)
                : null;
            if (currentIndex >= 0 && transformHandle) {
                canvas.setPointerCapture?.(event.pointerId);
                strokeDrag = {
                    mode: transformHandle.mode,
                    handle: transformHandle,
                    bounds: currentBounds,
                    startPoint: point,
                    centerX: (currentBounds.minX + currentBounds.maxX) / 2,
                    centerY: (currentBounds.minY + currentBounds.maxY) / 2,
                    startAngle: Math.atan2(
                        point[1] - (currentBounds.minY + currentBounds.maxY) / 2,
                        point[0] - (currentBounds.minX + currentBounds.maxX) / 2,
                    ),
                    originalStrokes: cloneDrawingStrokes(),
                    historyRecorded,
                };
            } else {
                let hitIndex = -1;
                if (currentIndex >= 0 && currentBounds && pointInGroupBounds(currentBounds, point)) {
                    hitIndex = currentIndex;
                } else {
                    for (let index = drawing.strokes.length - 1; index >= 0; index -= 1) {
                        if (drawing.strokes[index]?.visible !== false && hitTestStroke(drawing.strokes[index], pointerX, pointerY, canvas.width, canvas.height)) {
                            hitIndex = index;
                            break;
                        }
                    }
                }
                selectedStrokeIndex = hitIndex;
                strokeDrag = hitIndex >= 0 ? {
                    mode: "move",
                    startPoint: point,
                    originalStrokes: cloneDrawingStrokes(),
                    originalStroke: structuredClone(drawing.strokes[hitIndex]),
                    historyRecorded,
                } : null;
            }
            refreshLayerPanel();
            refreshControls();
            render();
            return;
        }
        if (tool === "move") {
            const layout = getSourceImageLayout(node, canvas.width, canvas.height);
            if (!layout) {
                statusMessage.textContent = "当前没有可移动的输入图片";
                statusMessage.style.color = "#FF9B73";
                return;
            }
            const [pointerX, pointerY] = eventCanvasPoint(event);
            const insideImage = pointerX >= layout.left && pointerX <= layout.left + layout.width &&
                pointerY >= layout.top && pointerY <= layout.top + layout.height;
            if (!insideImage) {
                statusMessage.textContent = "请按住输入图片后拖动";
                statusMessage.style.color = "#FF9B73";
                return;
            }
            canvas.setPointerCapture?.(event.pointerId);
            imageDrag = {
                offsetX: pointerX - layout.centerX,
                offsetY: pointerY - layout.centerY,
            };
            refreshControls();
            return;
        }
        currentStrokeHasHistory = false;
        if (Math.abs(drawingScale - 1) >= 0.0001) {
            recordHistory();
            commitDrawingScale();
            currentStrokeHasHistory = true;
        }
        canvas.setPointerCapture?.(event.pointerId);
        if (tool === "eraser") {
            eraserDrag = {historyRecorded: currentStrokeHasHistory};
            eraseStrokeAt(...eventCanvasPoint(event));
            return;
        }
        if (tool === "shape") {
            const [centerX, centerY] = eventCanvasPoint(event);
            shapeDraft = {shape: shapeType, sides: shapeSides, centerX, centerY};
            currentStroke = {
                tool: "brush",
                brushType: "solid",
                shape: shapeType,
                shapeSides,
                visible: true,
                color: brushColor,
                size: brushSize / Math.max(1, Math.min(outputWidth, outputHeight)),
                mirrorX: mirrorToggle.checked,
                points: shapePointsAt(centerX + 1, centerY),
            };
            selectedStrokeIndex = -1;
            render();
            return;
        }
        currentStroke = {
            tool,
            brushType: tool === "brush" ? brushType : "solid",
            visible: true,
            color: tool === "lasso" ? fillColor : brushColor,
            size: brushSize / Math.max(1, Math.min(outputWidth, outputHeight)),
            mirrorX: mirrorToggle.checked,
            points: [eventPoint(event)],
        };
        render();
    }

    function moveStroke(event) {
        if (groupDraft) {
            event.preventDefault();
            groupDraft.end = eventPoint(event);
            render();
            return;
        }
        if (groupDrag && groupSelection) {
            event.preventDefault();
            const point = eventPoint(event);
            let transformed;
            if (groupDrag.mode === "move") {
                let deltaX = point[0] - groupDrag.startPoint[0];
                let deltaY = point[1] - groupDrag.startPoint[1];
                deltaX = clamp(deltaX, -groupDrag.bounds.minX, 1 - groupDrag.bounds.maxX);
                deltaY = clamp(deltaY, -groupDrag.bounds.minY, 1 - groupDrag.bounds.maxY);
                transformed = transformDrawingGroup(groupDrag.originalStrokes, groupSelection.indices, {deltaX, deltaY, clampToCanvas: false});
            } else if (groupDrag.mode === "rotate") {
                const currentAngle = Math.atan2(point[1] - groupDrag.centerY, point[0] - groupDrag.centerX);
                transformed = transformDrawingGroup(groupDrag.originalStrokes, groupSelection.indices, {
                    anchorX: groupDrag.centerX,
                    anchorY: groupDrag.centerY,
                    rotationDegrees: (currentAngle - groupDrag.startAngle) * 180 / Math.PI,
                    clampToCanvas: false,
                });
            } else {
                const originalWidth = Math.max(0.0001, groupDrag.bounds.maxX - groupDrag.bounds.minX);
                const originalHeight = Math.max(0.0001, groupDrag.bounds.maxY - groupDrag.bounds.minY);
                const scaleX = Math.abs(point[0] - groupDrag.handle.anchorX) / originalWidth;
                const scaleY = Math.abs(point[1] - groupDrag.handle.anchorY) / originalHeight;
                const scale = clamp(Math.max(scaleX, scaleY), 0.05, 20);
                transformed = transformDrawingGroup(groupDrag.originalStrokes, groupSelection.indices, {
                    anchorX: groupDrag.handle.anchorX,
                    anchorY: groupDrag.handle.anchorY,
                    scale,
                    clampToCanvas: false,
                });
            }
            if (!groupDrag.historyRecorded) {
                recordHistory();
                groupDrag.historyRecorded = true;
            }
            drawing.strokes = transformed;
            statusMessage.textContent = groupDrag.mode === "move"
                ? "正在移动选中的图层"
                : groupDrag.mode === "rotate"
                    ? "正在旋转选中的图层"
                    : "正在等比例缩放选中的图层";
            statusMessage.style.color = "#79B7FF";
            render();
            return;
        }
        if (strokeDrag && selectedStrokeIndex >= 0) {
            event.preventDefault();
            const point = eventPoint(event);
            const deltaX = point[0] - strokeDrag.startPoint[0];
            const deltaY = point[1] - strokeDrag.startPoint[1];
            let transformed = strokeDrag.originalStrokes;
            if (strokeDrag.mode === "scale") {
                const originalWidth = Math.max(0.0001, strokeDrag.bounds.maxX - strokeDrag.bounds.minX);
                const originalHeight = Math.max(0.0001, strokeDrag.bounds.maxY - strokeDrag.bounds.minY);
                const scaleX = Math.abs(point[0] - strokeDrag.handle.anchorX) / originalWidth;
                const scaleY = Math.abs(point[1] - strokeDrag.handle.anchorY) / originalHeight;
                transformed = transformDrawingGroup(strokeDrag.originalStrokes, [selectedStrokeIndex], {
                    anchorX: strokeDrag.handle.anchorX,
                    anchorY: strokeDrag.handle.anchorY,
                    scale: clamp(Math.max(scaleX, scaleY), 0.05, 20),
                });
            } else if (strokeDrag.mode === "rotate") {
                const currentAngle = Math.atan2(point[1] - strokeDrag.centerY, point[0] - strokeDrag.centerX);
                transformed = transformDrawingGroup(strokeDrag.originalStrokes, [selectedStrokeIndex], {
                    anchorX: strokeDrag.centerX,
                    anchorY: strokeDrag.centerY,
                    rotationDegrees: (currentAngle - strokeDrag.startAngle) * 180 / Math.PI,
                });
            } else {
                transformed = structuredClone(strokeDrag.originalStrokes);
                transformed[selectedStrokeIndex] = translateStrokeLayer(strokeDrag.originalStroke, deltaX, deltaY);
            }
            if (!strokeDrag.historyRecorded && Math.hypot(deltaX, deltaY) > 0.0005) {
                recordHistory();
                strokeDrag.historyRecorded = true;
            }
            drawing.strokes = transformed;
            statusMessage.textContent = strokeDrag.mode === "scale"
                ? "正在等比例缩放选中图层"
                : strokeDrag.mode === "rotate"
                    ? "正在旋转选中图层"
                    : `正在移动第 ${selectedStrokeIndex + 1} 个图层`;
            statusMessage.style.color = "#79B7FF";
            render();
            return;
        }
        if (shapeDraft && currentStroke) {
            event.preventDefault();
            const [pointerX, pointerY] = eventCanvasPoint(event);
            currentStroke.points = shapePointsAt(pointerX, pointerY);
            render();
            return;
        }
        if (imageDrag) {
            event.preventDefault();
            const layout = getSourceImageLayout(node, canvas.width, canvas.height);
            if (!layout) {
                return;
            }
            const [pointerX, pointerY] = eventCanvasPoint(event);
            const position = resolveDraggedLayerPosition({
                pointerX,
                pointerY,
                dragOffsetX: imageDrag.offsetX,
                dragOffsetY: imageDrag.offsetY,
                areaWidth: canvas.width,
                areaHeight: canvas.height,
                layerWidth: layout.width,
                layerHeight: layout.height,
                snapPercent: -1,
            });
            setWidgetValue(findWidget(node, "图片X"), Number(position.xPercent.toFixed(1)), node);
            setWidgetValue(findWidget(node, "图片Y"), Number(position.yPercent.toFixed(1)), node);
            statusMessage.textContent = `图片位置 X ${position.xPercent.toFixed(1)}%  Y ${position.yPercent.toFixed(1)}%`;
            statusMessage.style.color = "#AEB6C2";
            render();
            return;
        }
        if (eraserDrag) {
            event.preventDefault();
            eraseStrokeAt(...eventCanvasPoint(event));
            return;
        }
        if (!currentStroke) {
            return;
        }
        event.preventDefault();
        const point = eventPoint(event);
        const previous = currentStroke.points[currentStroke.points.length - 1];
        if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 0.0005) {
            currentStroke.points.push(point);
            updateLassoClosure(currentStroke);
            render();
        }
    }

    function finishStroke(event) {
        if (groupDraft) {
            canvas.releasePointerCapture?.(event.pointerId);
            const rectangle = normalizedRect(groupDraft.start, groupDraft.end);
            const indices = [];
            if ((rectangle.maxX - rectangle.minX) * canvas.clientWidth >= 4 &&
                (rectangle.maxY - rectangle.minY) * canvas.clientHeight >= 4) {
                for (let index = 0; index < drawing.strokes.length; index += 1) {
                    const bounds = drawingGroupBounds(drawing.strokes, [index]);
                    if (bounds && bounds.maxX >= rectangle.minX && bounds.minX <= rectangle.maxX &&
                        bounds.maxY >= rectangle.minY && bounds.minY <= rectangle.maxY) {
                        indices.push(index);
                    }
                }
            }
            groupSelection = indices.length ? {indices} : null;
            groupDraft = null;
            refreshControls();
            render();
            return;
        }
        if (groupDrag) {
            canvas.releasePointerCapture?.(event.pointerId);
            groupDrag = null;
            refreshControls();
            render();
            return;
        }
        if (strokeDrag) {
            canvas.releasePointerCapture?.(event.pointerId);
            strokeDrag = null;
            refreshControls();
            render();
            return;
        }
        if (imageDrag) {
            canvas.releasePointerCapture?.(event.pointerId);
            imageDrag = null;
            refreshControls();
            render();
            return;
        }
        if (eraserDrag) {
            canvas.releasePointerCapture?.(event.pointerId);
            eraserDrag = null;
            refreshControls();
            render();
            return;
        }
        if (shapeDraft && currentStroke) {
            const [pointerX, pointerY] = eventCanvasPoint(event);
            currentStroke.points = shapePointsAt(pointerX, pointerY, true);
            shapeDraft = null;
        }
        if (!currentStroke) {
            return;
        }
        canvas.releasePointerCapture?.(event.pointerId);
        const canSave = currentStroke.tool !== "lasso" || updateLassoClosure(currentStroke);
        let regularizedKind = "";
        if (canSave) {
            if (!currentStrokeHasHistory) {
                recordHistory();
            }
            if (currentStroke.tool === "lasso") {
                currentStroke.points[currentStroke.points.length - 1] = [...currentStroke.points[0]];
                delete currentStroke.canClose;
            } else if (!currentStroke.shape) {
                const regularized = smartRegularizeToggle.checked && currentStroke.tool === "brush"
                    ? regularizeStrokePoints(currentStroke.points, canvas.width, canvas.height, regularizeSensitivity)
                    : null;
                if (regularized) {
                    currentStroke.points = regularized.points;
                    currentStroke.regularizedKind = regularized.kind;
                    regularizedKind = regularized.kind;
                } else if (smoothingToggle.checked && currentStroke.points.length >= 3) {
                    currentStroke.points = smoothWithCurrentStrength(currentStroke.points);
                }
            }
            drawing.strokes.push(currentStroke);
        } else {
            statusMessage.textContent = "套索未闭合，已取消本次填充";
            statusMessage.style.color = "#FF9B73";
        }
        currentStroke = null;
        currentStrokeHasHistory = false;
        render();
        if (canSave) {
            refreshControls();
            if (regularizedKind) {
                const labels = {line: "直线", circle: "圆形", ellipse: "椭圆", arc: "圆弧"};
                statusMessage.textContent = `已规整为${labels[regularizedKind] || "标准图形"}，可撤销恢复`;
                statusMessage.style.color = "#39FF88";
            }
        } else {
            window.setTimeout(refreshControls, 1400);
        }
    }

    function closeEditor() {
        window.removeEventListener("resize", resizeCanvas);
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("keyup", onKeyUp, true);
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("keyup", onKeyUp, true);
        overlay.remove();
        delete node.__jindouyunDrawingEditor;
    }

    function saveDrawing(runAfterSave = false, requestedQueueCount = 1) {
        commitDrawingScale();
        drawing.version = 7;
        drawing.smoothing = smoothingToggle.checked;
        drawing.smoothingStrength = Math.round(smoothingStrength);
        drawing.smartRegularize = smartRegularizeToggle.checked;
        drawing.regularizeSensitivity = Math.round(regularizeSensitivity);
        drawing.brushColor = brushColor;
        drawing.eyedropperColor = eyedropperColor;
        drawing.savedColors = savedColors;
        drawing.brushType = brushType;
        drawing.inputVisible = inputLayerToggle.checked;
        node.__jindouyunInputVisible = drawing.inputVisible;
        dataWidget.value = JSON.stringify(drawing);
        dataWidget.callback?.(dataWidget.value, app.canvas, node, dataWidget);
        app.graph.setDirtyCanvas(true, true);
        closeEditor();
        if (runAfterSave) {
            window.setTimeout(() => app.queuePrompt?.(0, requestedQueueCount), 50);
        }
    }

    function isEditorHistoryShortcut(event) {
        if (!event.ctrlKey && !event.metaKey) return false;
        const key = String(event.key || "").toLowerCase();
        return key === "z" || key === "y" || event.code === "KeyZ" || event.code === "KeyY";
    }

    function isEditorTransformShortcut(event) {
        if (!event.ctrlKey && !event.metaKey) return false;
        const key = String(event.key || "").toLowerCase();
        return key === "t" || key === "g" || event.code === "KeyT" || event.code === "KeyG";
    }

    function activateFreeTransform() {
        let indices = getLayerSelection();
        if (!indices.length) {
            statusMessage.textContent = "请先在图层面板选择图层，再使用 Ctrl+T";
            statusMessage.style.color = "#FF9B73";
            return;
        }
        if (indices.length > 1) {
            const groupIds = new Set(indices.map((index) => drawing.strokes[index]?.groupId).filter(Boolean));
            const sharedGroupId = groupIds.size === 1 ? [...groupIds][0] : null;
            const allInSharedGroup = sharedGroupId && indices.every((index) => drawing.strokes[index]?.groupId === sharedGroupId);
            if (!allInSharedGroup) {
                createGroupFromSelection();
                return;
            }
            indices = drawing.strokes
                .map((stroke, index) => stroke.groupId === sharedGroupId ? index : -1)
                .filter((index) => index >= 0);
            selectedGroupId = sharedGroupId;
        }
        selectedStrokeIndex = -1;
        groupSelection = {indices};
        tool = "group";
        refreshControls();
        render();
    }

    function blockEditorShortcut(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }

    function isNativeColorPickerEscape(event) {
        return event.key === "Escape"
            && (nativeColorPickerActive || event.target === customColor || document.activeElement === customColor);
    }

    function onKeyDown(event) {
        if (event.key === "Escape") {
            // Let the browser cancel its own screen picker without closing this editor.
            if (screenEyedropperActive) {
                event.stopPropagation();
                return;
            }
            if (isNativeColorPickerEscape(event)) {
                blockEditorShortcut(event);
                nativeColorPickerActive = false;
                customColor.blur();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            closeEditor();
        } else if (isEditorTransformShortcut(event)) {
            blockEditorShortcut(event);
            const key = String(event.key || "").toLowerCase();
            if (key === "g" || event.code === "KeyG") {
                createGroupFromSelection();
            } else {
                activateFreeTransform();
            }
        } else if (isEditorHistoryShortcut(event)) {
            blockEditorShortcut(event);
            const key = String(event.key || "").toLowerCase();
            if (key === "y" || event.code === "KeyY") {
                redoButton.click();
                return;
            }
            if (event.shiftKey) {
                redoButton.click();
            } else {
                undoButton.click();
            }
        }
    }

    function onKeyUp(event) {
        if (isEditorHistoryShortcut(event) || isEditorTransformShortcut(event)) {
            blockEditorShortcut(event);
        }
    }

    moveImageButton.addEventListener("click", () => { tool = "move"; selectedStrokeIndex = -1; refreshControls(); render(); });
    selectStrokeButton.addEventListener("click", () => { tool = "select"; refreshControls(); render(); });
    groupSelectButton.addEventListener("click", () => {
        tool = "group";
        selectedStrokeIndex = -1;
        refreshControls();
        render();
    });
    createGroupButton.addEventListener("click", createGroupFromSelection);
    ungroupButton.addEventListener("click", ungroupSelection);
    brushButton.addEventListener("click", () => {
        brushType = "solid";
        drawing.brushType = brushType;
        tool = "brush";
        selectedStrokeIndex = -1;
        refreshControls();
        render();
    });
    pencilBrushButton.addEventListener("click", () => {
        brushType = "pencil";
        drawing.brushType = brushType;
        tool = "brush";
        selectedStrokeIndex = -1;
        refreshControls();
        render();
    });
    eyedropperButton.addEventListener("click", () => {
        tool = "eyedropper";
        selectedStrokeIndex = -1;
        groupSelection = null;
        refreshControls();
        render();
    });
    screenEyedropperButton.addEventListener("click", async () => {
        if (screenEyedropperActive) return;
        if (typeof window.EyeDropper !== "function") {
            statusMessage.textContent = "当前浏览器不支持屏幕取色，请使用左侧画布吸管";
            statusMessage.style.color = "#FF9B73";
            return;
        }
        screenEyedropperActive = true;
        screenEyedropperButton.disabled = true;
        screenEyedropperButton.textContent = "⌾ 取色中…";
        screenEyedropperButton.title = "屏幕取色已开启，请移动到目标颜色后单击";
        screenEyedropperButton.style.background = "#1D5C9C";
        screenEyedropperButton.style.cursor = "wait";
        screenEyedropperButton.setAttribute("aria-busy", "true");
        statusMessage.textContent = "屏幕取色已开启，请将鼠标移到目标颜色后单击";
        statusMessage.style.color = "#79B7FF";
        try {
            const result = await new window.EyeDropper().open();
            const selectedColor = normalizeColor(result?.sRGBHex, "");
            if (!selectedColor) throw new Error("屏幕取色没有返回有效颜色");
            applyPickedColor(selectedColor, "已从屏幕吸取颜色");
        } catch (error) {
            if (error?.name === "AbortError") {
                statusMessage.textContent = "已取消屏幕取色";
                statusMessage.style.color = "#AEB6C2";
            } else {
                statusMessage.textContent = "屏幕取色没有成功，请重新尝试";
                statusMessage.style.color = "#FF9B73";
            }
        } finally {
            screenEyedropperActive = false;
            screenEyedropperButton.disabled = false;
            screenEyedropperButton.textContent = "⌾ 屏幕取色";
            screenEyedropperButton.title = "直接吸取屏幕任意位置的颜色并自动新增颜色球";
            screenEyedropperButton.style.background = "#153A63";
            screenEyedropperButton.style.cursor = "pointer";
            screenEyedropperButton.removeAttribute("aria-busy");
        }
    });
    eraserButton.addEventListener("click", () => { tool = "eraser"; selectedStrokeIndex = -1; refreshControls(); render(); });
    lassoButton.addEventListener("click", () => { tool = "lasso"; selectedStrokeIndex = -1; refreshControls(); render(); });
    shapeButton.addEventListener("click", () => { tool = "shape"; selectedStrokeIndex = -1; refreshControls(); render(); });
    shapeSelect.addEventListener("change", () => {
        shapeType = shapeSelect.value;
        if (shapeType === "star" && shapeSides === 6) {
            shapeSides = 5;
            shapeSidesInput.value = "5";
        }
        tool = "shape";
        selectedStrokeIndex = -1;
        refreshControls();
        render();
    });
    shapeSidesInput.addEventListener("change", () => {
        shapeSides = Math.round(clamp(shapeSidesInput.value, 3, 12));
        shapeSidesInput.value = String(shapeSides);
        tool = "shape";
        refreshControls();
    });
    sizeInput.addEventListener("input", () => {
        brushSize = Number(sizeInput.value);
        sizeText.textContent = `画笔大小 ${brushSize}`;
        customSizeInput.value = String(brushSize);
    });
    customSizeInput.addEventListener("change", () => {
        brushSize = Math.round(clamp(customSizeInput.value, 1, 5000));
        customSizeInput.value = String(brushSize);
        sizeInput.value = String(clamp(brushSize, 2, 20));
        sizeText.textContent = `画笔大小 ${brushSize}`;
    });
    undoButton.addEventListener("click", () => {
        if (Math.abs(drawingScale - 1) >= 0.0001) {
            drawingScale = 1;
            drawingScaleRange.value = "100";
            refreshControls();
            render();
            return;
        }
        const current = cloneHistoryState();
        if (undoStack.length) {
            restoreHistoryState(undoStack.pop());
            redoStack.push(current);
        } else if (drawing.strokes.length) {
            redoStack.push(current);
            drawing.strokes.pop();
        }
        refreshControls();
        render();
    });
    redoButton.addEventListener("click", () => {
        const next = redoStack.pop();
        if (next) {
            undoStack.push(cloneHistoryState());
            restoreHistoryState(next);
        }
        refreshControls();
        render();
    });
    clearButton.addEventListener("click", () => {
        if (drawing.strokes.length && window.confirm("清空全部绘画内容？")) {
            recordHistory();
            drawing.strokes = [];
            selectedStrokeIndex = -1;
            drawingScale = 1;
            drawingScaleRange.value = "100";
            refreshControls();
            render();
        }
    });
    outputToggle.addEventListener("change", () => {
        setWidgetValue(includeInputWidget, outputToggle.checked, node);
        refreshControls();
    });
    inputLayerToggle.addEventListener("change", () => {
        recordHistory();
        drawing.inputVisible = inputLayerToggle.checked;
        node.__jindouyunInputVisible = drawing.inputVisible;
        render();
    });
    function updateRotation(value) {
        const rotation = Math.max(-180, Math.min(180, Number(value) || 0));
        rotationRange.value = String(rotation);
        rotationNumber.value = rotation.toFixed(1);
        setWidgetValue(rotationWidget, rotation.toFixed(1), node);
        render();
    }
    rotationRange.addEventListener("input", () => updateRotation(rotationRange.value));
    rotationNumber.addEventListener("change", () => updateRotation(rotationNumber.value));
    resetRotationButton.addEventListener("click", () => updateRotation(0));
    mirrorToggle.addEventListener("change", () => {
        mirrorEnabled = mirrorToggle.checked;
        node.__jindouyunMirrorEnabled = mirrorEnabled;
        refreshControls();
        render();
    });
    smoothingToggle.addEventListener("change", () => {
        smoothingEnabled = smoothingToggle.checked;
        drawing.smoothing = smoothingEnabled;
        node.__jindouyunSmoothingEnabled = smoothingEnabled;
        refreshControls();
        render();
    });
    smoothingStrengthInput.addEventListener("input", () => {
        smoothingStrength = clamp(smoothingStrengthInput.value, 0, 100);
        drawing.smoothingStrength = Math.round(smoothingStrength);
        smoothingStrengthText.textContent = `强度 ${Math.round(smoothingStrength)}%`;
        render();
    });
    smartRegularizeToggle.addEventListener("change", () => {
        smartRegularizeEnabled = smartRegularizeToggle.checked;
        drawing.smartRegularize = smartRegularizeEnabled;
        refreshControls();
        render();
    });
    regularizeSensitivityInput.addEventListener("input", () => {
        regularizeSensitivity = clamp(regularizeSensitivityInput.value, 0, 100);
        drawing.regularizeSensitivity = Math.round(regularizeSensitivity);
        regularizeSensitivityText.textContent = `识别灵敏度 ${Math.round(regularizeSensitivity)}%`;
        render();
    });
    optimizeSelectedButton.addEventListener("click", () => {
        if (selectedStrokeIndex < 0 || selectedStrokeIndex >= drawing.strokes.length) {
            return;
        }
        const profile = currentSmoothingProfile();
        const preview = smoothDrawingStrokes([drawing.strokes[selectedStrokeIndex]], profile.strength, profile.passes);
        if (!preview.optimizedCount) {
            return;
        }
        recordHistory();
        commitDrawingScale();
        const optimized = smoothDrawingStrokes(
            [drawing.strokes[selectedStrokeIndex]],
            profile.strength,
            profile.passes,
        );
        drawing.strokes[selectedStrokeIndex] = optimized.strokes[0];
        refreshControls();
        render();
        statusMessage.textContent = `已优化第 ${selectedStrokeIndex + 1} 笔曲线，可撤销恢复`;
        statusMessage.style.color = "#39FF88";
    });
    optimizeAllButton.addEventListener("click", () => {
        const profile = currentSmoothingProfile();
        const preview = smoothDrawingStrokes(drawing.strokes, profile.strength, profile.passes);
        if (!preview.optimizedCount) {
            return;
        }
        recordHistory();
        commitDrawingScale();
        const optimized = smoothDrawingStrokes(drawing.strokes, profile.strength, profile.passes);
        drawing.strokes = optimized.strokes;
        refreshControls();
        render();
        statusMessage.textContent = `已优化 ${optimized.optimizedCount} 笔曲线，可撤销恢复`;
        statusMessage.style.color = "#39FF88";
    });
    drawingScaleRange.addEventListener("input", () => {
        const requestedScale = Number(drawingScaleRange.value) / 100;
        const resolved = scaleDrawingStrokes(drawing.strokes, requestedScale);
        drawingScale = resolved.scale;
        drawingScaleRange.value = String(Math.round(drawingScale * 100));
        refreshControls();
        render();
    });
    resetDrawingScaleButton.addEventListener("click", () => {
        drawingScale = 1;
        drawingScaleRange.value = "100";
        refreshControls();
        render();
    });
    closeButton.addEventListener("click", closeEditor);
    saveButton.addEventListener("click", () => saveDrawing(false));
    queueMinusButton.addEventListener("click", () => setQueueCount(queueCount - 1));
    queuePlusButton.addEventListener("click", () => setQueueCount(queueCount + 1));
    queueCountInput.addEventListener("input", () => {
        if (queueCountInput.value !== "" && Number.isFinite(Number(queueCountInput.value))) {
            setQueueCount(queueCountInput.value);
        }
    });
    queueCountInput.addEventListener("change", () => setQueueCount(queueCountInput.value || queueCount));
    runButton.addEventListener("click", () => saveDrawing(true, queueCount));
    canvas.addEventListener("pointerdown", startStroke);
    canvas.addEventListener("pointermove", moveStroke);
    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", finishStroke);
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);

    refreshControls();
    requestAnimationFrame(resizeCanvas);
}

function addDrawingButton(node) {
    if (node.__jindouyunDrawingButton || !node.addDOMWidget) {
        return;
    }
    node.__jindouyunDrawingButton = true;
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        display: "flex",
        gap: "8px",
        padding: "6px 10px 10px",
        boxSizing: "border-box",
        minHeight: "50px",
        maxWidth: "100%",
        overflow: "hidden",
        pointerEvents: "auto",
    });
    const drawButton = makeButton("全屏绘画");
    Object.assign(drawButton.style, {
        flex: "1 1 0", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis",
        background: "#E85D04", borderColor: "#FF7A1A", fontWeight: "600",
    });
    drawButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDrawingEditor(node);
    });

    const clearButton = makeButton("清空绘画", "一键清空该节点的全部绘画内容");
    Object.assign(clearButton.style, {
        flex: "0 1 112px", minWidth: "72px", maxWidth: "112px", overflow: "hidden", textOverflow: "ellipsis",
        background: "#343A43", borderColor: "#59616D",
    });
    clearButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const dataWidget = findWidget(node, "绘画数据");
        if (!dataWidget) {
            return;
        }
        dataWidget.value = JSON.stringify(DEFAULT_DATA);
        dataWidget.callback?.(dataWidget.value, app.canvas, node, dataWidget);
        app.graph.setDirtyCanvas(true, true);
        clearButton.textContent = "已清空";
        clearButton.style.background = "#227A49";
        window.setTimeout(() => {
            clearButton.textContent = "清空绘画";
            clearButton.style.background = "#343A43";
        }, 900);
    });

    wrapper.append(drawButton, clearButton);
    const widget = node.addDOMWidget("全屏绘画", "jindouyun_canvas_drawing", wrapper, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 52,
        getMaxHeight: () => 52,
    });
    const syncWidth = () => {
        const width = Math.max(180, Number(node.size?.[0] || 360) - 28);
        wrapper.style.width = `${width}px`;
        wrapper.style.maxWidth = `${width}px`;
        return width;
    };
    syncWidth();
    widget.computeSize = () => [syncWidth(), 52];
    const originalOnResize = node.onResize;
    node.onResize = function() {
        originalOnResize?.apply(this, arguments);
        syncWidth();
    };
}

function patchNode(node) {
    if ((node.comfyClass || node.type) !== NODE_TYPE) {
        return;
    }
    patchRotationWidget(node);
    hideDrawingWidget(node);
    const scaleModeWidget = findWidget(node, "缩放方式");
    if (scaleModeWidget && normalizeScaleMode(scaleModeWidget.value) === SCALE_MODE_MANUAL && scaleModeWidget.value !== SCALE_MODE_MANUAL) {
        scaleModeWidget.value = SCALE_MODE_MANUAL;
    }
    addDrawingButton(node);
}

app.registerExtension({
    name: "comfyui-jindouyun-design.canvas-drawing",
    nodeCreated(node) {
        patchNode(node);
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) {
            return;
        }
        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            patchNode(this);
        };
        const originalOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function() {
            originalOnConfigure?.apply(this, arguments);
            patchRotationWidget(this);
        };
        const originalOnRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            this.__jindouyunDrawingEditor?.remove();
            originalOnRemoved?.apply(this, arguments);
        };
    },
});
