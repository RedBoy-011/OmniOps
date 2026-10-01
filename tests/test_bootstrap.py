import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from omniops.bootstrap import main as bootstrap_main
from omniops.identity import IdentityStore
from omniops.server import main as server_main


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "identity.db"
        self.signing_key = "k" * 48
        self.environment = patch.dict(os.environ, {
            "OMNIOPS_SIGNING_KEY": self.signing_key,
            "OMNIOPS_API_KEY": "a" * 48,
            "OMNIOPS_DB_PATH": str(self.path),
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_short_and_mismatched_passwords_are_retried_before_creation(self):
        answers = ["short", "a strong password 123", "wrong confirmation", "a strong password 123", "a strong password 123"]
        output = io.StringIO()
        with patch("builtins.input", side_effect=["correct-admin", "09123456789"]), patch(
            "omniops.bootstrap.getpass.getpass", side_effect=answers
        ) as password_prompt, redirect_stdout(output):
            bootstrap_main()
        self.assertEqual(password_prompt.call_count, 5)
        self.assertIn("Ramzha yeksan nistand", output.getvalue())
        self.assertIn("correct-admin", output.getvalue())
        self.assertTrue(IdentityStore(self.path, self.signing_key.encode()).has_active_admin())
        self.assertEqual(
            IdentityStore(self.path, self.signing_key.encode()).login("correct-admin", "a strong password 123")["user"]["username"],
            "correct-admin",
        )

    def test_server_will_not_start_without_successful_bootstrap(self):
        with self.assertRaisesRegex(SystemExit, "SuperAdmin"):
            server_main()

    def test_invalid_mobile_does_not_create_an_admin(self):
        with patch("builtins.input", side_effect=["correct-admin", "not-a-number"]), patch(
            "omniops.bootstrap.getpass.getpass", side_effect=["a strong password 123", "a strong password 123"]
        ), self.assertRaisesRegex(SystemExit, "Hesab-e SuperAdmin sakhte nashod"):
            bootstrap_main()
        self.assertFalse(IdentityStore(self.path, self.signing_key.encode()).has_active_admin())


if __name__ == "__main__":
    unittest.main()
