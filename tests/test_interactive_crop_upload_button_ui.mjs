import assert from "node:assert/strict";
import fs from "node:fs/promises";

const path = new URL("../js/jindouyun_interactive_crop_upload_button.js", import.meta.url);
const source = await fs.readFile(path, "utf8");

assert.match(source, /const NODE_TYPE = "JindouyunInteractiveCrop"/);
assert.match(source, /const UPLOAD_BUTTON_HEIGHT = 42/);
assert.match(source, /function findUploadButton\(node\)/);
assert.match(source, /widget\.type === "button"/);
assert.match(source, /widget\.constructor\?\.name === "ButtonWidget"/);
assert.match(source, /选择\.\*上传\|choose\.\*upload/);
assert.match(source, /widget\.label = "选择要上传的图片"/);
assert.match(source, /ctx\.roundRect\(left, top, buttonWidth, buttonHeight, 6\)/);
assert.match(source, /ctx\.fillStyle = pressed \? "#1F6B43" : hovered \? "#3EAF72" : "#2E8B57"/);
assert.match(source, /ctx\.strokeStyle = hovered \? "#9AF0B8" : "#61C98A"/);
assert.match(source, /afterConfigureGraph\(\)/);
assert.match(source, /patchUploadButton\(this\)/);

console.log("interactive crop upload button UI test passed");
