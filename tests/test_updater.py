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
             patch("shutil.which", return_value=None):
            res = updater.apply_update()
            self.assertEqual(res["status"], "updated")
            self.assertEqual(res["previous_commit"], "466affa")
            self.assertEqual(res["new_commit"], "9999999")
            self.assertTrue(res["restart_recommended"])


if __name__ == "__main__":
    unittest.main()
