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
from .string_router import JindouyunStringRouter
from .load_image import (
    JindouyunLoadImage,
    list_sibling_images,
    navigate_local_image,
    prepare_local_image,
    resolve_dropped_source,
)
from .save_image import JindouyunSaveImage, create_subfolder, delete_saved_image
from .krea2_random_lora_model_only import Krea2RandomLoraModelOnly, NunchakuRandomLoraModelOnly
from .workflow_backup import register_workflow_backup_routes


_restart_requested = False


async def select_lora_folder(request):
    data = await request.json()
    initial_path = str(data.get("initial_path") or "").strip().strip('"')

    try:
        selected = await asyncio.to_thread(
            _select_folder_with_windows_dialog,
            initial_path,
            "选择 LoRA 文件夹",
        )
    except Exception as error:
        return web.json_response({"path": "", "error": str(error)}, status=500)

    return web.json_response({"path": selected or ""})


def _select_folder_with_windows_dialog(initial_path: str, description: str = "选择文件夹") -> str:
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
$dialog.Description = if ($env:JINDOUYUN_FOLDER_DIALOG_DESCRIPTION) {
    $env:JINDOUYUN_FOLDER_DIALOG_DESCRIPTION
} else {
    'Select folder'
}
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
    environment["JINDOUYUN_FOLDER_DIALOG_DESCRIPTION"] = description
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

async def image_siblings(request):
    data = await request.json()
    try:
        result = list_sibling_images(data.get("image", ""))
    except ValueError as error:
        return web.json_response({"images": [], "index": -1, "error": str(error)}, status=400)
    return web.json_response(result)


def _selected_explorer_image_paths():
    if os.name != "nt":
        return []
    script = r"""
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$shellApp = New-Object -ComObject Shell.Application
foreach ($window in @($shellApp.Windows())) {
    try {
        foreach ($item in @($window.Document.SelectedItems())) {
            if ($item.Path) { [Console]::WriteLine($item.Path) }
        }
    } catch {
    }
}
"""
    try:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-STA", "-Command", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if completed.returncode != 0:
        return []
    return [line.strip() for line in completed.stdout.splitlines() if line.strip()]


async def resolve_dropped_image(request):
    data = await request.json()
    candidates = []
    direct_source_path = str(data.get("direct_source_path") or "").strip().strip('"')
    if direct_source_path:
        candidates.append(direct_source_path)
    if os.name == "nt":
        candidates.extend(await asyncio.to_thread(_selected_explorer_image_paths))
    try:
        result = await asyncio.to_thread(
            resolve_dropped_source,
            data.get("image", ""),
            data.get("file_name", ""),
            data.get("file_size", 0),
            candidates,
        )
    except (OSError, ValueError) as error:
        return web.json_response({"resolved": False, "error": str(error)}, status=400)
    return web.json_response(result)


def _select_image_with_windows_dialog(initial_path: str = "") -> str:
    script = r"""
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择本地图像（保留原始文件夹路径）'
$dialog.Filter = '图像文件|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff|所有文件|*.*'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
if ($env:JINDOUYUN_INITIAL_IMAGE) {
    if (Test-Path -LiteralPath $env:JINDOUYUN_INITIAL_IMAGE -PathType Leaf) {
        $dialog.InitialDirectory = Split-Path -LiteralPath $env:JINDOUYUN_INITIAL_IMAGE -Parent
        $dialog.FileName = Split-Path -LiteralPath $env:JINDOUYUN_INITIAL_IMAGE -Leaf
    } elseif (Test-Path -LiteralPath $env:JINDOUYUN_INITIAL_IMAGE -PathType Container) {
        $dialog.InitialDirectory = $env:JINDOUYUN_INITIAL_IMAGE
    }
}
$owner = New-Object System.Windows.Forms.Form
$owner.Text = '筋斗云图像选择'
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(2, 2)
$owner.Opacity = 0
try {
    $owner.Show()
    $owner.Activate()
    $result = $dialog.ShowDialog($owner)
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Write-Output $dialog.FileName
    }
} finally {
    $owner.Close()
    $owner.Dispose()
    $dialog.Dispose()
}
"""
    environment = os.environ.copy()
    environment["JINDOUYUN_INITIAL_IMAGE"] = str(initial_path or "")
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
        raise RuntimeError(completed.stderr.strip() or "无法打开 Windows 图片选择窗口")
    return completed.stdout.strip()


async def select_local_image(request):
    data = await request.json()
    try:
        selected = await asyncio.to_thread(
            _select_image_with_windows_dialog,
            data.get("initial_path", ""),
        )
        result = prepare_local_image(selected) if selected else {"cancelled": True}
    except (OSError, ValueError, RuntimeError) as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response(result)


async def navigate_local_image_route(request):
    data = await request.json()
    try:
        result = await asyncio.to_thread(
            navigate_local_image,
            data.get("source_path", ""),
            data.get("direction", 1),
        )
    except (OSError, ValueError) as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response(result)


async def select_save_folder(request):
    data = await request.json()
    initial_path = str(data.get("initial_path") or "").strip().strip('"')
    try:
        selected = await asyncio.to_thread(
            _select_folder_with_windows_dialog,
            initial_path,
            "选择保存文件夹",
        )
    except Exception as error:
        return web.json_response({"path": "", "error": str(error)}, status=500)
    return web.json_response({"path": selected or ""})


async def create_save_folder(request):
    data = await request.json()
    try:
        path = await asyncio.to_thread(
            create_subfolder,
            data.get("parent_path", ""),
            data.get("folder_name", ""),
        )
    except (OSError, ValueError) as error:
        return web.json_response({"path": "", "error": str(error)}, status=400)
    return web.json_response({"path": path})


async def delete_save_image(request):
    data = await request.json()
    try:
        result = await asyncio.to_thread(
            delete_saved_image,
            data.get("directory", ""),
            data.get("filename", ""),
        )
    except (FileNotFoundError, OSError, RuntimeError, ValueError) as error:
        return web.json_response({"ok": False, "error": str(error)}, status=400)
    return web.json_response(result)


async def open_local_folder(request):
    data = await request.json()
    raw_path = str(data.get("path") or "").strip().strip('"')
    if not raw_path:
        return web.json_response({"ok": False, "error": "保存目录为空"}, status=400)
    folder = Path(raw_path).expanduser().resolve()
    if not folder.is_dir():
        return web.json_response({"ok": False, "error": f"文件夹不存在: {folder}"}, status=400)
    try:
        subprocess.Popen(
            ["explorer.exe", str(folder)],
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            close_fds=True,
        )
    except OSError as error:
        return web.json_response({"ok": False, "error": str(error)}, status=500)
    return web.json_response({"ok": True, "path": str(folder)})


try:
    from server import PromptServer

    prompt_server = getattr(PromptServer, "instance", None)
    if prompt_server is not None:
        prompt_server.routes.post("/jindouyun_design/select_folder")(select_lora_folder)
        prompt_server.routes.post("/jindouyun_design/restart_comfyui")(restart_comfyui)
        prompt_server.routes.post("/jindouyun_design/image_siblings")(image_siblings)
        prompt_server.routes.post("/jindouyun_design/resolve_dropped_image")(resolve_dropped_image)
        prompt_server.routes.post("/jindouyun_design/select_local_image")(select_local_image)
        prompt_server.routes.post("/jindouyun_design/navigate_local_image")(navigate_local_image_route)
        prompt_server.routes.post("/jindouyun_design/select_save_folder")(select_save_folder)
        prompt_server.routes.post("/jindouyun_design/create_folder")(create_save_folder)
        prompt_server.routes.post("/jindouyun_design/delete_saved_image")(delete_save_image)
        prompt_server.routes.post("/jindouyun_design/open_folder")(open_local_folder)
        prompt_server.routes.post("/krea2_random_lora/select_folder")(select_lora_folder)
        register_workflow_backup_routes(prompt_server)
except Exception:
    pass


class JindouyunRandomLora(Krea2RandomLoraModelOnly):
    CATEGORY = "筋斗云设计/LoRA"
    DESCRIPTION = "筋斗云设计随机或固定 LoRA 加载器，只加载到模型，并输出对应触发词。"
    SEARCH_ALIASES = ["筋斗云-随机LoRA", "筋斗云随机LORA", "筋斗云设计 LoRA", "随机 LoRA 仅模型"]
    RETURN_NAMES = ("模型", "触发词", "LoRA名称", "本次种子", "LoRA强度", "重绘值", "组合名")

    @classmethod
    def INPUT_TYPES(cls):
        schema = super().INPUT_TYPES()
        required = {
            name: input_type
            for name, input_type in schema["required"].items()
            if name != "启用"
        }
        return {**schema, "required": required}

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        kwargs["启用"] = True
        return super().IS_CHANGED(**kwargs)

    def load_lora(self, **kwargs):
        kwargs["启用"] = True
        return super().load_lora(**kwargs)


class Krea2RandomLoraAuto(Krea2RandomLoraModelOnly):
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
    "JindouyunStringRouter": JindouyunStringRouter,
    "JindouyunLoadImage": JindouyunLoadImage,
    "JindouyunSaveImage": JindouyunSaveImage,
    "JindouyunRandomLora": JindouyunRandomLora,
    "Krea2RandomLoraAuto": Krea2RandomLoraAuto,
    "Krea2RandomLoraModelOnly": LegacyKrea2RandomLoraModelOnly,
    "NunchakuRandomLoraModelOnly": NunchakuRandomLoraModelOnly,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "JindouyunCanvasComposite": "筋斗云-画布合成",
    "JindouyunImageSwitch": "筋斗云-图像尺寸判断",
    "JindouyunInteractiveCrop": "筋斗云-交互裁剪",
    "JindouyunTransparentCrop": "筋斗云-透明裁切",
    "JindouyunShowAnything": "筋斗云-显示任何",
    "JindouyunNumberSlider": "筋斗云-数值滑块",
    "JindouyunStringRouter": "筋斗云-提示词",
    "JindouyunLoadImage": "筋斗云-加载图像",
    "JindouyunSaveImage": "筋斗云-保存图像",
    "JindouyunRandomLora": "筋斗云-随机LoRA",
    "Krea2RandomLoraAuto": "Krea2 Random LoRA (Legacy)",
    "Krea2RandomLoraModelOnly": "Krea2 Model-Only LoRA (Legacy)",
    "NunchakuRandomLoraModelOnly": "筋斗云-Nunchaku随机LoRA",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
