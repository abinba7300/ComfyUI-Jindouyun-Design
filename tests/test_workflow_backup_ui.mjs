import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/jindouyun_workflow_backup.js", import.meta.url), "utf8");

assert.match(source, /Comfy\.SaveWorkflow/);
assert.match(source, /Comfy\.SaveWorkflowAs/);
assert.match(source, /工作流历史/);
assert.match(source, /筋斗云-工作流历史版本管理/);
assert.match(source, /每个工作流保留最近 \$\{BACKUP_LIMIT\} 个手工保存时间点/);
assert.match(source, /await requestBackup\(info\.path, "restore"\)/);
assert.match(source, /保存新版本/);
assert.match(source, /版本名称/);
assert.match(source, /版本备注/);
assert.match(source, /重命名\/备注/);
assert.match(source, /suppressAutomaticBackup/);
assert.match(source, /createNamedVersion/);
assert.match(source, /updateBackupMetadata/);
assert.match(source, /deleteBackup/);
assert.match(source, /jdy-history-delete/);
assert.match(source, /删除这个历史版本/);
assert.match(source, /background: #a93636/);
assert.match(source, /jdy-history-load \{ background: #2f6fb7/);
assert.match(source, /jdy-history-save \{ background: #23834a/);
assert.match(source, /function workflowVersionName\(info\)/);
assert.match(source, /const BACKUP_LIMIT = 20;/);
assert.match(source, /jindouyun-workflow-quick-save-button/);
assert.match(source, /快速保存/);
assert.match(source, /jdy-quick-save-success/);
assert.match(source, /background: #23834a/);
assert.match(source, /name: workflowVersionName\(currentInfo\)/);
assert.match(source, /document\.body\.appendChild\(overlay\);\s*nameInput\.value = initialName;/s);

const transformed = source
    .replace(/^import .*;\s*$/gm, "")
    .replace(/app\.registerExtension\([\s\S]*?\n\}\);/, "")
    .replace(/export \{[\s\S]*?\};/, "globalThis.__exports = { formatSize, formatTime, isWorkflowSaveRequest, workflowPathFromSaveRequest, workflowVersionName };");

const context = {
    console,
    globalThis: {},
    document: {},
    window: {},
    app: {},
    api: {},
    alert() {},
    confirm() { return true; },
    Intl,
    URLSearchParams,
};
vm.runInNewContext(transformed, context);
const helpers = context.globalThis.__exports;

assert.equal(helpers.formatSize(1536), "1.5 KB");
assert.equal(
    helpers.workflowPathFromSaveRequest("/userdata/workflows%2Ffolder%2Fdemo.json?overwrite=true"),
    "folder/demo.json",
);
assert.equal(helpers.workflowVersionName({filename: "产品方案.json", path: "项目/产品方案.json"}), "产品方案");
assert.equal(helpers.workflowVersionName({filename: "", path: "项目/设计稿.app.json"}), "设计稿");
assert.equal(helpers.workflowVersionName({filename: "临时名称.json", path: "项目/真实工作流名称.json"}), "真实工作流名称");

console.log("workflow backup UI tests passed");
