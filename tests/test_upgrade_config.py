"""Test-e negahdari-e kelidha va database-e modir dar update."""

import os
import sqlite3
from contextlib import closing
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.upgrade_config import prepare, parse_environment_file


class UpgradeConfigTests(unittest.TestCase):
    def test_existing_database_and_keys_are_backed_up_without_regeneration(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repo = root / "repo"
            repo.mkdir()
            (repo / "data").mkdir()
            original = repo / "data" / "identity.db"
            with closing(sqlite3.connect(original)) as database:
                database.execute("CREATE TABLE admins (name TEXT)")
                database.execute("INSERT INTO admins VALUES ('existing-admin')")
                database.commit()
            config = root / "settings" / "master.env"
            backups = root / "backups"
            process_root = root / "proc"
            process_root.mkdir()
            with patch.dict(os.environ, {"OMNIOPS_API_KEY": "a" * 40, "OMNIOPS_SIGNING_KEY": "b" * 48}):
                pid, port = prepare(repo, config, backups, process_root)
            self.assertEqual((pid, port), (0, 9000))
            self.assertIn("b" * 48, config.read_text())
            self.assertEqual(Path(parse_environment_file(config)["OMNIOPS_DB_PATH"]).resolve(), original.resolve())
            saved = list(backups.glob("identity-*.db"))
            self.assertEqual(len(saved), 1)
            with closing(sqlite3.connect(saved[0])) as database:
                self.assertEqual(database.execute("SELECT name FROM admins").fetchone()[0], "existing-admin")

    def test_missing_original_database_halts_without_creating_new_one(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repo = root / "repo"
            repo.mkdir()
            proc = root / "proc"
            proc.mkdir()
            with patch.dict(os.environ, {"OMNIOPS_API_KEY": "a" * 40, "OMNIOPS_SIGNING_KEY": "b" * 48}):
                with self.assertRaisesRegex(RuntimeError, "database not found"):
                    prepare(repo, root / "master.env", root / "backups", proc)
            self.assertFalse((repo / "data" / "identity.db").exists())

    @unittest.skipIf(os.name == "nt", "Windows unprivileged symlinks are unavailable")
    def test_running_gateway_is_authoritative_even_if_shell_keys_differ(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repo = root / "repo"
            repo.mkdir()
            (repo / "data").mkdir()
            with closing(sqlite3.connect(repo / "data" / "identity.db")) as database:
                database.execute("CREATE TABLE admins (name TEXT)")
            proc = root / "proc"
            running = proc / "9876"
            running.mkdir(parents=True)
            (running / "cwd").symlink_to(repo, target_is_directory=True)
            (running / "cmdline").write_bytes(b"python3\0-m\0omniops.server\0")
            (running / "environ").write_bytes(b"OMNIOPS_API_KEY=" + b"x" * 40 + b"\0OMNIOPS_SIGNING_KEY=" + b"y" * 48 + b"\0")
            config = root / "settings" / "master.env"
            with patch.dict(os.environ, {"OMNIOPS_API_KEY": "a" * 40, "OMNIOPS_SIGNING_KEY": "b" * 48}):
                pid, port = prepare(repo, config, root / "backups", proc)
            self.assertEqual((pid, port), (9876, 9000))
            self.assertIn("y" * 48, config.read_text())
            self.assertNotIn("b" * 48, config.read_text())


if __name__ == "__main__":
    unittest.main()