import json
import hashlib
import os
import re
import shutil
from pathlib import Path

import folder_paths
import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo


_INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_PREVIEW_LIMIT = 4
_IMAGE_EXTENSIONS = {extension.lower() for extension in Image.registered_extensions()}


def normalize_directory(value):
    text = str(value or "").strip().strip('"')
    if not text:
        raise ValueError("保存目录不能为空")
    return Path(text).expanduser().resolve()


def default_output_directory():
    return Path(folder_paths.get_output_directory()).expanduser().resolve()


def resolve_save_directory(*values):
    for value in values:
        if str(value or "").strip().strip('"'):
            return normalize_directory(value)
    return default_output_directory()


def normalize_prefix(value):
    prefix = _INVALID_FILENAME.sub("_", str(value or "").strip()).rstrip(". ")
    return prefix or "ComfyUI"


def create_subfolder(parent_directory, folder_name):
    parent = normalize_directory(parent_directory)
    name = str(folder_name or "").strip().rstrip(". ")
    if not name or name in {".", ".."} or Path(name).name != name or _INVALID_FILENAME.search(name):
        raise ValueError("新文件夹名称无效，请只输入单层文件夹名称")
    target = (parent / name).resolve()
    if target.is_dir():
        return str(target)
    if target.exists():
        suffix = 2
        while True:
            candidate = (parent / f"{name} ({suffix})").resolve()
            if candidate.is_dir():
                return str(candidate)
            if not candidate.exists():
                target = candidate
                break
            suffix += 1
    target.mkdir(parents=True, exist_ok=False)
    return str(target)


def _next_path(directory, prefix, batch_index):
    stem = prefix if batch_index == 0 else f"{prefix}_{batch_index}"
    counter = 1
    while True:
        candidate = directory / f"{stem}_{counter:05d}.png"
        if not candidate.exists():
            return candidate
        counter += 1


def _recent_image_paths(directory, limit=_PREVIEW_LIMIT):
    images = [
        path for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in _IMAGE_EXTENSIONS
    ]
    images.sort(key=lambda path: (path.stat().st_mtime_ns, path.name.casefold()), reverse=True)
    return images[:limit]


def build_recent_previews(directory):
    temp_root = Path(folder_paths.get_temp_directory()).resolve()
    cache_key = hashlib.sha256(str(directory).casefold().encode("utf-8")).hexdigest()[:16]
    cache_directory = temp_root / "jindouyun_save_preview" / cache_key
    cache_directory.mkdir(parents=True, exist_ok=True)

    recent_paths = _recent_image_paths(directory)
    keep_names = {path.name for path in recent_paths}
    for cached in cache_directory.iterdir():
        if cached.is_file() and cached.name not in keep_names:
            cached.unlink()

    results = []
    for source in recent_paths:
        target = cache_directory / source.name
        shutil.copy2(source, target)
        results.append({
            "filename": target.name,
            "subfolder": target.parent.relative_to(temp_root).as_posix(),
            "type": "temp",
        })
    return results


def _send_to_recycle_bin(path):
    if os.name != "nt":
        raise RuntimeError("当前系统不支持 Windows 回收站")

    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", ctypes.c_ushort),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", ctypes.c_void_p),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    operation = SHFILEOPSTRUCTW()
    operation.wFunc = 3  # FO_DELETE
    operation.pFrom = f"{path}\0\0"
    operation.fFlags = 0x0040 | 0x0010 | 0x0004 | 0x0400  # ALLOWUNDO, NO_UI
    result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(operation))
    if result != 0 or operation.fAnyOperationsAborted:
        raise OSError(f"移入回收站失败，Windows 错误代码: {result}")


def delete_saved_image(directory, filename, recycle_func=None):
    folder = normalize_directory(directory)
    if not folder.is_dir():
        raise ValueError(f"保存目录不存在: {folder}")

    name = str(filename or "").strip()
    if not name or Path(name).name != name:
        raise ValueError("图片文件名无效")
    if Path(name).suffix.lower() not in _IMAGE_EXTENSIONS:
        raise ValueError("只能删除支持的图片文件")

    target = (folder / name).resolve()
    if target.parent != folder or not target.is_file():
        raise FileNotFoundError(f"找不到要删除的图片: {name}")

    (recycle_func or _send_to_recycle_bin)(target)
    return {
        "ok": True,
        "filename": name,
        "directory": str(folder),
        "images": build_recent_previews(folder),
    }


class JindouyunSaveImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "保存目录": ("STRING", {"default": str(default_output_directory())}),
                "文件名前缀": ("STRING", {"default": "ComfyUI"}),
                "目录覆盖": ("STRING", {"default": ""}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像", "保存路径")
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "筋斗云设计/图像"
    DESCRIPTION = "将图像保存到任意本地文件夹，可浏览目录并直接新建子文件夹。"
    SEARCH_ALIASES = ["筋斗云保存图像", "自定义目录保存", "保存图片", "save image"]

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        del kwargs
        return float("NaN")

    def save_images(
        self,
        图像,
        保存目录,
        文件名前缀="ComfyUI",
        目录覆盖="",
        prompt=None,
        extra_pnginfo=None,
    ):
        directory = resolve_save_directory(目录覆盖, 保存目录)
        directory.mkdir(parents=True, exist_ok=True)
        prefix = normalize_prefix(文件名前缀)
        saved_paths = []

        for batch_index, image in enumerate(图像):
            pixels = np.clip(255.0 * image.cpu().numpy(), 0, 255).astype(np.uint8)
            output = Image.fromarray(pixels)
            metadata = PngInfo()
            if prompt is not None:
                metadata.add_text("prompt", json.dumps(prompt, ensure_ascii=False))
            if extra_pnginfo is not None:
                for key, value in extra_pnginfo.items():
                    metadata.add_text(str(key), json.dumps(value, ensure_ascii=False))

            path = _next_path(directory, prefix, batch_index)
            output.save(path, pnginfo=metadata, compress_level=4)
            saved_paths.append(str(path))

        path_output = saved_paths[0] if len(saved_paths) == 1 else "\n".join(saved_paths)
        return {
            "ui": {
                "images": build_recent_previews(directory),
                "save_directory": [str(directory)],
            },
            "result": (图像, path_output),
        }
