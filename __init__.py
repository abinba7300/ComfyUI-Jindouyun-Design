import os
import asyncio
import subprocess
import sys
import threading
from pathlib import Path

from aiohttp import web

from .canvas_composite import JindouyunCanvasComposite
from .image_switch import JindouyunImageSwitch
from .interactive_crop import JindouyunInteractiveCrop
from .transparent_crop import JindouyunTransparentCrop
from .show_anything import JindouyunShowAnything
from .number_slider import JindouyunNumberSlider
from .krea2_random_lora_model_only import Krea2RandomLoraModelOnly, NunchakuRandomLoraModelOnly


_restart_requested = False


async def select_lora_folder(request):
    data = await request.json()
    initial_path = str(data.get("initial_path") or "").strip().strip('"')

    try:
        selected = await asyncio.to_thread(_select_folder_with_windows_dialog, initial_path)
    except Exception as error:
        return web.json_response({"path": "", "error": str(error)}, status=500)

    return web.json_response({"path": selected or ""})


def _select_folder_with_windows_dialog(initial_path: str) -> str:
    script = r"""
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JindouyunNativeWindow
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AttachThreadInput(
        uint idAttach,
        uint idAttachTo,
        [MarshalAs(UnmanagedType.Bool)] bool attach
    );

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    public static IntPtr FindVisibleWindowForProcess(uint processId, IntPtr excludedHandle)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr handle, IntPtr state) {
            uint ownerProcessId;
            GetWindowThreadProcessId(handle, out ownerProcessId);
            if (ownerProcessId == processId && handle != excludedHandle && IsWindowVisible(handle)) {
                found = handle;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static void ForceWindowToFront(IntPtr handle)
    {
        if (handle == IntPtr.Zero) return;
        IntPtr foreground = GetForegroundWindow();
        uint ignoredProcessId;
        uint foregroundThread = GetWindowThreadProcessId(foreground, out ignoredProcessId);
        uint currentThread = GetCurrentThreadId();
        bool attached = foregroundThread != 0 && foregroundThread != currentThread
            && AttachThreadInput(currentThread, foregroundThread, true);
        try {
            SetWindowPos(handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
            BringWindowToTop(handle);
            SetForegroundWindow(handle);
            SetActiveWindow(handle);
            SetFocus(handle);
        } finally {
            if (attached) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }
}
'@
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择 LoRA 文件夹'
$dialog.ShowNewFolderButton = $true
if ($env:JINDOUYUN_INITIAL_FOLDER -and (Test-Path -LiteralPath $env:JINDOUYUN_INITIAL_FOLDER -PathType Container)) {
    $dialog.SelectedPath = $env:JINDOUYUN_INITIAL_FOLDER
}
$foreground = [JindouyunNativeWindow]::GetForegroundWindow()
$screen = if ($foreground -ne [IntPtr]::Zero) {
    [System.Windows.Forms.Screen]::FromHandle($foreground)
} else {
    [System.Windows.Forms.Screen]::PrimaryScreen
}
$area = $screen.WorkingArea
$owner = New-Object System.Windows.Forms.Form
$owner.Text = '筋斗云文件夹选择'
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$owner.Size = New-Object System.Drawing.Size(2, 2)
$owner.Location = New-Object System.Drawing.Point(
    [int]($area.Left + ($area.Width / 2)),
    [int]($area.Top + ($area.Height / 2))
)
$owner.Opacity = 0
$focusTimer = New-Object System.Windows.Forms.Timer
$focusTimer.Interval = 100
$focusTimer.Tag = [IntPtr]::Zero
$focusTimer.Add_Tick({
    param($sender, $eventArgs)
    $target = [JindouyunNativeWindow]::FindVisibleWindowForProcess(
        [uint32]$PID,
        [IntPtr]$sender.Tag
    )
    if ($target -ne [IntPtr]::Zero) {
        [JindouyunNativeWindow]::ForceWindowToFront($target)
        $sender.Stop()
    }
})

try {
    $owner.Show()
    $owner.Activate()
    [System.Windows.Forms.Application]::DoEvents()
    [void][JindouyunNativeWindow]::BringWindowToTop($owner.Handle)
    [void][JindouyunNativeWindow]::SetForegroundWindow($owner.Handle)
    $focusTimer.Tag = $owner.Handle
    $focusTimer.Start()

    $result = $dialog.ShowDialog($owner)
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Write-Output $dialog.SelectedPath
    }
} finally {
    $focusTimer.Stop()
    $focusTimer.Dispose()
    $owner.Close()
    $owner.Dispose()
    $dialog.Dispose()
}
"""
    environment = os.environ.copy()
    environment["JINDOUYUN_INITIAL_FOLDER"] = initial_path
    completed = subprocess.run(
        ["powershell.exe", "-NoProfile", "-STA", "-Command", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=environment,
        timeout=300,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "无法打开 Windows 文件夹选择窗口")
    return completed.stdout.strip()

def _spawn_restart_helper():
    helper_code = r"""
import os
import subprocess
import sys
import time
import traceback

python = sys.argv[1]
cwd = sys.argv[2]
main_script = sys.argv[3]
args = sys.argv[4:]
log_path = os.path.join(cwd, "jindouyun_restart.log")
time.sleep(1.8)
creationflags = 0
if os.name == "nt":
    creationflags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
try:
    with open(log_path, "a", encoding="utf-8") as log:
        log.write("\nRestarting ComfyUI: " + repr([python, "-s", main_script, *args]) + "\n")
        log.flush()
        subprocess.Popen(
            [python, "-s", main_script, *args],
            cwd=cwd,
            creationflags=creationflags,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            close_fds=True,
        )
except Exception:
    with open(log_path, "a", encoding="utf-8") as log:
        traceback.print_exc(file=log)
"""
    main_script = str(Path(sys.argv[0]).resolve())
    launch_args = list(sys.argv[1:])
    if not Path(main_script).is_file():
        raise RuntimeError(f"找不到 ComfyUI 启动文件: {main_script}")
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP

    subprocess.Popen(
        [sys.executable, "-s", "-c", helper_code, sys.executable, str(Path.cwd()), main_script, *launch_args],
        cwd=str(Path.cwd()),
        creationflags=creationflags,
        close_fds=True,
    )


async def restart_comfyui(request):
    global _restart_requested
    if _restart_requested:
        return web.json_response({"ok": True, "message": "ComfyUI 正在重启中"})

    _restart_requested = True
    try:
        _spawn_restart_helper()
    except Exception as error:
        _restart_requested = False
        return web.json_response({"ok": False, "error": str(error)}, status=500)

    def stop_current_process():
        os._exit(0)

    threading.Timer(0.7, stop_current_process).start()
    return web.json_response({"ok": True, "message": "ComfyUI 正在重启"})

try:
    from server import PromptServer

    prompt_server = getattr(PromptServer, "instance", None)
    if prompt_server is not None:
        prompt_server.routes.post("/jindouyun_design/select_folder")(select_lora_folder)
        prompt_server.routes.post("/jindouyun_design/restart_comfyui")(restart_comfyui)
        prompt_server.routes.post("/krea2_random_lora/select_folder")(select_lora_folder)
except Exception:
    pass


class JindouyunRandomLora(Krea2RandomLoraModelOnly):
    CATEGORY = "筋斗云设计/LoRA"
    DESCRIPTION = "筋斗云设计随机或固定 LoRA 加载器，只加载到模型，并输出对应触发词。"
    SEARCH_ALIASES = ["筋斗云随机LORA", "筋斗云设计 LoRA", "随机 LoRA 仅模型"]


class Krea2RandomLoraAuto(JindouyunRandomLora):
    DEPRECATED = True
    CATEGORY = "_deprecated/Krea2"
    DESCRIPTION = "Legacy Krea2 random LoRA node kept only for loading old workflows."
    SEARCH_ALIASES = []


class LegacyKrea2RandomLoraModelOnly(Krea2RandomLoraModelOnly):
    DEPRECATED = True
    CATEGORY = "_deprecated/Krea2"
    DESCRIPTION = "Legacy Krea2 model-only LoRA node kept only for loading old workflows."
    SEARCH_ALIASES = []


NODE_CLASS_MAPPINGS = {
    "JindouyunCanvasComposite": JindouyunCanvasComposite,
    "JindouyunImageSwitch": JindouyunImageSwitch,
    "JindouyunInteractiveCrop": JindouyunInteractiveCrop,
    "JindouyunTransparentCrop": JindouyunTransparentCrop,
    "JindouyunShowAnything": JindouyunShowAnything,
    "JindouyunNumberSlider": JindouyunNumberSlider,
    "JindouyunRandomLora": JindouyunRandomLora,
    "Krea2RandomLoraAuto": Krea2RandomLoraAuto,
    "Krea2RandomLoraModelOnly": LegacyKrea2RandomLoraModelOnly,
    "NunchakuRandomLoraModelOnly": NunchakuRandomLoraModelOnly,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "JindouyunCanvasComposite": "筋斗云画布合成",
    "JindouyunImageSwitch": "筋斗云图像尺寸判断",
    "JindouyunInteractiveCrop": "筋斗云交互裁剪",
    "JindouyunTransparentCrop": "筋斗云透明裁切",
    "JindouyunShowAnything": "筋斗云-显示任何",
    "JindouyunNumberSlider": "筋斗云数值滑块",
    "JindouyunRandomLora": "筋斗云随机LORA",
    "Krea2RandomLoraAuto": "Krea2 Random LoRA (Legacy)",
    "Krea2RandomLoraModelOnly": "Krea2 Model-Only LoRA (Legacy)",
    "NunchakuRandomLoraModelOnly": "Nunchaku 随机 LoRA",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
