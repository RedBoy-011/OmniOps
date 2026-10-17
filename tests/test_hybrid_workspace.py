"""Unit tests for OmniOps Module 2.3 Hybrid Workspace Engine & Disk Quota."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from omniops.identity import IdentityError, IdentityStore
from omniops.workspace import WorkspaceStore


class TestHybridWorkspace(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_identity.db"
        self.identity = IdentityStore(self.db_path, b"secret_key_32_bytes_long_1234567")
        self.identity.bootstrap_admin("sysadmin", "AdminPassword123!", "09121111111")
        self.admin = self.identity.login("sysadmin", "AdminPassword123!")["user"]

        reg = self.identity.register("devuser", "UserPassword123!", "09122222222")
        self.identity.decide(self.admin, reg, True, ["chat", "action.request", "tool.read"])
        self.user = self.identity.login("devuser", "UserPassword123!")["user"]

        self.workspace = WorkspaceStore(self.identity)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_auto_switch_to_cloud_server_workspace(self) -> None:
        # Project without local root path should auto-provision cloud server workspace
        project = self.workspace.create_project(self.user, "Cloud Cloud App")
        self.assertEqual(project["workspace_mode"], "cloud_server")

        inspect = self.workspace.inspect_project(self.user, project["id"])
        self.assertEqual(inspect["workspace_mode"], "cloud_server")
        self.assertTrue(inspect["has_readme"])
        self.assertIn("OmniOps Cloud Workspace", inspect["readme_preview"])

    def test_local_windows_mode_when_path_exists(self) -> None:
        # Create a real local directory
        local_dir = Path(self.temp_dir.name) / "local_repo"
        local_dir.mkdir(parents=True, exist_ok=True)
        (local_dir / "app.py").write_text("print('hello windows')", encoding="utf-8")

        project = self.workspace.create_project(self.user, "Windows Repo", root_path=str(local_dir))
        self.assertEqual(project["workspace_mode"], "local_windows")

        inspect = self.workspace.inspect_project(self.user, project["id"])
        self.assertEqual(inspect["workspace_mode"], "local_windows")
        self.assertEqual(inspect["root_path"], str(local_dir.resolve()))

    def test_disk_quota_tracking_and_enforcement(self) -> None:
        # Default quota
        quota_info = self.workspace.get_user_quota(self.user)
        self.assertEqual(quota_info["max_quota_mb"], 250.0)
        self.assertGreaterEqual(quota_info["available_bytes"], 0)

        # Admin adjusts quota to 15 MB
        custom_quota = self.workspace.set_user_quota(self.admin, self.user["id"], 15 * 1024 * 1024)
        self.assertEqual(custom_quota["max_quota_mb"], 15.0)

        # Non-admin cannot set quota
        with self.assertRaises(IdentityError) as ctx:
            self.workspace.set_user_quota(self.user, self.user["id"], 50 * 1024 * 1024)
        self.assertEqual(ctx.exception.status, 403)

    def test_file_write_in_cloud_workspace(self) -> None:
        project = self.workspace.create_project(self.user, "Server Script")
        res = self.workspace.write_project_file(
            self.user,
            project["id"],
            "script.py",
            "import os\nprint('running in cloud workspace')"
        )
        self.assertEqual(res["status"], "written")
        self.assertEqual(res["workspace_mode"], "cloud_server")

        # Verify read back
        read_res = self.workspace.read_project_file(self.user, project["id"], "script.py")
        self.assertIn("running in cloud workspace", read_res["content"])


if __name__ == "__main__":
    unittest.main()
