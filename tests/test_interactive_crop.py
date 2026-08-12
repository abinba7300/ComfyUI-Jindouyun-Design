import sys
import unittest
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from interactive_crop import (
    DEFAULT_CROP_DATA,
    JindouyunInteractiveCrop,
    RESIZE_METHODS,
    crop_and_resize_image,
    crop_image_tensor,
    mirror_image_tensor,
    normalize_rotation_degrees,
    parse_crop_data,
    resolve_rotated_size,
    rotate_image_tensor_expand,
    resize_image_by_percent,
    resize_image_to_max_edge,
    resolve_crop_bounds,
)


class InteractiveCropTests(unittest.TestCase):
    def test_horizontal_mirror_flips_width_axis(self):
        image = torch.tensor(
            [[[[1.0], [2.0], [3.0]], [[4.0], [5.0], [6.0]]]],
        )

        result = mirror_image_tensor(image, horizontal=True)

        expected = torch.tensor(
            [[[[3.0], [2.0], [1.0]], [[6.0], [5.0], [4.0]]]],
        )
        self.assertTrue(torch.equal(result, expected))

    def test_vertical_mirror_flips_height_axis(self):
        image = torch.tensor(
            [[[[1.0], [2.0], [3.0]], [[4.0], [5.0], [6.0]]]],
        )

        result = mirror_image_tensor(image, vertical=True)

        expected = torch.tensor(
            [[[[4.0], [5.0], [6.0]], [[1.0], [2.0], [3.0]]]],
        )
        self.assertTrue(torch.equal(result, expected))

    def test_both_mirrors_flip_both_spatial_axes(self):
        image = torch.tensor(
            [[[[1.0], [2.0], [3.0]], [[4.0], [5.0], [6.0]]]],
        )

        result = mirror_image_tensor(image, horizontal=True, vertical=True)

        expected = torch.tensor(
            [[[[6.0], [5.0], [4.0]], [[3.0], [2.0], [1.0]]]],
        )
        self.assertTrue(torch.equal(result, expected))

    def test_rotation_zero_returns_original_tensor(self):
        image = torch.rand((1, 40, 70, 3))
        self.assertIs(rotate_image_tensor_expand(image, 0), image)

    def test_rotation_90_swaps_width_and_height(self):
        image = torch.zeros((1, 20, 40, 3))
        result = rotate_image_tensor_expand(image, 90)
        self.assertEqual(tuple(result.shape), (1, 40, 20, 4))

    def test_rotated_size_expands_for_arbitrary_angle(self):
        self.assertEqual(resolve_rotated_size(100, 50, 45), (107, 107))

    def test_positive_rotation_is_clockwise(self):
        image = torch.zeros((1, 3, 3, 3))
        image[0, 0, 1, 0] = 1.0
        result = rotate_image_tensor_expand(image, 90)
        self.assertGreater(float(result[0, 1, 2, 0]), 0.99)

    def test_pipeline_rotates_before_cropping(self):
        image = torch.zeros((1, 20, 40, 3))
        image[:, :7, :13, 0] = 1.0
        image[:, 7:, :13, 1] = 1.0
        image[:, :7, 13:, 2] = 1.0
        image[:, 7:, 13:, :2] = 1.0
        crop_data = '{"x":0.2,"y":0.15,"width":0.55,"height":0.7}'
        max_edge = 17

        result = crop_and_resize_image(
            image,
            crop_data,
            max_edge=max_edge,
            rotation_degrees=90,
        )
        expected = resize_image_to_max_edge(
            crop_image_tensor(rotate_image_tensor_expand(image, 90), crop_data),
            max_edge=max_edge,
        )
        wrong = resize_image_to_max_edge(
            rotate_image_tensor_expand(crop_image_tensor(image, crop_data), 90),
            max_edge=max_edge,
        )

        torch.testing.assert_close(result, expected)
        self.assertFalse(torch.equal(result, wrong))

    def test_pipeline_mirrors_before_rotation_and_cropping(self):
        image = torch.zeros((1, 3, 4, 3))
        image[0, 0, 0, 0] = 1.0
        crop_data = '{"x":0.0,"y":0.0,"width":0.5,"height":1.0}'

        result = crop_and_resize_image(
            image,
            crop_data,
            rotation_degrees=90,
            mirror_horizontal=True,
        )
        expected = crop_image_tensor(
            rotate_image_tensor_expand(
                mirror_image_tensor(image, horizontal=True),
                90,
            ),
            crop_data,
        )

        torch.testing.assert_close(result, expected)

    def test_rgb_rotation_adds_transparent_corners(self):
        image = torch.ones((1, 20, 40, 3))
        result = rotate_image_tensor_expand(image, 45)
        self.assertEqual(result.shape[-1], 4)
        self.assertEqual(float(result[0, 0, 0, 3]), 0.0)

    def test_rgba_rotation_uses_premultiplied_alpha_sampling(self):
        image = torch.zeros((1, 3, 3, 4))
        image[..., 0] = 1.0
        image[0, 1, 1] = torch.tensor([0.0, 1.0, 0.0, 1.0])

        result = rotate_image_tensor_expand(image, 45)
        fractional_alpha = result[..., 3].gt(0.0) & result[..., 3].lt(1.0)
        sampled = result[fractional_alpha]

        self.assertGreater(sampled.shape[0], 0)
        self.assertLess(float(sampled[:, 0].max()), 1e-4)
        self.assertGreater(float(sampled[:, 1].min()), 0.99)

    def test_single_channel_rotation_keeps_single_channel(self):
        image = torch.ones((1, 5, 7, 1))
        result = rotate_image_tensor_expand(image, 45)
        self.assertEqual(tuple(result.shape), (1, 9, 9, 1))

    def test_invalid_rotation_values_normalize_to_zero(self):
        for value in (None, "", "not-a-number", float("nan"), float("inf")):
            with self.subTest(value=value):
                self.assertEqual(normalize_rotation_degrees(value), 0.0)

    def test_rotation_normalization_wraps_finite_angles(self):
        self.assertEqual(normalize_rotation_degrees(450), 90.0)

    def test_invalid_crop_data_defaults_to_full_image(self):
        self.assertEqual(
            parse_crop_data("not-json"),
            {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
        )

    def test_crop_data_is_clamped_inside_image(self):
        crop = parse_crop_data('{"x":0.8,"y":0.75,"width":0.8,"height":0.8}')
        self.assertAlmostEqual(crop["width"], 0.2)
        self.assertAlmostEqual(crop["height"], 0.25)

    def test_normalized_crop_resolves_to_pixel_bounds(self):
        self.assertEqual(
            resolve_crop_bounds(100, 80, '{"x":0.1,"y":0.25,"width":0.5,"height":0.5}'),
            (10, 20, 60, 60),
        )

    def test_tensor_crop_preserves_batch_and_channels(self):
        image = torch.arange(2 * 8 * 10 * 4, dtype=torch.float32).reshape(2, 8, 10, 4)
        result = crop_image_tensor(
            image,
            '{"x":0.2,"y":0.25,"width":0.5,"height":0.5}',
        )
        self.assertEqual(tuple(result.shape), (2, 4, 5, 4))
        self.assertTrue(torch.equal(result, image[:, 2:6, 2:7, :]))

    def test_node_prefers_connected_image_over_upload_value(self):
        image = torch.zeros((1, 12, 20, 3), dtype=torch.float32)
        node = JindouyunInteractiveCrop()
        result, qualified, needs_upscale = node.crop(
            上传图片="missing-file.png",
            裁剪数据='{"x":0.25,"y":0.25,"width":0.5,"height":0.5}',
            分流标准最大边=1,
            图像=image,
        )
        self.assertEqual(tuple(result.shape), (1, 6, 10, 3))
        self.assertTrue(qualified)
        self.assertFalse(needs_upscale)

    def test_locked_aspect_ratio_scales_width_and_height_together(self):
        image = torch.zeros((1, 50, 100, 3), dtype=torch.float32)
        result = resize_image_by_percent(
            image,
            width_percent=200,
            height_percent=50,
            aspect_locked=True,
        )
        self.assertEqual(tuple(result.shape), (1, 100, 200, 3))

    def test_unlocked_aspect_ratio_can_deform_width_and_height_independently(self):
        image = torch.zeros((1, 50, 100, 3), dtype=torch.float32)
        result = resize_image_by_percent(
            image,
            width_percent=200,
            height_percent=50,
            aspect_locked=False,
        )
        self.assertEqual(tuple(result.shape), (1, 25, 200, 3))

    def test_original_cropped_max_edge_routes_to_qualified_output(self):
        image = torch.zeros((1, 512, 1024, 3), dtype=torch.float32)
        result, qualified, needs_upscale = JindouyunInteractiveCrop().crop(
            图像=image,
            分流标准最大边=1024,
        )
        torch.testing.assert_close(result, image)
        self.assertTrue(qualified)
        self.assertFalse(needs_upscale)

    def test_small_original_cropped_max_edge_routes_to_upscale_output(self):
        image = torch.zeros((1, 512, 900, 3), dtype=torch.float32)
        result, qualified, needs_upscale = JindouyunInteractiveCrop().crop(
            图像=image,
            分流标准最大边=1024,
        )
        torch.testing.assert_close(result, image)
        self.assertFalse(qualified)
        self.assertTrue(needs_upscale)

    def test_upscaled_small_crop_still_routes_to_needs_upscale(self):
        image = torch.zeros((1, 400, 600, 3), dtype=torch.float32)
        result, qualified, needs_upscale = JindouyunInteractiveCrop().crop(
            图像=image,
            裁剪数据='{"x":0.25,"y":0.25,"width":0.5,"height":0.5}',
            启用最大边分辨率=True,
            最大边分辨率=2048,
            分流标准最大边=1024,
        )

        self.assertEqual(tuple(result.shape), (1, 1365, 2048, 3))
        self.assertFalse(qualified)
        self.assertTrue(needs_upscale)

    def test_disabled_max_edge_ignores_retained_target_value(self):
        image = torch.zeros((1, 400, 600, 3), dtype=torch.float32)
        result, qualified, needs_upscale = JindouyunInteractiveCrop().crop(
            图像=image,
            最大边分辨率=1536,
            启用最大边分辨率=False,
            分流标准最大边=1024,
        )

        self.assertEqual(tuple(result.shape), (1, 400, 600, 3))
        self.assertFalse(qualified)
        self.assertTrue(needs_upscale)

    def test_max_edge_zero_preserves_cropped_resolution(self):
        image = torch.zeros((1, 60, 100, 3), dtype=torch.float32)
        result = resize_image_to_max_edge(image, max_edge=0)
        self.assertIs(result, image)

    def test_max_edge_downscales_and_preserves_aspect_ratio(self):
        image = torch.zeros((1, 600, 1200, 3), dtype=torch.float32)
        result = resize_image_to_max_edge(image, max_edge=900)
        self.assertEqual(tuple(result.shape), (1, 450, 900, 3))

    def test_max_edge_uses_frontend_half_up_rounding(self):
        image = torch.zeros((1, 3, 4, 3), dtype=torch.float32)

        result = resize_image_to_max_edge(image, max_edge=6)

        self.assertEqual(tuple(result.shape), (1, 5, 6, 3))

    def test_max_edge_can_high_quality_upscale_after_crop(self):
        image = torch.zeros((1, 80, 120, 3), dtype=torch.float32)
        image[..., 0] = 0.5
        result = crop_and_resize_image(
            image,
            '{"x":0.25,"y":0.25,"width":0.5,"height":0.5}',
            max_edge=240,
        )
        self.assertEqual(tuple(result.shape), (1, 160, 240, 3))
        self.assertAlmostEqual(float(result[..., 0].mean()), 0.5, places=4)

    def test_all_resize_methods_preserve_expected_output_shape(self):
        image = torch.rand((2, 30, 60, 4), dtype=torch.float32)
        for method in RESIZE_METHODS:
            with self.subTest(method=method):
                result = resize_image_to_max_edge(
                    image,
                    max_edge=120,
                    resize_method=method,
                )
                self.assertEqual(tuple(result.shape), (2, 60, 120, 4))
                self.assertEqual(result.dtype, image.dtype)
                self.assertTrue(torch.all((result >= 0) & (result <= 1)))

    def test_area_method_can_downscale(self):
        image = torch.rand((1, 80, 120, 3), dtype=torch.float32)
        result = resize_image_to_max_edge(
            image,
            max_edge=60,
            resize_method="area",
        )
        self.assertEqual(tuple(result.shape), (1, 40, 60, 3))

    def test_nearest_exact_keeps_hard_pixel_edges(self):
        image = torch.tensor(
            [[[[0.0], [1.0]], [[1.0], [0.0]]]],
            dtype=torch.float32,
        )
        result = resize_image_to_max_edge(
            image,
            max_edge=4,
            resize_method="nearest-exact",
        )
        expected = image.repeat_interleave(2, dim=1).repeat_interleave(2, dim=2)
        self.assertTrue(torch.equal(result, expected))

    def test_node_schema_has_upload_and_optional_image(self):
        schema = JindouyunInteractiveCrop.INPUT_TYPES()
        self.assertIn("上传图片", schema["required"])
        self.assertTrue(schema["required"]["上传图片"][1]["image_upload"])
        self.assertEqual(schema["required"]["裁剪数据"][1]["default"], DEFAULT_CROP_DATA)
        self.assertEqual(schema["required"]["最大边分辨率"][1]["default"], 0)
        self.assertEqual(schema["required"]["最大边分辨率"][1]["max"], 16384)
        self.assertEqual(schema["required"]["最大边分辨率"][1]["step"], 1)
        self.assertFalse(schema["required"]["启用最大边分辨率"][1]["default"])
        self.assertEqual(schema["required"]["放大方法"][0], RESIZE_METHODS)
        self.assertEqual(schema["required"]["放大方法"][1]["default"], RESIZE_METHODS[0])
        self.assertTrue(schema["required"]["锁定长宽比"][1]["default"])
        self.assertEqual(schema["required"]["宽度比例"][1]["default"], 100.0)
        self.assertEqual(schema["required"]["高度比例"][1]["default"], 100.0)
        self.assertEqual(schema["required"]["分流标准最大边"][1]["default"], 1024)
        self.assertEqual(JindouyunInteractiveCrop.RETURN_TYPES, ("IMAGE", "BOOLEAN", "BOOLEAN"))
        self.assertEqual(JindouyunInteractiveCrop.RETURN_NAMES, ("图像", "符合尺寸", "不符合尺寸"))
        resize_tooltip = schema["required"]["放大方法"][1]["tooltip"]
        self.assertIn("实用推荐", resize_tooltip)
        self.assertIn("产品图、照片、普通透明素材：bicubic", resize_tooltip)
        self.assertIn("主要进行缩小：area 或 lanczos", resize_tooltip)
        self.assertIn("蒙版、线稿分区、像素画：nearest-exact", resize_tooltip)
        self.assertEqual(schema["optional"]["图像"], ("IMAGE",))

    def test_schema_appends_rotation_and_mirror_controls_after_resize_method(self):
        required = JindouyunInteractiveCrop.INPUT_TYPES()["required"]
        keys = list(required)
        self.assertEqual(
            keys,
            [
                "上传图片",
                "裁剪数据",
                "最大边分辨率",
                "放大方法",
                "图片旋转",
                "左右镜像",
                "上下镜像",
                "锁定长宽比",
                "宽度比例",
                "高度比例",
                "分流标准最大边",
                "启用最大边分辨率",
            ],
        )
        self.assertEqual(required["图片旋转"][0], "FLOAT")
        self.assertEqual(required["图片旋转"][1]["default"], 0.0)
        self.assertEqual(required["图片旋转"][1]["min"], -180.0)
        self.assertEqual(required["图片旋转"][1]["max"], 180.0)
        self.assertEqual(required["图片旋转"][1]["step"], 0.1)
        self.assertEqual(required["左右镜像"], ("BOOLEAN", {"default": False}))
        self.assertEqual(required["上下镜像"], ("BOOLEAN", {"default": False}))


if __name__ == "__main__":
    unittest.main()
