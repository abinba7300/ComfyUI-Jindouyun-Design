import tempfile
import unittest
import sys
import math
import types
import importlib.util
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from krea2_random_lora_model_only import (
    Krea2RandomLoraModelOnly,
    NunchakuRandomLoraModelOnly,
    _is_valid_nunchaku_support_module,
    build_lora_summary,
    extract_trigger_word,
    format_decimal_value,
    lora_output_name,
    random_range_value,
    resolve_effective_seed,
    scan_lora_files,
    select_lora,
    trigger_for_lora,
    validate_lora_file,
)


class Krea2RandomLoraLogicTests(unittest.TestCase):
    def test_extracts_trigger_word_from_krea2_lora_filename(self):
        self.assertEqual(
            extract_trigger_word("shuhuifengge-K2T-V1_copy_000010500.safetensors"),
            "shuhuifengge",
        )
        self.assertEqual(
            extract_trigger_word("qichefengge-K2T-v1_000007200.safetensors"),
            "qichefengge",
        )

    def test_hyphen_is_preferred_over_underscore_for_trigger_prefix(self):
        self.assertEqual(
            extract_trigger_word("shu_hui_fengge-K2T-V1_000010500.safetensors"),
            "shu_hui_fengge",
        )

    def test_trigger_is_derived_automatically_from_lora_file_name(self):
        self.assertEqual(
            trigger_for_lora(
                Path("shuhuifengge-K2T-V1_copy_000010500.safetensors")
            ),
            "shuhuifengge",
        )
        self.assertEqual(
            trigger_for_lora(
                Path("qichefengge-K2T-v1_000007200.safetensors")
            ),
            "qichefengge",
        )

    def test_scans_supported_lora_files_and_ignores_other_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.safetensors").write_bytes(b"lora")
            (root / "b.pt").write_bytes(b"lora")
            (root / "note.txt").write_text("ignore", encoding="utf-8")

            found = [path.name for path in scan_lora_files(root, recursive=False)]

        self.assertEqual(found, ["a.safetensors", "b.pt"])

    def test_scan_ignores_empty_lora_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "empty.safetensors").write_bytes(b"")
            (root / "valid.safetensors").write_bytes(b"lora")

            found = [path.name for path in scan_lora_files(root, recursive=False)]

        self.assertEqual(found, ["valid.safetensors"])

    def test_empty_fixed_lora_has_clear_validation_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            lora_path = Path(tmp) / "empty.safetensors"
            lora_path.write_bytes(b"")

            with self.assertRaisesRegex(ValueError, r"empty \(0 bytes\)"):
                validate_lora_file(lora_path)

    def test_select_lora_is_stable_for_seed_and_changes_with_different_seed(self):
        loras = [
            Path("a.safetensors"),
            Path("b.safetensors"),
            Path("c.safetensors"),
        ]

        self.assertEqual(select_lora(loras, seed=42), select_lora(loras, seed=42))
        self.assertEqual(select_lora(loras, seed=5), Path("c.safetensors"))
        self.assertNotEqual(select_lora(loras, seed=5), select_lora(loras, seed=7))

    def test_random_mode_with_zero_seed_forces_rerun(self):
        changed = Krea2RandomLoraModelOnly.IS_CHANGED(
            **{
                "模型": object(),
                "启用": True,
                "随机": True,
                "目录": "",
                "固定": "",
                "强度": 1.0,
                "seed": 0,
                "子目录": False,
                "过滤": "",
            }
        )

        self.assertTrue(math.isnan(changed))

    def test_zero_seed_resolves_to_visible_random_seed(self):
        self.assertEqual(resolve_effective_seed(123), 123)
        self.assertNotEqual(resolve_effective_seed(0), 0)

    def test_lora_output_name_drops_file_extension(self):
        self.assertEqual(
            lora_output_name(Path("qichefengge-K2T-v1_000007200.safetensors")),
            "qichefengge-K2T-v1_000007200",
        )

    def test_random_range_can_be_fixed_or_seeded(self):
        self.assertEqual(random_range_value(0.8, 0.8, seed=5, salt="lora"), 0.8)
        self.assertEqual(
            random_range_value(0.5, 1.0, seed=123, salt="lora"),
            random_range_value(0.5, 1.0, seed=123, salt="lora"),
        )
        self.assertNotEqual(
            random_range_value(0.5, 1.0, seed=123, salt="lora"),
            random_range_value(0.5, 1.0, seed=124, salt="lora"),
        )

    def test_random_range_is_rounded_to_two_decimal_places(self):
        value = random_range_value(0.5, 1.0, seed=123, salt="lora")

        self.assertEqual(value, round(value, 2))

    def test_random_range_respects_custom_step(self):
        values_005 = {
            random_range_value(0.6, 1.0, seed=seed, salt="lora", step=0.05)
            for seed in range(100)
        }
        values_010 = {
            random_range_value(0.6, 1.0, seed=seed, salt="lora", step=0.1)
            for seed in range(100)
        }

        self.assertTrue(values_005.issubset({0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0}))
        self.assertTrue(values_010.issubset({0.6, 0.7, 0.8, 0.9, 1.0}))
        self.assertGreater(len(values_005), 1)
        self.assertGreater(len(values_010), 1)

    def test_random_step_starts_at_minimum_and_never_exceeds_maximum(self):
        values = {
            random_range_value(0.63, 0.98, seed=seed, salt="lora", step=0.1)
            for seed in range(100)
        }

        self.assertTrue(values.issubset({0.63, 0.73, 0.83, 0.93}))

    def test_summary_uses_lora_name_and_decimal_values(self):
        self.assertEqual(format_decimal_value(0.8), "0.80")
        self.assertEqual(format_decimal_value(0.555), "0.56")
        self.assertEqual(
            build_lora_summary("qichefengge-K2T-v1_000007200", 0.95, 0.69),
            "qichefengge-K2T-v1_000007200_0.95_0.69",
        )

    def test_fixed_lora_can_be_none(self):
        node = Krea2RandomLoraModelOnly()
        self.assertIsNone(node._choose_lora_path(
            folder=Path("."),
            random_mode=False,
            fixed_lora_name="无",
            recursive=False,
            filename_filter="",
            seed=1,
        ))

    def test_validation_allows_empty_fixed_value_from_old_workflows(self):
        self.assertTrue(Krea2RandomLoraModelOnly.VALIDATE_INPUTS(固定="", 随机=True))

    def test_random_execution_returns_node_outputs_without_fixed_dropdown_ui(self):
        class NoopLoader(Krea2RandomLoraModelOnly):
            def _apply_model_lora(self, model, lora_path, strength_model):
                return model

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lora = root / "qichefengge-K2T-v1_000007200.safetensors"
            lora.write_bytes(b"lora")
            result = NoopLoader().load_lora(
                **{
                    "模型": object(),
                    "启用": True,
                    "随机": True,
                    "目录": str(root),
                    "固定": "",
                    "LoRA值最小": 0.6,
                    "LoRA值最大": 1.0,
                    "LoRA值步进": 0.05,
                    "重绘值最小": 0.5,
                    "重绘值最大": 1.0,
                    "重绘值步进": 0.1,
                    "seed": 123,
                    "子目录": False,
                    "过滤": "",
                }
            )

        self.assertIsInstance(result, tuple)
        self.assertEqual(result[2], "qichefengge-K2T-v1_000007200")
        self.assertIn(result[4], {0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0})
        self.assertIn(result[5], {0.5, 0.6, 0.7, 0.8, 0.9, 1.0})

    def test_legacy_chain_fields_are_ignored_so_nodes_can_be_stacked_manually(self):
        class RecordingLoader(Krea2RandomLoraModelOnly):
            def _apply_model_lora(self, model, lora_path, strength_model):
                model.append((Path(lora_path).name, strength_model))
                return model

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder1 = root / "one"
            folder2 = root / "two"
            folder1.mkdir()
            folder2.mkdir()
            (folder1 / "shuhuifengge-K2T-V1_copy_000010500.safetensors").write_bytes(b"lora")
            (folder2 / "qichefengge-K2T-v1_000007200.safetensors").write_bytes(b"lora")

            model = []
            result = RecordingLoader().load_lora(
                **{
                    "模型": model,
                    "启用": True,
                    "随机": True,
                    "目录": str(folder1),
                    "固定": "",
                    "LoRA值最小": 0.6,
                    "LoRA值最大": 0.6,
                    "重绘值最小": 0.5,
                    "重绘值最大": 0.5,
                    "seed": 123,
                    "子目录": False,
                    "过滤": "",
                    "串联2": True,
                    "目录2": str(folder2),
                    "固定2": "",
                    "LoRA2值最小": 0.8,
                    "LoRA2值最大": 0.8,
                    "子目录2": False,
                    "过滤2": "",
                }
            )

        self.assertEqual(
            model,
            [
                ("shuhuifengge-K2T-V1_copy_000010500.safetensors", 0.6),
            ],
        )
        self.assertEqual(len(result), 7)
        self.assertEqual(result[1], "shuhuifengge")
        self.assertEqual(result[2], "shuhuifengge-K2T-V1_copy_000010500")
        self.assertEqual(
            result[6],
            "shuhuifengge-K2T-V1_copy_000010500_0.60_0.50",
        )

    def test_comfyui_schema_uses_chinese_labels(self):
        schema = Krea2RandomLoraModelOnly.INPUT_TYPES()
        self.assertEqual(
            list(schema["required"].keys()),
            [
                "模型",
                "启用",
                "随机",
                "LoRA目录",
                "固定",
                "LoRA值最小",
                "LoRA值最大",
                "重绘值最小",
                "重绘值最大",
                "seed",
                "子目录",
                "过滤",
                "LoRA值步进",
                "重绘值步进",
            ],
        )
        self.assertEqual(schema["required"]["LoRA值最小"][1]["default"], 0.6)
        self.assertEqual(schema["required"]["LoRA值最大"][1]["default"], 1.0)
        self.assertEqual(schema["required"]["LoRA值步进"][1]["default"], 0.05)
        self.assertIn("0.05", schema["required"]["LoRA值步进"][1]["tooltip"])
        self.assertEqual(schema["required"]["重绘值步进"][1]["default"], 0.05)
        self.assertIn("0.05", schema["required"]["重绘值步进"][1]["tooltip"])
        self.assertEqual(schema["required"]["重绘值最小"][1]["default"], 0.5)
        self.assertEqual(schema["required"]["重绘值最大"][1]["default"], 1.0)
        self.assertIn("无", schema["required"]["固定"][0])
        self.assertEqual(
            Krea2RandomLoraModelOnly.RETURN_NAMES,
            ("模型", "触发词", "LoRA", "本次种子", "LoRA强度", "重绘值", "组合名"),
        )
        self.assertEqual(
            schema["required"]["seed"][1]["tooltip"],
            "LoRA 随机选择使用的种子。使用随机按钮时会像采样器一样更新这个数字。",
        )
        self.assertTrue(schema["required"]["seed"][1]["control_after_generate"])

    def test_jindouyun_design_package_exposes_new_random_lora_node_id(self):
        package_dir = Path(__file__).resolve().parents[1]
        module_name = "comfyui_krea2_random_lora_model_only_test_import"
        spec = importlib.util.spec_from_file_location(
            module_name,
            package_dir / "__init__.py",
            submodule_search_locations=[str(package_dir)],
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)
            self.assertIn("JindouyunRandomLora", module.NODE_CLASS_MAPPINGS)
            self.assertEqual(
                module.NODE_DISPLAY_NAME_MAPPINGS["JindouyunRandomLora"],
                "筋斗云随机LORA",
            )
            self.assertEqual(
                module.NODE_DISPLAY_NAME_MAPPINGS["JindouyunStringRouter"],
                "筋斗云-提示词",
            )
            self.assertEqual(
                module.NODE_CLASS_MAPPINGS["JindouyunRandomLora"].CATEGORY,
                "筋斗云设计/LoRA",
            )
            self.assertEqual(
                module.NODE_DISPLAY_NAME_MAPPINGS["Krea2RandomLoraAuto"],
                "Krea2 Random LoRA (Legacy)",
            )
            self.assertTrue(module.NODE_CLASS_MAPPINGS["Krea2RandomLoraAuto"].DEPRECATED)
            self.assertTrue(module.NODE_CLASS_MAPPINGS["Krea2RandomLoraModelOnly"].DEPRECATED)
            self.assertFalse(getattr(module.NODE_CLASS_MAPPINGS["JindouyunRandomLora"], "DEPRECATED", False))
            self.assertNotIn("筋斗云", module.NODE_DISPLAY_NAME_MAPPINGS["Krea2RandomLoraAuto"])
            self.assertNotIn("筋斗云", module.NODE_DISPLAY_NAME_MAPPINGS["Krea2RandomLoraModelOnly"])

            node_class = module.NODE_CLASS_MAPPINGS["JindouyunRandomLora"]
            self.assertEqual(
                node_class.RETURN_NAMES,
                ("模型", "触发词", "LoRA名称", "本次种子", "LoRA强度", "重绘值", "组合名"),
            )
            self.assertNotIn("启用", node_class.INPUT_TYPES()["required"])
            self.assertEqual(next(iter(node_class.INPUT_TYPES()["required"])), "模型")
            parent_class = node_class.__mro__[1]
            with patch.object(parent_class, "load_lora", return_value=("loaded",)) as load_lora:
                self.assertEqual(node_class().load_lora(**{"启用": False}), ("loaded",))
            self.assertTrue(load_lora.call_args.kwargs["启用"])
        finally:
            sys.modules.pop(module_name, None)

    def test_nunchaku_schema_uses_same_random_lora_interface(self):
        schema = NunchakuRandomLoraModelOnly.INPUT_TYPES()

        self.assertEqual(list(schema["required"].keys()), list(Krea2RandomLoraModelOnly.INPUT_TYPES()["required"].keys()))
        self.assertEqual(NunchakuRandomLoraModelOnly.CATEGORY, "Nunchaku")
        self.assertEqual(NunchakuRandomLoraModelOnly.RETURN_NAMES, Krea2RandomLoraModelOnly.RETURN_NAMES)

    def test_nunchaku_loader_uses_nunchaku_flux_lora_application(self):
        model = object()
        lora_path = Path("flux-style.safetensors")
        patched_model = object()

        with patch(
            "krea2_random_lora_model_only.apply_nunchaku_flux_lora",
            return_value=patched_model,
        ) as apply_lora:
            result = NunchakuRandomLoraModelOnly()._apply_model_lora(model, lora_path, 0.75)

        self.assertIs(result, patched_model)
        apply_lora.assert_called_once_with(model, lora_path, 0.75)

    def test_nunchaku_support_module_requires_wrapper_to_be_a_type(self):
        bogus_support = types.SimpleNamespace(
            ComfyFluxWrapper=object(),
            copy_with_ctx=lambda model: model,
            to_diffusers=lambda path: {},
        )
        valid_support = types.SimpleNamespace(
            ComfyFluxWrapper=type("ComfyFluxWrapper", (), {}),
            copy_with_ctx=lambda model: model,
            to_diffusers=lambda path: {},
        )

        self.assertFalse(_is_valid_nunchaku_support_module(bogus_support))
        self.assertTrue(_is_valid_nunchaku_support_module(valid_support))


if __name__ == "__main__":
    unittest.main()
