import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "load_image.py"


def load_module(input_directory):
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_input_directory = lambda: str(input_directory)
    folder_paths.get_output_directory = lambda: str(input_directory.parent / "output")
    folder_paths.get_temp_directory = lambda: str(input_directory.parent / "temp")
    folder_paths.filter_files_content_types = lambda files, kinds: [
        name for name in files if Path(name).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    ]
    folder_paths.annotated_filepath = lambda name: (name, None)
    folder_paths.get_annotated_filepath = lambda name: str(input_directory / name)
    folder_paths.exists_annotated_filepath = lambda name: (input_directory / name).is_file()

    nodes = types.ModuleType("nodes")

    class LoadImage:
        @classmethod
        def INPUT_TYPES(cls):
            return {"required": {"image": (("one.png",), {"image_upload": True})}}

        def load_image(self, image):
            return (f"image:{image}", f"mask:{image}")

        @classmethod
        def IS_CHANGED(cls, image):
            return f"changed:{image}"

        @classmethod
        def VALIDATE_INPUTS(cls, image):
            return True

    nodes.LoadImage = LoadImage

    previous = {name: sys.modules.get(name) for name in ("folder_paths", "nodes")}
    sys.modules["folder_paths"] = folder_paths
    sys.modules["nodes"] = nodes
    try:
        spec = importlib.util.spec_from_file_location("jindouyun_test_load_image", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, value in previous.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value


class JindouyunLoadImageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.input_dir = self.root / "input"
        self.input_dir.mkdir()
        (self.root / "output").mkdir()
        (self.root / "temp").mkdir()
        self.module = load_module(self.input_dir)

    def tearDown(self):
        self.temp.cleanup()

    def test_node_keeps_native_upload_and_image_mask_outputs(self):
        schema = self.module.JindouyunLoadImage.INPUT_TYPES()
        self.assertTrue(schema["required"]["image"][1]["image_upload"])
        self.assertIn("原始图片路径", schema["required"])
        self.assertEqual(self.module.JindouyunLoadImage.RETURN_TYPES, ("IMAGE", "MASK", "STRING", "STRING"))
        self.assertEqual(self.module.JindouyunLoadImage.RETURN_NAMES, ("图像", "遮罩", "文件夹路径", "图像名称"))

    def test_load_outputs_parent_folder_and_stem_without_extension(self):
        album = self.input_dir / "album"
        album.mkdir()
        (album / "123.png").write_bytes(b"x")

        result = self.module.JindouyunLoadImage().load_image("album/123.png")

        self.assertEqual(result[:2], ("image:album/123.png", "mask:album/123.png"))
        self.assertEqual(result[2], str(album.resolve()))
        self.assertEqual(result[3], "123")

    def test_local_source_path_preserves_original_folder_and_name(self):
        original = self.root / "产品原图" / "ABC.png"
        original.parent.mkdir()
        original.write_bytes(b"x")
        (self.input_dir / "staged.png").write_bytes(b"x")

        result = self.module.JindouyunLoadImage().load_image("staged.png", str(original))

        self.assertEqual(result[:2], ("image:staged.png", "mask:staged.png"))
        self.assertEqual(result[2], str(original.parent.resolve()))
        self.assertEqual(result[3], "ABC")

    def test_dropped_image_resolves_matching_explorer_selection(self):
        original = self.root / "originals" / "dragged.png"
        original.parent.mkdir()
        original.write_bytes(b"same-image-content")
        uploaded = self.input_dir / "dragged.png"
        uploaded.write_bytes(b"same-image-content")

        result = self.module.resolve_dropped_source(
            "dragged.png",
            "dragged.png",
            uploaded.stat().st_size,
            [str(original)],
        )

        self.assertTrue(result["resolved"])
        self.assertEqual(result["source_path"], str(original.resolve()))
        self.assertEqual(result["folder_path"], str(original.parent.resolve()))
        self.assertEqual(result["image_name"], "dragged")

    def test_dropped_image_rejects_non_matching_selected_file(self):
        selected = self.root / "other" / "dragged.png"
        selected.parent.mkdir()
        selected.write_bytes(b"different-content")
        uploaded = self.input_dir / "dragged.png"
        uploaded.write_bytes(b"same-image-content")

        result = self.module.resolve_dropped_source(
            "dragged.png",
            "dragged.png",
            uploaded.stat().st_size,
            [str(selected)],
        )

        self.assertFalse(result["resolved"])
        self.assertEqual(result["source_path"], "")

    def test_siblings_are_naturally_sorted_and_stay_in_current_folder(self):
        album = self.input_dir / "album"
        album.mkdir()
        for name in ("image10.png", "image2.png", "image1.jpg", "notes.txt"):
            (album / name).write_bytes(b"x")
        (self.input_dir / "outside.png").write_bytes(b"x")

        result = self.module.list_sibling_images("album/image2.png")

        self.assertEqual(result["images"], ["album/image1.jpg", "album/image2.png", "album/image10.png"])
        self.assertEqual(result["index"], 1)

    def test_random_image_from_folder_filters_images_and_stages_selected_file(self):
        album = self.root / "随机图片"
        album.mkdir()
        first = album / "第一张.png"
        second = album / "第二张.webp"
        first.write_bytes(b"first")
        second.write_bytes(b"second")
        (album / "说明.txt").write_text("not an image", encoding="utf-8")

        shuffled_names = []

        def capture_shuffle(values):
            shuffled_names.extend(item.name for item in values)

        with mock.patch.object(self.module.random, "shuffle", side_effect=capture_shuffle) as shuffle:
            result = self.module.prepare_random_image_from_folder(album)

        shuffle.assert_called_once()
        self.assertEqual(set(shuffled_names), {"第一张.png", "第二张.webp"})
        self.assertEqual(result["source_path"], str(second.resolve()))
        self.assertEqual(result["folder_path"], str(album.resolve()))
        self.assertEqual(result["image_name"], "第二张")
        self.assertEqual(result["folder_image_count"], 2)
        self.assertTrue((self.input_dir / result["image"]).is_file())

    def test_random_image_from_folder_rejects_folder_without_images(self):
        album = self.root / "空目录"
        album.mkdir()
        (album / "说明.txt").write_text("not an image", encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "没有可加载的图片"):
            self.module.prepare_random_image_from_folder(album)

    def test_random_image_from_folder_avoids_immediate_repeat(self):
        album = self.root / "两张图"
        album.mkdir()
        first = album / "one.png"
        second = album / "two.png"
        first.write_bytes(b"first")
        second.write_bytes(b"second")

        with mock.patch.object(self.module.random, "shuffle", side_effect=lambda values: None):
            result = self.module.prepare_random_image_from_folder(
                album,
                exclude_source_path=first,
            )

        self.assertEqual(result["source_path"], str(second.resolve()))

    def test_random_folder_visits_every_image_once_before_repeating(self):
        album = self.root / "整轮洗牌"
        album.mkdir()
        expected_names = {f"image-{index}.png" for index in range(6)}
        for name in expected_names:
            (album / name).write_bytes(name.encode("utf-8"))

        with mock.patch.object(
            self.module.random,
            "choice",
            side_effect=lambda candidates: candidates[0],
        ):
            draws = [
                Path(self.module.prepare_random_image_from_folder(album)["source_path"]).name
                for _ in range(len(expected_names) * 2)
            ]

        self.assertEqual(set(draws[:len(expected_names)]), expected_names)
        self.assertEqual(set(draws[len(expected_names):]), expected_names)

    def test_path_outside_allowed_directories_is_rejected(self):
        with self.assertRaises(ValueError):
            self.module.list_sibling_images("../secret.png")


if __name__ == "__main__":
    unittest.main()
