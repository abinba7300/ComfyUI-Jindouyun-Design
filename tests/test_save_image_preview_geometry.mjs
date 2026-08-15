import assert from "node:assert/strict";
import {
    containImageRect,
    featuredPreviewRects,
    interpolateRect,
    pointInRect,
} from "../js/jindouyun_save_preview_geometry.mjs";

const rects = featuredPreviewRects(10, 20, 400, 360, 4, 6);
assert.equal(rects.length, 4);
assert.equal(rects[0].featured, true);
assert.equal(rects[0].height, 360);
assert.ok(rects[0].width > rects[1].width * 2);
assert.equal(rects[1].x, rects[2].x);
assert.equal(rects[2].x, rects[3].x);
assert.ok(rects[1].y < rects[2].y && rects[2].y < rects[3].y);
assert.ok(rects.every((rect) => rect.x >= 10 && rect.y >= 20));
assert.ok(rects.every((rect) => rect.x + rect.width <= 410.0001));
assert.ok(rects.every((rect) => rect.y + rect.height <= 380.0001));

const single = featuredPreviewRects(0, 0, 300, 200, 1);
assert.deepEqual(single, [{x: 0, y: 0, width: 300, height: 200, featured: true}]);

const fitted = containImageRect(1000, 500, {x: 0, y: 0, width: 200, height: 200}, 0);
assert.equal(fitted.width, 200);
assert.equal(fitted.height, 100);
assert.equal(fitted.y, 50);

assert.equal(pointInRect(50, 50, {x: 10, y: 20, width: 80, height: 60}), true);
assert.equal(pointInRect(5, 50, {x: 10, y: 20, width: 80, height: 60}), false);

const animated = interpolateRect(
    {x: 0, y: 0, width: 100, height: 80},
    {x: 200, y: 100, width: 6, height: 6},
    1,
);
assert.deepEqual(animated, {x: 200, y: 100, width: 6, height: 6});

console.log("save image featured preview geometry tests passed");
