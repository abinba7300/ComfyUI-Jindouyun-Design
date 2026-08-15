import copy
import json
import re
from typing import Any


MAX_SCHEMES = 64
MAX_SEGMENTS = 12
MAX_BINDINGS_PER_SCHEME = 256
SUPPORTED_LORA_SUFFIXES = (".safetensors", ".ckpt", ".pt", ".pth")

DEFAULT_CONFIG = {
    "version": 1,
    "activeSchemeId": "scheme-1",
    "schemes": [
        {
            "id": "scheme-1",
            "name": "方案 1",
            "bindings": [],
            "segments": [
                {"id": "segment-1", "text": ""},
                {"id": "segment-2", "text": ""},
                {"id": "segment-3", "text": ""},
            ],
            "delimiter": ", ",
            "isDefault": True,
        }
    ],
}
DEFAULT_CONFIG_JSON = json.dumps(DEFAULT_CONFIG, ensure_ascii=False, separators=(",", ":"))


def normalize_lora_signal(value: Any) -> str:
    text = str(value or "").strip().strip('"').strip("'").replace("\\", "/")
    text = re.sub(r"/{2,}", "/", text)
    lowered = text.casefold()
    for suffix in SUPPORTED_LORA_SUFFIXES:
        if lowered.endswith(suffix):
            return text[:-len(suffix)]
    return text


def _boolean(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value or "").strip().casefold() in {"true", "1", "yes", "on", "开启"}


def _safe_id(value: Any, fallback: str, used: set[str]) -> str:
    base = str(value or "").strip()[:128] or fallback
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def _normalize_segments(raw_segments: Any, scheme_index: int) -> list[dict[str, str]]:
    if not isinstance(raw_segments, list):
        raw_segments = []
    segments = []
    used_ids: set[str] = set()
    for segment_index, raw_segment in enumerate(raw_segments[:MAX_SEGMENTS], start=1):
        if isinstance(raw_segment, dict):
            text = str(raw_segment.get("text") or "")
            raw_id = raw_segment.get("id")
        else:
            text = str(raw_segment or "")
            raw_id = None
        segments.append({
            "id": _safe_id(raw_id, f"segment-{scheme_index}-{segment_index}", used_ids),
            "text": text,
        })
    if not segments:
        segments.append({"id": f"segment-{scheme_index}-1", "text": ""})
    return segments


def normalize_router_config(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            payload = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return copy.deepcopy(DEFAULT_CONFIG)
    elif isinstance(value, dict):
        payload = value
    else:
        return copy.deepcopy(DEFAULT_CONFIG)

    raw_schemes = payload.get("schemes") if isinstance(payload, dict) else None
    if not isinstance(raw_schemes, list) or not raw_schemes:
        return copy.deepcopy(DEFAULT_CONFIG)

    schemes = []
    used_scheme_ids: set[str] = set()
    used_bindings: set[str] = set()
    default_claimed = False
    for scheme_index, raw_scheme in enumerate(raw_schemes[:MAX_SCHEMES], start=1):
        if not isinstance(raw_scheme, dict):
            raw_scheme = {}
        scheme_id = _safe_id(raw_scheme.get("id"), f"scheme-{scheme_index}", used_scheme_ids)
        name = str(raw_scheme.get("name") or "").strip()[:200] or f"方案 {scheme_index}"
        raw_bindings = raw_scheme.get("bindings")
        if isinstance(raw_bindings, str):
            raw_bindings = [raw_bindings]
        if not isinstance(raw_bindings, list):
            raw_bindings = []
        bindings = []
        for raw_binding in raw_bindings[:MAX_BINDINGS_PER_SCHEME]:
            binding = normalize_lora_signal(raw_binding)
            binding_key = binding.casefold()
            if not binding or binding_key in used_bindings:
                continue
            used_bindings.add(binding_key)
            bindings.append(binding)

        wants_default = _boolean(raw_scheme.get("isDefault"))
        is_default = wants_default and not default_claimed
        default_claimed = default_claimed or is_default
        schemes.append({
            "id": scheme_id,
            "name": name,
            "bindings": bindings,
            "segments": _normalize_segments(raw_scheme.get("segments"), scheme_index),
            "delimiter": str(raw_scheme.get("delimiter", ", ")),
            "isDefault": is_default,
        })

    active_scheme_id = str(payload.get("activeSchemeId") or "").strip()
    valid_ids = {item["id"] for item in schemes}
    if active_scheme_id not in valid_ids:
        active_scheme_id = schemes[0]["id"]
    return {
        "version": 1,
        "activeSchemeId": active_scheme_id,
        "schemes": schemes,
    }


def route_string(lora_name: Any, config_value: Any) -> tuple[str, str, str, str]:
    signal = normalize_lora_signal(lora_name)
    signal_key = signal.casefold()
    config = normalize_router_config(config_value)
    selected = None
    matched_keyword = ""
    matches = []
    if signal_key:
        for scheme in config["schemes"]:
            keyword = next(
                (binding for binding in scheme["bindings"] if binding.casefold() in signal_key),
                "",
            )
            if keyword:
                matches.append((scheme, keyword))
        if matches:
            selected, matched_keyword = matches[0]

    match_mode = "conflict" if signal_key and len(matches) > 1 else "matched"
    if selected is None:
        selected = next((scheme for scheme in config["schemes"] if scheme["isDefault"]), None)
        match_mode = "default" if selected is not None else "unmatched"

    if selected is None:
        return "", match_mode, "", ""
    parts = [
        str(segment.get("text") or "").strip()
        for segment in selected["segments"]
        if str(segment.get("text") or "").strip()
    ]
    return selected["delimiter"].join(parts), match_mode, selected["name"], matched_keyword


class JindouyunStringRouter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "LoRA名称": ("STRING", {"default": "", "forceInput": True}),
                "配置数据": ("STRING", {"default": DEFAULT_CONFIG_JSON, "multiline": False}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("字符串",)
    FUNCTION = "route"
    CATEGORY = "筋斗云设计/文本"
    DESCRIPTION = "根据 LoRA 名称关键词自动切换、拼接并输出对应提示词方案。"
    SEARCH_ALIASES = [
        "筋斗云-提示词",
        "筋斗云提示词",
        "筋斗云-字符串",
        "筋斗云字符串",
        "LoRA文本切换",
        "提示词方案",
        "字符串拼接",
    ]

    @classmethod
    def VALIDATE_INPUTS(cls, **_kwargs):
        return True

    def route(self, LoRA名称="", 配置数据=DEFAULT_CONFIG_JSON):
        text, match_mode, scheme_name, matched_keyword = route_string(LoRA名称, 配置数据)
        return {
            "ui": {
                "lora_name": [normalize_lora_signal(LoRA名称)],
                "match_mode": [match_mode],
                "scheme_name": [scheme_name],
                "matched_keyword": [matched_keyword],
            },
            "result": (text,),
        }
