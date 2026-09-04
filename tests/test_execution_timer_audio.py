import unittest
from pathlib import Path


class ExecutionTimerAudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1]
        cls.source = (cls.root / "__init__.py").read_text(encoding="utf-8")

    def test_sound_is_served_by_an_inline_backend_route(self):
        self.assertIn("async def execution_timer_sound(request):", self.source)
        self.assertIn(
            'routes.get("/jindouyun_design/execution_timer_sound")',
            self.source,
        )
        self.assertIn('"Content-Type": "audio/mpeg"', self.source)
        self.assertIn('"Content-Disposition": "inline"', self.source)

    def test_sound_asset_is_outside_frontend_extension_directory(self):
        sound = self.root / "assets" / "toaster-oven-ding-sethlind-cc0.mp3"
        self.assertTrue(sound.is_file())
        self.assertGreater(sound.stat().st_size, 20_000)
        self.assertFalse(
            (self.root / "js" / "assets" / sound.name).exists(),
            "MP3 files in WEB_DIRECTORY can be treated as browser downloads",
        )


if __name__ == "__main__":
    unittest.main()
