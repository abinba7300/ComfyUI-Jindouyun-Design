import sys
import unittest
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from transparent_crop import (
    JindouyunTransparentCrop,
    alpha_mask_from_image,
    crop_image_and_mask,
    expand_bounds,
    find_visible_bounds,
)


class TransparentCropTests(unittest.TestCase):
    def test_finds_visible_bounds_from_alpha_mask(self):
        mask = torch.zeros((1, 6, 8), dtype=torch.float32)
        mask[:, 2:5, 3:7] = 1.0

        self.assertEqual(find_visible_bounds(mask), (3, 2, 7, 5))

    def test_expands_bounds_with_padding_inside_image(self):
        self.assertEqual(expand_bounds((3, 2, 7, 5), width=8, height=6, padding=2), (1, 0, 8, 6))

    def test_crops_transparent_padding_from_rgba_image(self):
        image = torch.zeros((1, 6, 8, 4), dtype=torch.float32)
        image[:, 2:5, 3:7, 0] = 1.0
        image[:, 2:5, 3:7, 3] = 1.0

        cropped, mask = crop_image_and_mask(image)

        self.assertEqual(tuple(cropped.shape), (1, 3, 4, 4))
        self.assertEqual(tuple(mask.shape), (1, 3, 4))
        self.assertTrue(torch.allclose(cropped[..., 0], torch.ones((1, 3, 4))))
        self.assertTrue(torch.allclose(mask, torch.ones((1, 3, 4))))

    def test_padding_keeps_extra_pixels_around_subject(self):
        image = torch.zeros((1, 6, 8, 4), dtype=torch.float32)
        image[:, 2:4, 3:5, 3] = 1.0

        cropped, _ = crop_image_and_mask(image, padding=1)

        self.assertEqual(tuple(cropped.shape), (1, 4, 4, 4))

    def test_optional_mask_can_drive_crop_for_rgb_image(self):
        image = torch.zeros((1, 6, 8, 3), dtype=torch.float32)
        image[:, 1:4, 2:6, 1] = 1.0
        mask = torch.zeros((1, 6, 8), dtype=torch.float32)
        mask[:, 1:4, 2:6] = 1.0

        cropped, cropped_mask = crop_image_and_mask(image, mask=mask)

        self.assertEqual(tuple(cropped.shape), (1, 3, 4, 3))
        self.assertEqual(tuple(cropped_mask.shape), (1, 3, 4))
        self.assertTrue(torch.allclose(cropped[..., 1], torch.ones((1, 3, 4))))

    def test_disabled_crop_returns_original_size_and_mask(self):
        image = torch.zeros((1, 6, 8, 4), dtype=torch.float32)
        image[:, 2:4, 3:5, 3] = 1.0

        cropped, mask = crop_image_and_mask(image, enabled=False)

        self.assertEqual(tuple(cropped.shape), (1, 6, 8, 4))
        self.assertEqual(tuple(mask.shape), (1, 6, 8))

    def test_rgb_image_without_mask_stays_uncropped(self):
        image = torch.zeros((1, 6, 8, 3), dtype=torch.float32)

        cropped, mask = crop_image_and_mask(image)

        self.assertEqual(tuple(cropped.shape), (1, 6, 8, 3))
        self.assertTrue(torch.allclose(mask, torch.ones((1, 6, 8))))

    def test_node_schema_exposes_crop_controls(self):
        schema = JindouyunTransparentCrop.INPUT_TYPES()

        self.assertEqual(list(schema["required"].keys()), ["图像", "启用裁切", "透明阈值", "保留边距"])
        self.assertIn("遮罩", schema["optional"])
        self.assertEqual(JindouyunTransparentCrop.RETURN_NAMES, ("图像", "遮罩"))

    def test_alpha_mask_from_image_uses_rgba_alpha(self):
        image = torch.zeros((1, 2, 3, 4), dtype=torch.float32)
        image[..., 3] = 0.5

        self.assertTrue(torch.allclose(alpha_mask_from_image(image), torch.ones((1, 2, 3)) * 0.5))


if __name__ == "__main__":
    unittest.main()
