import importlib.util
import sys
import unittest
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from image_switch import JindouyunImageSwitch


class JindouyunImageSwitchTests(unittest.TestCase):
    def test_package_registers_image_switch(self):
        package_dir = Path(__file__).resolve().parents[1]
        module_name = "jindouyun_image_switch_test_import"
        spec = importlib.util.spec_from_file_location(
            module_name,
            package_dir / "__init__.py",
            submodule_search_locations=[str(package_dir)],
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)
            self.assertEqual(
                module.NODE_CLASS_MAPPINGS["JindouyunImageSwitch"].__name__,
                JindouyunImageSwitch.__name__,
            )
            self.assertEqual(
                module.NODE_DISPLAY_NAME_MAPPINGS["JindouyunImageSwitch"],
                "筋斗云图像尺寸判断",
            )
        finally:
            sys.modules.pop(module_name, None)

    def test_schema_has_two_lazy_image_inputs_two_signals_and_one_output(self):
        schema = JindouyunImageSwitch.INPUT_TYPES()["required"]

        self.assertEqual(
            list(schema),
            ["符合尺寸图像", "不符合尺寸图像", "符合尺寸信号", "不符合尺寸信号"],
        )
        self.assertEqual(schema["符合尺寸图像"][0], "IMAGE")
        self.assertTrue(schema["符合尺寸图像"][1]["lazy"])
        self.assertEqual(schema["不符合尺寸图像"][0], "IMAGE")
        self.assertTrue(schema["不符合尺寸图像"][1]["lazy"])
        self.assertEqual(schema["符合尺寸信号"][0], "BOOLEAN")
        self.assertTrue(schema["符合尺寸信号"][1]["forceInput"])
        self.assertEqual(schema["不符合尺寸信号"][0], "BOOLEAN")
        self.assertTrue(schema["不符合尺寸信号"][1]["forceInput"])
        self.assertEqual(JindouyunImageSwitch.RETURN_TYPES, ("IMAGE",))
        self.assertEqual(JindouyunImageSwitch.RETURN_NAMES, ("图像",))

    def test_qualified_signal_routes_image_to_qualified_output(self):
        image = torch.zeros((1, 8, 12, 3))

        other_image = torch.ones((1, 8, 12, 3))
        result, = JindouyunImageSwitch().switch(
            符合尺寸图像=image,
            不符合尺寸图像=other_image,
            符合尺寸信号=True,
            不符合尺寸信号=False,
        )

        self.assertIs(result, image)

    def test_upscale_signal_routes_image_to_upscale_output(self):
        image = torch.ones((1, 16, 24, 3))

        other_image = torch.zeros((1, 16, 24, 3))
        result, = JindouyunImageSwitch().switch(
            符合尺寸图像=other_image,
            不符合尺寸图像=image,
            符合尺寸信号=False,
            不符合尺寸信号=True,
        )

        self.assertIs(result, image)

    def test_lazy_status_only_requests_selected_image(self):
        node = JindouyunImageSwitch()

        self.assertEqual(
            node.check_lazy_status(
                符合尺寸图像=None,
                不符合尺寸图像=None,
                符合尺寸信号=True,
                不符合尺寸信号=False,
            ),
            ["符合尺寸图像"],
        )
        self.assertEqual(
            node.check_lazy_status(
                符合尺寸图像=None,
                不符合尺寸图像=None,
                符合尺寸信号=False,
                不符合尺寸信号=True,
            ),
            ["不符合尺寸图像"],
        )

    def test_switch_rejects_conflicting_signals(self):
        image = torch.zeros((1, 8, 12, 3))
        for qualified, needs_upscale in ((True, True), (False, False)):
            with self.subTest(qualified=qualified, needs_upscale=needs_upscale):
                with self.assertRaisesRegex(ValueError, "必须且只能有一个开启"):
                    JindouyunImageSwitch().switch(
                        符合尺寸图像=image,
                        不符合尺寸图像=image,
                        符合尺寸信号=qualified,
                        不符合尺寸信号=needs_upscale,
                    )


if __name__ == "__main__":
    unittest.main()
