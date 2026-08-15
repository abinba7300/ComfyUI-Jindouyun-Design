import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from workflow_backup import (
    MAX_BACKUPS,
    _backup_files,
    _create_backup,
    _delete_backup,
    _normalize_workflow_path,
    _read_metadata,
    _update_backup_metadata,
)


class WorkflowBackupTests(unittest.TestCase):
    def test_backup_limit_is_twenty(self):
        self.assertEqual(MAX_BACKUPS, 20)

    def test_normalize_workflow_path_accepts_userdata_workflow_paths(self):
        self.assertEqual(
            _normalize_workflow_path("workflows/folder/test.json"),
            "folder/test.json",
        )
        self.assertEqual(
            _normalize_workflow_path(r"folder\test.app.json"),
            "folder/test.app.json",
        )

    def test_normalize_workflow_path_rejects_unsafe_values(self):
        for value in ("", "../test.json", "folder/../../test.json", "test.png"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                _normalize_workflow_path(value)

    def test_create_backup_keeps_only_configured_versions(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "workflows" / "demo.json"
            source.parent.mkdir(parents=True)

            for index in range(MAX_BACKUPS + 3):
                source.write_text(json.dumps({"version": index}), encoding="utf-8")
                backup = _create_backup(root, "demo.json")
                self.assertIsNotNone(backup)

            container = root / ".jindouyun-workflow-backups"
            backup_root = next(path for path in container.iterdir() if path.is_dir())
            backups = _backup_files(backup_root)
            self.assertEqual(len(backups), MAX_BACKUPS)
            self.assertEqual(
                json.loads(backups[0].read_text(encoding="utf-8"))["version"],
                MAX_BACKUPS + 2,
            )

    def test_create_backup_returns_none_before_first_save(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(_create_backup(Path(directory), "new-workflow.json"))

    def test_create_named_backup_stores_name_and_note(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "workflows" / "demo.json"
            source.parent.mkdir(parents=True)
            source.write_text('{"version": 1}', encoding="utf-8")

            backup = _create_backup(
                root,
                "demo.json",
                reason="named",
                name="产品布局完成",
                note="调整了产品位置",
            )

            metadata = _read_metadata(backup)
            self.assertEqual(metadata["name"], "产品布局完成")
            self.assertEqual(metadata["note"], "调整了产品位置")
            self.assertEqual(metadata["reason"], "named")

    def test_invalid_named_backup_does_not_leave_partial_snapshot(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "workflows" / "demo.json"
            source.parent.mkdir(parents=True)
            source.write_text('{"version": 1}', encoding="utf-8")

            with self.assertRaises(ValueError):
                _create_backup(root, "demo.json", name="超" * 81)

            container = root / ".jindouyun-workflow-backups"
            self.assertFalse(container.exists())

    def test_update_backup_metadata_does_not_rename_json_file(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "workflows" / "demo.json"
            source.parent.mkdir(parents=True)
            source.write_text('{"version": 1}', encoding="utf-8")
            backup = _create_backup(root, "demo.json")
            original_name = backup.name

            metadata = _update_backup_metadata(
                root,
                "demo.json",
                backup.name,
                "定稿版本",
                "客户已确认",
            )

            self.assertEqual(backup.name, original_name)
            self.assertTrue(backup.is_file())
            self.assertEqual(metadata["name"], "定稿版本")
            self.assertEqual(metadata["note"], "客户已确认")

    def test_update_backup_metadata_rejects_invalid_backup_id(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                _update_backup_metadata(
                    Path(directory), "demo.json", "../bad.json", "名称", "备注"
                )

    def test_delete_backup_removes_snapshot_and_metadata(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "workflows" / "demo.json"
            source.parent.mkdir(parents=True)
            source.write_text('{"version": 1}', encoding="utf-8")
            backup = _create_backup(root, "demo.json", name="待删除版本")
            metadata = backup.with_suffix(".meta.json")

            self.assertTrue(backup.is_file())
            self.assertTrue(metadata.is_file())
            _delete_backup(root, "demo.json", backup.name)

            self.assertFalse(backup.exists())
            self.assertFalse(metadata.exists())

    def test_delete_backup_rejects_invalid_or_missing_backup(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                _delete_backup(root, "demo.json", "../bad.json")
            with self.assertRaises(FileNotFoundError):
                _delete_backup(root, "demo.json", "2026-01-01_00-00-00_000000.json")


if __name__ == "__main__":
    unittest.main()
