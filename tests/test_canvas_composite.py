import sys
import unittest
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from canvas_composite import (
    BLEND_MODES,
    CANVAS_PERCENT_MAX,
    CANVAS_PRESETS,
    SCALE_MODES,
    JindouyunCanvasComposite,
    apply_drawing_to_canvas,
    blend_pixels,
    composite_image_on_canvas,
    normalize_blend_mode,
    parse_hex_color,
    crop_transparent_padding,
    resolve_canvas_size,
    resolve_layer_bounds,
    resolve_layer_regions,
    resolve_layer_size,
    parse_drawing_data,
)


class CanvasCompositeTests(unittest.TestCase):
    def test_parse_hex_color_defaults_to_normalized_rgb(self):
        self.assertEqual(parse_hex_color("#FFFFFF"), (1.0, 1.0, 1.0))
        self.assertEqual(parse_hex_color("000000"), (0.0, 0.0, 0.0))

    def test_resolve_canvas_size_uses_width_for_ratio_presets(self):
        self.assertEqual(resolve_canvas_size(1600, 999, "16:9"), (1600, 900))
        self.assertEqual(resolve_canvas_size(768, 1, "3:4"), (768, 1024))
        self.assertEqual(resolve_canvas_size(321, 654, "自定义"), (321, 654))
        self.assertIn("21:9", CANVAS_PRESETS)
        self.assertIn("multiply", BLEND_MODES)

    def test_manual_layer_size_keeps_legacy_pixel_scaling(self):
        self.assertEqual(resolve_layer_size(2000, 1000, 1000, 1000, 1.0, "手动缩放"), (1000, 500))
        self.assertEqual(resolve_layer_size(100, 50, 1000, 1000, 1.0, "手动缩放"), (100, 50))
        self.assertEqual(resolve_layer_size(100, 50, 1000, 1000, 2.0, "手动缩放"), (200, 100))
        self.assertEqual(resolve_layer_size(100, 50, 1000, 1000, 50.0, "手动缩放"), (2000, 1000))
        self.assertEqual(resolve_layer_size(2000, 1000, 1000, 1000, 2.0, "手动缩放"), (2000, 1000))

    def test_layer_size_can_follow_canvas_height_or_width_percent(self):
        self.assertIn("高度占画布", SCALE_MODES)
        self.assertIn("宽度占画布", SCALE_MODES)
        self.assertEqual(resolve_layer_size(100, 200, 1000, 800, 1.0, "高度占画布", 90), (360, 720))
        self.assertEqual(resolve_layer_size(200, 100, 1000, 800, 1.0, "宽度占画布", 90), (900, 450))
        self.assertEqual(CANVAS_PERCENT_MAX, 2000.0)
        self.assertEqual(resolve_layer_size(100, 200, 1000, 800, 1.0, "高度占画布", 2000), (8000, 16000))

    def test_empty_scale_mode_auto_fits_small_image_to_ninety_percent(self):
        self.assertEqual(resolve_layer_size(110, 127, 1442, 1280, 2.43, "", 90), (998, 1152))

    def test_small_image_output_matches_ninety_percent_preview_size(self):
        source = torch.zeros((1, 13, 11, 3), dtype=torch.float32)
        source[..., 0] = 1.0

        result = composite_image_on_canvas(
            image=source,
            width=144,
            height=128,
            background_color="#000000",
            x_percent=50,
            y_percent=50,
            scale=2.43,
            scale_mode="",
            canvas_percent=90,
        )

        red_pixels = result[0, ..., 0] > 0.99
        rows, columns = torch.where(red_pixels)
        self.assertEqual(int(columns.max() - columns.min() + 1), 97)
        self.assertEqual(int(rows.max() - rows.min() + 1), 115)

    def test_auto_fit_scales_large_image_down_to_ninety_percent(self):
        self.assertEqual(resolve_layer_size(4000, 2000, 1000, 1000, 1.0, "适应画布", 90), (900, 450))

    def test_explicit_manual_mode_keeps_pixel_based_scaling(self):
        self.assertEqual(resolve_layer_size(110, 127, 1442, 1280, 2.43, "手动缩放", 90), (267, 309))

    def test_layer_bounds_keep_image_edges_inside_canvas(self):
        self.assertEqual(resolve_layer_bounds(100, 100, 20, 20, 0, 0), (0, 0, 20, 20))
        self.assertEqual(resolve_layer_bounds(100, 100, 20, 20, 100, 100), (80, 80, 100, 100))
        self.assertEqual(resolve_layer_bounds(100, 100, 20, 20, 50, 50), (40, 40, 60, 60))

    def test_layer_regions_crop_oversized_layer_to_canvas(self):
        self.assertEqual(
            resolve_layer_regions(100, 80, 200, 160, 50, 50),
            (50, 40, 150, 120, 0, 0, 100, 80),
        )

    def test_composite_supports_twenty_times_canvas_percent(self):
        source = torch.zeros((1, 10, 10, 3), dtype=torch.float32)
        source[..., 0] = 1.0
        result = composite_image_on_canvas(
            image=source,
            width=20,
            height=20,
            background_color="#000000",
            x_percent=50,
            y_percent=50,
            scale=1,
            scale_mode="高度占画布",
            canvas_percent=2000,
        )
        self.assertEqual(tuple(result.shape), (1, 20, 20, 3))
        self.assertTrue(torch.allclose(result[..., 0], torch.ones_like(result[..., 0])))

    def test_composite_centers_image_on_custom_canvas(self):
        source = torch.zeros((1, 2, 2, 3), dtype=torch.float32)
        source[..., 0] = 1.0

        result = composite_image_on_canvas(
            image=source,
            width=4,
            height=4,
            background_color="#FFFFFF",
            x_percent=50,
            y_percent=50,
            scale=1,
            scale_mode="手动缩放",
        )

        self.assertEqual(tuple(result.shape), (1, 4, 4, 3))
        self.assertTrue(torch.allclose(result[0, 1:3, 1:3, 0], torch.ones((2, 2))))
        self.assertTrue(torch.allclose(result[0, 0, 0], torch.tensor([1.0, 1.0, 1.0])))

    def test_composite_can_place_image_by_percentage(self):
        source = torch.zeros((1, 2, 2, 3), dtype=torch.float32)
        source[..., 2] = 1.0

        result = composite_image_on_canvas(
            image=source,
            width=4,
            height=4,
            background_color="#000000",
            x_percent=25,
            y_percent=25,
            scale=1,
            scale_mode="手动缩放",
        )

        self.assertTrue(torch.allclose(result[0, 0:2, 0:2, 2], torch.ones((2, 2))))
        self.assertTrue(torch.allclose(result[0, 3, 3], torch.tensor([0.0, 0.0, 0.0])))

    def test_composite_rotates_input_image_around_its_center(self):
        source = torch.zeros((1, 3, 1, 3), dtype=torch.float32)
        source[..., 0] = 1.0

        result = composite_image_on_canvas(
            image=source,
            width=7,
            height=7,
            background_color="#000000",
            x_percent=50,
            y_percent=50,
            scale=1,
            scale_mode="手动缩放",
            rotation_degrees=90,
        )

        self.assertTrue(torch.all(result[0, 3, 2:5, 0] > 0.9))
        self.assertTrue(torch.allclose(result[0, 2, 3], torch.zeros(3)))

    def test_rotated_rgb_image_keeps_bounding_box_corners_transparent(self):
        source = torch.zeros((1, 3, 3, 3), dtype=torch.float32)
        source[..., 0] = 1.0

        result = composite_image_on_canvas(
            image=source,
            width=9,
            height=9,
            background_color="#FFFFFF",
            x_percent=50,
            y_percent=50,
            scale=1,
            scale_mode="手动缩放",
            rotation_degrees=45,
        )

        self.assertTrue(torch.allclose(result[0, 2, 2], torch.ones(3)))
        self.assertGreater(float(result[0, 4, 4, 0]), 0.9)
        self.assertLess(float(result[0, 4, 4, 1]), 0.1)

    def test_positive_rotation_is_clockwise_like_browser_canvas(self):
        source = torch.zeros((1, 2, 2, 3), dtype=torch.float32)
        source[0, 0, 0, 0] = 1.0

        result = composite_image_on_canvas(
            image=source,
            width=2,
            height=2,
            background_color="#000000",
            x_percent=50,
            y_percent=50,
            scale=1,
            scale_mode="手动缩放",
            rotation_degrees=90,
        )

        self.assertGreater(float(result[0, 0, 1, 0]), 0.9)
        self.assertLess(float(result[0, 1, 0, 0]), 0.1)

    def test_composite_clamps_position_to_keep_image_inside_canvas(self):
        source = torch.zeros((1, 2, 2, 3), dtype=torch.float32)
        source[..., 1] = 1.0

        result = composite_image_on_canvas(
            image=source,
            width=4,
            height=4,
            background_color="#000000",
            x_percent=100,
            y_percent=100,
            scale=1,
            scale_mode="手动缩放",
        )

        self.assertTrue(torch.allclose(result[0, 2:4, 2:4, 1], torch.ones((2, 2))))
        self.assertTrue(torch.allclose(result[0, 0, 0], torch.tensor([0.0, 0.0, 0.0])))

    def test_composite_blends_alpha_channel(self):
        source = torch.zeros((1, 1, 1, 4), dtype=torch.float32)
        source[..., 0] = 1.0
        source[..., 3] = 0.5

        result = composite_image_on_canvas(
            image=source,
            width=1,
            height=1,
            background_color="#0000FF",
            x_percent=50,
            y_percent=50,
            scale=1,
            scale_mode="手动缩放",
        )

        self.assertTrue(torch.allclose(result[0, 0, 0], torch.tensor([0.5, 0.0, 0.5])))

    def test_transparent_padding_is_cropped_before_compositing(self):
        source = torch.zeros((1, 4, 6, 4), dtype=torch.float32)
        source[:, 1:3, 2:4, 0] = 1.0
        source[:, 1:3, 2:4, 3] = 1.0

        cropped = crop_transparent_padding(source)

        self.assertEqual(tuple(cropped.shape), (1, 2, 2, 4))

    def test_transparent_subject_aligns_to_right_edge_after_cropping_padding(self):
        source = torch.zeros((1, 4, 6, 4), dtype=torch.float32)
        source[:, 1:3, 2:4, 0] = 1.0
        source[:, 1:3, 2:4, 3] = 1.0

        result = composite_image_on_canvas(
            image=source,
            width=6,
            height=4,
            background_color="#000000",
            x_percent=100,
            y_percent=50,
            scale=1,
            scale_mode="手动缩放",
        )

        self.assertTrue(torch.allclose(result[0, 1:3, 4:6, 0], torch.ones((2, 2))))
        self.assertTrue(torch.allclose(result[0, 1:3, 2:4, 0], torch.zeros((2, 2))))

    def test_blend_multiply_and_opacity(self):
        base = torch.tensor([[[[0.5, 0.5, 0.5]]]], dtype=torch.float32)
        layer = torch.tensor([[[[0.2, 0.4, 0.8]]]], dtype=torch.float32)

        multiplied = blend_pixels(base, layer, "multiply")

        self.assertTrue(torch.allclose(multiplied, torch.tensor([[[[0.1, 0.2, 0.4]]]])))

    def test_invalid_legacy_blend_mode_value_falls_back_to_normal(self):
        self.assertEqual(normalize_blend_mode(50), "normal")
        self.assertTrue(JindouyunCanvasComposite.VALIDATE_INPUTS(混合模式=50))

    def test_composite_uses_blend_mode_and_opacity(self):
        source = torch.ones((1, 1, 1, 3), dtype=torch.float32) * 0.5

        result = composite_image_on_canvas(
            image=source,
            width=1,
            height=1,
            background_color="#808080",
            x_percent=50,
            y_percent=50,
            scale=1,
            blend_mode="screen",
            opacity=0.5,
            scale_mode="手动缩放",
        )

        self.assertTrue(torch.all(result >= 0.5))

    def test_composite_defaults_to_height_percent_scaling(self):
        source = torch.zeros((1, 100, 50, 3), dtype=torch.float32)
        source[..., 0] = 1.0

        result = composite_image_on_canvas(
            image=source,
            width=200,
            height=100,
            background_color="#000000",
            x_percent=50,
            y_percent=50,
            scale=1,
        )

        self.assertEqual(tuple(result.shape), (1, 100, 200, 3))
        self.assertTrue(torch.allclose(result[0, 5:95, 78:123, 0], torch.ones((90, 45))))

    def test_drawing_brush_is_applied_to_final_canvas(self):
        canvas = torch.zeros((1, 20, 20, 3), dtype=torch.float32)
        drawing = '{"version":1,"strokes":[{"tool":"brush","color":"#FF6A00","size":0.2,"points":[[0.25,0.5],[0.75,0.5]]}]}'

        result = apply_drawing_to_canvas(canvas, drawing)

        self.assertGreater(float(result[0, 10, 10, 0]), 0.9)
        self.assertGreater(float(result[0, 10, 10, 1]), 0.2)
        self.assertLess(float(result[0, 10, 10, 2]), 0.1)

    def test_pencil_brush_type_is_parsed_and_rendered_with_texture(self):
        canvas = torch.ones((1, 48, 48, 3), dtype=torch.float32)
        drawing = '{"version":5,"strokes":[{"tool":"brush","brushType":"pencil","color":"#111111","size":0.12,"points":[[0.15,0.5],[0.35,0.48],[0.65,0.52],[0.85,0.5]]}]}'

        strokes = parse_drawing_data(drawing)
        result = apply_drawing_to_canvas(canvas, drawing)

        self.assertEqual(strokes[0]["brush_type"], "pencil")
        self.assertLess(float(result[0, 24, 24].mean()), 0.95)
        self.assertGreater(float(result[0, 24, 24].mean()), 0.05)
        self.assertGreater(float(result[0, 20:29, 6:42].std()), 0.01)

    def test_hidden_drawing_layer_is_not_applied(self):
        canvas = torch.zeros((1, 20, 20, 3), dtype=torch.float32)
        drawing = '{"version":4,"strokes":[{"tool":"brush","visible":false,"color":"#FF6A00","size":0.2,"points":[[0.25,0.5],[0.75,0.5]]}]}'

        result = apply_drawing_to_canvas(canvas, drawing)

        self.assertTrue(torch.equal(result, canvas))

    def test_hidden_drawing_group_is_not_applied(self):
        canvas = torch.zeros((1, 20, 20, 3), dtype=torch.float32)
        drawing = '{"version":5,"groups":[{"id":"g1","visible":false}],"strokes":[{"tool":"brush","groupId":"g1","groupVisible":false,"color":"#2387FF","size":0.2,"points":[[0.25,0.5],[0.75,0.5]]}]}'

        result = apply_drawing_to_canvas(canvas, drawing)

        self.assertTrue(torch.equal(result, canvas))

    def test_hidden_input_layer_is_not_applied(self):
        source = torch.zeros((1, 10, 10, 3), dtype=torch.float32)
        source[..., 0] = 1.0

        result = composite_image_on_canvas(
            image=source,
            width=10,
            height=10,
            background_color="#000000",
            x_percent=50,
            y_percent=50,
            scale=1,
            scale_mode="鎵嬪姩缂╂斁",
            drawing_data='{"version":4,"inputVisible":false,"strokes":[]}',
        )

        self.assertTrue(torch.equal(result, torch.zeros_like(result)))

    def test_mirrored_brush_stroke_is_applied_to_both_sides(self):
        canvas = torch.zeros((1, 21, 21, 3), dtype=torch.float32)
        drawing = '{"version":1,"strokes":[{"tool":"brush","color":"#2387FF","size":0.05,"mirrorX":true,"points":[[0.25,0.25],[0.25,0.75]]}]}'

        result = apply_drawing_to_canvas(canvas, drawing)

        self.assertGreater(float(result[0, 10, 5, 2]), 0.9)
        self.assertGreater(float(result[0, 10, 15, 2]), 0.9)
        self.assertTrue(torch.allclose(result[0, 10, 10], torch.zeros(3)))

    def test_materialized_mirror_points_are_applied_as_one_transformed_layer(self):
        canvas = torch.zeros((1, 21, 21, 3), dtype=torch.float32)
        drawing = '{"version":5,"strokes":[{"tool":"brush","color":"#2387FF","size":0.05,"mirrorX":false,"points":[[0.375,0.25],[0.375,0.75]],"mirrorPoints":[[0.625,0.25],[0.625,0.75]]}]}'

        result = apply_drawing_to_canvas(canvas, drawing)

        self.assertGreater(float(result[0, 10, 8, 2]), 0.9)
        self.assertGreater(float(result[0, 10, 12, 2]), 0.9)

    def test_drawing_eraser_removes_previous_brush_stroke(self):
        canvas = torch.zeros((1, 20, 20, 3), dtype=torch.float32)
        drawing = '{"version":1,"strokes":[' \
            '{"tool":"brush","color":"#2387FF","size":0.3,"points":[[0.2,0.5],[0.8,0.5]]},' \
            '{"tool":"eraser","color":"#FF6A00","size":0.3,"points":[[0.5,0.3],[0.5,0.7]]}' \
            ']}'

        result = apply_drawing_to_canvas(canvas, drawing)

        self.assertTrue(torch.allclose(result[0, 10, 10], torch.zeros(3)))
        self.assertGreater(float(result[0, 10, 4, 2]), 0.9)

    def test_lasso_fill_covers_input_image_with_selected_color(self):
        source = torch.zeros((1, 20, 20, 3), dtype=torch.float32)
        source[..., 0] = 1.0
        drawing = '{"version":1,"strokes":[{"tool":"lasso","color":"#FFFFFF","size":0.02,"points":[[0.25,0.25],[0.75,0.25],[0.75,0.75],[0.25,0.75],[0.25,0.25]]}]}'

        result = composite_image_on_canvas(
            image=source,
            width=20,
            height=20,
            background_color="#000000",
            x_percent=50,
            y_percent=50,
            scale=1,
            scale_mode="手动缩放",
            drawing_data=drawing,
        )

        self.assertTrue(torch.allclose(result[0, 10, 10], torch.ones(3)))
        self.assertTrue(torch.allclose(result[0, 1, 1], torch.tensor([1.0, 0.0, 0.0])))

    def test_input_image_can_be_reference_only_in_final_output(self):
        source = torch.zeros((1, 20, 20, 3), dtype=torch.float32)
        source[..., 0] = 1.0
        drawing = '{"version":1,"strokes":[{"tool":"brush","color":"#2387FF","size":0.2,"points":[[0.25,0.5],[0.75,0.5]]}]}'

        result = composite_image_on_canvas(
            image=source,
            width=20,
            height=20,
            background_color="#000000",
            x_percent=50,
            y_percent=50,
            scale=1,
            scale_mode="手动缩放",
            drawing_data=drawing,
            include_input_image=False,
        )

        self.assertTrue(torch.allclose(result[0, 0, 0], torch.zeros(3)))
        self.assertGreater(float(result[0, 10, 10, 2]), 0.9)
        self.assertLess(float(result[..., 0].max()), 0.2)

    def test_unclosed_lasso_is_ignored_instead_of_cross_filling(self):
        canvas = torch.zeros((1, 20, 20, 3), dtype=torch.float32)
        drawing = '{"version":1,"strokes":[{"tool":"lasso","color":"#FFFFFF","size":0.02,"points":[[0.2,0.2],[0.8,0.2],[0.8,0.8],[0.2,0.8]]}]}'

        result = apply_drawing_to_canvas(canvas, drawing)

        self.assertTrue(torch.equal(result, canvas))

    def test_canvas_can_run_without_an_input_image(self):
        drawing = '{"version":1,"strokes":[{"tool":"brush","color":"#2387FF","size":0.25,"points":[[0.25,0.5],[0.75,0.5]]}]}'

        result = composite_image_on_canvas(
            image=None,
            width=20,
            height=10,
            background_color="#FFFFFF",
            x_percent=50,
            y_percent=50,
            scale=1,
            drawing_data=drawing,
        )

        self.assertEqual(tuple(result.shape), (1, 10, 20, 3))
        self.assertGreater(float(result[0, 5, 10, 2]), 0.9)
        self.assertTrue(torch.allclose(result[0, 0, 0], torch.ones(3)))

    def test_invalid_drawing_data_is_ignored(self):
        canvas = torch.rand((1, 4, 4, 3), dtype=torch.float32)

        self.assertEqual(parse_drawing_data("not-json"), [])
        self.assertTrue(torch.equal(apply_drawing_to_canvas(canvas, "not-json"), canvas))

    def test_compose_exposes_hidden_serialized_drawing_input(self):
        input_types = JindouyunCanvasComposite.INPUT_TYPES()
        inputs = input_types["required"]

        self.assertIn("绘画数据", inputs)
        self.assertIn("strokes", inputs["绘画数据"][1]["default"])
        self.assertEqual(inputs["输出输入图像"][0], "BOOLEAN")
        self.assertTrue(inputs["输出输入图像"][1]["default"])
        self.assertEqual(inputs["图片旋转"][0], "STRING")
        self.assertEqual(inputs["图片旋转"][1]["default"], "0.0")
        self.assertNotIn("图像", inputs)
        self.assertIn("图像", input_types["optional"])


if __name__ == "__main__":
    unittest.main()
