import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from number_slider import JindouyunNumberSlider, normalize_hex_color, normalize_slider_config


class NumberSliderTests(unittest.TestCase):
    def test_default_step_snaps_to_five_hundredths(self):
        value, minimum, maximum, step = normalize_slider_config(0.87, 0.0, 1.0, 0.05)

        self.assertEqual((value, minimum, maximum, step), (0.85, 0.0, 1.0, 0.05))

    def test_step_is_anchored_to_minimum(self):
        value, minimum, maximum, step = normalize_slider_config(0.18, 0.1, 1.0, 0.05)

        self.assertEqual((value, minimum, maximum, step), (0.2, 0.1, 1.0, 0.05))

    def test_reversed_range_is_exchanged(self):
        value, minimum, maximum, step = normalize_slider_config(0.75, 1.0, 0.0, 0.1)

        self.assertEqual((value, minimum, maximum, step), (0.8, 0.0, 1.0, 0.1))

    def test_invalid_step_uses_default(self):
        self.assertEqual(normalize_slider_config(0.12, 0, 1, 0)[3], 0.05)
        self.assertEqual(normalize_slider_config(0.12, 0, 1, "bad")[3], 0.05)

    def test_value_is_clamped_to_range(self):
        self.assertEqual(normalize_slider_config(2.0, 0.0, 1.0, 0.05)[0], 1.0)
        self.assertEqual(normalize_slider_config(-2.0, 0.0, 1.0, 0.05)[0], 0.0)

    def test_hex_color_normalization(self):
        self.assertEqual(normalize_hex_color("#0af"), "#00AAFF")
        self.assertEqual(normalize_hex_color("not-color"), "#FF6A00")

    def test_node_outputs_normalized_float(self):
        result = JindouyunNumberSlider().slide(
            滑块名称="LoRA 强度",
            当前值=0.87,
            最小值=0.0,
            最大值=1.0,
            步进值=0.05,
            滑块颜色="#FF6A00",
        )

        self.assertEqual(result, (0.85,))
        self.assertIsInstance(result[0], float)

    def test_schema_exposes_saved_configuration(self):
        required = JindouyunNumberSlider.INPUT_TYPES()["required"]

        self.assertEqual(list(required), ["滑块名称", "当前值", "最小值", "最大值", "步进值", "滑块颜色"])
        self.assertEqual(required["步进值"][1]["default"], 0.05)
        self.assertEqual(required["滑块颜色"][1]["default"], "#FF6A00")
        self.assertEqual(JindouyunNumberSlider.RETURN_TYPES, ("FLOAT",))
        self.assertEqual(JindouyunNumberSlider.RETURN_NAMES, ("数值",))


if __name__ == "__main__":
    unittest.main()
