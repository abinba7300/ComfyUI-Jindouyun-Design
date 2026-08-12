import json
import math
import re
from typing import Tuple

import torch
from PIL import Image, ImageDraw


CANVAS_PRESETS = [
    "自定义",
    "1:1",
    "3:4",
    "4:3",
    "16:9",
    "9:16",
    "2:3",
    "3:2",
    "4:5",
    "5:4",
    "21:9",
    "9:21",
]

BLEND_MODES = [
    "normal",
    "dissolve",
    "darken",
    "multiply",
    "color burn",
    "linear burn",
    "darker color",
    "lighten",
    "screen",
    "color dodge",
    "linear dodge(add)",
    "lighter color",
    "dodge",
    "overlay",
    "soft light",
    "hard light",
    "vivid light",
    "linear light",
    "pin light",
    "hard mix",
    "difference",
    "exclusion",
    "subtract",
    "divide",
    "hue",
    "saturation",
    "color",
    "luminosity",
    "grain extract",
    "grain merge",
]

SCALE_MODES = [
    "适应画布",
    "高度占画布",
    "宽度占画布",
    "手动缩放",
]

CANVAS_PERCENT_MAX = 2000.0
DEFAULT_DRAWING_DATA = '{"version":1,"strokes":[]}'


def parse_hex_color(color: str) -> Tuple[float, float, float]:
    text = str(color or "").strip()
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", text)
    if not match:
        raise ValueError(f"Invalid background color: {color}")
    hex_value = match.group(1)
    return tuple(int(hex_value[index:index + 2], 16) / 255.0 for index in (0, 2, 4))


def resolve_canvas_size(width: int, height: int, preset: str) -> Tuple[int, int]:
    out_width = max(1, int(width))
    out_height = max(1, int(height))
    preset_text = str(preset or "自定义").strip()
    if preset_text in {"", "自定义"} or ":" not in preset_text:
        return out_width, out_height

    left, right = preset_text.split(":", 1)
    ratio_w = max(1, int(left))
    ratio_h = max(1, int(right))
    return out_width, max(1, round(out_width * ratio_h / ratio_w))


def resolve_layer_size(
    image_width: int,
    image_height: int,
    canvas_width: int,
    canvas_height: int,
    scale: float,
    scale_mode: str = "适应画布",
    canvas_percent: float = 90.0,
) -> Tuple[int, int]:
    safe_scale = max(0.01, float(scale))
    if safe_scale > 10.0:
        safe_scale = 1.0

    mode = str(scale_mode or "适应画布")
    if mode not in SCALE_MODES:
        mode = "适应画布"
    percent = max(1.0, min(CANVAS_PERCENT_MAX, float(canvas_percent))) / 100.0
    if mode == "适应画布":
        fit_scale = min(
            canvas_width / max(1, image_width),
            canvas_height / max(1, image_height),
        ) * percent
        target_width = max(1, round(image_width * fit_scale))
        target_height = max(1, round(image_height * fit_scale))
    elif mode == "高度占画布":
        target_height = max(1, round(canvas_height * percent))
        target_width = max(1, round(target_height * image_width / max(1, image_height)))
    elif mode == "宽度占画布":
        target_width = max(1, round(canvas_width * percent))
        target_height = max(1, round(target_width * image_height / max(1, image_width)))
    else:
        base_scale = min(1.0, canvas_width / max(1, image_width), canvas_height / max(1, image_height))
        target_width = max(1, round(image_width * base_scale * safe_scale))
        target_height = max(1, round(image_height * base_scale * safe_scale))
        edge_fit = min(1.0, canvas_width / target_width, canvas_height / target_height)
        if edge_fit < 1.0:
            target_width = max(1, round(target_width * edge_fit))
            target_height = max(1, round(target_height * edge_fit))

    return target_width, target_height


def resolve_layer_regions(
    canvas_width: int,
    canvas_height: int,
    layer_width: int,
    layer_height: int,
    x_percent: float,
    y_percent: float,
) -> Tuple[int, int, int, int, int, int, int, int]:
    center_x = float(x_percent) / 100.0 * canvas_width
    center_y = float(y_percent) / 100.0 * canvas_height
    left = round(center_x - layer_width / 2)
    top = round(center_y - layer_height / 2)

    if layer_width <= canvas_width:
        left = min(max(0, left), canvas_width - layer_width)
    else:
        left = min(0, max(canvas_width - layer_width, left))

    if layer_height <= canvas_height:
        top = min(max(0, top), canvas_height - layer_height)
    else:
        top = min(0, max(canvas_height - layer_height, top))

    dst_left = max(0, left)
    dst_top = max(0, top)
    dst_right = min(canvas_width, left + layer_width)
    dst_bottom = min(canvas_height, top + layer_height)
    src_left = dst_left - left
    src_top = dst_top - top
    src_right = src_left + max(0, dst_right - dst_left)
    src_bottom = src_top + max(0, dst_bottom - dst_top)
    return src_left, src_top, src_right, src_bottom, dst_left, dst_top, dst_right, dst_bottom


def resolve_layer_bounds(
    canvas_width: int,
    canvas_height: int,
    layer_width: int,
    layer_height: int,
    x_percent: float,
    y_percent: float,
) -> Tuple[int, int, int, int]:
    _, _, _, _, dst_left, dst_top, dst_right, dst_bottom = resolve_layer_regions(
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        layer_width=layer_width,
        layer_height=layer_height,
        x_percent=x_percent,
        y_percent=y_percent,
    )
    return dst_left, dst_top, dst_right, dst_bottom


def sample_resized_region(
    image: torch.Tensor,
    target_width: int,
    target_height: int,
    src_left: int,
    src_top: int,
    src_right: int,
    src_bottom: int,
) -> torch.Tensor:
    region_width = max(0, src_right - src_left)
    region_height = max(0, src_bottom - src_top)
    if region_width == 0 or region_height == 0:
        return image[:, :0, :0, :]

    x = torch.arange(region_width, device=image.device, dtype=image.dtype) + src_left + 0.5
    y = torch.arange(region_height, device=image.device, dtype=image.dtype) + src_top + 0.5
    grid_y, grid_x = torch.meshgrid(y, x, indexing="ij")
    grid = torch.stack(
        (
            2.0 * grid_x / max(1, target_width) - 1.0,
            2.0 * grid_y / max(1, target_height) - 1.0,
        ),
        dim=-1,
    ).unsqueeze(0).expand(image.shape[0], -1, -1, -1)

    sampled = torch.nn.functional.grid_sample(
        image.permute(0, 3, 1, 2),
        grid,
        mode="bilinear",
        padding_mode="border",
        align_corners=False,
    )
    return sampled.permute(0, 2, 3, 1)


def normalize_rotation_degrees(value: float) -> float:
    try:
        degrees = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(degrees):
        return 0.0
    return (degrees + 180.0) % 360.0 - 180.0


def resolve_rotated_layer_size(width: int, height: int, rotation_degrees: float) -> Tuple[int, int]:
    angle = math.radians(normalize_rotation_degrees(rotation_degrees))
    cosine = abs(math.cos(angle))
    sine = abs(math.sin(angle))
    rotated_width = max(1, math.ceil(width * cosine + height * sine - 1e-6))
    rotated_height = max(1, math.ceil(width * sine + height * cosine - 1e-6))
    return rotated_width, rotated_height


def sample_rotated_region(
    image: torch.Tensor,
    target_width: int,
    target_height: int,
    rotated_width: int,
    rotated_height: int,
    rotation_degrees: float,
    src_left: int,
    src_top: int,
    src_right: int,
    src_bottom: int,
) -> torch.Tensor:
    region_width = max(0, src_right - src_left)
    region_height = max(0, src_bottom - src_top)
    if region_width == 0 or region_height == 0:
        return image[:, :0, :0, :]

    angle = math.radians(normalize_rotation_degrees(rotation_degrees))
    cosine = math.cos(angle)
    sine = math.sin(angle)
    x = torch.arange(region_width, device=image.device, dtype=image.dtype) + src_left + 0.5 - rotated_width / 2.0
    y = torch.arange(region_height, device=image.device, dtype=image.dtype) + src_top + 0.5 - rotated_height / 2.0
    grid_y, grid_x = torch.meshgrid(y, x, indexing="ij")
    source_x = cosine * grid_x + sine * grid_y + target_width / 2.0
    source_y = -sine * grid_x + cosine * grid_y + target_height / 2.0
    grid = torch.stack(
        (
            2.0 * source_x / max(1, target_width) - 1.0,
            2.0 * source_y / max(1, target_height) - 1.0,
        ),
        dim=-1,
    ).unsqueeze(0).expand(image.shape[0], -1, -1, -1)

    sampled = torch.nn.functional.grid_sample(
        image.permute(0, 3, 1, 2),
        grid,
        mode="bilinear",
        padding_mode="zeros",
        align_corners=False,
    )
    return sampled.permute(0, 2, 3, 1)


def crop_transparent_padding(image: torch.Tensor, alpha_threshold: float = 0.001) -> torch.Tensor:
    if image.ndim != 4 or image.shape[-1] != 4:
        return image

    alpha = image[..., 3]
    visible = alpha > float(alpha_threshold)
    if not torch.any(visible):
        return image

    visible_y = torch.any(visible, dim=(0, 2))
    visible_x = torch.any(visible, dim=(0, 1))
    y_indices = torch.nonzero(visible_y, as_tuple=False).flatten()
    x_indices = torch.nonzero(visible_x, as_tuple=False).flatten()
    if y_indices.numel() == 0 or x_indices.numel() == 0:
        return image

    top = int(y_indices[0].item())
    bottom = int(y_indices[-1].item()) + 1
    left = int(x_indices[0].item())
    right = int(x_indices[-1].item()) + 1
    return image[:, top:bottom, left:right, :]


def normalize_blend_mode(blend_mode) -> str:
    mode = str(blend_mode or "normal")
    return mode if mode in BLEND_MODES else "normal"


def blend_pixels(base: torch.Tensor, layer: torch.Tensor, blend_mode: str) -> torch.Tensor:
    mode = normalize_blend_mode(blend_mode).casefold()
    eps = 1e-6

    if mode in {"normal", "dissolve", "hue", "saturation", "color", "luminosity"}:
        result = layer
    elif mode == "darken":
        result = torch.minimum(base, layer)
    elif mode == "multiply":
        result = base * layer
    elif mode == "color burn":
        result = 1 - torch.minimum(torch.ones_like(base), (1 - base) / (layer + eps))
    elif mode == "linear burn":
        result = base + layer - 1
    elif mode == "darker color":
        base_luma = base.mean(dim=-1, keepdim=True)
        layer_luma = layer.mean(dim=-1, keepdim=True)
        result = torch.where(layer_luma < base_luma, layer, base)
    elif mode == "lighten":
        result = torch.maximum(base, layer)
    elif mode == "screen":
        result = 1 - (1 - base) * (1 - layer)
    elif mode in {"color dodge", "dodge"}:
        result = torch.minimum(torch.ones_like(base), base / (1 - layer + eps))
    elif mode == "linear dodge(add)":
        result = base + layer
    elif mode == "lighter color":
        base_luma = base.mean(dim=-1, keepdim=True)
        layer_luma = layer.mean(dim=-1, keepdim=True)
        result = torch.where(layer_luma > base_luma, layer, base)
    elif mode == "overlay":
        result = torch.where(base <= 0.5, 2 * base * layer, 1 - 2 * (1 - base) * (1 - layer))
    elif mode == "soft light":
        result = torch.where(
            layer <= 0.5,
            base - (1 - 2 * layer) * base * (1 - base),
            base + (2 * layer - 1) * (torch.sqrt(torch.clamp(base, min=0)) - base),
        )
    elif mode == "hard light":
        result = torch.where(layer <= 0.5, 2 * base * layer, 1 - 2 * (1 - base) * (1 - layer))
    elif mode == "vivid light":
        burn = 1 - torch.minimum(torch.ones_like(base), (1 - base) / (2 * layer + eps))
        dodge = torch.minimum(torch.ones_like(base), base / (2 * (1 - layer) + eps))
        result = torch.where(layer <= 0.5, burn, dodge)
    elif mode == "linear light":
        result = base + 2 * layer - 1
    elif mode == "pin light":
        result = torch.where(layer <= 0.5, torch.minimum(base, 2 * layer), torch.maximum(base, 2 * layer - 1))
    elif mode == "hard mix":
        vivid = blend_pixels(base, layer, "vivid light")
        result = torch.where(vivid < 0.5, torch.zeros_like(vivid), torch.ones_like(vivid))
    elif mode == "difference":
        result = torch.abs(base - layer)
    elif mode == "exclusion":
        result = base + layer - 2 * base * layer
    elif mode == "subtract":
        result = base - layer
    elif mode == "divide":
        result = base / (layer + eps)
    elif mode == "grain extract":
        result = base - layer + 0.5
    elif mode == "grain merge":
        result = base + layer - 0.5
    else:
        result = layer

    return result.clamp(0, 1)


def parse_drawing_data(drawing_data: str) -> list:
    if not drawing_data:
        return []
    try:
        payload = json.loads(str(drawing_data))
    except (TypeError, ValueError, json.JSONDecodeError):
        return []

    raw_strokes = payload.get("strokes", []) if isinstance(payload, dict) else []
    raw_groups = payload.get("groups", []) if isinstance(payload, dict) else []
    group_visibility = {
        str(group.get("id")): group.get("visible") is not False
        for group in raw_groups
        if isinstance(group, dict) and group.get("id")
    }
    strokes = []
    total_points = 0
    for raw_stroke in raw_strokes[:1000]:
        if not isinstance(raw_stroke, dict):
            continue
        raw_tool = raw_stroke.get("tool")
        tool = raw_tool if raw_tool in {"brush", "eraser", "lasso"} else "brush"
        brush_type = "pencil" if tool == "brush" and raw_stroke.get("brushType") == "pencil" else "solid"
        try:
            size = max(0.0005, min(0.5, float(raw_stroke.get("size", 0.02))))
        except (TypeError, ValueError):
            size = 0.02
        try:
            color = parse_hex_color(raw_stroke.get("color", "#FF6A00"))
        except ValueError:
            color = parse_hex_color("#FF6A00")

        points = []
        for raw_point in raw_stroke.get("points", []):
            if total_points >= 20000:
                break
            if not isinstance(raw_point, (list, tuple)) or len(raw_point) < 2:
                continue
            try:
                x = max(-20.0, min(20.0, float(raw_point[0])))
                y = max(-20.0, min(20.0, float(raw_point[1])))
            except (TypeError, ValueError):
                continue
            points.append((x, y))
            total_points += 1
        if tool == "lasso":
            if len(points) < 3:
                continue
            close_distance = ((points[-1][0] - points[0][0]) ** 2 + (points[-1][1] - points[0][1]) ** 2) ** 0.5
            if close_distance > 0.03:
                continue
            points[-1] = points[0]
        if points:
            mirror_points = []
            for raw_point in raw_stroke.get("mirrorPoints", []):
                if not isinstance(raw_point, (list, tuple)) or len(raw_point) < 2:
                    continue
                try:
                    mirror_points.append((max(-20.0, min(20.0, float(raw_point[0]))), max(-20.0, min(20.0, float(raw_point[1])))))
                except (TypeError, ValueError):
                    continue
            strokes.append({
                "tool": tool,
                "brush_type": brush_type,
                "visible": raw_stroke.get("visible") is not False,
                "group_visible": raw_stroke.get("groupVisible") is not False
                and group_visibility.get(str(raw_stroke.get("groupId")), True),
                "size": size,
                "color": color,
                "points": points,
                "mirror_points": mirror_points,
                "mirror_x": raw_stroke.get("mirrorX") is True,
            })
        if total_points >= 20000:
            break
    return strokes


def is_drawing_input_visible(drawing_data: str) -> bool:
    if not drawing_data:
        return True
    try:
        payload = json.loads(str(drawing_data))
    except (TypeError, ValueError, json.JSONDecodeError):
        return True
    return not isinstance(payload, dict) or payload.get("inputVisible") is not False


def _draw_stroke(draw: ImageDraw.ImageDraw, points, width: int, fill):
    pixel_points = [(round(x), round(y)) for x, y in points]
    radius = max(1, width // 2)
    if len(pixel_points) > 1:
        draw.line(pixel_points, fill=fill, width=width, joint="curve")
    for x, y in (pixel_points[0], pixel_points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def _pencil_noise(seed: float) -> float:
    value = math.sin(seed * 12.9898 + 78.233) * 43758.5453
    return value - math.floor(value) - 0.5


def _pencil_point_normal(points, index: int):
    previous = points[max(0, index - 1)]
    following = points[min(len(points) - 1, index + 1)]
    dx = following[0] - previous[0]
    dy = following[1] - previous[1]
    length = math.hypot(dx, dy) or 1.0
    return -dy / length, dx / length


def _draw_pencil_stroke(draw: ImageDraw.ImageDraw, points, width: int, color):
    seed = sum(x * 0.017 + y * 0.031 + index * 7.13 for index, (x, y) in enumerate(points)) + 11.7
    _draw_stroke(draw, points, max(1, round(width * 0.82)), (*color[:3], 20))
    if len(points) == 1:
        return
    normals = [_pencil_point_normal(points, index) for index in range(len(points))]
    fiber_count = round(max(3, min(15, width * 0.8)))
    for fiber_index in range(fiber_count):
        fiber_noise = _pencil_noise(seed + fiber_index * 17.37) + 0.5
        offset = ((fiber_index + 0.5) / fiber_count - 0.5) * width * 0.88
        fiber_points = []
        for index, point in enumerate(points):
            local_offset = offset + _pencil_noise(seed + fiber_index * 29.1 + index * 4.7) * width * 0.07
            fiber_points.append((
                point[0] + normals[index][0] * local_offset,
                point[1] + normals[index][1] * local_offset,
            ))
        fiber_width = max(1, round(width * (0.035 + fiber_noise * 0.045)))
        base_alpha = round(46 + fiber_noise * 87)
        _draw_stroke(draw, fiber_points, fiber_width, (*color[:3], base_alpha))

        segment_spacing = max(2.0, width * 0.35)
        segment_index = 0
        for start, end in zip(fiber_points, fiber_points[1:]):
            dx = end[0] - start[0]
            dy = end[1] - start[1]
            length = math.hypot(dx, dy)
            steps = min(128, max(1, math.ceil(length / segment_spacing)))
            previous = start
            for step in range(1, steps + 1):
                amount = step / steps
                current = (start[0] + dx * amount, start[1] + dy * amount)
                if _pencil_noise(seed + fiber_index * 101.3 + segment_index * 3.71) > -0.08:
                    alpha_noise = _pencil_noise(seed + fiber_index * 67.9 + segment_index * 8.13) + 0.5
                    draw.line((previous, current), fill=(*color[:3], round(92 + alpha_noise * 92)), width=fiber_width)
                previous = current
                segment_index += 1


def apply_drawing_to_canvas(canvas: torch.Tensor, drawing_data: str) -> torch.Tensor:
    strokes = parse_drawing_data(drawing_data)
    if not strokes:
        return canvas

    _, height, width, _ = canvas.shape
    drawing = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    shortest_side = max(1, min(width, height))

    for stroke in strokes:
        if not stroke["visible"] or not stroke["group_visible"]:
            continue
        line_width = max(1, round(stroke["size"] * shortest_side))
        points = [(x * (width - 1), y * (height - 1)) for x, y in stroke["points"]]
        point_sets = [points]
        if stroke["mirror_points"]:
            point_sets.append([(x * (width - 1), y * (height - 1)) for x, y in stroke["mirror_points"]])
        elif stroke["mirror_x"]:
            point_sets.append([((width - 1) - x, y) for x, y in points])
        if stroke["tool"] == "eraser":
            alpha = drawing.getchannel("A")
            alpha_draw = ImageDraw.Draw(alpha)
            for stroke_points in point_sets:
                _draw_stroke(alpha_draw, stroke_points, line_width, 0)
            drawing.putalpha(alpha)
            continue

        red, green, blue = (round(channel * 255) for channel in stroke["color"])
        stroke_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        stroke_draw = ImageDraw.Draw(stroke_layer)
        for stroke_points in point_sets:
            if stroke["tool"] == "lasso" and len(stroke_points) >= 3:
                stroke_draw.polygon(stroke_points, fill=(red, green, blue, 255))
            elif stroke["brush_type"] == "pencil":
                _draw_pencil_stroke(stroke_draw, stroke_points, line_width, (red, green, blue))
            else:
                _draw_stroke(stroke_draw, stroke_points, line_width, (red, green, blue, 255))
        drawing = Image.alpha_composite(drawing, stroke_layer)

    rgba = torch.frombuffer(bytearray(drawing.tobytes()), dtype=torch.uint8)
    rgba = rgba.reshape(height, width, 4).to(device=canvas.device, dtype=canvas.dtype) / 255.0
    paint = rgba[..., :3].unsqueeze(0)
    alpha = rgba[..., 3:4].unsqueeze(0)
    return (paint * alpha + canvas * (1 - alpha)).clamp(0, 1)


def composite_image_on_canvas(
    image: torch.Tensor | None,
    width: int,
    height: int,
    background_color: str,
    x_percent: float,
    y_percent: float,
    scale: float,
    preset: str = "自定义",
    blend_mode: str = "normal",
    opacity: float = 1.0,
    scale_mode: str = "适应画布",
    canvas_percent: float = 90.0,
    drawing_data: str = DEFAULT_DRAWING_DATA,
    include_input_image: bool = True,
    rotation_degrees: float = 0.0,
) -> torch.Tensor:
    canvas_width, canvas_height = resolve_canvas_size(width, height, preset)
    rgb = parse_hex_color(background_color)

    if image is not None and image.ndim != 4:
        raise ValueError("IMAGE input must be a BHWC tensor.")

    if image is not None:
        image = crop_transparent_padding(image)
        batch, image_height, image_width, channels = image.shape
        if channels not in (3, 4):
            raise ValueError("IMAGE input must have 3 or 4 channels.")
        device = image.device
        dtype = image.dtype
    else:
        batch = 1
        device = torch.device("cpu")
        dtype = torch.float32

    canvas = torch.empty((batch, canvas_height, canvas_width, 3), device=device, dtype=dtype)
    canvas[..., 0] = rgb[0]
    canvas[..., 1] = rgb[1]
    canvas[..., 2] = rgb[2]

    if image is not None and bool(include_input_image) and is_drawing_input_visible(drawing_data):
        target_width, target_height = resolve_layer_size(
            image_width=image_width,
            image_height=image_height,
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            scale=scale,
            scale_mode=scale_mode,
            canvas_percent=canvas_percent,
        )
        rotation = normalize_rotation_degrees(rotation_degrees)
        rotated_width, rotated_height = resolve_rotated_layer_size(target_width, target_height, rotation)
        src_left, src_top, src_right, src_bottom, dst_left, dst_top, dst_right, dst_bottom = resolve_layer_regions(
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            layer_width=rotated_width,
            layer_height=rotated_height,
            x_percent=x_percent,
            y_percent=y_percent,
        )

        sample_region = sample_resized_region if abs(rotation) < 1e-6 else sample_rotated_region
        sample_kwargs = {
            "target_width": target_width,
            "target_height": target_height,
            "src_left": src_left,
            "src_top": src_top,
            "src_right": src_right,
            "src_bottom": src_bottom,
        }
        if sample_region is sample_rotated_region:
            sample_kwargs.update({
                "rotated_width": rotated_width,
                "rotated_height": rotated_height,
                "rotation_degrees": rotation,
            })
        src_region = sample_region(image=image[..., :3], **sample_kwargs)
        dst_region = canvas[:, dst_top:dst_bottom, dst_left:dst_right, :]
        blended = blend_pixels(dst_region, src_region, blend_mode)
        effective_opacity = max(0.0, min(1.0, float(opacity)))
        if channels == 4 or abs(rotation) >= 1e-6:
            alpha_source = image[..., 3:4] if channels == 4 else torch.ones_like(image[..., :1])
            effective_alpha = sample_region(image=alpha_source, **sample_kwargs).clamp(0, 1) * effective_opacity
        else:
            effective_alpha = effective_opacity
        canvas[:, dst_top:dst_bottom, dst_left:dst_right, :] = blended * effective_alpha + dst_region * (1 - effective_alpha)

    return apply_drawing_to_canvas(canvas.clamp(0, 1), drawing_data)


class JindouyunCanvasComposite:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "画布比例": (CANVAS_PRESETS,),
                "画布宽度": ("INT", {"default": 1024, "min": 1, "max": 16384, "step": 1}),
                "画布高度": ("INT", {"default": 1024, "min": 1, "max": 16384, "step": 1}),
                "背景颜色": ("STRING", {"default": "#FFFFFF", "multiline": False}),
                "图片X": ("FLOAT", {"default": 50.0, "min": -200.0, "max": 300.0, "step": 0.1}),
                "图片Y": ("FLOAT", {"default": 50.0, "min": -200.0, "max": 300.0, "step": 0.1}),
                "图片缩放": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 100.0, "step": 0.01}),
                "混合模式": (BLEND_MODES,),
                "透明度": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "缩放方式": (SCALE_MODES,),
                "画布占比": ("FLOAT", {"default": 90.0, "min": 1.0, "max": CANVAS_PERCENT_MAX, "step": 1.0}),
                "绘画数据": ("STRING", {"default": DEFAULT_DRAWING_DATA, "multiline": False}),
                "输出输入图像": ("BOOLEAN", {"default": True, "label_on": "输出输入图像", "label_off": "仅作绘画参考"}),
                "图片旋转": ("STRING", {"default": "0.0", "multiline": False}),
            },
            "optional": {
                "图像": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "compose"
    CATEGORY = "筋斗云设计/图像"
    DESCRIPTION = "创建自定义尺寸和背景色画布，并把输入图像按位置合成为一张图。"
    SEARCH_ALIASES = ["筋斗云画布合成", "背景画布", "图像放到画布"]

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    def compose(
        self,
        画布比例,
        画布宽度,
        画布高度,
        背景颜色,
        图片X,
        图片Y,
        图片缩放,
        混合模式="normal",
        透明度=1.0,
        缩放方式="适应画布",
        画布占比=90.0,
        绘画数据=DEFAULT_DRAWING_DATA,
        输出输入图像=True,
        图片旋转=0.0,
        图像=None,
    ):
        return (
            composite_image_on_canvas(
                image=图像,
                width=画布宽度,
                height=画布高度,
                background_color=背景颜色,
                x_percent=图片X,
                y_percent=图片Y,
                scale=图片缩放,
                preset=画布比例,
                blend_mode=normalize_blend_mode(混合模式),
                opacity=透明度,
                scale_mode=缩放方式,
                canvas_percent=画布占比,
                drawing_data=绘画数据,
                include_input_image=输出输入图像,
                rotation_degrees=图片旋转,
            ),
        )
