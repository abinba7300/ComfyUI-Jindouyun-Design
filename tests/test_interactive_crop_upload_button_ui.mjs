import assert from "node:assert/strict";
import fs from "node:fs/promises";

const path = new URL("../js/jindouyun_interactive_crop_upload_button.js", import.meta.url);
const source = await fs.readFile(path, "utf8");

assert.match(source, /const NODE_TYPE = "JindouyunInteractiveCrop"/);
assert.match(source, /import \{ api \} from "\.\.\/\.\.\/scripts\/api\.js"/);
assert.match(source, /const RANDOM_FOLDER_ENDPOINT = "\/jindouyun_design\/select_random_crop_image_folder"/);
assert.match(source, /const UPLOAD_BUTTON_HEIGHT = 42/);
assert.match(source, /function findUploadButton\(node\)/);
assert.match(source, /widget\.type === "button"/);
assert.match(source, /widget\.constructor\?\.name === "ButtonWidget"/);
assert.match(source, /选择\.\*上传\|choose\.\*upload/);
assert.match(source, /widget\.label = "选择要上传的图片"/);
assert.match(source, /从图片文件夹随机加载/);
assert.match(source, /node\.properties\.jindouyunCropImageFolder/);
assert.match(source, /initial_path: node\.properties\.jindouyunCropImageFolder \|\| ""/);
assert.match(source, /findFolderWidget\(node\)/);
assert.match(source, /setFolderWidgetValue\(node, folderWidget, result\.folder_path\)/);
assert.match(source, /if \(savedFolder\) setFolderWidgetValue\(node, folderWidget, savedFolder\)/);
assert.match(source, /setUploadWidgetValue\(node, uploadWidget, result\.image\)/);
assert.match(source, /文件夹随机已开启/);
assert.match(source, /jindouyun_random_folder_image/);
assert.match(source, /api\.addEventListener\("executed"/);
assert.match(source, /node\.__jindouyunPreserveCropForRandomFolder = true/);
assert.match(source, /if \(widget\.__jindouyunUploadButtonPatched\) \{\s+addRandomFolderButton\(node, widget\);/);
assert.match(source, /ctx\.roundRect\(left, top, buttonWidth, buttonHeight, 6\)/);
assert.match(source, /ctx\.fillStyle = pressed \? "#1F6B43" : hovered \? "#3EAF72" : "#2E8B57"/);
assert.match(source, /ctx\.strokeStyle = hovered \? "#9AF0B8" : "#61C98A"/);
assert.match(source, /afterConfigureGraph\(\)/);
assert.match(source, /patchUploadButton\(this\)/);

console.log("interactive crop upload button UI test passed");
