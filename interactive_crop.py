import json
import math
import os
from pathlib import Path
from typing import Any, Dict, Tuple

import folder_paths
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageOps


DEFAULT_CROP_DATA = json.dumps(
    {"version": 1, "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
    ensure_ascii=False,
    separators=(",", ":"),
)

RESIZE_METHODS = [
    "双三次 bicubic（推荐·通用）",
    "Lanczos（推荐·清晰锐利）",
    "区域 area（推荐·缩小）",
    "双线性 bilinear（快速）",
    "最近邻 nearest-exact（像素画/蒙版）",
]

RESIZE_METHOD_ALIASES = {
    RESIZE_METHODS[0]: "bicubic",
    RESIZE_METHODS[1]: "lanczos",
    RESIZE_METHODS[2]: "area",
    RESIZE_METHODS[3]: "bilinear",
    RESIZE_METHODS[4]: "nearest-exact",
    "bicubic": "bicubic",
    "lanczos": "lanczos",
    "area": "area",
    "bilinear": "bilinear",
    "nearest-exact": "nearest-exact",
}


def _clamp(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(number):
        return fallback
    return max(minimum, min(maximum, number))


def parse_crop_data(value: Any) -> Dict[str, float]:
    try:
        payload = json.loads(str(value or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    x = _clamp(payload.get("x"), 0.0, 1.0, 0.0)
    y = _clamp(payload.get("y"), 0.0, 1.0, 0.0)
    width = _clamp(payload.get("width"), 0.0, 1.0, 1.0)
    height = _clamp(payload.get("height"), 0.0, 1.0, 1.0)
    width = max(0.0, min(width, 1.0 - x))
    height = max(0.0, min(height, 1.0 - y))

    if width <= 0.0:
        x = min(x, 1.0 - 1e-6)
        width = min(1.0 - x, 1e-6)
    if height <= 0.0:
        y = min(y, 1.0 - 1e-6)
        height = min(1.0 - y, 1e-6)

    return {"x": x, "y": y, "width": width, "height": height}


def resolve_crop_bounds(
    image_width: int,
    image_height: int,
    crop_data: Any,
) -> Tuple[int, int, int, int]:
    width = max(1, int(image_width))
    height = max(1, int(image_height))
    crop = parse_crop_data(crop_data)

    left = min(width - 1, max(0, int(math.floor(crop["x"] * width))))
    top = min(height - 1, max(0, int(math.floor(crop["y"] * height))))
    right = min(width, max(left + 1, int(math.ceil((crop["x"] + crop["width"]) * width))))
    bottom = min(height, max(top + 1, int(math.ceil((crop["y"] + crop["height"]) * height))))
    return left, top, right, bottom


def crop_image_tensor(image: torch.Tensor, crop_data: Any) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("图像输入必须是 BHWC 格式。")
    if image.shape[-1] not in (1, 3, 4):
        raise ValueError("图像输入必须包含 1、3 或 4 个通道。")

    _, height, width, _ = image.shape
    left, top, right, bottom = resolve_crop_bounds(width, height, crop_data)
    return image[:, top:bottom, left:right, :].contiguous()


def mirror_image_tensor(
    image: torch.Tensor,
    horizontal: bool = False,
    vertical: bool = False,
) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("image input must use BHWC format")
    if image.shape[-1] not in (1, 3, 4):
        raise ValueError("image input must have 1, 3, or 4 channels")

    axes = []
    if vertical:
        axes.append(1)
    if horizontal:
        axes.append(2)
    if not axes:
        return image
    return torch.flip(image, dims=axes).contiguous()


def normalize_rotation_degrees(value: Any) -> float:
    try:
        angle = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(angle):
        return 0.0
    return ((angle + 180.0) % 360.0) - 180.0


def resolve_rotated_size(width: int, height: int, angle: float) -> Tuple[int, int]:
    radians = math.radians(normalize_rotation_degrees(angle))
    cosine = abs(math.cos(radians))
    sine = abs(math.sin(radians))
    return (
        max(1, math.ceil(width * cosine + height * sine - 1e-6)),
        max(1, math.ceil(width * sine + height * cosine - 1e-6)),
    )


def rotate_image_tensor_expand(image: torch.Tensor, angle: Any) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("image input must use BHWC format")
    if image.shape[-1] not in (1, 3, 4):
        raise ValueError("image input must have 1, 3, or 4 channels")

    normalized_angle = normalize_rotation_degrees(angle)
    if normalized_angle == 0.0:
        return image

    batch, height, width, channels = image.shape
    output_width, output_height = resolve_rotated_size(
        width,
        height,
        normalized_angle,
    )
    original_dtype = image.dtype
    sampled_input = image.movedim(-1, 1).float()
    has_alpha = channels in (3, 4)

    if channels == 3:
        alpha = torch.ones_like(sampled_input[:, :1])
        sampled_input = torch.cat((sampled_input, alpha), dim=1)
    if has_alpha:
        sampled_input = torch.cat(
            (
                sampled_input[:, :3] * sampled_input[:, 3:4],
                sampled_input[:, 3:4],
            ),
            dim=1,
        )

    radians = math.radians(normalized_angle)
    cosine = math.cos(radians)
    sine = math.sin(radians)
    destination_y, destination_x = torch.meshgrid(
        torch.arange(output_height, device=image.device, dtype=sampled_input.dtype),
        torch.arange(output_width, device=image.device, dtype=sampled_input.dtype),
        indexing="ij",
    )
    destination_x = destination_x - (output_width - 1) / 2
    destination_y = destination_y - (output_height - 1) / 2
    source_x = cosine * destination_x + sine * destination_y + (width - 1) / 2
    source_y = -sine * destination_x + cosine * destination_y + (height - 1) / 2
    sampling_grid = torch.stack(
        (
            2 * (source_x + 0.5) / width - 1,
            2 * (source_y + 0.5) / height - 1,
        ),
        dim=-1,
    ).unsqueeze(0).expand(batch, -1, -1, -1)

    rotated = F.grid_sample(
        sampled_input,
        sampling_grid,
        mode="bilinear",
        padding_mode="zeros",
        align_corners=False,
    )
    if has_alpha:
        alpha = rotated[:, 3:4]
        rgb = torch.where(
            alpha > 1e-8,
            rotated[:, :3] / alpha.clamp_min(1e-8),
            torch.zeros_like(rotated[:, :3]),
        )
        rotated = torch.cat((rgb, alpha), dim=1)

    return rotated.movedim(1, -1).to(dtype=original_dtype).contiguous()


def _resize_lanczos(
    image: torch.Tensor,
    target_width: int,
    target_height: int,
) -> torch.Tensor:
    original_device = image.device
    original_dtype = image.dtype
    channels = image.shape[-1]
    resized_batches = []

    for frame in image.detach().float().cpu():
        pixels = (
            frame.clamp(0, 1)
            .mul(255)
            .round()
            .to(torch.uint8)
            .numpy()
        )
        if channels == 1:
            pixels = pixels[..., 0]
        pil_image = Image.fromarray(pixels)
        resized = pil_image.resize(
            (target_width, target_height),
            resample=Image.Resampling.LANCZOS,
        )
        resized_pixels = np.asarray(resized, dtype=np.float32)
        if resized_pixels.ndim == 2:
            resized_pixels = resized_pixels[..., None]
        resized_batches.append(torch.from_numpy(resized_pixels.copy()).div(255.0))

    return (
        torch.stack(resized_batches)
        .to(device=original_device, dtype=original_dtype)
        .clamp(0, 1)
        .contiguous()
    )


def resize_image_to_max_edge(
    image: torch.Tensor,
    max_edge: int = 0,
    resize_method: str = RESIZE_METHODS[0],
) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("图像输入必须是 BHWC 格式。")

    target_edge = max(0, int(max_edge or 0))
    if target_edge == 0:
        return image

    _, height, width, _ = image.shape
    current_edge = max(height, width)
    if current_edge == target_edge:
        return image

    scale = target_edge / current_edge
    target_width = max(1, math.floor(width * scale + 0.5))
    target_height = max(1, math.floor(height * scale + 0.5))
    return resize_image_to_dimensions(
        image,
        target_width=target_width,
        target_height=target_height,
        resize_method=resize_method,
    )


def resize_image_to_dimensions(
    image: torch.Tensor,
    target_width: int,
    target_height: int,
    resize_method: str = RESIZE_METHODS[0],
) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("图像输入必须是 BHWC 格式。")

    width = max(1, int(target_width))
    height = max(1, int(target_height))
    if image.shape[2] == width and image.shape[1] == height:
        return image

    method = RESIZE_METHOD_ALIASES.get(str(resize_method), "bicubic")
    if method == "lanczos":
        return _resize_lanczos(image, width, height)

    original_dtype = image.dtype
    channels_first = image.movedim(-1, 1)
    if not channels_first.is_floating_point() or (
        channels_first.device.type == "cpu"
        and channels_first.dtype in (torch.float16, torch.bfloat16)
    ):
        channels_first = channels_first.float()

    resize_options = {
        "size": (height, width),
        "mode": method,
    }
    if method in ("bilinear", "bicubic"):
        resize_options.update(align_corners=False, antialias=True)
    resized = F.interpolate(channels_first, **resize_options)
    return resized.movedim(1, -1).to(dtype=original_dtype).clamp(0, 1).contiguous()


def resize_image_by_percent(
    image: torch.Tensor,
    width_percent: Any = 100.0,
    height_percent: Any = 100.0,
    aspect_locked: bool = True,
    resize_method: str = RESIZE_METHODS[0],
) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("图像输入必须是 BHWC 格式。")

    width_scale = _clamp(width_percent, 1.0, 2000.0, 100.0)
    height_scale = _clamp(height_percent, 1.0, 2000.0, 100.0)
    if bool(aspect_locked):
        height_scale = width_scale

    _, height, width, _ = image.shape
    target_width = max(1, math.floor(width * width_scale / 100.0 + 0.5))
    target_height = max(1, math.floor(height * height_scale / 100.0 + 0.5))
    return resize_image_to_dimensions(
        image,
        target_width=target_width,
        target_height=target_height,
        resize_method=resize_method,
    )


def crop_and_resize_image(
    image: torch.Tensor,
    crop_data: Any,
    max_edge: int = 0,
    resize_method: str = RESIZE_METHODS[0],
    rotation_degrees: float = 0.0,
    mirror_horizontal: bool = False,
    mirror_vertical: bool = False,
    aspect_locked: bool = True,
    width_percent: float = 100.0,
    height_percent: float = 100.0,
) -> torch.Tensor:
    mirrored = mirror_image_tensor(
        image,
        horizontal=mirror_horizontal,
        vertical=mirror_vertical,
    )
    rotated = rotate_image_tensor_expand(mirrored, rotation_degrees)
    cropped = crop_image_tensor(rotated, crop_data)
    transformed = resize_image_by_percent(
        cropped,
        width_percent=width_percent,
        height_percent=height_percent,
        aspect_locked=aspect_locked,
        resize_method=resize_method,
    )
    return resize_image_to_max_edge(
        transformed,
        max_edge=max_edge,
        resize_method=resize_method,
    )


def load_uploaded_image(filename: str) -> torch.Tensor:
    name = str(filename or "").strip()
    if not name:
        raise ValueError("请上传图片，或连接上游图像输入。")

    image_path = Path(folder_paths.get_annotated_filepath(name))
    if not image_path.is_file():
        raise ValueError(f"找不到上传图片：{name}")

    with Image.open(image_path) as opened:
        image = ImageOps.exif_transpose(opened)
        mode = "RGBA" if "A" in image.getbands() else "RGB"
        pixels = np.asarray(image.convert(mode), dtype=np.float32) / 255.0
    return torch.from_numpy(pixels.copy()).unsqueeze(0)


class JindouyunInteractiveCrop:
    @classmethod
    def INPUT_TYPES(cls):
        input_directory = folder_paths.get_input_directory()
        files = [
            filename
            for filename in os.listdir(input_directory)
            if os.path.isfile(os.path.join(input_directory, filename))
        ]
        filter_content_types = getattr(folder_paths, "filter_files_content_types", None)
        if callable(filter_content_types):
            files = filter_content_types(files, ["image"])
        return {
            "required": {
                "上传图片": (files or [""], {"image_upload": True}),
                "裁剪数据": (
                    "STRING",
                    {"default": DEFAULT_CROP_DATA, "multiline": False},
                ),
                "最大边分辨率": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "默认实时显示裁剪框最长边；输入其它数值会自动切换为自定义缩放，输入 0 恢复实时。",
                    },
                ),
                "放大方法": (
                    RESIZE_METHODS,
                    {
                        "default": RESIZE_METHODS[0],
                        "tooltip": (
                            "实用推荐\n"
                            "产品图、照片、普通透明素材：bicubic\n"
                            "更追求锐利细节：lanczos\n"
                            "主要进行缩小：area 或 lanczos\n"
                            "蒙版、线稿分区、像素画：nearest-exact\n"
                            "只想快速运行：bilinear"
                        ),
                    },
                ),
                "图片旋转": (
                    "FLOAT",
                    {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1},
                ),
                "左右镜像": ("BOOLEAN", {"default": False}),
                "上下镜像": ("BOOLEAN", {"default": False}),
                "锁定长宽比": (
                    "BOOLEAN",
                    {"default": True, "label_on": "锁定", "label_off": "解锁"},
                ),
                "宽度比例": (
                    "FLOAT",
                    {"default": 100.0, "min": 1.0, "max": 2000.0, "step": 1.0},
                ),
                "高度比例": (
                    "FLOAT",
                    {"default": 100.0, "min": 1.0, "max": 2000.0, "step": 1.0},
                ),
                "分流标准最大边": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 1,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "原始裁剪图的最大边达到此值时走符合尺寸，否则走不符合尺寸；后续变形和放大不参与判断。",
                    },
                ),
                "启用最大边分辨率": (
                    "BOOLEAN",
                    {"default": False, "label_on": "开启", "label_off": "关闭"},
                ),
            },
            "optional": {
                "图像": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE", "BOOLEAN", "BOOLEAN")
    RETURN_NAMES = ("图像", "符合尺寸", "不符合尺寸")
    FUNCTION = "crop"
    CATEGORY = "筋斗云设计/图像"
    DESCRIPTION = "交互裁剪、旋转、镜像及长宽比变形图片，并按最终最大边尺寸分流输出。"
    SEARCH_ALIASES = ["筋斗云交互裁剪", "手动裁剪", "可视化裁剪", "图片裁剪"]

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    def crop(
        self,
        上传图片="",
        裁剪数据=DEFAULT_CROP_DATA,
        最大边分辨率=0,
        放大方法=RESIZE_METHODS[0],
        图片旋转=0.0,
        左右镜像=False,
        上下镜像=False,
        锁定长宽比=True,
        宽度比例=100.0,
        高度比例=100.0,
        分流标准最大边=1024,
        启用最大边分辨率=False,
        图像=None,
    ):
        source = 图像 if isinstance(图像, torch.Tensor) else load_uploaded_image(上传图片)
        mirrored = mirror_image_tensor(
            source,
            horizontal=左右镜像,
            vertical=上下镜像,
        )
        rotated = rotate_image_tensor_expand(mirrored, 图片旋转)
        original_crop = crop_image_tensor(rotated, 裁剪数据)
        transformed = resize_image_by_percent(
            original_crop,
            width_percent=宽度比例,
            height_percent=高度比例,
            aspect_locked=锁定长宽比,
            resize_method=放大方法,
        )
        result = resize_image_to_max_edge(
            transformed,
            max_edge=最大边分辨率 if bool(启用最大边分辨率) else 0,
            resize_method=放大方法,
        )
        threshold = max(1, int(分流标准最大边 or 1024))
        original_crop_edge = max(int(original_crop.shape[1]), int(original_crop.shape[2]))
        is_qualified = original_crop_edge >= threshold
        return result, is_qualified, not is_qualified
