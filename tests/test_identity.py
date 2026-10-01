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


if __name__ == "__main__":
    unittest.main()
