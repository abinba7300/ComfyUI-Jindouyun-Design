import importlib.util
import math
import tempfile
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).resolve().parents[1] / "save_image.py"


def load_module():
    spec = importlib.util.spec_from_file_location("jindouyun_test_save_image", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeImage:
    shape = (8, 6, 3)

    def cpu(self):
        return self

    def numpy(self):
        return np.full(self.shape, 0.5, dtype=np.float32)


class JindouyunSaveImageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.module = load_module()

    def tearDown(self):
        self.temp.cleanup()

    def test_schema_accepts_custom_folder_and_prefix(self):
        schema = self.module.JindouyunSaveImage.INPUT_TYPES()
        self.assertIn("保存目录", schema["required"])
        self.assertIn("文件名前缀", schema["required"])
        self.assertIn("目录覆盖", schema["required"])
        self.assertEqual(self.module.JindouyunSaveImage.RETURN_TYPES, ("IMAGE", "STRING"))
        self.assertEqual(self.module.JindouyunSaveImage.RETURN_NAMES, ("图像", "保存路径"))
        self.assertTrue(self.module.JindouyunSaveImage.OUTPUT_NODE)

    def test_schema_defaults_to_comfyui_output_directory(self):
        output_directory = self.root / "output"
        self.module.folder_paths.get_output_directory = lambda: str(output_directory)

        schema = self.module.JindouyunSaveImage.INPUT_TYPES()

        self.assertEqual(
            schema["required"]["保存目录"][1]["default"],
            str(output_directory.resolve()),
        )

    def test_empty_directory_saves_to_comfyui_output_directory(self):
        output_directory = self.root / "output"
        preview_root = self.root / "temp"
        preview_root.mkdir()
        self.module.folder_paths.get_output_directory = lambda: str(output_directory)
        self.module.folder_paths.get_temp_directory = lambda: str(preview_root)

        result = self.module.JindouyunSaveImage().save_images(
            [FakeImage()], "", "默认目录", prompt=None, extra_pnginfo=None
        )

        saved_path = Path(result["result"][1])
        self.assertTrue(saved_path.is_file())
        self.assertEqual(saved_path.parent, output_directory.resolve())
        self.assertEqual(result["ui"]["save_directory"], [str(output_directory.resolve())])

    def test_save_node_always_bypasses_execution_cache(self):
        self.assertTrue(math.isnan(self.module.JindouyunSaveImage.IS_CHANGED()))

    def test_save_creates_folder_and_never_overwrites(self):
        target = self.root / "new" / "product"
        node = self.module.JindouyunSaveImage()
        preview_root = self.root / "temp"
        preview_root.mkdir()
        self.module.folder_paths.get_temp_directory = lambda: str(preview_root)

        first = node.save_images([FakeImage()], str(target), "样图", prompt=None, extra_pnginfo=None)
        second = node.save_images([FakeImage()], str(target), "样图", prompt=None, extra_pnginfo=None)

        first_path = Path(first["result"][1])
        second_path = Path(second["result"][1])
        self.assertTrue(first_path.is_file())
        self.assertTrue(second_path.is_file())
        self.assertNotEqual(first_path, second_path)
        self.assertEqual(first_path.parent, target.resolve())
        self.assertEqual(second["ui"]["save_directory"], [str(target.resolve())])
        self.assertEqual(len(second["ui"]["images"]), 2)
        self.assertEqual(second["ui"]["images"][0]["type"], "temp")
        self.assertTrue(second["ui"]["images"][0]["subfolder"].startswith("jindouyun_save_preview/"))

    def test_recent_preview_is_limited_to_four_newest_images(self):
        target = self.root / "gallery"
        target.mkdir()
        preview_root = self.root / "temp"
        preview_root.mkdir()
        self.module.folder_paths.get_temp_directory = lambda: str(preview_root)
        node = self.module.JindouyunSaveImage()

        result = None
        for index in range(6):
            result = node.save_images([FakeImage()], str(target), f"image{index}", prompt=None, extra_pnginfo=None)

        previews = result["ui"]["images"]
        self.assertEqual(len(previews), 4)
        self.assertTrue(previews[0]["filename"].endswith("image5_00001.png"))
        cached_files = list((preview_root / previews[0]["subfolder"]).iterdir())
        self.assertEqual(len(cached_files), 4)

    def test_directory_override_wins_over_connected_base_directory(self):
        base = self.root / "source"
        override = base / "123"
        preview_root = self.root / "temp"
        preview_root.mkdir()
        self.module.folder_paths.get_temp_directory = lambda: str(preview_root)

        result = self.module.JindouyunSaveImage().save_images(
            [FakeImage()], str(base), "样图", str(override), prompt=None, extra_pnginfo=None
        )

        saved_path = Path(result["result"][1])
        self.assertEqual(saved_path.parent, override.resolve())
        self.assertEqual(result["ui"]["save_directory"], [str(override.resolve())])

    def test_create_subfolder_rejects_nested_or_parent_names(self):
        with self.assertRaises(ValueError):
            self.module.create_subfolder(self.root, "../escape")
        with self.assertRaises(ValueError):
            self.module.create_subfolder(self.root, "nested/child")

    def test_create_subfolder_returns_created_absolute_path(self):
        created = self.module.create_subfolder(self.root, "新文件夹")
        self.assertEqual(Path(created), (self.root / "新文件夹").resolve())
        self.assertTrue(Path(created).is_dir())

    def test_create_subfolder_enters_existing_folder(self):
        existing = self.root / "123"
        existing.mkdir()

        created = self.module.create_subfolder(self.root, "123")

        self.assertEqual(Path(created), existing.resolve())

    def test_create_subfolder_uses_numbered_name_when_file_has_same_name(self):
        (self.root / "123").write_text("occupied", encoding="utf-8")
        (self.root / "123 (2)").write_text("occupied", encoding="utf-8")

        created = self.module.create_subfolder(self.root, "123")

        self.assertEqual(Path(created), (self.root / "123 (3)").resolve())
        self.assertTrue(Path(created).is_dir())

    def test_delete_saved_image_moves_exact_file_to_recycle_bin_and_refills_preview(self):
        target = self.root / "gallery"
        target.mkdir()
        preview_root = self.root / "temp"
        preview_root.mkdir()
        self.module.folder_paths.get_temp_directory = lambda: str(preview_root)
        for index in range(5):
            (target / f"image{index}.png").write_bytes(f"image-{index}".encode("ascii"))

        recycled = []

        def fake_recycle(path):
            recycled.append(path)
            path.unlink()

        result = self.module.delete_saved_image(target, "image4.png", fake_recycle)

        self.assertEqual(recycled, [(target / "image4.png").resolve()])
        self.assertFalse((target / "image4.png").exists())
        self.assertTrue(result["ok"])
        self.assertEqual(result["filename"], "image4.png")
        self.assertEqual(len(result["images"]), 4)
        self.assertNotIn("image4.png", {item["filename"] for item in result["images"]})

    def test_delete_saved_image_rejects_path_traversal(self):
        target = self.root / "gallery"
        target.mkdir()
        outside = self.root / "outside.png"
        outside.write_bytes(b"outside")

        with self.assertRaises(ValueError):
            self.module.delete_saved_image(target, "../outside.png", lambda path: path.unlink())

        self.assertTrue(outside.exists())

    def test_delete_saved_image_rejects_non_image_file(self):
        target = self.root / "gallery"
        target.mkdir()
        text_file = target / "notes.txt"
        text_file.write_text("keep", encoding="utf-8")

        with self.assertRaises(ValueError):
            self.module.delete_saved_image(target, text_file.name, lambda path: path.unlink())

        self.assertTrue(text_file.exists())


if __name__ == "__main__":
    unittest.main()
