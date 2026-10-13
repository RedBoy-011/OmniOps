import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from omniops.identity import IdentityError, IdentityStore


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = [1_800_000_000]
        self.store = IdentityStore(Path(self.temp.name) / "identity.db", b"k" * 32, lambda: self.now[0])
        self.admin_id = self.store.bootstrap_admin("admin", "a sufficiently strong password", "09123456789")

    def _admin(self):
        token = self.store.login("admin", "a sufficiently strong password")["token"]
        return self.store.authenticate(token)

    def test_pending_registration_is_never_a_login(self):
        self.store.register("operator", "another strong password", "۰۹۱۲۳۴۵۶۷۸۸")
        with self.assertRaises(IdentityError) as error:
            self.store.login("operator", "another strong password")
        self.assertEqual(error.exception.status, 403)
        admin_login = self.store.login("admin", "a sufficiently strong password")
        self.assertEqual(admin_login["pending_count"], 1)
        admin = self.store.authenticate(admin_login["token"])
        requests = self.store.pending(admin)
        self.assertEqual(requests[0]["mobile"], "+989123456788")
        self.store.decide(admin, requests[0]["id"], True, ["chat", "agent.pair"])
        member = self.store.login("operator", "another strong password")
        self.assertEqual(member["user"]["capabilities"], ["agent.pair", "chat"])

    def test_only_admin_approves_and_cannot_bootstrap_again(self):
        with self.assertRaises(IdentityError):
            self.store.bootstrap_admin("other", "another strong password", "09121111111")
        self.store.register("member", "another strong password", "09121111111")
        admin = self._admin()
        pending = self.store.pending(admin)
        self.store.decide(admin, pending[0]["id"], False)
        with self.assertRaises(IdentityError):
            self.store.login("member", "another strong password")

    def test_pair_is_one_use_short_lived_and_not_stored_plaintext(self):
        admin = self._admin()
        pairing = self.store.create_pairing(admin)
        self.assertRegex(pairing["code"], r"^\d{6}$")
        with closing(sqlite3.connect(self.store.path)) as db:
            self.assertNotIn(pairing["code"], repr(db.execute("SELECT * FROM pairings").fetchall()))
        result = self.store.redeem_pairing(pairing["code"], "pc-01", "127.0.0.1")
        self.assertNotIn("token", result["profile"])
        self.assertEqual(self.store.authenticate(result["token"], "agent")["device_id"], "pc-01")
        with self.assertRaises(IdentityError):
            self.store.redeem_pairing(pairing["code"], "pc-02", "127.0.0.1")
        self.store.revoke(self.store.authenticate(result["token"], "agent"))
        with self.assertRaises(IdentityError):
            self.store.authenticate(result["token"], "agent")

    def test_agent_lease_expires_without_heartbeat(self):
        code = self.store.create_pairing(self._admin())["code"]
        token = self.store.redeem_pairing(code, "pc-01", "127.0.0.1")["token"]
        self.now[0] += 45
        self.store.heartbeat(self.store.authenticate(token, "agent"))
        self.now[0] += 51
        with self.assertRaises(IdentityError):
            self.store.authenticate(token, "agent")

    def test_pair_code_expires_before_redemption(self):
        code = self.store.create_pairing(self._admin())["code"]
        self.now[0] += 121
        with self.assertRaises(IdentityError) as error:
            self.store.redeem_pairing(code, "pc-01", "127.0.0.1")
        self.assertEqual(error.exception.status, 401)

    def test_registration_limit_is_applied_per_remote_address(self):
        for number in range(5):
            self.store.register(f"user-{number}", "another strong password", f"0912111111{number}", "192.0.2.1")
        with self.assertRaises(IdentityError) as error:
            self.store.register("user-extra", "another strong password", "09121111119", "192.0.2.1")
        self.assertEqual(error.exception.status, 429)

    def test_pairing_and_login_attempt_limits_persist(self):
        for _ in range(5):
            with self.assertRaises(IdentityError):
                self.store.redeem_pairing("123456", "pc-01", "127.0.0.1")
        with self.assertRaises(IdentityError) as error:
            self.store.redeem_pairing("123456", "pc-01", "127.0.0.1")
        self.assertEqual(error.exception.status, 429)
        for _ in range(5):
            with self.assertRaises(IdentityError):
                self.store.login("admin", "wrong password")
        with self.assertRaises(IdentityError) as error:
            self.store.login("admin", "a sufficiently strong password")
        self.assertEqual(error.exception.status, 429)

    def test_reset_admin_updates_existing_admin_and_revokes_sessions(self):
        login1 = self.store.login("admin", "a sufficiently strong password")
        old_token = login1["token"]
        self.store.authenticate(old_token)

        updated_id = self.store.reset_admin("newadmin", "brand new strong password", "09129999999")
        self.assertEqual(updated_id, self.admin_id)

        # Old session must be revoked
        with self.assertRaises(IdentityError):
            self.store.authenticate(old_token)

        # Old password must fail
        with self.assertRaises(IdentityError):
            self.store.login("admin", "a sufficiently strong password")

        # New credentials succeed
        login2 = self.store.login("newadmin", "brand new strong password")
        self.assertEqual(login2["user"]["username"], "newadmin")
        self.assertEqual(login2["user"]["role"], "superadmin")
        self.assertTrue(self.store.has_active_admin())

    def test_reset_admin_creates_admin_if_none_exists(self):
        fresh_path = Path(self.temp.name) / "fresh.db"
        fresh_store = IdentityStore(fresh_path, b"k" * 32, lambda: self.now[0])
        self.assertFalse(fresh_store.has_active_admin())

        user_id = fresh_store.reset_admin("fresh_admin", "fresh password 1234", "09127777777")
        self.assertTrue(fresh_store.has_active_admin())
        login = fresh_store.login("fresh_admin", "fresh password 1234")
        self.assertEqual(login["user"]["id"], user_id)
        self.assertEqual(login["user"]["role"], "superadmin")

    def test_database_backup_and_restore_cycle(self):
        admin_principal = {"id": self.admin_id, "role": "superadmin"}
        member_principal = {"id": "member-id", "role": "member"}

        # Members cannot create backups
        with self.assertRaises(IdentityError) as err:
            self.store.create_backup(member_principal)
        self.assertEqual(err.exception.status, 403)

        # Superadmin can create backup
        backup_res = self.store.create_backup(admin_principal)
        self.assertEqual(backup_res["status"], "created")
        self.assertTrue(backup_res["filename"].startswith("identity-"))
        self.assertGreater(backup_res["size_bytes"], 0)

        # List backups
        backups = self.store.list_backups(admin_principal)
        self.assertGreaterEqual(len(backups), 1)
        self.assertEqual(backups[0]["filename"], backup_res["filename"])

        # Path validation and traversal prevention
        target_path = self.store.get_backup_path(admin_principal, backup_res["filename"])
        self.assertTrue(target_path.is_file())

        with self.assertRaises(IdentityError):
            self.store.get_backup_path(admin_principal, "../malicious.db")
        with self.assertRaises(IdentityError):
            self.store.get_backup_path(admin_principal, "identity-nonexistent.db")


if __name__ == "__main__":
    unittest.main()

