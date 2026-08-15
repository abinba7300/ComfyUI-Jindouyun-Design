import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "comfyui-jindouyun-design.workflow-backup";
const BACKUP_LIMIT = 20;
const BUTTON_GROUP_ID = "jindouyun-workflow-save-buttons";
const BUTTON_ID = "jindouyun-workflow-history-button";
const QUICK_SAVE_BUTTON_ID = "jindouyun-workflow-quick-save-button";
const DIALOG_ID = "jindouyun-workflow-history-dialog";
const STYLE_ID = "jindouyun-workflow-history-style";
const SAVE_COMMANDS = new Set(["Comfy.SaveWorkflow", "Comfy.SaveWorkflowAs"]);

let manualSaveDepth = 0;
let suppressAutomaticBackup = 0;
let patchedFetch = false;
let originalFetchApi = null;

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        #${BUTTON_GROUP_ID} {
            position: fixed;
            right: 18px;
            bottom: 58px;
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #${BUTTON_GROUP_ID} > button {
            border: 1px solid rgba(255, 255, 255, 0.22);
            border-radius: 6px;
            padding: 8px 12px;
            color: #fff;
            font: 13px/1 sans-serif;
            cursor: pointer;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
            transition: background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
        }
        #${BUTTON_ID} { background: #2c3038; }
        #${BUTTON_ID}:hover { background: #3a404a; }
        #${QUICK_SAVE_BUTTON_ID} {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #23834a;
            border-color: #35a765;
        }
        #${QUICK_SAVE_BUTTON_ID}:hover { background: #2d9a59; }
        #${QUICK_SAVE_BUTTON_ID}:disabled { cursor: wait; opacity: 1; }
        #${QUICK_SAVE_BUTTON_ID} .jdy-quick-save-icon {
            display: inline-grid;
            width: 16px;
            height: 16px;
            place-items: center;
            font-size: 16px;
            font-weight: 800;
        }
        #${QUICK_SAVE_BUTTON_ID}.is-saving .jdy-quick-save-icon {
            animation: jdy-quick-save-pulse 620ms ease-in-out infinite;
        }
        #${QUICK_SAVE_BUTTON_ID}.is-success {
            animation: jdy-quick-save-success 520ms ease-out;
            background: #2fa75f;
            box-shadow: 0 0 0 4px rgba(47, 167, 95, 0.22), 0 7px 20px rgba(0, 0, 0, 0.34);
        }
        @keyframes jdy-quick-save-pulse {
            0%, 100% { transform: translateY(0); opacity: 1; }
            50% { transform: translateY(3px); opacity: 0.55; }
        }
        @keyframes jdy-quick-save-success {
            0% { transform: scale(1); }
            45% { transform: scale(1.09); }
            100% { transform: scale(1); }
        }
        #${DIALOG_ID} {
            position: fixed;
            inset: 0;
            z-index: 20000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 18px;
            background: rgba(8, 10, 14, 0.68);
            font-family: sans-serif;
        }
        #${DIALOG_ID} .jdy-history-panel {
            width: min(680px, calc(100vw - 36px));
            max-height: min(720px, calc(100vh - 36px));
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 8px;
            background: #25282e;
            color: #f3f4f6;
            box-shadow: 0 22px 70px rgba(0, 0, 0, 0.58);
        }
        #${DIALOG_ID} .jdy-history-header,
        #${DIALOG_ID} .jdy-history-footer {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 14px 16px;
            border-color: rgba(255, 255, 255, 0.11);
        }
        #${DIALOG_ID} .jdy-history-header { border-bottom: 1px solid; }
        #${DIALOG_ID} .jdy-history-footer {
            justify-content: space-between;
            border-top: 1px solid;
            color: #aeb4bf;
            font-size: 12px;
        }
        #${DIALOG_ID} .jdy-history-title {
            min-width: 0;
            flex: 1;
            font-size: 16px;
            font-weight: 700;
        }
        #${DIALOG_ID} .jdy-history-workflow {
            display: block;
            margin-top: 4px;
            overflow: hidden;
            color: #aeb4bf;
            font-size: 12px;
            font-weight: 400;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        #${DIALOG_ID} button {
            min-height: 32px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 5px;
            padding: 6px 11px;
            background: #343942;
            color: #fff;
            cursor: pointer;
        }
        #${DIALOG_ID} button:hover { background: #444b57; }
        #${DIALOG_ID} .jdy-history-save { background: #23834a; border-color: #35a765; }
        #${DIALOG_ID} .jdy-history-save:hover { background: #2d9a59; }
        #${DIALOG_ID} .jdy-history-load { background: #2f6fb7; border-color: #4b8bd2; }
        #${DIALOG_ID} .jdy-history-load:hover { background: #3d82cf; }
        #${DIALOG_ID} .jdy-history-delete {
            background: #a93636;
            border-color: #cf5555;
        }
        #${DIALOG_ID} .jdy-history-delete:hover { background: #c44444; }
        #${DIALOG_ID} .jdy-history-list {
            min-height: 180px;
            overflow-y: auto;
            padding: 8px 16px 16px;
        }
        #${DIALOG_ID} .jdy-history-row {
            display: grid;
            grid-template-columns: 34px minmax(0, 1fr) auto;
            align-items: center;
            gap: 12px;
            padding: 11px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.09);
        }
        #${DIALOG_ID} .jdy-history-index {
            display: grid;
            width: 30px;
            height: 30px;
            place-items: center;
            border-radius: 50%;
            background: #3a4049;
            color: #d7dbe2;
            font-size: 12px;
        }
        #${DIALOG_ID} .jdy-history-actions {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 7px;
        }
        #${DIALOG_ID} .jdy-history-name { font-size: 14px; font-weight: 700; color: #f4f6f8; }
        #${DIALOG_ID} .jdy-history-time { font-size: 14px; font-weight: 600; }
        #${DIALOG_ID} .jdy-history-meta { margin-top: 4px; color: #979eaa; font-size: 12px; }
        #${DIALOG_ID} .jdy-history-note {
            margin-top: 5px;
            color: #c6cbd3;
            font-size: 12px;
            line-height: 1.45;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }
        #${DIALOG_ID} .jdy-history-empty { padding: 60px 16px; text-align: center; color: #aeb4bf; }
        .jdy-version-editor-overlay {
            position: fixed;
            inset: 0;
            z-index: 21000;
            display: grid;
            place-items: center;
            padding: 18px;
            background: rgba(8, 10, 14, 0.74);
            font-family: sans-serif;
        }
        .jdy-version-editor {
            width: min(480px, calc(100vw - 36px));
            padding: 18px;
            border: 1px solid rgba(255,255,255,.18);
            border-radius: 8px;
            background: #292d34;
            color: #f5f7fa;
            box-shadow: 0 22px 70px rgba(0,0,0,.62);
        }
        .jdy-version-editor h3 { margin: 0 0 15px; font-size: 17px; }
        .jdy-version-editor label { display: block; margin-top: 11px; color: #d7dbe2; font-size: 12px; }
        .jdy-version-editor input,
        .jdy-version-editor textarea {
            width: 100%;
            box-sizing: border-box;
            margin-top: 6px;
            border: 1px solid #59616d;
            border-radius: 5px;
            background: #191d23;
            color: #fff;
            padding: 9px 10px;
            font: 13px/1.4 sans-serif;
        }
        .jdy-version-editor textarea { min-height: 96px; resize: vertical; }
        .jdy-version-editor-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
        .jdy-version-editor-actions button {
            min-height: 34px;
            border: 1px solid rgba(255,255,255,.18);
            border-radius: 5px;
            padding: 6px 13px;
            background: #343942;
            color: #fff;
            cursor: pointer;
        }
        .jdy-version-editor-actions .jdy-version-confirm { background: #d76220; border-color: #e87836; }
    `;
    document.head.appendChild(style);
}

function getWorkflowInfo() {
    const extensionWorkflow = app.extensionManager?.workflow;
    const workflowStore = extensionWorkflow?.workflowStore
        ?? extensionWorkflow?.store
        ?? extensionWorkflow;
    const workflow = workflowStore?.activeWorkflow?.value
        ?? workflowStore?.activeWorkflow
        ?? workflowStore?.activeWorkflowRef?.value
        ?? null;
    let path = workflow?.path || workflow?.filename || "";
    if (!path) {
        const title = document.title.replace(/\s*[|\-]\s*ComfyUI.*$/i, "").trim();
        if (title && title.toLowerCase() !== "comfyui") path = title;
    }
    path = String(path || "").replaceAll("\\", "/").replace(/^\/+/, "");
    if (path.startsWith("workflows/")) path = path.slice("workflows/".length);
    if (path && !path.toLowerCase().endsWith(".json")) path += ".json";
    return {
        path,
        filename: workflow?.filename || path.split("/").at(-1) || "当前工作流",
        temporary: workflow?.isTemporary === true,
    };
}

function findActiveWorkflowInfo() {
    const direct = getWorkflowInfo();
    if (direct.path) return direct;
    const saveCommand = app.extensionManager?.command?.commands?.find(
        (command) => command?.id === "Comfy.SaveWorkflow",
    );
    const workflowStore = saveCommand?.workflowStore
        ?? app.workflowStore
        ?? window.comfyAPI?.workflowStore
        ?? null;
    const workflow = workflowStore?.activeWorkflow?.value ?? workflowStore?.activeWorkflow;
    let path = String(workflow?.path || workflow?.filename || "").replaceAll("\\", "/");
    if (path.startsWith("workflows/")) path = path.slice("workflows/".length);
    if (path && !path.toLowerCase().endsWith(".json")) path += ".json";
    return {
        path,
        filename: workflow?.filename || path.split("/").at(-1) || "当前工作流",
        temporary: workflow?.isTemporary === true,
    };
}

function workflowVersionName(info) {
    const source = String(info?.path || info?.filename || "当前工作流")
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        .trim();
    return source.replace(/(?:\.app)?\.json$/i, "").trim() || "当前工作流";
}

function isWorkflowSaveRequest(route, options) {
    if (manualSaveDepth <= 0 || suppressAutomaticBackup > 0) return false;
    const method = String(options?.method || "GET").toUpperCase();
    if (method !== "POST") return false;
    const value = String(route || "");
    return /\/userdata\/[^?]*workflows%2F/i.test(value)
        || /\/userdata\/workflows(?:%2F|\/)/i.test(value);
}

function workflowPathFromSaveRequest(route) {
    const match = String(route || "").match(/\/userdata\/([^?]+)/i);
    if (!match) return "";
    let decoded = "";
    try {
        decoded = decodeURIComponent(match[1]);
    } catch {
        decoded = match[1];
    }
    decoded = decoded.replaceAll("\\", "/").replace(/^\/+/, "");
    return decoded.startsWith("workflows/") ? decoded.slice("workflows/".length) : "";
}

async function requestBackup(workflowPath, reason = "save", metadata = {}) {
    if (!workflowPath) return false;
    try {
        const response = await originalFetchApi.call(api, "/jindouyun_design/workflow_backups/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workflow_path: workflowPath, reason, ...metadata }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || response.statusText);
        return data.created === true ? data : false;
    } catch (error) {
        console.warn("[筋斗云工作流备份] 自动备份失败，原保存仍将继续：", error);
        return false;
    }
}

async function updateBackupMetadata(workflowPath, backupId, name, note) {
    const response = await api.fetchApi("/jindouyun_design/workflow_backups/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            workflow_path: workflowPath,
            backup_id: backupId,
            name,
            note,
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "更新版本信息失败");
    return data.metadata;
}

async function deleteBackup(workflowPath, backupId) {
    const response = await api.fetchApi("/jindouyun_design/workflow_backups/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({workflow_path: workflowPath, backup_id: backupId}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false || data.deleted !== true) {
        throw new Error(data.error || "删除历史版本失败");
    }
}

function findCommand(commandId) {
    return app.extensionManager?.command?.commands?.find((command) => command?.id === commandId);
}

async function executeSaveCommand() {
    const command = findCommand("Comfy.SaveWorkflow");
    if (typeof command?.function !== "function") {
        throw new Error("找不到 ComfyUI 保存命令，请刷新页面后重试");
    }
    suppressAutomaticBackup += 1;
    try {
        await command.function.call(command);
    } finally {
        suppressAutomaticBackup = Math.max(0, suppressAutomaticBackup - 1);
    }
}

async function createNamedVersion(workflowPath, name, note) {
    await executeSaveCommand();
    const active = findActiveWorkflowInfo();
    if (!active.path || active.temporary) throw new Error("工作流尚未保存，请先使用“另存为”命名");
    const savedPath = active.path || workflowPath;
    const result = await requestBackup(savedPath, "named", {name, note});
    if (!result?.created) throw new Error("保存完成，但没有生成历史版本");
    return result;
}

function patchFetchApi() {
    if (patchedFetch) return;
    originalFetchApi = api.fetchApi;
    api.fetchApi = async function jindouyunBackupFetch(route, options) {
        if (isWorkflowSaveRequest(route, options)) {
            await requestBackup(workflowPathFromSaveRequest(route), "save");
        }
        return originalFetchApi.apply(this, arguments);
    };
    patchedFetch = true;
}

function patchManualSaveCommands() {
    const commands = app.extensionManager?.command?.commands;
    if (!Array.isArray(commands)) return false;
    let patchedAny = false;
    for (const command of commands) {
        if (!SAVE_COMMANDS.has(command?.id) || command.__jindouyunBackupWrapped) continue;
        const original = command.function;
        if (typeof original !== "function") continue;
        command.function = async function jindouyunManualSaveCommand() {
            manualSaveDepth += 1;
            try {
                return await original.apply(this, arguments);
            } finally {
                manualSaveDepth = Math.max(0, manualSaveDepth - 1);
            }
        };
        command.__jindouyunBackupWrapped = true;
        patchedAny = true;
    }
    return patchedAny;
}

function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(date).replaceAll("/", "-");
}

function formatSize(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function fetchHistory(workflowPath) {
    const query = new URLSearchParams({ workflow_path: workflowPath });
    const response = await api.fetchApi(`/jindouyun_design/workflow_backups?${query}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "读取历史失败");
    return data.backups || [];
}

async function loadBackup(workflowPath, backupId) {
    const query = new URLSearchParams({ workflow_path: workflowPath, backup_id: backupId });
    const response = await api.fetchApi(`/jindouyun_design/workflow_backups/content?${query}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false || !data.workflow) {
        throw new Error(data.error || "加载历史版本失败");
    }
    await app.loadGraphData(data.workflow);
}

function closeDialog() {
    document.getElementById(DIALOG_ID)?.remove();
}

function editVersionDetails({title, name = "", note = "", requireName = false}) {
    return new Promise((resolve) => {
        const initialName = String(name || "").trim();
        const initialNote = String(note || "");
        const overlay = document.createElement("div");
        overlay.className = "jdy-version-editor-overlay";
        overlay.innerHTML = `
            <section class="jdy-version-editor" role="dialog" aria-modal="true">
                <h3></h3>
                <label>版本名称
                    <input class="jdy-version-name" type="text" maxlength="80" placeholder="例如：产品布局完成">
                </label>
                <label>版本备注（可留空）
                    <textarea class="jdy-version-note" maxlength="1000" placeholder="记录本次修改内容"></textarea>
                </label>
                <div class="jdy-version-editor-actions">
                    <button type="button" class="jdy-version-cancel">取消</button>
                    <button type="button" class="jdy-version-confirm">确认</button>
                </div>
            </section>`;
        const nameInput = overlay.querySelector(".jdy-version-name");
        const noteInput = overlay.querySelector(".jdy-version-note");
        overlay.querySelector("h3").textContent = title;
        const finish = (value) => {
            overlay.remove();
            resolve(value);
        };
        const confirmDetails = () => {
            const nextName = nameInput.value.trim();
            if (requireName && !nextName) {
                nameInput.focus();
                nameInput.setCustomValidity("请填写版本名称");
                nameInput.reportValidity();
                return;
            }
            finish({name: nextName, note: noteInput.value.trim()});
        };
        nameInput.addEventListener("input", () => nameInput.setCustomValidity(""));
        overlay.querySelector(".jdy-version-cancel").addEventListener("click", () => finish(null));
        overlay.querySelector(".jdy-version-confirm").addEventListener("click", confirmDetails);
        overlay.addEventListener("mousedown", (event) => {
            if (event.target === overlay) finish(null);
        });
        overlay.addEventListener("keydown", (event) => {
            if (event.key === "Escape") finish(null);
            if (event.key === "Enter" && event.ctrlKey) confirmDetails();
        });
        document.body.appendChild(overlay);
        nameInput.value = initialName;
        noteInput.value = initialNote;
        nameInput.focus();
        nameInput.select();
    });
}

async function showHistoryDialog() {
    ensureStyle();
    closeDialog();
    const info = findActiveWorkflowInfo();
    if (!info.path || info.temporary) {
        alert("请先给当前工作流命名并保存一次，再查看历史版本。");
        return;
    }

    const overlay = document.createElement("div");
    overlay.id = DIALOG_ID;
    overlay.innerHTML = `
        <section class="jdy-history-panel" role="dialog" aria-modal="true" aria-label="工作流历史版本">
            <header class="jdy-history-header">
                <div class="jdy-history-title">筋斗云-工作流历史版本管理
                    <span class="jdy-history-workflow"></span>
                </div>
                <button type="button" class="jdy-history-save">保存新版本</button>
                <button type="button" class="jdy-history-refresh">刷新</button>
                <button type="button" class="jdy-history-close" aria-label="关闭">关闭</button>
            </header>
            <div class="jdy-history-list"><div class="jdy-history-empty">正在读取历史版本...</div></div>
            <footer class="jdy-history-footer">
                <span>每个工作流保留最近 ${BACKUP_LIMIT} 个手工保存时间点</span>
                <span>加载后检查无误，再按 Ctrl+S 保存</span>
            </footer>
        </section>`;
    overlay.querySelector(".jdy-history-workflow").textContent = info.path;
    overlay.addEventListener("mousedown", (event) => {
        if (event.target === overlay) closeDialog();
    });
    overlay.querySelector(".jdy-history-close").addEventListener("click", closeDialog);
    document.body.appendChild(overlay);

    const list = overlay.querySelector(".jdy-history-list");
    const render = async () => {
        list.innerHTML = '<div class="jdy-history-empty">正在读取历史版本...</div>';
        try {
            const history = await fetchHistory(info.path);
            if (!history.length) {
                list.innerHTML = '<div class="jdy-history-empty">暂无历史版本。下次手工保存时，会先备份当前版本。</div>';
                return;
            }
            list.replaceChildren();
            history.forEach((item, index) => {
                const row = document.createElement("div");
                row.className = "jdy-history-row";
                row.innerHTML = `
                    <span class="jdy-history-index"></span>
                    <div>
                        <div class="jdy-history-name"></div>
                        <div class="jdy-history-time"></div>
                        <div class="jdy-history-meta"></div>
                        <div class="jdy-history-note"></div>
                    </div>
                    <div class="jdy-history-actions">
                        <button type="button" class="jdy-history-edit">重命名/备注</button>
                        <button type="button" class="jdy-history-load">加载此版本</button>
                        <button type="button" class="jdy-history-delete">删除</button>
                    </div>`;
                row.querySelector(".jdy-history-index").textContent = String(index + 1);
                const nameElement = row.querySelector(".jdy-history-name");
                nameElement.textContent = item.name || (item.reason === "named" ? "命名版本" : "自动备份");
                row.querySelector(".jdy-history-time").textContent = formatTime(item.created_at);
                row.querySelector(".jdy-history-meta").textContent = `${formatSize(item.size)} · ${item.reason === "named" ? "手工命名版本" : "保存前版本"}`;
                const noteElement = row.querySelector(".jdy-history-note");
                noteElement.textContent = item.note || "";
                noteElement.style.display = item.note ? "block" : "none";
                row.querySelector(".jdy-history-edit").addEventListener("click", async (event) => {
                    const details = await editVersionDetails({
                        title: "重命名及修改备注",
                        name: item.name || "",
                        note: item.note || "",
                    });
                    if (!details) return;
                    const button = event.currentTarget;
                    button.disabled = true;
                    try {
                        await updateBackupMetadata(info.path, item.id, details.name, details.note);
                        await render();
                    } catch (error) {
                        alert(`更新失败：${error.message || error}`);
                        button.disabled = false;
                    }
                });
                row.querySelector(".jdy-history-load").addEventListener("click", async (event) => {
                    const button = event.currentTarget;
                    if (!confirm(`加载 ${formatTime(item.created_at)} 的工作流版本？\n\n它只会载入画布，不会立即覆盖主文件。`)) return;
                    button.disabled = true;
                    button.textContent = "加载中...";
                    try {
                        await requestBackup(info.path, "restore");
                        await loadBackup(info.path, item.id);
                        closeDialog();
                        alert("历史版本已载入画布。确认内容后，按 Ctrl+S 才会覆盖主工作流。");
                    } catch (error) {
                        alert(`加载失败：${error.message || error}`);
                        button.disabled = false;
                        button.textContent = "加载此版本";
                    }
                });
                row.querySelector(".jdy-history-delete").addEventListener("click", async (event) => {
                    const versionName = item.name || (item.reason === "named" ? "命名版本" : "自动备份");
                    const savedTime = formatTime(item.created_at);
                    if (!confirm(`删除这个历史版本？\n\n${versionName}\n${savedTime}\n\n删除后无法恢复，但不会影响当前工作流。`)) return;
                    const button = event.currentTarget;
                    button.disabled = true;
                    button.textContent = "删除中...";
                    try {
                        await deleteBackup(info.path, item.id);
                        await render();
                    } catch (error) {
                        alert(`删除失败：${error.message || error}`);
                        button.disabled = false;
                        button.textContent = "删除";
                    }
                });
                list.appendChild(row);
            });
        } catch (error) {
            list.innerHTML = "";
            const empty = document.createElement("div");
            empty.className = "jdy-history-empty";
            empty.textContent = `读取失败：${error.message || error}`;
            list.appendChild(empty);
        }
    };
    overlay.querySelector(".jdy-history-save").addEventListener("click", async (event) => {
        const currentInfo = findActiveWorkflowInfo();
        const details = await editVersionDetails({
            title: "保存新版本",
            name: workflowVersionName(currentInfo),
            requireName: true,
        });
        if (!details) return;
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "保存中...";
        try {
            await createNamedVersion(currentInfo.path, details.name, details.note);
            await render();
        } catch (error) {
            alert(`保存版本失败：${error.message || error}`);
        } finally {
            button.disabled = false;
            button.textContent = "保存新版本";
        }
    });
    overlay.querySelector(".jdy-history-refresh").addEventListener("click", render);
    document.addEventListener("keydown", function escape(event) {
        if (event.key !== "Escape" || !document.getElementById(DIALOG_ID)) return;
        document.removeEventListener("keydown", escape);
        closeDialog();
    });
    await render();
}

async function quickSaveCurrentWorkflow(event) {
    const button = event.currentTarget;
    if (button.disabled) return;
    const info = findActiveWorkflowInfo();
    if (!info.path || info.temporary) {
        alert("请先给当前工作流命名并保存一次，再使用快速保存。");
        return;
    }

    const label = button.querySelector(".jdy-quick-save-label");
    button.disabled = true;
    button.classList.remove("is-success");
    button.classList.add("is-saving");
    label.textContent = "保存中";
    try {
        await createNamedVersion(info.path, workflowVersionName(info), "");
        button.classList.remove("is-saving");
        button.classList.add("is-success");
        label.textContent = "已保存";
    } catch (error) {
        button.classList.remove("is-saving");
        label.textContent = "保存失败";
        alert(`快速保存失败：${error.message || error}`);
    } finally {
        setTimeout(() => {
            button.disabled = false;
            button.classList.remove("is-saving", "is-success");
            label.textContent = "快速保存";
        }, 1200);
    }
}

function addHistoryButton() {
    if (document.getElementById(BUTTON_GROUP_ID)) return;
    if (!document.body) {
        document.addEventListener("DOMContentLoaded", addHistoryButton, { once: true });
        return;
    }
    ensureStyle();
    const group = document.createElement("div");
    group.id = BUTTON_GROUP_ID;

    const quickSaveButton = document.createElement("button");
    quickSaveButton.id = QUICK_SAVE_BUTTON_ID;
    quickSaveButton.type = "button";
    quickSaveButton.title = "立即保存当前工作流，并记录一个历史版本";
    const quickSaveIcon = document.createElement("span");
    quickSaveIcon.className = "jdy-quick-save-icon";
    quickSaveIcon.textContent = "↓";
    quickSaveIcon.setAttribute("aria-hidden", "true");
    const quickSaveLabel = document.createElement("span");
    quickSaveLabel.className = "jdy-quick-save-label";
    quickSaveLabel.textContent = "快速保存";
    quickSaveButton.append(quickSaveIcon, quickSaveLabel);
    quickSaveButton.addEventListener("click", quickSaveCurrentWorkflow);

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "工作流历史";
    button.title = `查看当前工作流最近 ${BACKUP_LIMIT} 个手工保存版本`;
    button.addEventListener("click", showHistoryDialog);
    group.append(quickSaveButton, button);
    document.body.appendChild(group);
}

app.registerExtension({
    name: EXTENSION_NAME,
    setup() {
        patchFetchApi();
        patchManualSaveCommands();
        setTimeout(patchManualSaveCommands, 1000);
        setTimeout(patchManualSaveCommands, 3000);
        addHistoryButton();
    },
});

export {
    formatSize,
    formatTime,
    isWorkflowSaveRequest,
    workflowVersionName,
    workflowPathFromSaveRequest,
};
