import { app } from "../../scripts/app.js";

const BUTTON_ID = "jindouyun-restart-comfyui-button";
const STYLE_ID = "jindouyun-restart-comfyui-style";

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        #${BUTTON_ID} {
            position: fixed;
            right: 18px;
            bottom: 18px;
            z-index: 10000;
            border: 1px solid rgba(255, 255, 255, 0.22);
            border-radius: 6px;
            padding: 8px 12px;
            background: #2f6fed;
            color: #fff;
            font-size: 13px;
            line-height: 1;
            cursor: pointer;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
        }
        #${BUTTON_ID}:hover {
            background: #3d7cff;
        }
        #${BUTTON_ID}:disabled {
            cursor: wait;
            opacity: 0.72;
        }
    `;
    document.head.appendChild(style);
}

async function waitForComfyUIAndReload(button) {
    await new Promise((resolve) => setTimeout(resolve, 4500));
    for (let index = 0; index < 40; index += 1) {
        try {
            const response = await fetch(`/system_stats?jindouyun_restart=${Date.now()}`, {
                cache: "no-store",
            });
            if (response.ok) {
                button.textContent = "刷新中...";
                window.location.reload();
                return;
            }
        } catch (error) {
            // The server is expected to disappear briefly while it restarts.
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    button.disabled = false;
    button.textContent = "重启 ComfyUI";
    alert("重启请求已发送，但网页没有检测到新服务，请稍后手动刷新页面。");
}

async function restartComfyUI(button) {
    const confirmed = confirm("确定要重启 ComfyUI 吗？正在运行的任务会中断。");
    if (!confirmed) {
        return;
    }

    button.disabled = true;
    button.textContent = "重启中...";
    try {
        const response = await fetch("/jindouyun_design/restart_comfyui", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: "{}",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
            throw new Error(data.error || "重启请求失败");
        }
        waitForComfyUIAndReload(button);
    } catch (error) {
        button.disabled = false;
        button.textContent = "重启 ComfyUI";
        alert(`重启失败：${error.message || error}`);
    }
}

function addRestartButton() {
    if (document.getElementById(BUTTON_ID)) {
        return;
    }
    if (!document.body) {
        document.addEventListener("DOMContentLoaded", addRestartButton, {once: true});
        return;
    }
    ensureStyle();
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "重启 ComfyUI";
    button.title = "重启 ComfyUI 后端并刷新页面";
    button.addEventListener("click", () => restartComfyUI(button));
    document.body.appendChild(button);
}

app.registerExtension({
    name: "comfyui-jindouyun-design.restart-button",

    setup() {
        addRestartButton();
    },
});
