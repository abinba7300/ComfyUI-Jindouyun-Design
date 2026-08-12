import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from show_anything import JindouyunShowAnything, stringify_value


class ShowAnythingTests(unittest.TestCase):
    def test_schema_defaults_to_normal_text_and_three_times_magnification(self):
        schema = JindouyunShowAnything.INPUT_TYPES()
        self.assertFalse(schema["required"]["放大文字"][1]["default"])
        self.assertEqual(schema["required"]["放大倍数"][1]["default"], 3.0)
        self.assertIn("任意内容", schema["optional"])

    def test_single_value_is_displayed_and_passed_through(self):
        node = JindouyunShowAnything()
        result = node.show(**{"任意内容": ["筋斗云"], "放大文字": [False], "放大倍数": [5.0]})
        self.assertEqual(result["ui"]["text"], ["筋斗云"])
        self.assertEqual(result["result"], ("筋斗云",))

    def test_multiple_values_are_displayed_and_passed_as_list(self):
        node = JindouyunShowAnything()
        result = node.show(**{"任意内容": [12, True], "放大文字": [True], "放大倍数": [3.0]})
        self.assertEqual(result["ui"]["text"], ["12", "True"])
        self.assertEqual(result["result"], ([12, True],))

    def test_structured_values_use_readable_unicode_json(self):
        self.assertEqual(stringify_value({"名称": "测试"}), '{\n  "名称": "测试"\n}')


if __name__ == "__main__":
    unittest.main()
