export const SCALE_MODE_FIT = "适应画布";
export const SCALE_MODE_HEIGHT = "高度占画布";
export const SCALE_MODE_WIDTH = "宽度占画布";
export const SCALE_MODE_MANUAL = "手动缩放";
export const CANVAS_PERCENT_MAX = 2000;

export function resolvePreviewArea({
    widgetWidth,
    widgetHeight,
    canvasWidth,
    canvasHeight,
    horizontalMargin = 16,
    verticalMargin = 8,
}) {
    const width = Math.max(1, Number(widgetWidth) || 1);
    const height = Math.max(1, Number(widgetHeight) || 1);
    const outputWidth = Math.max(1, Number(canvasWidth) || 1);
    const outputHeight = Math.max(1, Number(canvasHeight) || 1);
    const marginX = Math.max(0, Number(horizontalMargin) || 0);
    const marginY = Math.max(0, Number(verticalMargin) || 0);
    const outerWidth = Math.max(1, width - marginX * 2);
    const outerHeight = Math.max(1, height - marginY * 2);
    const ratio = outputWidth / outputHeight;

    let areaWidth = outerWidth;
    let areaHeight = areaWidth / ratio;
    if (areaHeight > outerHeight) {
        areaHeight = outerHeight;
        areaWidth = areaHeight * ratio;
    }
    return {
        x: marginX + (outerWidth - areaWidth) / 2,
        y: marginY + (outerHeight - areaHeight) / 2,
        width: areaWidth,
        height: areaHeight,
    };
}

export function resolvePreviewWidgetHeight({
    widgetWidth,
    canvasWidth,
    canvasHeight,
    horizontalMargin = 16,
    minHeight = 230,
    maxHeight = 560,
}) {
    const width = Math.max(1, Number(widgetWidth) || 1);
    const outputWidth = Math.max(1, Number(canvasWidth) || 1);
    const outputHeight = Math.max(1, Number(canvasHeight) || 1);
    const marginX = Math.max(0, Number(horizontalMargin) || 0);
    const availableWidth = Math.max(1, width - marginX * 2);
    const naturalHeight = availableWidth * outputHeight / outputWidth;
    return Math.round(Math.max(minHeight, Math.min(maxHeight, naturalHeight)));
}

function regularizationPixels(points, width, height) {
    const maximumX = Math.max(1, (Number(width) || 2) - 1);
    const maximumY = Math.max(1, (Number(height) || 2) - 1);
    const result = [];
    for (const point of Array.isArray(points) ? points : []) {
        const x = Number(point?.[0]);
        const y = Number(point?.[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const pixel = [x * maximumX, y * maximumY];
        const previous = result.at(-1);
        if (!previous || Math.hypot(pixel[0] - previous[0], pixel[1] - previous[1]) >= 0.75) {
            result.push(pixel);
        }
    }
    return {points: result, maximumX, maximumY};
}

function polylineLength(points) {
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
        length += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
    }
    return length;
}

function solveLinear3(matrix, values) {
    const rows = matrix.map((row, index) => [...row, values[index]]);
    for (let column = 0; column < 3; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < 3; row += 1) {
            if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
        }
        if (Math.abs(rows[pivot][column]) < 1e-9) return null;
        [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
        const divisor = rows[column][column];
        for (let index = column; index < 4; index += 1) rows[column][index] /= divisor;
        for (let row = 0; row < 3; row += 1) {
            if (row === column) continue;
            const factor = rows[row][column];
            for (let index = column; index < 4; index += 1) rows[row][index] -= factor * rows[column][index];
        }
    }
    return rows.map((row) => row[3]);
}

function fitCircle(points) {
    let xx = 0;
    let xy = 0;
    let yy = 0;
    let x = 0;
    let y = 0;
    let xz = 0;
    let yz = 0;
    let z = 0;
    for (const point of points) {
        const px = point[0];
        const py = point[1];
        const squared = px * px + py * py;
        xx += px * px;
        xy += px * py;
        yy += py * py;
        x += px;
        y += py;
        xz += px * squared;
        yz += py * squared;
        z += squared;
    }
    const count = points.length;
    const solution = solveLinear3(
        [[xx, xy, x], [xy, yy, y], [x, y, count]],
        [-xz, -yz, -z],
    );
    if (!solution) return null;
    const centerX = -solution[0] / 2;
    const centerY = -solution[1] / 2;
    const radiusSquared = centerX * centerX + centerY * centerY - solution[2];
    if (!Number.isFinite(radiusSquared) || radiusSquared <= 1) return null;
    const radius = Math.sqrt(radiusSquared);
    const radialErrors = points.map((point) => Math.abs(Math.hypot(point[0] - centerX, point[1] - centerY) - radius) / radius);
    const rmsError = Math.sqrt(radialErrors.reduce((sum, error) => sum + error * error, 0) / radialErrors.length);
    return {centerX, centerY, radius, rmsError};
}

function unwrapAngles(points, centerX, centerY) {
    const angles = [Math.atan2(points[0][1] - centerY, points[0][0] - centerX)];
    let backwards = 0;
    let forwards = 0;
    for (let index = 1; index < points.length; index += 1) {
        let delta = Math.atan2(points[index][1] - centerY, points[index][0] - centerX) - angles[index - 1];
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        if (delta > 0.002) forwards += delta;
        if (delta < -0.002) backwards -= delta;
        angles.push(angles[index - 1] + delta);
    }
    const dominant = Math.max(forwards, backwards);
    const reversalRatio = dominant > 0 ? Math.min(forwards, backwards) / dominant : 1;
    return {start: angles[0], end: angles.at(-1), span: Math.abs(angles.at(-1) - angles[0]), reversalRatio};
}

function fitOrientedEllipse(points) {
    const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
    const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
    let covarianceXX = 0;
    let covarianceXY = 0;
    let covarianceYY = 0;
    for (const point of points) {
        const dx = point[0] - meanX;
        const dy = point[1] - meanY;
        covarianceXX += dx * dx;
        covarianceXY += dx * dy;
        covarianceYY += dy * dy;
    }
    const rotation = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const projected = points.map((point) => {
        const dx = point[0] - meanX;
        const dy = point[1] - meanY;
        return [dx * cosine + dy * sine, -dx * sine + dy * cosine];
    });
    const minU = Math.min(...projected.map((point) => point[0]));
    const maxU = Math.max(...projected.map((point) => point[0]));
    const minV = Math.min(...projected.map((point) => point[1]));
    const maxV = Math.max(...projected.map((point) => point[1]));
    const radiusU = (maxU - minU) / 2;
    const radiusV = (maxV - minV) / 2;
    if (radiusU < 8 || radiusV < 8) return null;
    const offsetU = (minU + maxU) / 2;
    const offsetV = (minV + maxV) / 2;
    const centerX = meanX + offsetU * cosine - offsetV * sine;
    const centerY = meanY + offsetU * sine + offsetV * cosine;
    const errors = projected.map((point) => {
        const u = (point[0] - offsetU) / radiusU;
        const v = (point[1] - offsetV) / radiusV;
        return Math.abs(Math.hypot(u, v) - 1);
    });
    const rmsError = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length);
    const firstU = (projected[0][0] - offsetU) / radiusU;
    const firstV = (projected[0][1] - offsetV) / radiusV;
    const signedArea = points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    return {
        centerX, centerY, radiusU, radiusV, rotation, rmsError,
        startAngle: Math.atan2(firstV, firstU),
        direction: signedArea >= 0 ? 1 : -1,
    };
}

function normalizedRegularizationPoints(points, maximumX, maximumY) {
    return points.map((point) => [
        Math.max(0, Math.min(1, point[0] / maximumX)),
        Math.max(0, Math.min(1, point[1] / maximumY)),
    ]);
}

export function regularizeStrokePoints(points, width, height, sensitivity = 50) {
    const converted = regularizationPixels(points, width, height);
    const pixels = converted.points;
    if (pixels.length < 2) return null;
    const level = Math.max(0, Math.min(100, Number(sensitivity) || 0));
    const lineTolerance = 0.008 + level * 0.00016;
    const curveTolerance = 0.035 + level * 0.00045;
    const first = pixels[0];
    const last = pixels.at(-1);
    const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
    const pathLength = polylineLength(pixels);
    const xs = pixels.map((point) => point[0]);
    const ys = pixels.map((point) => point[1]);
    const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (diagonal < 8 || pathLength < 8) return null;

    if (chord >= 16) {
        const dx = last[0] - first[0];
        const dy = last[1] - first[1];
        const squaredDistances = pixels.map((point) => {
            const distance = Math.abs(dy * point[0] - dx * point[1] + last[0] * first[1] - last[1] * first[0]) / chord;
            return distance * distance;
        });
        const rmsDistance = Math.sqrt(squaredDistances.reduce((sum, value) => sum + value, 0) / squaredDistances.length);
        if (rmsDistance / chord <= lineTolerance && pathLength / chord <= 1.04 + level * 0.0012) {
            return {
                kind: "line",
                confidence: Math.max(0, 1 - rmsDistance / Math.max(1, chord * lineTolerance)),
                points: [[...points[0]], [...points.at(-1)]],
            };
        }
    }

    if (pixels.length < 8) return null;
    const closureRatio = chord / Math.max(1, diagonal);
    if (closureRatio <= 0.08 + level * 0.0014) {
        const ellipse = fitOrientedEllipse(pixels);
        if (ellipse && ellipse.rmsError <= curveTolerance) {
            const axisRatio = Math.max(ellipse.radiusU, ellipse.radiusV) / Math.min(ellipse.radiusU, ellipse.radiusV);
            const kind = axisRatio <= 1.12 + level * 0.0008 ? "circle" : "ellipse";
            const radiusU = kind === "circle" ? (ellipse.radiusU + ellipse.radiusV) / 2 : ellipse.radiusU;
            const radiusV = kind === "circle" ? radiusU : ellipse.radiusV;
            const generated = [];
            const count = 72;
            const cosine = Math.cos(ellipse.rotation);
            const sine = Math.sin(ellipse.rotation);
            for (let index = 0; index <= count; index += 1) {
                const angle = ellipse.startAngle + ellipse.direction * index / count * Math.PI * 2;
                const u = Math.cos(angle) * radiusU;
                const v = Math.sin(angle) * radiusV;
                generated.push([
                    ellipse.centerX + u * cosine - v * sine,
                    ellipse.centerY + u * sine + v * cosine,
                ]);
            }
            const normalized = normalizedRegularizationPoints(generated, converted.maximumX, converted.maximumY);
            normalized[normalized.length - 1] = [...normalized[0]];
            return {kind, confidence: Math.max(0, 1 - ellipse.rmsError / curveTolerance), points: normalized};
        }
    }

    if (closureRatio > 0.12 && pixels.length >= 12) {
        const circle = fitCircle(pixels);
        if (circle && circle.rmsError <= curveTolerance) {
            const angles = unwrapAngles(pixels, circle.centerX, circle.centerY);
            const minimumSpan = Math.PI * (0.18 + (100 - level) * 0.0012);
            if (angles.span >= minimumSpan && angles.span <= Math.PI * 1.92 && angles.reversalRatio <= 0.08 + level * 0.0012) {
                const generated = [];
                const count = Math.max(16, Math.min(96, Math.ceil(angles.span / (Math.PI * 2) * 72)));
                for (let index = 0; index <= count; index += 1) {
                    const angle = angles.start + (angles.end - angles.start) * index / count;
                    generated.push([
                        circle.centerX + Math.cos(angle) * circle.radius,
                        circle.centerY + Math.sin(angle) * circle.radius,
                    ]);
                }
                return {
                    kind: "arc",
                    confidence: Math.max(0, 1 - circle.rmsError / curveTolerance),
                    points: normalizedRegularizationPoints(generated, converted.maximumX, converted.maximumY),
                };
            }
        }
    }
    return null;
}

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
        if (!stroke || stroke.tool === "lasso" || stroke.shape || stroke.regularizedKind || !Array.isArray(stroke.points) || stroke.points.length < 3) {
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
    return Math.min(CANVAS_PERCENT_MAX / 100, scale);
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
    maxScale = CANVAS_PERCENT_MAX / 100,
}) {
    const ratio = Math.max(0.01, Number(aspectRatio) || 1);
    const directionX = signX < 0 ? -1 : 1;
    const directionY = signY < 0 ? -1 : 1;
    const safeMaxScale = Math.max(1, Number(maxScale) || 1);
    const maxWidth = Math.max(1, Math.min(
        Math.max(1, Number(areaWidth) || 1) * safeMaxScale,
        Math.max(1, Number(areaHeight) || 1) * safeMaxScale * ratio,
    ));
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
    return {manualScale: Math.max(0.01, Math.min(CANVAS_PERCENT_MAX / 100, ratio))};
}
