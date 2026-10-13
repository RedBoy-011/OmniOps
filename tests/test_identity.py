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

    def test_list_users_and_update_user_access(self):
        admin = self._admin()
        # Register a member
        uid = self.store.register("new_member", "member password 1234", "09128888888")
        self.store.decide(admin, uid, True, ["chat"])

        # List users
        users = self.store.list_users(admin)
        self.assertGreaterEqual(len(users), 2)
        member_obj = next(u for u in users if u["id"] == uid)
        self.assertEqual(member_obj["username"], "new_member")
        self.assertEqual(member_obj["role"], "member")
        self.assertEqual(member_obj["status"], "active")

        # Promote to superadmin and change capabilities
        updated = self.store.update_user_access(
            admin, uid, role="superadmin", capabilities=["chat", "agent.pair", "user.approve"]
        )
        self.assertEqual(updated["role"], "superadmin")
        self.assertIn("user.approve", updated["capabilities"])

        # Prevent demoting the ONLY other active superadmin if admin is demoted
        # Currently we have 2 superadmins (admin and uid), so demoting uid back to member should succeed
        demoted = self.store.update_user_access(admin, uid, role="member", status="active")
        self.assertEqual(demoted["role"], "member")

        # Now only 1 superadmin remains (admin). Attempting to demote admin must fail!
        with self.assertRaises(IdentityError) as err:
            self.store.update_user_access(admin, self.admin_id, role="member")
        self.assertEqual(err.exception.status, 400)

    def test_update_profile_and_change_password(self):
        admin = self._admin()
        # Update admin profile username and mobile
        updated = self.store.update_profile(admin, username="admin_renamed", mobile="09129999999")
        self.assertEqual(updated["username"], "admin_renamed")
        self.assertEqual(updated["mobile"], "+989129999999")

        # Register another user and ensure conflict check works
        uid = self.store.register("test_conflict", "conflict pass 1234", "09123333333")
        self.store.decide(admin, uid, True)

        with self.assertRaises(IdentityError) as err:
            self.store.update_profile(admin, username="test_conflict")
        self.assertEqual(err.exception.status, 409)

        with self.assertRaises(IdentityError) as err:
            self.store.update_profile(admin, mobile="09123333333")
        self.assertEqual(err.exception.status, 409)

        # Change password
        with self.assertRaises(IdentityError) as err:
            self.store.change_password(admin, "wrong current password", "a brand new strong password 1234")
        self.assertEqual(err.exception.status, 400)

        res = self.store.change_password(admin, "a sufficiently strong password", "a brand new strong password 1234")
        self.assertEqual(res["status"], "ok")

        # Login with new password
        login = self.store.login("admin_renamed", "a brand new strong password 1234")
        self.assertEqual(login["user"]["username"], "admin_renamed")

        # Old password must fail
        with self.assertRaises(IdentityError):
            self.store.login("admin_renamed", "a sufficiently strong password")

    def test_user_profile_report(self):
        admin = self._admin()
        report = self.store.user_profile_report(admin)
        self.assertEqual(report["user"]["id"], self.admin_id)
        self.assertIn("stats", report)
        self.assertIn("total_sessions", report["stats"])
        self.assertIn("total_messages", report["stats"])
        self.assertIn("active_web_sessions", report["stats"])
        self.assertGreaterEqual(report["stats"]["active_web_sessions"], 1)

    def test_list_audit_requires_superadmin_and_filters(self):
        admin = self._admin()
        # Admin can view audit logs
        logs = self.store.list_audit(admin)
        self.assertIsInstance(logs, list)
        self.assertGreaterEqual(len(logs), 1)

        # Register and approve a member
        member_id = self.store.register("test_auditee", "a strong password 1234", "09124444444")
        self.store.decide(admin, member_id, True)
        member_login = self.store.login("test_auditee", "a strong password 1234")
        member_principal = self.store.authenticate(member_login["token"])

        # Member is forbidden from accessing audit logs
        with self.assertRaises(IdentityError) as err:
            self.store.list_audit(member_principal)
        self.assertEqual(err.exception.status, 403)

        # Filtering by event works
        login_logs = self.store.list_audit(admin, event="login")
        self.assertGreaterEqual(len(login_logs), 1)
        self.assertTrue(all(item["event"] == "login" for item in login_logs))

    def test_chat_quota_enforcement_and_reset(self):
        admin = self._admin()
        # Admin has unlimited quota
        admin_quota = self.store.check_and_increment_chat_quota(admin)
        self.assertTrue(admin_quota["unlimited"])

        # Register and approve a member
        member_id = self.store.register("quota_tester", "strong password 1234", "09125555555")
        self.store.decide(admin, member_id, True)
        member_login = self.store.login("quota_tester", "strong password 1234")
        member_principal = self.store.authenticate(member_login["token"])

        # Initial quota
        initial = self.store.get_user_chat_quota(member_id, "member")
        self.assertEqual(initial["used"], 0)
        self.assertEqual(initial["limit"], 60)
        self.assertEqual(initial["remaining"], 60)

        # Increment up to 60
        for i in range(60):
            res = self.store.check_and_increment_chat_quota(member_principal)
            self.assertEqual(res["used"], i + 1)

        # 61st request should be blocked with 429
        with self.assertRaises(IdentityError) as err:
            self.store.check_and_increment_chat_quota(member_principal)
        self.assertEqual(err.exception.status, 429)

        # Non-admin cannot reset quota
        with self.assertRaises(IdentityError) as err:
            self.store.reset_user_chat_quota(member_principal, member_id)
        self.assertEqual(err.exception.status, 403)

        # Admin resets quota
        reset_res = self.store.reset_user_chat_quota(admin, member_id)
        self.assertEqual(reset_res["status"], "ok")

        # After reset, member can make requests again
        res_after = self.store.check_and_increment_chat_quota(member_principal)
        self.assertEqual(res_after["used"], 1)

        # Check list_users and user_profile_report contain quota
        users = self.store.list_users(admin)
        tester_user = next(u for u in users if u["id"] == member_id)
        self.assertIn("chat_quota", tester_user)
        self.assertEqual(tester_user["chat_quota"]["used"], 1)

        report = self.store.user_profile_report(member_principal)
        self.assertIn("chat_quota", report)
        self.assertEqual(report["chat_quota"]["used"], 1)


if __name__ == "__main__":
    unittest.main()


