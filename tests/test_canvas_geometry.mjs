import assert from "node:assert/strict";

import {
    CANVAS_PERCENT_MAX,
    createShapeStrokePoints,
    drawingGroupBounds,
    fitLayerToPreview,
    normalizeManualScale,
    normalizeScaleMode,
    resolveDraggedLayerPosition,
    resolveRotatedBounds,
    resizeLayerFromCorner,
    resolveLayerSize,
    resolveSmoothingProfile,
    scaleDrawingStrokes,
    scaleValuesFromPreview,
    SCALE_MODE_FIT,
    SCALE_MODE_MANUAL,
    smoothStrokePoints,
    smoothDrawingStrokes,
    translateStrokeLayer,
    transformDrawingGroup,
} from "../js/jindouyun_canvas_geometry.mjs";

assert.deepEqual(resolveSmoothingProfile(50), {strength: 0.95, passes: 3});
assert.equal(resolveSmoothingProfile(100).strength, 1);
assert.equal(resolveSmoothingProfile(100).passes, 6);
assert.ok(resolveSmoothingProfile(75).passes > resolveSmoothingProfile(50).passes);

const noisyStroke = [[0, 0], [0.25, 0.3], [0.5, 0.05], [0.75, 0.3], [1, 0]];
const smoothedStroke = smoothStrokePoints(noisyStroke);
assert.deepEqual(smoothedStroke[0], noisyStroke[0]);
assert.deepEqual(smoothedStroke.at(-1), noisyStroke.at(-1));
assert.equal(smoothedStroke.length, noisyStroke.length);
assert.ok(smoothedStroke[2][1] > noisyStroke[2][1]);

const shakyVerticalStroke = Array.from({length: 121}, (_, index) => {
    const progress = index / 120;
    return [0.5 + Math.sin(index * 0.42) * 0.018 + Math.sin(index * 0.11) * 0.012, progress];
});
const stabilizedVerticalStroke = smoothStrokePoints(shakyVerticalStroke);
const horizontalRms = (points) => Math.sqrt(
    points.reduce((sum, point) => sum + (point[0] - 0.5) ** 2, 0) / points.length,
);
assert.ok(
    horizontalRms(stabilizedVerticalStroke) < horizontalRms(shakyVerticalStroke) * 0.55,
    "curve optimization should visibly reduce mouse jitter",
);
const weaklyStabilizedStroke = smoothStrokePoints(shakyVerticalStroke, 0.25, 1);
const stronglyStabilizedStroke = smoothStrokePoints(shakyVerticalStroke, 0.95, 3);
assert.ok(horizontalRms(stronglyStabilizedStroke) < horizontalRms(weaklyStabilizedStroke) * 0.7);

const lassoPoints = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.2]];
const optimizedDrawing = smoothDrawingStrokes([
    {tool: "brush", points: shakyVerticalStroke},
    {tool: "lasso", points: lassoPoints},
    {tool: "brush", shape: "circle", points: shakyVerticalStroke},
], 0.95, 3);
assert.equal(optimizedDrawing.optimizedCount, 1);
assert.notDeepEqual(optimizedDrawing.strokes[0].points, shakyVerticalStroke);
assert.deepEqual(optimizedDrawing.strokes[1].points, lassoPoints);
assert.deepEqual(optimizedDrawing.strokes[2].points, shakyVerticalStroke);

const circlePoints = createShapeStrokePoints({
    shape: "circle", centerX: 500, centerY: 250, pointerX: 600, pointerY: 250,
    canvasWidth: 1000, canvasHeight: 500,
});
assert.equal(circlePoints.length, 65);
assert.deepEqual(circlePoints[0], circlePoints.at(-1));
const circlePixels = circlePoints.map(([x, y]) => [x * 999, y * 499]);
const circleWidth = Math.max(...circlePixels.map((point) => point[0])) - Math.min(...circlePixels.map((point) => point[0]));
const circleHeight = Math.max(...circlePixels.map((point) => point[1])) - Math.min(...circlePixels.map((point) => point[1]));
assert.ok(Math.abs(circleWidth - circleHeight) < 0.01);

assert.equal(createShapeStrokePoints({
    shape: "square", centerX: 300, centerY: 250, pointerX: 380, pointerY: 310,
    canvasWidth: 1000, canvasHeight: 500,
}).length, 5);
assert.equal(createShapeStrokePoints({
    shape: "polygon", sides: 6, centerX: 300, centerY: 250, pointerX: 380, pointerY: 250,
    canvasWidth: 1000, canvasHeight: 500,
}).length, 7);
assert.equal(createShapeStrokePoints({
    shape: "star", sides: 5, centerX: 300, centerY: 250, pointerX: 380, pointerY: 250,
    canvasWidth: 1000, canvasHeight: 500,
}).length, 11);

const translatedLayer = translateStrokeLayer({
    tool: "brush",
    points: [[0.2, 0.3], [0.4, 0.7]],
}, 0.15, -0.1);
const roundedPoints = (points) => points.map((point) => point.map((value) => Number(value.toFixed(6))));
assert.deepEqual(roundedPoints(translatedLayer.points), [[0.35, 0.2], [0.55, 0.6]]);
const clampedLayer = translateStrokeLayer({
    tool: "brush",
    points: [[0.8, 0.2], [0.95, 0.4]],
}, 0.5, 0);
assert.deepEqual(roundedPoints(clampedLayer.points), [[0.85, 0.2], [1, 0.4]]);

const scaledDrawing = scaleDrawingStrokes([{
    tool: "brush",
    size: 0.05,
    points: [[0.25, 0.5], [0.75, 0.5]],
}], 3);
assert.equal(scaledDrawing.scale, 2);
assert.deepEqual(scaledDrawing.strokes[0].points, [[0, 0.5], [1, 0.5]]);
assert.equal(scaledDrawing.strokes[0].size, 0.1);

const groupSource = [
    {tool: "brush", size: 0.02, points: [[0.2, 0.2], [0.4, 0.4]]},
    {tool: "brush", size: 0.03, points: [[0.6, 0.5], [0.8, 0.7]]},
    {tool: "brush", size: 0.01, points: [[0.9, 0.1], [0.95, 0.15]]},
];
assert.deepEqual(drawingGroupBounds(groupSource, [0, 1]), {
    minX: 0.2, minY: 0.2, maxX: 0.8, maxY: 0.7,
});
const movedGroup = transformDrawingGroup(groupSource, [0, 1], {deltaX: 0.05, deltaY: -0.1});
assert.deepEqual(roundedPoints(movedGroup[0].points), [[0.25, 0.1], [0.45, 0.3]]);
assert.deepEqual(roundedPoints(movedGroup[1].points), [[0.65, 0.4], [0.85, 0.6]]);
assert.deepEqual(movedGroup[2], groupSource[2]);
const resizedGroup = transformDrawingGroup(groupSource, [0, 1], {
    anchorX: 0.2,
    anchorY: 0.2,
    scale: 0.5,
});
assert.deepEqual(roundedPoints(resizedGroup[1].points), [[0.4, 0.35], [0.5, 0.45]]);
assert.equal(resizedGroup[1].size, 0.015);
const originalCenterDistance = 0.7 - 0.3;
const resizedCenterDistance = ((0.4 + 0.5) / 2) - ((0.2 + 0.3) / 2);
assert.ok(Math.abs(resizedCenterDistance - originalCenterDistance * 0.5) < 1e-9);
const unclampedGroup = transformDrawingGroup(groupSource, [0, 1], {
    anchorX: 0,
    anchorY: 0,
    scale: 2,
    clampToCanvas: false,
});
assert.deepEqual(roundedPoints(unclampedGroup[1].points), [[1.2, 1], [1.6, 1.4]]);
const rotatedLayer = transformDrawingGroup([{
    tool: "brush", size: 0.02, points: [[0.6, 0.5], [0.8, 0.5]],
}], [0], {anchorX: 0.5, anchorY: 0.5, rotationDegrees: 90});
assert.deepEqual(roundedPoints(rotatedLayer[0].points), [[0.5, 0.6], [0.5, 0.8]]);
const mirroredGroup = transformDrawingGroup([{
    tool: "brush", mirrorX: true, size: 0.02, points: [[0.25, 0.4], [0.25, 0.6]],
}], [0], {anchorX: 0.5, anchorY: 0.5, scale: 0.5, clampToCanvas: false});
assert.equal(mirroredGroup[0].mirrorX, false);
assert.deepEqual(roundedPoints(mirroredGroup[0].points), [[0.375, 0.45], [0.375, 0.55]]);
assert.deepEqual(roundedPoints(mirroredGroup[0].mirrorPoints), [[0.625, 0.45], [0.625, 0.55]]);

assert.equal(CANVAS_PERCENT_MAX, 2000);
assert.equal(normalizeManualScale(50), 1);
assert.equal(normalizeScaleMode(""), SCALE_MODE_FIT);
assert.equal(normalizeScaleMode(50), SCALE_MODE_FIT);
assert.deepEqual(
    fitLayerToPreview(500, 400, 200, 180),
    {width: 200, height: 160},
);
assert.deepEqual(
    resizeLayerFromCorner({
        pointerX: 90,
        pointerY: 70,
        anchorX: 10,
        anchorY: 10,
        signX: 1,
        signY: 1,
        aspectRatio: 2,
        areaX: 0,
        areaY: 0,
        areaWidth: 100,
        areaHeight: 100,
    }),
    {width: 90, height: 45, centerX: 55, centerY: 32.5},
);

assert.deepEqual(
    resolveDraggedLayerPosition({
        pointerX: 104,
        pointerY: 50,
        dragOffsetX: 0,
        dragOffsetY: 0,
        areaX: 0,
        areaY: 0,
        areaWidth: 200,
        areaHeight: 100,
        layerWidth: 40,
        layerHeight: 20,
        snapPercent: 2.5,
    }),
    {xPercent: 50, yPercent: 50, centerX: 100, centerY: 50, snappedX: true, snappedY: true},
);

assert.deepEqual(
    resolveDraggedLayerPosition({
        pointerX: -50,
        pointerY: -50,
        areaWidth: 200,
        areaHeight: 100,
        layerWidth: 40,
        layerHeight: 20,
    }),
    {xPercent: 10, yPercent: 10, centerX: 20, centerY: 10, snappedX: false, snappedY: false},
);

assert.deepEqual(
    resolveDraggedLayerPosition({
        pointerX: 100,
        pointerY: 50,
        areaWidth: 200,
        areaHeight: 100,
        layerWidth: 40,
        layerHeight: 20,
        snapPercent: -1,
    }),
    {xPercent: 50, yPercent: 50, centerX: 100, centerY: 50, snappedX: false, snappedY: false},
);

assert.deepEqual(
    resolveRotatedBounds(100, 50, 90),
    {width: 50, height: 100},
);

const legacyLayer = resolveLayerSize({
    imageWidth: 110,
    imageHeight: 127,
    canvasWidth: 1442,
    canvasHeight: 1280,
    scale: 2.43,
    scaleMode: "",
    canvasPercent: 90,
});
assert.ok(Math.abs(legacyLayer.width - 997.7952755905512) < 1e-9);
assert.equal(legacyLayer.height, 1152);

const draggedFit = scaleValuesFromPreview({
    width: 180,
    height: 90,
    areaWidth: 200,
    areaHeight: 200,
    imageWidth: 4000,
    imageHeight: 2000,
    canvasWidth: 1000,
    canvasHeight: 1000,
    scaleMode: SCALE_MODE_FIT,
});
assert.deepEqual(draggedFit, {canvasPercent: 90});

const draggedManual = scaleValuesFromPreview({
    width: 138.6,
    height: 160,
    areaWidth: 1442,
    areaHeight: 1280,
    imageWidth: 110,
    imageHeight: 127,
    canvasWidth: 1442,
    canvasHeight: 1280,
    scaleMode: SCALE_MODE_MANUAL,
});
assert.ok(Math.abs(draggedManual.manualScale - 1.26) < 1e-9);

const heightLayer = resolveLayerSize({
    imageWidth: 1024,
    imageHeight: 1024,
    canvasWidth: 1442,
    canvasHeight: 1280,
    scale: 1,
    scaleMode: "高度占画布",
    canvasPercent: 100,
});
assert.deepEqual(heightLayer, {width: 1280, height: 1280});

const twentyTimesLayer = resolveLayerSize({
    imageWidth: 100,
    imageHeight: 200,
    canvasWidth: 1000,
    canvasHeight: 800,
    scale: 1,
    scaleMode: "高度占画布",
    canvasPercent: 2000,
});
assert.deepEqual(twentyTimesLayer, {width: 8000, height: 16000});

console.log("canvas geometry tests passed");
