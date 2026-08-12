import math
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Tuple


DEFAULT_STEP = Decimal("0.05")
DEFAULT_COLOR = "#FF6A00"
HEX_COLOR_PATTERN = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _finite_decimal(value: Any, fallback: Decimal) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return fallback
    return result if result.is_finite() else fallback


def _decimal_places(value: Decimal) -> int:
    return max(0, -value.normalize().as_tuple().exponent)


def normalize_slider_config(
    value: Any,
    minimum: Any,
    maximum: Any,
    step: Any,
) -> Tuple[float, float, float, float]:
    low = _finite_decimal(minimum, Decimal("0"))
    high = _finite_decimal(maximum, Decimal("1"))
    if high < low:
        low, high = high, low

    step_value = abs(_finite_decimal(step, DEFAULT_STEP))
    if step_value == 0:
        step_value = DEFAULT_STEP

    current = _finite_decimal(value, low)
    current = min(high, max(low, current))
    if high > low:
        step_count = ((current - low) / step_value).to_integral_value(rounding=ROUND_HALF_UP)
        current = low + step_count * step_value
        current = min(high, max(low, current))

    places = max(
        _decimal_places(low),
        _decimal_places(high),
        _decimal_places(step_value),
    )
    quantum = Decimal(1).scaleb(-places)
    current = current.quantize(quantum)
    return float(current), float(low), float(high), float(step_value)


def normalize_hex_color(value: Any) -> str:
    match = HEX_COLOR_PATTERN.fullmatch(str(value or "").strip())
    if not match:
        return DEFAULT_COLOR
    digits = match.group(1).upper()
    if len(digits) == 3:
        digits = "".join(character * 2 for character in digits)
    return f"#{digits}"


class JindouyunNumberSlider:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "滑块名称": ("STRING", {"default": "数值滑块"}),
                "当前值": (
                    "FLOAT",
                    {"default": 0.5, "min": -1000000.0, "max": 1000000.0, "step": 0.01},
                ),
                "最小值": (
                    "FLOAT",
                    {"default": 0.0, "min": -1000000.0, "max": 1000000.0, "step": 0.01},
                ),
                "最大值": (
                    "FLOAT",
                    {"default": 1.0, "min": -1000000.0, "max": 1000000.0, "step": 0.01},
                ),
                "步进值": (
                    "FLOAT",
                    {"default": 0.05, "min": 0.000001, "max": 1000000.0, "step": 0.01},
                ),
                "滑块颜色": ("STRING", {"default": DEFAULT_COLOR}),
            }
        }

    RETURN_TYPES = ("FLOAT",)
    RETURN_NAMES = ("数值",)
    FUNCTION = "slide"
    CATEGORY = "筋斗云设计/数值"
    DESCRIPTION = "可命名并自定义范围、步进和颜色的数值滑块，输出 FLOAT。"
    SEARCH_ALIASES = ["筋斗云滑块", "LoRA强度滑块", "重绘值滑块", "数值控制"]

    def slide(
        self,
        滑块名称="数值滑块",
        当前值=0.5,
        最小值=0.0,
        最大值=1.0,
        步进值=0.05,
        滑块颜色=DEFAULT_COLOR,
    ):
        del 滑块名称, 滑块颜色
        normalized, _, _, _ = normalize_slider_config(当前值, 最小值, 最大值, 步进值)
        if not math.isfinite(normalized):
            normalized = 0.0
        return (float(normalized),)
