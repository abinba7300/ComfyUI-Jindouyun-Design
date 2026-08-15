import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path


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

    def test_path_outside_allowed_directories_is_rejected(self):
        with self.assertRaises(ValueError):
            self.module.list_sibling_images("../secret.png")


if __name__ == "__main__":
    unittest.main()
