import json
from typing import Any


class AnyType(str):
    def __eq__(self, _other):
        return True

    def __ne__(self, _other):
        return False


ANY_TYPE = AnyType("*")


def stringify_value(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return str(value)
    try:
        return json.dumps(value, indent=2, ensure_ascii=False, default=str)
    except (TypeError, ValueError, OverflowError):
        return str(value)


class JindouyunShowAnything:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "放大文字": (
                    "BOOLEAN",
                    {"default": False, "label_on": "开启", "label_off": "关闭"},
                ),
                "放大倍数": (
                    "FLOAT",
                    {"default": 3.0, "min": 1.0, "max": 10.0, "step": 0.5},
                ),
            },
            "optional": {"任意内容": (ANY_TYPE, {})},
        }

    RETURN_TYPES = (ANY_TYPE,)
    RETURN_NAMES = ("原样输出",)
    INPUT_IS_LIST = True
    OUTPUT_NODE = True
    FUNCTION = "show"
    CATEGORY = "筋斗云设计/文本"
    DESCRIPTION = "显示任意输入内容，并可在节点内临时放大文字；输出数据保持不变。"

    def show(self, **kwargs):
        values = kwargs.get("任意内容")
        if values is None:
            values = []
        elif not isinstance(values, list):
            values = [values]

        display_values = [stringify_value(value) for value in values]
        if not values:
            output = None
        elif len(values) == 1:
            output = values[0]
        else:
            output = values

        return {"ui": {"text": display_values}, "result": (output,)}
