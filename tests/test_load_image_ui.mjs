import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
    droppedSourcePath,
    normalizeDroppedFilePath,
} from "../js/jindouyun_load_image_drop.mjs";

const path = new URL("../js/jindouyun_load_image.js", import.meta.url);
const source = await fs.readFile(path, "utf8");

assert.match(source, /const NODE_TYPE = "JindouyunLoadImage"/);
assert.match(source, /makeButton\("← 上一张"/);
assert.match(source, /makeButton\("下一张 →"/);
assert.match(source, /makeButton\("选择本地图像"/);
assert.match(source, /\/jindouyun_design\/image_siblings/);
assert.match(source, /\/jindouyun_design\/select_local_image/);
assert.match(source, /\/jindouyun_design\/navigate_local_image/);
assert.match(source, /\/jindouyun_design\/resolve_dropped_image/);
assert.match(source, /\(currentIndex \+ direction \+ images\.length\) % images\.length/);
assert.match(source, /imageWidget\.callback\?\.\(nextImage/);
assert.match(source, /node\.onDragDrop = async function/);
assert.match(source, /droppedSourcePath\(event, files\[0\]\)/);
assert.match(source, /原目录未识别/);

assert.equal(normalizeDroppedFilePath("C:\\images\\demo.png"), "C:\\images\\demo.png");
assert.equal(normalizeDroppedFilePath("file:///C:/images/demo.png"), "C:\\images\\demo.png");
assert.equal(normalizeDroppedFilePath("images/demo.png"), "");
assert.equal(droppedSourcePath({}, {path: "D:\\art\\sample.png"}), "D:\\art\\sample.png");
assert.equal(droppedSourcePath({
    dataTransfer: {
        getData(type) {
            return type === "text/uri-list" ? "file:///E:/products/item.png" : "";
        },
    },
}, {}), "E:\\products\\item.png");
assert.match(source, /node\.addDOMWidget\("图片浏览"/);
assert.match(source, /positionLabel\.textContent = available \? `\$\{currentIndex \+ 1\} \/ \$\{images\.length\}`/);

const initSource = await fs.readFile(new URL("../__init__.py", import.meta.url), "utf8");
assert.match(initSource, /"JindouyunLoadImage": JindouyunLoadImage/);
assert.match(initSource, /resolve_dropped_image/);
assert.match(initSource, /"JindouyunLoadImage": "筋斗云-加载图像"/);

console.log("load image UI test passed");
