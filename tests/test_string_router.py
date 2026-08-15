import json
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from string_router import (  # noqa: E402
    DEFAULT_CONFIG,
    JindouyunStringRouter,
    normalize_lora_signal,
    normalize_router_config,
    route_string,
)


def scheme(name, bindings, segments, *, delimiter=", ", is_default=False):
    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "bindings": bindings,
        "segments": [
            {"id": f"segment-{index}", "text": text}
            for index, text in enumerate(segments, start=1)
        ],
        "delimiter": delimiter,
        "isDefault": is_default,
    }


def config(*schemes):
    return json.dumps({"version": 1, "activeSchemeId": schemes[0]["id"], "schemes": list(schemes)}, ensure_ascii=False)


class StringRouterTests(unittest.TestCase):
    def test_default_config_starts_with_three_text_segments(self):
        self.assertEqual(len(DEFAULT_CONFIG["schemes"]), 1)
        self.assertEqual(len(DEFAULT_CONFIG["schemes"][0]["segments"]), 3)
        self.assertTrue(DEFAULT_CONFIG["schemes"][0]["isDefault"])

    def test_normalize_lora_signal_keeps_full_name_and_removes_supported_suffix(self):
        self.assertEqual(
            normalize_lora_signal('  "K9E\\DSM\\DSMQIAOXING-K9E-v2.safetensors"  '),
            "K9E/DSM/DSMQIAOXING-K9E-v2",
        )
        self.assertEqual(normalize_lora_signal("name.CKPT"), "name")

    def test_version_keywords_route_similar_lora_names_to_different_text(self):
        value = config(
            scheme("V1.1 方案", ["V1.1"], ["first", "prompt"]),
            scheme("V1.0 方案", ["V1.0"], ["second", "prompt"]),
        )

        self.assertEqual(
            route_string("DSMQIAOXING-K9E-8-V1.1_4000_loss-0.11724", value),
            ("first, prompt", "matched", "V1.1 方案", "V1.1"),
        )
        self.assertEqual(
            route_string("DSMQIAOXING-K9E-8-v1.0_4600_loss-0.18666", value),
            ("second, prompt", "matched", "V1.0 方案", "V1.0"),
        )

    def test_prompt_content_is_never_used_for_matching(self):
        value = config(
            scheme("方案 A", ["bound-lora"], ["another-lora", "is only prompt text"]),
        )

        self.assertEqual(route_string("another-lora", value), ("", "unmatched", "", ""))

    def test_matching_is_case_insensitive_literal_substring_only(self):
        value = config(scheme("版本方案", ["V1.1"], ["selected"]))

        self.assertEqual(route_string("product-v1.1-extra", value)[0], "selected")
        self.assertEqual(route_string("PRODUCT-V1.1.SAFETENSORS", value)[0], "selected")
        self.assertEqual(route_string("product-v1-1-extra", value)[1], "unmatched")
        self.assertEqual(route_string("product-v1.0-extra", value)[1], "unmatched")

    def test_old_full_name_binding_still_matches_as_a_long_keyword(self):
        value = config(scheme("旧方案", ["DSMQIAOXING-K9E-v1"], ["legacy"]))

        self.assertEqual(route_string("DSMQIAOXING-K9E-v1.safetensors", value)[0], "legacy")

    def test_multiple_loras_can_share_one_scheme(self):
        value = config(scheme("共享方案", ["product-front", "product-side"], ["same", "prompt"]))

        self.assertEqual(route_string("collection-product-front-v3", value)[0], "same, prompt")
        self.assertEqual(route_string("collection-product-side-v3", value)[0], "same, prompt")

    def test_multiple_matching_schemes_use_first_and_report_conflict(self):
        value = config(
            scheme("第一方案", ["V1.1"], ["first"]),
            scheme("第二方案", ["K9E"], ["second"]),
        )

        self.assertEqual(
            route_string("DSMQIAOXING-K9E-8-V1.1_4000", value),
            ("first", "conflict", "第一方案", "V1.1"),
        )

    def test_empty_segments_are_skipped_and_custom_delimiter_is_used(self):
        value = config(scheme("自定义", ["lora"], [" first ", "", "third"], delimiter=" | "))

        self.assertEqual(route_string("lora", value)[0], "first | third")

    def test_unmatched_signal_uses_the_default_scheme(self):
        value = config(
            scheme("普通", ["known"], ["known text"]),
            scheme("默认文本", [], ["base", "prompt"], is_default=True),
        )

        self.assertEqual(route_string("absent", value), ("base, prompt", "default", "默认文本", ""))

    def test_unmatched_signal_without_default_returns_empty_string(self):
        value = config(scheme("普通", ["known"], ["known text"]))

        self.assertEqual(route_string("absent", value), ("", "unmatched", "", ""))

    def test_damaged_json_falls_back_to_safe_default(self):
        normalized = normalize_router_config("{broken")

        self.assertEqual(len(normalized["schemes"]), 1)
        self.assertEqual(len(normalized["schemes"][0]["segments"]), 3)
        self.assertEqual(route_string("anything", "{broken"), ("", "default", "方案 1", ""))

    def test_config_limits_segments_to_twelve_and_keeps_one_minimum(self):
        too_many = scheme("多段", ["many"], [str(index) for index in range(20)])
        empty = scheme("空段", ["empty"], [])
        normalized = normalize_router_config(config(too_many, empty))

        self.assertEqual(len(normalized["schemes"][0]["segments"]), 12)
        self.assertEqual(len(normalized["schemes"][1]["segments"]), 1)

    def test_duplicate_binding_is_kept_only_by_the_first_scheme(self):
        normalized = normalize_router_config(config(
            scheme("先绑定", ["same-lora"], ["first"]),
            scheme("后绑定", ["same-lora"], ["second"]),
        ))

        self.assertEqual(normalized["schemes"][0]["bindings"], ["same-lora"])
        self.assertEqual(normalized["schemes"][1]["bindings"], [])
        self.assertEqual(route_string("same-lora", normalized)[0], "first")

    def test_node_has_one_forced_string_input_and_one_string_output(self):
        schema = JindouyunStringRouter.INPUT_TYPES()["required"]

        self.assertEqual(schema["LoRA名称"][0], "STRING")
        self.assertTrue(schema["LoRA名称"][1]["forceInput"])
        self.assertIn("配置数据", schema)
        self.assertEqual(JindouyunStringRouter.RETURN_TYPES, ("STRING",))
        self.assertEqual(JindouyunStringRouter.RETURN_NAMES, ("字符串",))
        self.assertIn("筋斗云-提示词", JindouyunStringRouter.SEARCH_ALIASES)
        self.assertIn("筋斗云-字符串", JindouyunStringRouter.SEARCH_ALIASES)

    def test_node_returns_frontend_match_status(self):
        node = JindouyunStringRouter()
        value = config(scheme("产品方案", ["product-v1"], ["render", "prompt"]))

        result = node.route("product-v1", value)

        self.assertEqual(result["result"], ("render, prompt",))
        self.assertEqual(result["ui"]["lora_name"], ["product-v1"])
        self.assertEqual(result["ui"]["match_mode"], ["matched"])
        self.assertEqual(result["ui"]["scheme_name"], ["产品方案"])
        self.assertEqual(result["ui"]["matched_keyword"], ["product-v1"])


if __name__ == "__main__":
    unittest.main()
