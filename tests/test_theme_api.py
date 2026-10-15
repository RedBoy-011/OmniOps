"""Tests for OmniOps Global Theme Palette API (Phase 2)."""

import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from urllib.request import build_opener, ProxyHandler

from omniops.identity import IdentityStore
from omniops.server import make_server

REPO_ROOT = Path(__file__).resolve().parent.parent


class ThemeApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db_path = Path(self.tmp.name) / "identity.db"
        self.store = IdentityStore(db_path, signing_key=b"test-secret-key-0123456789abcdef")
        self.admin_id = self.store.bootstrap_admin("admin", "adminpass", "+989120000000")
        self.server = make_server(
            host="127.0.0.1",
            port=0,
            api_key="testing-a-unique-gateway-key-long-enough",
            ollama_url="http://127.0.0.1:11434",
            identity_store=self.store,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        self.opener = build_opener(ProxyHandler({}))

        # Login to get admin token
        req = urllib.request.Request(
            f"{self.base_url}/api/auth/login",
            json.dumps({"username": "admin", "password": "adminpass"}).encode(),
            {"Content-Type": "application/json"}
        )
        res = self.opener.open(req)
        self.admin_token = json.loads(res.read())["token"]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def test_public_get_theme_returns_default_magenta(self):
        req = urllib.request.Request(f"{self.base_url}/api/theme")
        res = self.opener.open(req)
        self.assertEqual(res.status, 200)
        data = json.loads(res.read())
        self.assertEqual(data.get("active_palette"), "magenta")
        palettes = [p["id"] for p in data.get("available_palettes", [])]
        self.assertIn("magenta", palettes)
        self.assertIn("cyan", palettes)
        self.assertIn("emerald", palettes)
        self.assertIn("amber", palettes)
        self.assertIn("indigo", palettes)

    def test_admin_change_theme_and_propagation(self):
        # 1. Change to cyan
        req = urllib.request.Request(
            f"{self.base_url}/api/admin/theme",
            json.dumps({"palette": "cyan"}).encode(),
            {"Content-Type": "application/json", "Authorization": f"Bearer {self.admin_token}"}
        )
        res = self.opener.open(req)
        self.assertEqual(res.status, 200)
        data = json.loads(res.read())
        self.assertEqual(data.get("active_palette"), "cyan")

        # 2. Public GET should now reflect cyan
        req2 = urllib.request.Request(f"{self.base_url}/api/theme")
        res2 = self.opener.open(req2)
        data2 = json.loads(res2.read())
        self.assertEqual(data2.get("active_palette"), "cyan")

    def test_unauthenticated_or_invalid_theme_rejected(self):
        # 1. Unauthenticated change
        req = urllib.request.Request(
            f"{self.base_url}/api/admin/theme",
            json.dumps({"palette": "emerald"}).encode(),
            {"Content-Type": "application/json"}
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.opener.open(req)
        self.assertEqual(ctx.exception.code, 401)

        # 2. Invalid palette name
        req_bad = urllib.request.Request(
            f"{self.base_url}/api/admin/theme",
            json.dumps({"palette": "non_existent_palette"}).encode(),
            {"Content-Type": "application/json", "Authorization": f"Bearer {self.admin_token}"}
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx2:
            self.opener.open(req_bad)
        self.assertEqual(ctx2.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
