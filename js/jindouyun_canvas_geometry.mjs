export const SCALE_MODE_FIT = "适应画布";
export const SCALE_MODE_HEIGHT = "高度占画布";
export const SCALE_MODE_WIDTH = "宽度占画布";
export const SCALE_MODE_MANUAL = "手动缩放";
export const CANVAS_PERCENT_MAX = 2000;

export function smoothStrokePoints(points, strength = 0.96, passes = 3) {
    if (!Array.isArray(points) || points.length < 3) {
        return Array.isArray(points) ? points.map((point) => [...point]) : [];
    }
    const amount = Math.max(0, Math.min(1, Number(strength) || 0));
    const passCount = Math.max(1, Math.min(4, Math.round(Number(passes) || 1)));
    let result = points.map((point) => [Number(point?.[0]) || 0, Number(point?.[1]) || 0]);
    const radius = Math.max(2, Math.min(18, Math.round(result.length * (0.025 + amount * 0.065))));
    for (let pass = 0; pass < passCount; pass += 1) {
        const next = [];
        for (let index = 0; index < result.length; index += 1) {
            if (index === 0 || index === result.length - 1) {
                next.push([...result[index]]);
                continue;
            }
            let weightedX = 0;
            let weightedY = 0;
            let totalWeight = 0;
            const start = Math.max(0, index - radius);
            const end = Math.min(result.length - 1, index + radius);
            for (let sample = start; sample <= end; sample += 1) {
                const weight = radius + 1 - Math.abs(sample - index);
                weightedX += result[sample][0] * weight;
                weightedY += result[sample][1] * weight;
                totalWeight += weight;
            }
            const edgeProtection = Math.min(
                1,
                index / radius,
                (result.length - 1 - index) / radius,
            );
            const blend = amount * edgeProtection;
            const current = result[index];
            next.push([
                current[0] + (weightedX / totalWeight - current[0]) * blend,
                current[1] + (weightedY / totalWeight - current[1]) * blend,
            ]);
        }
        result = next;
    }
    return result;
}

export function smoothDrawingStrokes(strokes, strength = 0.96, passes = 3) {
    let optimizedCount = 0;
    const optimized = (strokes || []).map((stroke) => {
        if (!stroke || stroke.tool === "lasso" || stroke.shape || !Array.isArray(stroke.points) || stroke.points.length < 3) {
            return structuredClone(stroke);
        }
        optimizedCount += 1;
        return {...stroke, points: smoothStrokePoints(stroke.points, strength, passes)};
    });
    return {strokes: optimized, optimizedCount};
}

export function resolveSmoothingProfile(value) {
    const level = Math.max(0, Math.min(100, Number(value) || 0));
    if (level <= 50) {
        return {
            strength: Number((0.35 + level / 50 * 0.6).toFixed(4)),
            passes: level < 20 ? 1 : level < 40 ? 2 : 3,
        };
    }
    const upper = (level - 50) / 50;
    return {
        strength: Number((0.95 + upper * 0.05).toFixed(4)),
        passes: 3 + Math.round(upper * 3),
    };
}

export function translateStrokeLayer(stroke, deltaX, deltaY) {
    const points = Array.isArray(stroke?.points) ? stroke.points : [];
    if (!points.length) {
        return structuredClone(stroke);
    }
    const xs = points.map((point) => Number(point?.[0])).filter(Number.isFinite);
    const ys = points.map((point) => Number(point?.[1])).filter(Number.isFinite);
    if (!xs.length || !ys.length) {
        return structuredClone(stroke);
    }
    const requestedX = Number(deltaX) || 0;
    const requestedY = Number(deltaY) || 0;
    const appliedX = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), requestedX));
    const appliedY = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), requestedY));
    return {
        ...stroke,
        points: points.map((point) => [
            Math.max(0, Math.min(1, Number(point?.[0]) + appliedX)),
            Math.max(0, Math.min(1, Number(point?.[1]) + appliedY)),
        ]),
    };
}

export function createShapeStrokePoints({
    shape,
    centerX,
    centerY,
    pointerX,
    pointerY,
    canvasWidth,
    canvasHeight,
    sides = 6,
}) {
    const width = Math.max(2, Number(canvasWidth) || 2);
    const height = Math.max(2, Number(canvasHeight) || 2);
    const maximumX = width - 1;
    const maximumY = height - 1;
    const cx = Math.max(0, Math.min(maximumX, Number(centerX) || 0));
    const cy = Math.max(0, Math.min(maximumY, Number(centerY) || 0));
    const numericPointerX = Number(pointerX);
    const numericPointerY = Number(pointerY);
    const dx = (Number.isFinite(numericPointerX) ? numericPointerX : cx) - cx;
    const dy = (Number.isFinite(numericPointerY) ? numericPointerY : cy) - cy;
    const maximumRadius = Math.max(1, Math.min(cx, maximumX - cx, cy, maximumY - cy));
    const requestedRadius = shape === "square" ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy);
    const radius = Math.max(1, Math.min(maximumRadius, requestedRadius || 1));
    const normalizedPoint = (x, y) => [
        Math.max(0, Math.min(1, x / maximumX)),
        Math.max(0, Math.min(1, y / maximumY)),
    ];

    if (shape === "square") {
        const points = [
            normalizedPoint(cx - radius, cy - radius),
            normalizedPoint(cx + radius, cy - radius),
            normalizedPoint(cx + radius, cy + radius),
            normalizedPoint(cx - radius, cy + radius),
        ];
        points.push([...points[0]]);
        return points;
    }

    const pointCount = Math.max(3, Math.min(12, Math.round(Number(sides) || 6)));
    const vertices = shape === "star" ? pointCount * 2 : shape === "polygon" ? pointCount : 64;
    const points = [];
    for (let index = 0; index < vertices; index += 1) {
        const angle = -Math.PI / 2 + index / vertices * Math.PI * 2;
        const pointRadius = shape === "star" && index % 2 === 1 ? radius * 0.45 : radius;
        points.push(normalizedPoint(
            cx + Math.cos(angle) * pointRadius,
            cy + Math.sin(angle) * pointRadius,
        ));
    }
    points.push([...points[0]]);
    return points;
}

function drawingPointBounds(strokes) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const stroke of strokes || []) {
        const pointSets = [stroke?.points || []];
        if (Array.isArray(stroke?.mirrorPoints)) pointSets.push(stroke.mirrorPoints);
        for (const points of pointSets) for (const point of points) {
            const x = Number(point?.[0]);
            const y = Number(point?.[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            if (stroke?.mirrorX === true) {
                minX = Math.min(minX, 1 - x);
                maxX = Math.max(maxX, 1 - x);
            }
        }
    }
    return Number.isFinite(minX) ? {minX, minY, maxX, maxY} : null;
}

export function resolveDrawingScale(strokes, requestedScale) {
    const requested = Math.max(0.1, Math.min(3, Number(requestedScale) || 1));
    const bounds = drawingPointBounds(strokes);
    if (!bounds) {
        return {scale: 1, centerX: 0.5, centerY: 0.5};
    }
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const limits = [3];
    if (bounds.minX < centerX) limits.push(centerX / (centerX - bounds.minX));
    if (bounds.maxX > centerX) limits.push((1 - centerX) / (bounds.maxX - centerX));
    if (bounds.minY < centerY) limits.push(centerY / (centerY - bounds.minY));
    if (bounds.maxY > centerY) limits.push((1 - centerY) / (bounds.maxY - centerY));
    const maximum = Math.max(0.1, Math.min(...limits.filter(Number.isFinite)));
    return {scale: Math.min(requested, maximum), centerX, centerY};
}

export function scaleDrawingStrokes(strokes, requestedScale) {
    const transform = resolveDrawingScale(strokes, requestedScale);
    const scale = transform.scale;
    return {
        ...transform,
        strokes: (strokes || []).map((stroke) => ({
            ...stroke,
            size: Math.max(0.0005, Math.min(0.5, (Number(stroke?.size) || 0.02) * scale)),
            points: (stroke?.points || []).map((point) => [
                Math.max(0, Math.min(1, transform.centerX + (Number(point?.[0]) - transform.centerX) * scale)),
                Math.max(0, Math.min(1, transform.centerY + (Number(point?.[1]) - transform.centerY) * scale)),
            ]),
        })),
    };
}

export function drawingGroupBounds(strokes, indices = null) {
    const selected = indices instanceof Set ? indices : new Set(indices || (strokes || []).map((_, index) => index));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [index, stroke] of (strokes || []).entries()) {
        if (!selected.has(index)) continue;
        for (const point of stroke?.points || []) {
            const x = Number(point?.[0]);
            const y = Number(point?.[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            if (stroke?.mirrorX === true) {
                minX = Math.min(minX, 1 - x);
                maxX = Math.max(maxX, 1 - x);
            }
        }
    }
    return Number.isFinite(minX) ? {minX, minY, maxX, maxY} : null;
}

export function transformDrawingGroup(strokes, indices, {
    anchorX = 0.5,
    anchorY = 0.5,
    scale = 1,
    deltaX = 0,
    deltaY = 0,
    rotationDegrees = 0,
    clampToCanvas = true,
} = {}) {
    const selected = indices instanceof Set ? indices : new Set(indices || []);
    const safeScale = Math.max(0.01, Math.min(20, Number(scale) || 1));
    const offsetX = Number(deltaX) || 0;
    const offsetY = Number(deltaY) || 0;
    const radians = Number(rotationDegrees || 0) * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return (strokes || []).map((stroke, index) => {
        if (!selected.has(index)) return structuredClone(stroke);
        const transformPoint = (point) => {
            const scaledX = anchorX + (Number(point?.[0]) - anchorX) * safeScale;
            const scaledY = anchorY + (Number(point?.[1]) - anchorY) * safeScale;
            const relativeX = scaledX - anchorX;
            const relativeY = scaledY - anchorY;
            const transformedX = anchorX + relativeX * cosine - relativeY * sine + offsetX;
            const transformedY = anchorY + relativeX * sine + relativeY * cosine + offsetY;
            return clampToCanvas
                ? [Math.max(0, Math.min(1, transformedX)), Math.max(0, Math.min(1, transformedY))]
                : [Math.max(-20, Math.min(20, transformedX)), Math.max(-20, Math.min(20, transformedY))];
        };
        const sourceMirrorPoints = Array.isArray(stroke?.mirrorPoints)
            ? stroke.mirrorPoints
            : stroke?.mirrorX === true
                ? (stroke.points || []).map((point) => [1 - Number(point?.[0]), Number(point?.[1])])
                : null;
        const transformedStroke = {
            ...structuredClone(stroke),
            points: (stroke?.points || []).map(transformPoint),
        };
        if (sourceMirrorPoints) {
            transformedStroke.mirrorPoints = sourceMirrorPoints.map(transformPoint);
            transformedStroke.mirrorX = false;
        }
        return {
            ...transformedStroke,
            size: Math.max(0.0005, Math.min(0.5, (Number(stroke?.size) || 0.02) * safeScale)),
        };
    });
}

export function normalizeScaleMode(value) {
    const mode = String(value || "").trim();
    return mode === SCALE_MODE_FIT || mode === SCALE_MODE_HEIGHT || mode === SCALE_MODE_WIDTH || mode === SCALE_MODE_MANUAL
        ? mode
        : SCALE_MODE_FIT;
}

export function normalizeManualScale(value) {
    const scale = Math.max(0.01, Number(value) || 1);
    return scale > 10 ? 1 : scale;
}

export function fitLayerToPreview(layerWidth, layerHeight, areaWidth, areaHeight) {
    const width = Math.max(1, Number(layerWidth) || 1);
    const height = Math.max(1, Number(layerHeight) || 1);
    const maxWidth = Math.max(1, Number(areaWidth) || 1);
    const maxHeight = Math.max(1, Number(areaHeight) || 1);
    const fit = Math.min(1, maxWidth / width, maxHeight / height);
    return {
        width: Math.max(1, width * fit),
        height: Math.max(1, height * fit),
    };
}

export function resizeLayerFromCorner({
    pointerX,
    pointerY,
    anchorX,
    anchorY,
    signX,
    signY,
    aspectRatio,
    areaX,
    areaY,
    areaWidth,
    areaHeight,
    minSize = 16,
}) {
    const ratio = Math.max(0.01, Number(aspectRatio) || 1);
    const directionX = signX < 0 ? -1 : 1;
    const directionY = signY < 0 ? -1 : 1;
    const availableWidth = directionX < 0 ? anchorX - areaX : areaX + areaWidth - anchorX;
    const availableHeight = directionY < 0 ? anchorY - areaY : areaY + areaHeight - anchorY;
    const maxWidth = Math.max(1, Math.min(availableWidth, availableHeight * ratio));
    const minimumWidth = Math.min(maxWidth, Math.max(1, minSize, minSize * ratio));
    const requestedWidth = Math.max(
        Math.abs(Number(pointerX) - anchorX),
        Math.abs(Number(pointerY) - anchorY) * ratio,
    );
    const width = Math.max(minimumWidth, Math.min(maxWidth, requestedWidth));
    const height = width / ratio;
    const cornerX = anchorX + directionX * width;
    const cornerY = anchorY + directionY * height;
    return {
        width,
        height,
        centerX: (anchorX + cornerX) / 2,
        centerY: (anchorY + cornerY) / 2,
    };
}

function draggedAxisPosition({pointer, dragOffset, areaStart, areaSize, layerSize, snapPercent}) {
    const size = Math.max(1, Number(areaSize) || 1);
    const layer = Math.max(1, Number(layerSize) || 1);
    const start = Number(areaStart) || 0;
    const desiredCenter = Number(pointer) - (Number(dragOffset) || 0);
    const middle = start + size / 2;
    const limits = layer <= size
        ? {min: start + layer / 2, max: start + size - layer / 2}
        : {min: start + size - layer / 2, max: start + layer / 2};
    const desiredPercent = (desiredCenter - start) / size * 100;
    const threshold = Number(snapPercent);
    const snapped = Number.isFinite(threshold) && threshold >= 0 && Math.abs(desiredPercent - 50) <= threshold;
    const center = snapped
        ? middle
        : Math.max(limits.min, Math.min(limits.max, desiredCenter));
    return {center, percent: (center - start) / size * 100, snapped};
}

export function resolveDraggedLayerPosition({
    pointerX,
    pointerY,
    dragOffsetX = 0,
    dragOffsetY = 0,
    areaX = 0,
    areaY = 0,
    areaWidth,
    areaHeight,
    layerWidth,
    layerHeight,
    snapPercent = 2.5,
}) {
    const horizontal = draggedAxisPosition({
        pointer: pointerX,
        dragOffset: dragOffsetX,
        areaStart: areaX,
        areaSize: areaWidth,
        layerSize: layerWidth,
        snapPercent,
    });
    const vertical = draggedAxisPosition({
        pointer: pointerY,
        dragOffset: dragOffsetY,
        areaStart: areaY,
        areaSize: areaHeight,
        layerSize: layerHeight,
        snapPercent,
    });
    return {
        xPercent: horizontal.percent,
        yPercent: vertical.percent,
        centerX: horizontal.center,
        centerY: vertical.center,
        snappedX: horizontal.snapped,
        snappedY: vertical.snapped,
    };
}

export function normalizeRotationDegrees(value) {
    const degrees = Number(value);
    if (!Number.isFinite(degrees)) {
        return 0;
    }
    return ((degrees + 180) % 360 + 360) % 360 - 180;
}

export function resolveRotatedBounds(width, height, rotationDegrees) {
    const sourceWidth = Math.max(1, Number(width) || 1);
    const sourceHeight = Math.max(1, Number(height) || 1);
    const radians = normalizeRotationDegrees(rotationDegrees) * Math.PI / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    return {
        width: Math.max(1, Math.ceil(sourceWidth * cosine + sourceHeight * sine - 1e-6)),
        height: Math.max(1, Math.ceil(sourceWidth * sine + sourceHeight * cosine - 1e-6)),
    };
}

export function resolveLayerSize({
    imageWidth,
    imageHeight,
    canvasWidth,
    canvasHeight,
    scale,
    scaleMode,
    canvasPercent,
}) {
    const sourceWidth = Math.max(1, Number(imageWidth) || 1);
    const sourceHeight = Math.max(1, Number(imageHeight) || 1);
    const outputWidth = Math.max(1, Number(canvasWidth) || 1);
    const outputHeight = Math.max(1, Number(canvasHeight) || 1);
    const mode = normalizeScaleMode(scaleMode);
    const percent = Math.max(1, Math.min(CANVAS_PERCENT_MAX, Number(canvasPercent) || 90)) / 100;
    let targetWidth;
    let targetHeight;

    if (mode === SCALE_MODE_FIT) {
        const fitScale = Math.min(outputWidth / sourceWidth, outputHeight / sourceHeight) * percent;
        targetWidth = sourceWidth * fitScale;
        targetHeight = sourceHeight * fitScale;
    } else if (mode === SCALE_MODE_HEIGHT) {
        targetHeight = outputHeight * percent;
        targetWidth = targetHeight * sourceWidth / sourceHeight;
    } else if (mode === SCALE_MODE_WIDTH) {
        targetWidth = outputWidth * percent;
        targetHeight = targetWidth * sourceHeight / sourceWidth;
    } else {
        const baseScale = Math.min(1, outputWidth / sourceWidth, outputHeight / sourceHeight);
        const manualScale = normalizeManualScale(scale);
        targetWidth = sourceWidth * baseScale * manualScale;
        targetHeight = sourceHeight * baseScale * manualScale;
        const edgeFit = Math.min(1, outputWidth / targetWidth, outputHeight / targetHeight);
        targetWidth *= edgeFit;
        targetHeight *= edgeFit;
    }

    return {
        width: Math.max(1, targetWidth),
        height: Math.max(1, targetHeight),
    };
}

export function scaleValuesFromPreview({
    width,
    height,
    areaWidth,
    areaHeight,
    imageWidth,
    imageHeight,
    canvasWidth,
    canvasHeight,
    scaleMode,
}) {
    const previewWidth = Math.max(1, Number(areaWidth) || 1);
    const previewHeight = Math.max(1, Number(areaHeight) || 1);
    const outputWidth = Math.max(1, Number(canvasWidth) || 1);
    const outputHeight = Math.max(1, Number(canvasHeight) || 1);
    const mode = normalizeScaleMode(scaleMode);

    if (mode === SCALE_MODE_HEIGHT) {
        return {canvasPercent: Math.max(1, Math.min(CANVAS_PERCENT_MAX, Number(height) / previewHeight * 100))};
    }
    if (mode === SCALE_MODE_WIDTH) {
        return {canvasPercent: Math.max(1, Math.min(CANVAS_PERCENT_MAX, Number(width) / previewWidth * 100))};
    }

    const base = resolveLayerSize({
        imageWidth,
        imageHeight,
        canvasWidth: outputWidth,
        canvasHeight: outputHeight,
        scale: 1,
        scaleMode: mode,
        canvasPercent: 100,
    });
    const basePreviewWidth = base.width / outputWidth * previewWidth;
    const basePreviewHeight = base.height / outputHeight * previewHeight;
    const ratio = Math.max(
        Number(width) / Math.max(1, basePreviewWidth),
        Number(height) / Math.max(1, basePreviewHeight),
    );

    if (mode === SCALE_MODE_FIT) {
        return {canvasPercent: Math.max(1, Math.min(CANVAS_PERCENT_MAX, ratio * 100))};
    }
    return {manualScale: Math.max(0.01, Math.min(10, ratio))};
}
