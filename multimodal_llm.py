import base64
import hashlib
import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from io import BytesIO
from typing import Any, Callable

import numpy as np
from PIL import Image


PROVIDER_PRESETS = {
    "OpenAI": {
        "base_url": "https://api.openai.com/v1",
        "key_url": "https://platform.openai.com/api-keys",
    },
    "DeepSeek": {
        "base_url": "https://api.deepseek.com",
        "key_url": "https://platform.deepseek.com/api_keys",
    },
    "阿里云百炼": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "key_url": "https://bailian.console.aliyun.com/?apiKey=1&tab=model",
    },
    "豆包（火山方舟）": {
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "key_url": "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
    },
    "智谱AI": {
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "key_url": "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    },
    "Kimi": {
        "base_url": "https://api.moonshot.cn/v1",
        "key_url": "https://platform.kimi.com/console/api-keys",
    },
    "小米MiMo": {
        "base_url": "https://api.xiaomimimo.com/v1",
        "key_url": "https://platform.xiaomimimo.com",
    },
    "自定义 OpenAI 兼容": {
        "base_url": "http://127.0.0.1:8000/v1",
        "key_url": "https://platform.openai.com/docs/api-reference/introduction",
    },
}

MAX_INPUT_IMAGES = 16
LEGACY_IMAGE_PROMPT = "请分析输入的图片。"
DEFAULT_ASSISTANT_PROMPT = "你好，请介绍一下你能提供哪些帮助。"


def normalize_base_url(value: Any) -> str:
    url = str(value or "").strip().rstrip("/")
    if not url:
        raise ValueError("Base URL 不能为空")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Base URL 必须是有效的 http 或 https 地址")
    if parsed.username or parsed.password:
        raise ValueError("Base URL 不能包含用户名或密码")
    return url


def provider_preset(provider: Any) -> dict[str, str]:
    return PROVIDER_PRESETS.get(str(provider or ""), PROVIDER_PRESETS["自定义 OpenAI 兼容"])


def resolve_provider_base_url(provider: Any, value: Any) -> str:
    provider_name = str(provider or "")
    candidate = normalize_base_url(value)
    if provider_name not in PROVIDER_PRESETS or provider_name == "自定义 OpenAI 兼容":
        return candidate
    foreign_presets = {
        normalize_base_url(preset["base_url"])
        for name, preset in PROVIDER_PRESETS.items()
        if name not in {provider_name, "自定义 OpenAI 兼容"}
    }
    if candidate in foreign_presets:
        return PROVIDER_PRESETS[provider_name]["base_url"]
    return candidate


def model_list_url(provider: Any, base_url: Any) -> str:
    base = normalize_base_url(base_url)
    if str(provider or "") == "阿里云百炼":
        marker = "/compatible-mode/v1"
        if marker in base:
            return f"{base.split(marker, 1)[0]}/api/v1/models"
    return f"{base}/models"


def chat_completions_url(base_url: Any) -> str:
    return f"{normalize_base_url(base_url)}/chat/completions"


def safe_api_error(error: Any, api_key: Any = "") -> str:
    message = str(error or "未知接口错误").strip()
    secret = str(api_key or "").strip()
    if secret:
        message = message.replace(secret, "***")
    return message[:2000]


def _headers(api_key: str, provider: str) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "ComfyUI-Jindouyun-Design/1.0",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if provider == "小米MiMo" and api_key:
        headers["api-key"] = api_key
    return headers


def _response_error_message(raw: bytes, fallback: str) -> str:
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return fallback
    try:
        payload = json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        return text
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error.get("code") or text)
        if error:
            return str(error)
        return str(payload.get("message") or text)
    return text


def request_json(
    url: str,
    api_key: str,
    provider: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: int = 30,
    opener: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    secret = str(api_key or "").strip()
    if not secret and provider != "自定义 OpenAI 兼容":
        raise ValueError("请先填写 API Key")
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers=_headers(secret, provider),
        method=method.upper(),
    )
    open_request = opener or urllib.request.urlopen
    try:
        with open_request(request, timeout=max(1, int(timeout))) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        try:
            detail = _response_error_message(error.read(), str(error.reason or error))
        except Exception:
            detail = str(error.reason or error)
        raise RuntimeError(
            safe_api_error(f"接口返回 HTTP {error.code}: {detail}", secret)
        ) from None
    except urllib.error.URLError as error:
        raise RuntimeError(safe_api_error(f"无法连接模型服务: {error.reason}", secret)) from None
    except TimeoutError:
        raise RuntimeError("模型服务请求超时") from None
    except Exception as error:
        raise RuntimeError(safe_api_error(error, secret)) from None

    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError(f"模型服务返回了无法解析的 JSON: {error}") from None
    if not isinstance(result, dict):
        raise RuntimeError("模型服务返回的数据格式不正确")
    if result.get("error"):
        raise RuntimeError(safe_api_error(_response_error_message(raw, "接口调用失败"), secret))
    return result


def _model_items(payload: Any) -> list[Any]:
    if not isinstance(payload, dict):
        return []
    for candidate in (
        payload.get("data"),
        payload.get("models"),
        (payload.get("output") or {}).get("models") if isinstance(payload.get("output"), dict) else None,
        (payload.get("result") or {}).get("models") if isinstance(payload.get("result"), dict) else None,
    ):
        if isinstance(candidate, list):
            return candidate
    return []


def parse_model_ids(payload: Any) -> list[str]:
    model_ids = []
    for item in _model_items(payload):
        if isinstance(item, str):
            model_id = item
        elif isinstance(item, dict):
            model_id = next(
                (item.get(key) for key in ("id", "model_id", "model", "name") if item.get(key)),
                "",
            )
        else:
            model_id = ""
        model_id = str(model_id or "").strip()
        if model_id:
            model_ids.append(model_id)
    return sorted(set(model_ids), key=str.casefold)


def list_provider_models(
    provider: str,
    api_key: str,
    base_url: str,
    timeout: int = 30,
    opener: Callable[..., Any] | None = None,
) -> list[str]:
    resolved_base_url = resolve_provider_base_url(provider, base_url)
    payload = request_json(
        model_list_url(provider, resolved_base_url),
        str(api_key or "").strip(),
        str(provider or ""),
        timeout=timeout,
        opener=opener,
    )
    models = parse_model_ids(payload)
    if not models:
        raise RuntimeError("接口已连接，但没有返回可选择的模型；可直接手工填写模型名称")
    return models


def _as_numpy(image: Any) -> np.ndarray:
    value = image
    for method_name in ("detach", "cpu"):
        method = getattr(value, method_name, None)
        if callable(method):
            value = method()
    numpy_method = getattr(value, "numpy", None)
    if callable(numpy_method):
        value = numpy_method()
    return np.asarray(value)


def _normalized_image_batch(image: Any) -> np.ndarray:
    values = _as_numpy(image)
    if values.ndim == 2:
        values = values[None, ..., None]
    elif values.ndim == 3:
        values = values[None, ...]
    if values.ndim != 4:
        raise ValueError("图像输入必须是 ComfyUI IMAGE 格式")
    if values.shape[-1] not in {1, 3, 4} and values.shape[1] in {1, 3, 4}:
        values = np.transpose(values, (0, 2, 3, 1))
    if values.shape[-1] not in {1, 3, 4}:
        raise ValueError("图像通道数必须为 1、3 或 4")
    if np.issubdtype(values.dtype, np.floating):
        values = np.rint(np.clip(values, 0.0, 1.0) * 255.0)
    return np.clip(values, 0, 255).astype(np.uint8)


def encode_png_data_url(frame: np.ndarray) -> str:
    channels = frame.shape[-1]
    pixels = frame[..., 0] if channels == 1 else frame
    output = BytesIO()
    Image.fromarray(pixels).save(output, format="PNG", optimize=True)
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def decode_data_url(value: str) -> bytes:
    return base64.b64decode(str(value).split(",", 1)[-1])


def collect_image_data_urls(*images: Any, max_images: int = MAX_INPUT_IMAGES) -> list[str]:
    urls = []
    for image in images:
        if image is None:
            continue
        for frame in _normalized_image_batch(image):
            if len(urls) >= max_images:
                raise ValueError(f"一次最多发送 {max_images} 张图片")
            urls.append(encode_png_data_url(frame))
    return urls


def _as_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on", "开启", "锁定"}
    return bool(value)


def _bounded_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        parsed = default
    if not np.isfinite(parsed):
        parsed = default
    return min(maximum, max(minimum, parsed))


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError, OverflowError):
        parsed = default
    return min(maximum, max(minimum, parsed))


def normalize_generation_numbers(
    temperature: Any,
    max_tokens: Any,
    timeout: Any,
) -> tuple[float, int, int]:
    temperature_value = _bounded_float(temperature, 0.7, 0.0, 2.0)
    raw_max_tokens = _bounded_int(max_tokens, 2048, 1, 131072)
    raw_timeout = _bounded_int(timeout, 120, 5, 7200)

    # A short-lived frontend version serialized these two fields one position apart.
    if raw_max_tokens <= 4 and raw_timeout >= 256:
        raw_max_tokens, raw_timeout = raw_timeout, 120
    return temperature_value, raw_max_tokens, raw_timeout


def build_chat_payload(
    model: str,
    system_prompt: str,
    user_prompt: str,
    image_urls: list[str],
    temperature: float,
    max_tokens: int,
) -> dict[str, Any]:
    messages = []
    if str(system_prompt or "").strip():
        messages.append({"role": "system", "content": str(system_prompt).strip()})
    prompt = str(user_prompt or "").strip()
    if not prompt or (not image_urls and prompt == LEGACY_IMAGE_PROMPT):
        prompt = LEGACY_IMAGE_PROMPT if image_urls else DEFAULT_ASSISTANT_PROMPT
    if image_urls:
        content: Any = [{"type": "text", "text": prompt}]
        content.extend(
            {"type": "image_url", "image_url": {"url": image_url}}
            for image_url in image_urls
        )
    else:
        content = prompt
    messages.append({"role": "user", "content": content})
    return {
        "model": str(model or "").strip(),
        "messages": messages,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
        "stream": False,
    }


def extract_response_text(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return str(payload.get("output_text") or payload.get("text") or "")
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
    content = message.get("content", choice.get("text", ""))
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        text = content.get("text") or content.get("content") or content.get("value")
        if isinstance(text, dict):
            text = text.get("value") or text.get("text")
        return str(text or "")
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, dict):
                    text = text.get("value")
                if text:
                    parts.append(str(text))
        return "".join(parts)
    return str(content or "")


class JindouyunMultimodalLLM:
    CATEGORY = "筋斗云设计/LLM"
    DESCRIPTION = "统一连接常见 OpenAI 兼容模型服务，支持文本对话和最多 16 张批量图片。"
    FUNCTION = "run"
    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("回复文本", "原始响应", "实际模型")
    OUTPUT_NODE = True
    _reply_cache: OrderedDict[str, tuple[str, str, str]] = OrderedDict()
    _reply_cache_lock = threading.Lock()
    _reply_cache_limit = 64

    @classmethod
    def INPUT_TYPES(cls):
        optional = {f"图像{index}": ("IMAGE",) for index in range(1, 9)}
        return {
            "required": {
                "供应商": (tuple(PROVIDER_PRESETS), {"default": "OpenAI"}),
                "API密钥": ("STRING", {"default": "", "password": True}),
                "Base URL": ("STRING", {"default": PROVIDER_PRESETS["OpenAI"]["base_url"]}),
                "模型名称": ("STRING", {"default": ""}),
                "系统提示词": (
                    "STRING",
                    {"default": "你是一个专业、准确的多模态助手。", "multiline": True},
                ),
                "对话内容": (
                    "STRING",
                    {"default": "", "multiline": True, "dynamicPrompts": True},
                ),
                "温度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.05}),
                "最大输出Token": ("INT", {"default": 2048, "min": 1, "max": 131072, "step": 1}),
                "超时秒数": ("INT", {"default": 120, "min": 5, "max": 7200, "step": 5}),
                "锁定回复": ("BOOLEAN", {"default": False}),
            },
            "optional": optional,
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    @classmethod
    def IS_CHANGED(cls, 锁定回复=False, **_kwargs):
        return "locked" if _as_bool(锁定回复) else float("nan")

    @classmethod
    def _get_cached_reply(cls, cache_key: str) -> tuple[str, str, str] | None:
        with cls._reply_cache_lock:
            result = cls._reply_cache.get(cache_key)
            if result is not None:
                cls._reply_cache.move_to_end(cache_key)
            return result

    @classmethod
    def _remember_reply(cls, cache_key: str, result: tuple[str, str, str]) -> None:
        with cls._reply_cache_lock:
            cls._reply_cache[cache_key] = result
            cls._reply_cache.move_to_end(cache_key)
            while len(cls._reply_cache) > cls._reply_cache_limit:
                cls._reply_cache.popitem(last=False)

    def run(self, *args, **kwargs):
        names = (
            "供应商",
            "API密钥",
            "Base URL",
            "模型名称",
            "系统提示词",
            "对话内容",
            "温度",
            "最大输出Token",
            "超时秒数",
            "锁定回复",
        )
        values = {name: value for name, value in zip(names, args)}
        values.update(kwargs)
        provider = str(values.get("供应商") or "OpenAI")
        api_key = str(values.get("API密钥") or "").strip()
        base_url = resolve_provider_base_url(
            provider,
            values.get("Base URL") or provider_preset(provider)["base_url"],
        )
        model = str(values.get("模型名称") or "").strip()
        if not model:
            raise ValueError("请先获取并选择模型，或手工填写模型名称")

        images = [values.get(f"图像{index}") for index in range(1, 9)]
        image_urls = collect_image_data_urls(*images)
        temperature, max_tokens, timeout = normalize_generation_numbers(
            values.get("温度", 0.7),
            values.get("最大输出Token", 2048),
            values.get("超时秒数", 120),
        )
        payload = build_chat_payload(
            model,
            str(values.get("系统提示词") or ""),
            str(values.get("对话内容") or ""),
            image_urls,
            temperature,
            max_tokens,
        )
        if provider in {"OpenAI", "Kimi"}:
            payload["max_completion_tokens"] = payload.pop("max_tokens")
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "provider": provider,
                    "base_url": normalize_base_url(base_url),
                    "api_key": hashlib.sha256(api_key.encode("utf-8")).hexdigest(),
                    "payload": payload,
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        cache_key = f"{values.get('unique_id') or 'shared'}:{fingerprint}"
        if _as_bool(values.get("锁定回复", False)):
            cached = self._get_cached_reply(cache_key)
            if cached is not None:
                return cached
        response = request_json(
            chat_completions_url(base_url),
            api_key,
            provider,
            method="POST",
            payload=payload,
            timeout=timeout,
        )
        text = extract_response_text(response)
        if not text:
            raise RuntimeError("模型已返回结果，但没有找到可输出的文本内容")
        raw = json.dumps(response, ensure_ascii=False, indent=2)
        actual_model = str(response.get("model") or model)
        result = (text, raw, actual_model)
        self._remember_reply(cache_key, result)
        return result
