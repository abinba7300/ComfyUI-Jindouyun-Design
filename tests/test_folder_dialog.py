import unittest
from pathlib import Path


class FolderDialogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (Path(__file__).resolve().parents[1] / "__init__.py").read_text(
            encoding="utf-8"
        )

    def test_folder_dialog_uses_disposable_topmost_owner(self):
        self.assertIn("$owner.TopMost = $true", self.source)
        self.assertIn("$owner.ShowInTaskbar = $false", self.source)
        self.assertIn("$owner.Activate()", self.source)
        self.assertIn("$dialog.ShowDialog($owner)", self.source)
        self.assertIn("$owner.Dispose()", self.source)

    def test_folder_dialog_brings_owner_to_foreground(self):
        self.assertIn("BringWindowToTop($owner.Handle)", self.source)
        self.assertIn("SetForegroundWindow($owner.Handle)", self.source)
        self.assertIn("FindVisibleWindowForProcess", self.source)
        self.assertIn("ForceWindowToFront($target)", self.source)
        self.assertIn("AttachThreadInput", self.source)
        self.assertIn("$focusTimer.Dispose()", self.source)
        self.assertNotIn("New-Object JindouyunWindowOwner", self.source)


if __name__ == "__main__":
    unittest.main()
