from typing import Optional, Tuple

import torch


def _normalize_mask(mask: torch.Tensor) -> torch.Tensor:
    if mask.ndim == 2:
        return mask.unsqueeze(0)
    if mask.ndim == 3:
        if mask.shape[-1] == 1:
            return mask[..., 0]
        return mask
    if mask.ndim == 4:
        if mask.shape[-1] == 1:
            return mask[..., 0]
        return mask[..., 0]
    raise ValueError("MASK input must be HW, BHW, BHWC, or BHW1 tensor.")


def alpha_mask_from_image(image: torch.Tensor) -> torch.Tensor:
    if image.ndim != 4:
        raise ValueError("IMAGE input must be a BHWC tensor.")
    if image.shape[-1] == 4:
        return image[..., 3]
    return torch.ones(image.shape[:3], device=image.device, dtype=image.dtype)


def find_visible_bounds(mask: torch.Tensor, threshold: float = 0.001) -> Optional[Tuple[int, int, int, int]]:
    normalized = _normalize_mask(mask)
    visible = normalized > float(threshold)
    if not torch.any(visible):
        return None

    visible_y = torch.any(visible, dim=(0, 2))
    visible_x = torch.any(visible, dim=(0, 1))
    y_indices = torch.nonzero(visible_y, as_tuple=False).flatten()
    x_indices = torch.nonzero(visible_x, as_tuple=False).flatten()
    if y_indices.numel() == 0 or x_indices.numel() == 0:
        return None

    top = int(y_indices[0].item())
    bottom = int(y_indices[-1].item()) + 1
    left = int(x_indices[0].item())
    right = int(x_indices[-1].item()) + 1
    return left, top, right, bottom


def expand_bounds(
    bounds: Tuple[int, int, int, int],
    width: int,
    height: int,
    padding: int,
) -> Tuple[int, int, int, int]:
    left, top, right, bottom = bounds
    pad = max(0, int(padding))
    return (
        max(0, left - pad),
        max(0, top - pad),
        min(width, right + pad),
        min(height, bottom + pad),
    )


def crop_image_and_mask(
    image: torch.Tensor,
    enabled: bool = True,
    threshold: float = 0.001,
    padding: int = 0,
    mask: Optional[torch.Tensor] = None,
) -> Tuple[torch.Tensor, torch.Tensor]:
    if image.ndim != 4:
        raise ValueError("IMAGE input must be a BHWC tensor.")
    if image.shape[-1] not in (3, 4):
        raise ValueError("IMAGE input must have 3 or 4 channels.")

    source_mask = _normalize_mask(mask) if mask is not None else alpha_mask_from_image(image)
    if source_mask.shape[0] == 1 and image.shape[0] != 1:
        source_mask = source_mask.repeat(image.shape[0], 1, 1)
    if source_mask.shape[:3] != image.shape[:3]:
        raise ValueError("MASK size must match IMAGE size.")

    if not enabled:
        return image, source_mask.clamp(0, 1)

    bounds = find_visible_bounds(source_mask, threshold=threshold)
    if bounds is None:
        return image, source_mask.clamp(0, 1)

    _, height, width, _ = image.shape
    left, top, right, bottom = expand_bounds(bounds, width=width, height=height, padding=padding)
    return image[:, top:bottom, left:right, :], source_mask[:, top:bottom, left:right].clamp(0, 1)


class JindouyunTransparentCrop:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "启用裁切": ("BOOLEAN", {"default": True}),
                "透明阈值": ("FLOAT", {"default": 0.001, "min": 0.0, "max": 1.0, "step": 0.001}),
                "保留边距": ("INT", {"default": 0, "min": 0, "max": 4096, "step": 1}),
            },
            "optional": {
                "遮罩": ("MASK",),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("图像", "遮罩")
    FUNCTION = "crop"
    CATEGORY = "筋斗云设计/图像"
    DESCRIPTION = "按透明通道或遮罩裁掉图像周围多余空白，并可保留指定边距。"
    SEARCH_ALIASES = ["筋斗云透明裁切", "透明空白裁切", "裁切透明边"]

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    def crop(self, 图像, 启用裁切, 透明阈值, 保留边距, 遮罩=None):
        cropped_image, cropped_mask = crop_image_and_mask(
            image=图像,
            enabled=启用裁切,
            threshold=透明阈值,
            padding=保留边距,
            mask=遮罩,
        )
        return cropped_image, cropped_mask
