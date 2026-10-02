"""Test-e negahdari-e kelidha va database-e modir dar update."""

import os
import sqlite3
from contextlib import closing
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.upgrade_config import prepare, parse_environment_file
from omniops.identity import IdentityError, IdentityStore


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

    def test_existing_config_changes_only_bind_and_preserves_keys_and_database(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repo = root / "repo"
            repo.mkdir()
            database = repo / "identity.db"
            with closing(sqlite3.connect(database)) as db:
                db.execute("CREATE TABLE admins (name TEXT)")
                db.execute("INSERT INTO admins VALUES ('existing-admin')")
                db.commit()
            config = root / "master.env"
            config.write_text(f'OMNIOPS_API_KEY={"a" * 40}\nOMNIOPS_SIGNING_KEY={"b" * 48}\nOMNIOPS_DB_PATH="{database}"\n', encoding="utf-8")
            os.chmod(config, 0o600)
            proc = root / "proc"
            proc.mkdir()
            with patch.dict(os.environ, {"OMNIOPS_BIND_HOST": "172.19.30.10"}):
                prepare(repo, config, root / "backups", proc)
            values = parse_environment_file(config)
            self.assertEqual(values["OMNIOPS_BIND_HOST"], "172.19.30.10")
            self.assertEqual(values["OMNIOPS_SIGNING_KEY"], "b" * 48)
            self.assertEqual(values["OMNIOPS_DB_PATH"], str(database))
            self.assertEqual(len(list((root / "backups").glob("master-env-*.bak"))), 1)
            with closing(sqlite3.connect(database)) as db:
                self.assertEqual(db.execute("SELECT name FROM admins").fetchone()[0], "existing-admin")
            with patch.dict(os.environ, {"OMNIOPS_BIND_HOST": "0.0.0.0"}):
                with self.assertRaisesRegex(RuntimeError, "OMNIOPS_BIND_HOST"):
                    prepare(repo, config, root / "backups", proc)
            self.assertEqual(parse_environment_file(config)["OMNIOPS_BIND_HOST"], "172.19.30.10")

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

    def test_lost_keys_rotate_only_after_backup_and_preserve_existing_admin(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repo = root / "repo"
            repo.mkdir()
            (repo / "data").mkdir()
            database = repo / "data" / "identity.db"
            original = IdentityStore(database, b"old-key-" * 6)
            original.bootstrap_admin("root-admin", "my secure password 123", "09123456789")
            old_session = original.login("root-admin", "my secure password 123")["token"]
            config = root / "settings" / "master.env"
            proc = root / "proc"
            proc.mkdir()
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(prepare(repo, config, root / "backups", proc), (0, 9000))
            credentials = parse_environment_file(config)
            self.assertNotEqual(credentials["OMNIOPS_SIGNING_KEY"], "old-key-" * 6)
            self.assertGreaterEqual(len(credentials["OMNIOPS_SIGNING_KEY"]), 32)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM users WHERE role='superadmin'").fetchone()[0], 1)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM sessions WHERE revoked=0").fetchone()[0], 0)
                self.assertEqual(connection.execute("SELECT event FROM audit WHERE event='signing_key_rotated_after_loss'").fetchone()[0], "signing_key_rotated_after_loss")
            new_identity = IdentityStore(database, credentials["OMNIOPS_SIGNING_KEY"].encode())
            with self.assertRaises(IdentityError):
                new_identity.authenticate(old_session)
            self.assertTrue(new_identity.login("root-admin", "my secure password 123")["token"])
            saved_key = credentials["OMNIOPS_SIGNING_KEY"]
            with patch.dict(os.environ, {}, clear=True):
                prepare(repo, config, root / "backups", proc)
            self.assertEqual(parse_environment_file(config)["OMNIOPS_SIGNING_KEY"], saved_key)
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