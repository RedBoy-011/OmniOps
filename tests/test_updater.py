"""Azmoon-haye vahed baraye modool-e updater va barresi-e GitHub updates."""

import unittest
from unittest.mock import MagicMock, patch

from omniops import updater


class TestUpdater(unittest.TestCase):
    def test_get_current_commit(self):
        commit = updater.get_current_commit()
        self.assertIsNotNone(commit)
        self.assertIsInstance(commit, str)
        self.assertGreaterEqual(len(commit), 7)

    def test_get_remote_commit_parsing(self):
        fake_process = MagicMock()
        fake_process.returncode = 0
        fake_process.stdout = (
            "466affac16f2d62c20f774d7c4fc64270c2d474a\trefs/heads/main\n"
            "b59729c8978f2441b5a7ada10ee0623e987147cf\trefs/tags/main\n"
        )
        with patch("subprocess.run", return_value=fake_process):
            sha = updater.get_remote_commit(branch="main")
            self.assertEqual(sha, "466affac16f2d62c20f774d7c4fc64270c2d474a")

    def test_check_for_updates_no_update(self):
        with patch.object(updater, "get_current_commit", return_value="466affac16f2d62c20f774d7c4fc64270c2d474a"), \
             patch.object(updater, "get_remote_commit", return_value="466affac16f2d62c20f774d7c4fc64270c2d474a"):
            res = updater.check_for_updates(force_refresh=True)
            self.assertFalse(res["update_available"])
            self.assertEqual(res["current_commit"], "466affa")
            self.assertEqual(res["latest_commit"], "466affa")
            self.assertIsNone(res["error"])

    def test_check_for_updates_with_new_update(self):
        with patch.object(updater, "get_current_commit", return_value="466affac16f2d62c20f774d7c4fc64270c2d474a"), \
             patch.object(updater, "get_remote_commit", return_value="9999999999999999999999999999999999999999"):
            res = updater.check_for_updates(force_refresh=True)
            self.assertTrue(res["update_available"])
            self.assertEqual(res["current_commit"], "466affa")
            self.assertEqual(res["latest_commit"], "9999999")
            self.assertIsNone(res["error"])

    def test_apply_update_success(self):
        fake_fetch = MagicMock(returncode=0, stderr="")
        fake_pull = MagicMock(returncode=0, stdout="Updating 466affa..9999999\nFast-forward")
        with patch("subprocess.run", side_effect=[fake_fetch, fake_pull]), \
             patch.object(updater, "get_current_commit", side_effect=["466affa", "9999999"]), \
             patch("shutil.which", return_value=None), \
             patch.object(updater, "sync_release_assets", return_value={"synced_files": []}):
            res = updater.apply_update()
            self.assertEqual(res["status"], "updated")
            self.assertEqual(res["previous_commit"], "466affa")
            self.assertEqual(res["new_commit"], "9999999")
            self.assertTrue(res["restart_recommended"])
            self.assertTrue(res["release_assets_synced"])

    def test_compute_file_sha256_and_format_size(self):
        import tempfile
        from pathlib import Path
        with tempfile.NamedTemporaryFile("wb", delete=False) as tf:
            tf.write(b"Hello OmniOps Core!")
            tf_path = Path(tf.name)
        try:
            sha = updater.compute_file_sha256(tf_path)
            self.assertEqual(len(sha), 64)
            # SHA-256 for b"Hello OmniOps Core!"
            import hashlib
            self.assertEqual(sha, hashlib.sha256(b"Hello OmniOps Core!").hexdigest())

            self.assertEqual(updater.format_size(0), "0 B")
            self.assertEqual(updater.format_size(500), "500 B")
            self.assertEqual(updater.format_size(2048), "2.0 KB")
            self.assertEqual(updater.format_size(10485760), "10.0 MB")
        finally:
            if tf_path.is_file():
                tf_path.unlink()

    def test_get_core_downloads_info(self):
        info = updater.get_core_downloads_info()
        self.assertEqual(info["status"], "ok")
        self.assertIn("version", info)
        self.assertIsInstance(info["files"], list)
        self.assertGreaterEqual(len(info["files"]), 3)

        filenames = [f["filename"] for f in info["files"]]
        self.assertIn("OmniOps-Edge-Setup.exe", filenames)
        self.assertIn("OmniOps-Coucou-v1.0.apk", filenames)
        self.assertIn("OmniOps-Mobile.apk", filenames)

        for item in info["files"]:
            self.assertIn("direct_url", item)
            self.assertIn("fallback_url", item)
            self.assertIn("version", item)
            self.assertIn("sha256", item)
            self.assertTrue(item["direct_url"].startswith("/downloads/"))
            self.assertTrue(item["fallback_url"].startswith("https://github.com/"))

    def test_sync_release_assets(self):
        import tempfile
        import shutil
        from pathlib import Path
        temp_dir = Path(tempfile.mkdtemp())
        try:
            downloads_dir = temp_dir / "downloads"
            downloads_dir.mkdir(parents=True)
            # Create a mock agent-setup file
            mock_exe = downloads_dir / "omniops-agent-setup.exe"
            mock_exe.write_bytes(b"MZ-mock-binary")

            res = updater.sync_release_assets(repo_root=temp_dir)
            self.assertEqual(res["status"], "ok")
            # Should have copied omniops-agent-setup.exe to OmniOps-Edge-Setup.exe
            edge_file = downloads_dir / "OmniOps-Edge-Setup.exe"
            self.assertTrue(edge_file.is_file())
            self.assertEqual(edge_file.read_bytes(), b"MZ-mock-binary")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
