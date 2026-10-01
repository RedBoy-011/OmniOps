import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener
from http.server import ThreadingHTTPServer

from omniops.identity import IdentityStore
from omniops.server import make_server
from test_ollama import FakeOllama


class IdentityGatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.store = IdentityStore(Path(cls.temp.name) / "identity.db", b"z" * 32)
        cls.store.bootstrap_admin("root-admin", "a very strong admin password", "09123456789")
        web_dist = Path(cls.temp.name) / "web"
        web_dist.mkdir()
        (web_dist / "index.html").write_text("<!doctype html><html lang='fa'>OmniOps</html>", encoding="utf-8")
        cls.ollama = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
        cls.ollama_thread = threading.Thread(target=cls.ollama.serve_forever, daemon=True)
        cls.ollama_thread.start()
        cls.server = make_server("127.0.0.1", 0, "testing-a-unique-gateway-key-long-enough", f"http://127.0.0.1:{cls.ollama.server_port}", cls.store, web_dist)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.root = f"http://127.0.0.1:{cls.server.server_port}"
        cls.opener = build_opener(ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.ollama.shutdown()
        cls.ollama.server_close()
        cls.ollama_thread.join(timeout=2)
        cls.temp.cleanup()

    def call(self, method, path, payload=None, token=None):
        data = None if payload is None else json.dumps(payload).encode()
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = Request(self.root + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=2) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_full_registration_approval_and_agent_pairing(self):
        code, signup = self.call("POST", "/api/auth/register", {
            "username": "new-operator", "password": "operator password 123!", "mobile": "09129999999",
        })
        self.assertEqual((code, signup["status"]), (202, "pending"))
        self.assertEqual(self.call("POST", "/api/auth/login", {
            "username": "new-operator", "password": "operator password 123!",
        })[0], 403)
        code, admin_login = self.call("POST", "/api/auth/login", {
            "username": "root-admin", "password": "a very strong admin password",
        })
        self.assertEqual(code, 200)
        self.assertGreaterEqual(admin_login["pending_count"], 1)
        admin_token = admin_login["token"]
        code, pending = self.call("GET", "/api/admin/pending", token=admin_token)
        self.assertEqual(code, 200)
        selected = next(u for u in pending["users"] if u["username"] == "new-operator")
        code, approved = self.call("POST", f"/api/admin/pending/{selected['id']}/approve", {
            "capabilities": ["chat", "agent.pair"],
        }, admin_token)
        self.assertEqual((code, approved["status"]), (200, "active"))
        code, member_login = self.call("POST", "/api/auth/login", {
            "username": "new-operator", "password": "operator password 123!",
        })
        self.assertEqual(code, 200)
        member_token = member_login["token"]
        self.assertEqual(self.call("GET", "/api/admin/pending", token=member_token)[0], 403)
        code, pairing = self.call("POST", "/api/agent/pairing", {}, member_token)
        self.assertEqual(code, 201)
        code, paired = self.call("POST", "/api/agent/redeem", {
            "code": pairing["code"], "device_id": "my-pc-01",
        })
        self.assertEqual(code, 200)
        agent_token = paired["token"]
        self.assertEqual(self.call("GET", "/api/agent/models", token=member_token)[0], 401)
        code, model_list = self.call("GET", "/api/agent/models", token=agent_token)
        self.assertEqual(code, 200)
        self.assertIn("ollama/", model_list["models"][0])
        code, chat = self.call("POST", "/api/agent/chat", {"message": "سلام"}, agent_token)
        self.assertEqual(code, 200)
        self.assertEqual(chat["reply"], "پاسخ واقعی آزمایشی")
        self.assertEqual(self.call("POST", "/api/agent/chat", {"message": "سلام", "model": model_list["models"][0]}, agent_token)[0], 200)
        self.assertEqual(self.call("POST", "/api/agent/chat", {"message": "سلام", "model": "ollama/not-installed"}, agent_token)[0], 404)
        self.assertEqual(self.call("POST", "/api/agent/heartbeat", {}, agent_token)[0], 200)
        self.assertEqual(self.call("POST", "/api/agent/logout", {}, agent_token)[0], 200)
        self.assertEqual(self.call("POST", "/api/agent/chat", {"message": "سلام"}, agent_token)[0], 401)
        self.assertEqual(self.call("POST", "/api/agent/redeem", {
            "code": pairing["code"], "device_id": "another-pc",
        })[0], 401)

    def test_web_ui_is_served_same_origin(self):
        with self.opener.open(self.root + "/", timeout=2) as result:
            self.assertEqual(result.status, 200)
            self.assertIn(b"OmniOps", result.read())
            self.assertIn("'self'", result.headers["Content-Security-Policy"])


if __name__ == "__main__":
    unittest.main()
