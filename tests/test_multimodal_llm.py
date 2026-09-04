import importlib.util
import json
import sys
import types
import unittest
from io import BytesIO
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "multimodal_llm.py"


def load_module():
    spec = importlib.util.spec_from_file_location("jindouyun_test_multimodal_llm", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeTensor:
    def __init__(self, value):
        self.value = np.asarray(value, dtype=np.float32)

    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self.value


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


class JindouyunMultimodalLlmTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def setUp(self):
        with self.module.JindouyunMultimodalLLM._reply_cache_lock:
            self.module.JindouyunMultimodalLLM._reply_cache.clear()

    def test_provider_presets_cover_requested_services(self):
        names = set(self.module.PROVIDER_PRESETS)
        self.assertTrue({
            "OpenAI",
            "DeepSeek",
            "阿里云百炼",
            "豆包（火山方舟）",
            "智谱AI",
            "Kimi",
            "小米MiMo",
            "自定义 OpenAI 兼容",
        }.issubset(names))
        for preset in self.module.PROVIDER_PRESETS.values():
            self.assertTrue(preset["base_url"].startswith("http"))
            self.assertTrue(preset["key_url"].startswith("http"))

    def test_schema_has_eight_optional_image_inputs_and_useful_outputs(self):
        schema = self.module.JindouyunMultimodalLLM.INPUT_TYPES()
        self.assertEqual(
            [name for name in schema["optional"] if name.startswith("图像")],
            [f"图像{index}" for index in range(1, 9)],
        )
        self.assertEqual(
            self.module.JindouyunMultimodalLLM.RETURN_NAMES,
            ("回复文本", "原始响应", "实际模型"),
        )
        self.assertFalse(schema["required"]["锁定回复"][1]["default"])
        self.assertEqual(schema["hidden"]["unique_id"], "UNIQUE_ID")

    def test_aliyun_uses_its_model_management_endpoint(self):
        self.assertEqual(
            self.module.model_list_url(
                "阿里云百炼",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            "https://dashscope.aliyuncs.com/api/v1/models",
        )

    def test_provider_base_url_repairs_a_foreign_provider_preset(self):
        self.assertEqual(
            self.module.resolve_provider_base_url("阿里云百炼", "https://api.openai.com/v1"),
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        )

    def test_provider_base_url_keeps_an_aliyun_workspace_host(self):
        workspace_url = "https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
        self.assertEqual(
            self.module.resolve_provider_base_url("阿里云百炼", workspace_url),
            workspace_url,
        )
        self.assertEqual(
            self.module.model_list_url(
                "阿里云百炼",
                "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
            ),
            "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/models",
        )

    def test_model_parser_accepts_common_openai_and_aliyun_shapes(self):
        self.assertEqual(
            self.module.parse_model_ids({"data": [{"id": "gpt-b"}, {"id": "gpt-a"}]}),
            ["gpt-a", "gpt-b"],
        )
        self.assertEqual(
            self.module.parse_model_ids({"output": {"models": [{"model_id": "qwen-vl"}]}}),
            ["qwen-vl"],
        )

    def test_image_batches_are_encoded_in_input_order(self):
        red = np.zeros((1, 2, 2, 3), dtype=np.float32)
        red[..., 0] = 1
        green_batch = np.zeros((2, 2, 2, 3), dtype=np.float32)
        green_batch[..., 1] = 1
        green_batch[1, ..., 2] = 1

        urls = self.module.collect_image_data_urls(FakeTensor(red), FakeTensor(green_batch))

        self.assertEqual(len(urls), 3)
        first = Image.open(BytesIO(self.module.decode_data_url(urls[0])))
        second = Image.open(BytesIO(self.module.decode_data_url(urls[1])))
        self.assertEqual(first.getpixel((0, 0)), (255, 0, 0))
        self.assertEqual(second.getpixel((0, 0)), (0, 255, 0))

    def test_chat_payload_contains_text_and_every_image(self):
        payload = self.module.build_chat_payload(
            model="vision-model",
            system_prompt="系统",
            user_prompt="比较这些图片",
            image_urls=["data:image/png;base64,one", "data:image/png;base64,two"],
            temperature=0.4,
            max_tokens=1234,
        )

        self.assertEqual(payload["messages"][0], {"role": "system", "content": "系统"})
        content = payload["messages"][1]["content"]
        self.assertEqual(content[0], {"type": "text", "text": "比较这些图片"})
        self.assertEqual(
            [item["image_url"]["url"] for item in content[1:]],
            ["data:image/png;base64,one", "data:image/png;base64,two"],
        )

    def test_no_image_uses_normal_assistant_prompt_instead_of_image_analysis(self):
        payload = self.module.build_chat_payload(
            model="chat-model",
            system_prompt="系统",
            user_prompt="",
            image_urls=[],
            temperature=0.7,
            max_tokens=2048,
        )

        self.assertEqual(payload["messages"][1]["content"], "你好，请介绍一下你能提供哪些帮助。")
        self.assertNotIn("图片", payload["messages"][1]["content"])

    def test_legacy_shifted_numeric_values_are_repaired(self):
        values = self.module.normalize_generation_numbers(0.7, 1, 2048)
        self.assertEqual(values, (0.7, 2048, 120))

    def test_fetch_models_uses_bearer_auth_and_returns_sorted_ids(self):
        captured = {}

        def opener(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse({"data": [{"id": "model-z"}, {"id": "model-a"}]})

        models = self.module.list_provider_models(
            "OpenAI",
            "secret-key",
            "https://api.openai.com/v1",
            timeout=11,
            opener=opener,
        )

        self.assertEqual(models, ["model-a", "model-z"])
        self.assertEqual(captured["request"].get_header("Authorization"), "Bearer secret-key")
        self.assertEqual(captured["timeout"], 11)

    def test_custom_local_service_can_run_without_an_authorization_header(self):
        captured = {}

        def opener(request, timeout):
            captured["request"] = request
            return FakeResponse({"data": [{"id": "local-model"}]})

        models = self.module.list_provider_models(
            "自定义 OpenAI 兼容",
            "",
            "http://127.0.0.1:8000/v1",
            opener=opener,
        )

        self.assertEqual(models, ["local-model"])
        self.assertIsNone(captured["request"].get_header("Authorization"))

    def test_api_error_never_echoes_the_key(self):
        key = "super-secret-key"
        error = self.module.safe_api_error(RuntimeError(f"bad credentials: {key}"), key)
        self.assertNotIn(key, error)
        self.assertIn("***", error)

    def test_node_posts_chat_completion_and_extracts_text(self):
        captured = {}

        def fake_json_request(url, api_key, provider, method="GET", payload=None, timeout=30, opener=None):
            captured.update(url=url, api_key=api_key, provider=provider, method=method, payload=payload)
            return {
                "model": "vision-used",
                "choices": [{"message": {"content": [{"type": "text", "text": "看到了两张图"}]}}],
            }

        with mock.patch.object(self.module, "request_json", side_effect=fake_json_request):
            result = self.module.JindouyunMultimodalLLM().run(
                "OpenAI",
                "secret-key",
                "https://api.openai.com/v1",
                "vision-requested",
                "系统",
                "请分析",
                0.7,
                1024,
                60,
            )

        self.assertEqual(result[0], "看到了两张图")
        self.assertEqual(result[2], "vision-used")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["url"], "https://api.openai.com/v1/chat/completions")
        self.assertNotIn("max_tokens", captured["payload"])
        self.assertEqual(captured["payload"]["max_completion_tokens"], 1024)

    def test_lock_reuses_last_successful_reply_without_second_api_request(self):
        calls = []

        def fake_json_request(*_args, **_kwargs):
            calls.append(True)
            return {"model": "chat-used", "choices": [{"message": {"content": "完整回复"}}]}

        common = (
            "OpenAI",
            "secret-key",
            "https://api.openai.com/v1",
            "chat-requested",
            "系统",
            "普通问题",
            0.7,
            2048,
            120,
        )
        node = self.module.JindouyunMultimodalLLM()
        with mock.patch.object(self.module, "request_json", side_effect=fake_json_request):
            first = node.run(*common, False, unique_id="node-1")
            locked = node.run(*common, True, unique_id="node-1")

        self.assertEqual(first, locked)
        self.assertEqual(first[0], "完整回复")
        self.assertEqual(len(calls), 1)

    def test_lock_runs_again_when_the_question_changes(self):
        calls = []

        def fake_json_request(*_args, **_kwargs):
            calls.append(True)
            return {"model": "chat-used", "choices": [{"message": {"content": f"回复{len(calls)}"}}]}

        node = self.module.JindouyunMultimodalLLM()
        with mock.patch.object(self.module, "request_json", side_effect=fake_json_request):
            first = node.run(
                "OpenAI", "key", "https://api.openai.com/v1", "model",
                "系统", "问题一", 0.7, 2048, 120, True, unique_id="node-2",
            )
            second = node.run(
                "OpenAI", "key", "https://api.openai.com/v1", "model",
                "系统", "问题二", 0.7, 2048, 120, True, unique_id="node-2",
            )

        self.assertEqual(first[0], "回复1")
        self.assertEqual(second[0], "回复2")
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
