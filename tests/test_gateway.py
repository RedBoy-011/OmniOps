import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

from omniops.server import allowed_bind_host, make_server
from test_ollama import FakeOllama
from http.server import ThreadingHTTPServer


class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ollama = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
        cls.ollama_thread = threading.Thread(target=cls.ollama.serve_forever, daemon=True)
        cls.ollama_thread.start()
        cls.key = "development-test-key-must-be-at-least-32-characters"
        cls.gateway = make_server(
            "127.0.0.1", 0, cls.key, f"http://127.0.0.1:{cls.ollama.server_port}"
        )
        cls.gateway_thread = threading.Thread(target=cls.gateway.serve_forever, daemon=True)
        cls.gateway_thread.start()
        cls.root = f"http://127.0.0.1:{cls.gateway.server_port}"
        cls.opener = build_opener(ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        for server, thread in ((cls.gateway, cls.gateway_thread), (cls.ollama, cls.ollama_thread)):
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def _request(self, path, payload=None, key=None):
        body = None if payload is None else json.dumps(payload).encode()
        headers = {} if key is None else {"Authorization": f"Bearer {key}"}
        request = Request(self.root + path, data=body, headers=headers)
        try:
            with self.opener.open(request, timeout=2) as result:
                return result.status, json.load(result)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_key_is_required_for_model_discovery(self):
        self.assertEqual(self._request("/v1/models")[0], 401)
        code, response = self._request("/v1/models", key=self.key)
        self.assertEqual(code, 200)
        self.assertEqual(response["data"][0]["id"], "ollama/test:1b")

    def test_chat_proxies_actual_ollama_reply(self):
        code, response = self._request(
            "/v1/chat/completions",
            {"model": "ollama/test:1b", "messages": [{"role": "user", "content": "سلام"}]},
            self.key,
        )
        self.assertEqual(code, 200)
        self.assertEqual(response["choices"][0]["message"]["content"], "پاسخ واقعی آزمایشی")

    def test_absent_model_and_streaming_never_claim_success(self):
        code, _ = self._request(
            "/v1/chat/completions", {"model": "ollama/not-installed", "messages": []}, self.key
        )
        self.assertEqual(code, 404)
        code, _ = self._request(
            "/v1/chat/completions", {"model": "ollama/test:1b", "messages": [], "stream": True}, self.key
        )
        self.assertEqual(code, 400)

    def test_private_lan_bind_is_explicit_and_public_or_wildcard_is_rejected(self):
        self.assertTrue(allowed_bind_host("10.88.0.1"))
        self.assertTrue(allowed_bind_host("192.168.100.10"))
        self.assertTrue(allowed_bind_host("172.20.1.4"))
        for host in ("0.0.0.0", "8.8.8.8", "172.32.0.1", "server.example.com"):
            self.assertFalse(allowed_bind_host(host))
            with self.assertRaises(ValueError):
                make_server(host, 0, self.key, "http://127.0.0.1:11434")

    def test_weak_key_rejected(self):
        with self.assertRaises(ValueError):
            make_server("0.0.0.0", 0, self.key, "http://127.0.0.1:11434")
        with self.assertRaises(ValueError):
            make_server("127.0.0.1", 0, "weak", "http://127.0.0.1:11434")

    def test_download_fallback_redirects_to_github(self):
        from urllib.request import HTTPRedirectHandler, build_opener
        class NoRedirect(HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        no_redirect_opener = build_opener(NoRedirect)
        try:
            no_redirect_opener.open(f"{self.root}/downloads/nonexistent-file.apk")
        except HTTPError as err:
            try:
                self.assertEqual(err.code, 302)
                self.assertIn("github.com/RedBoy-011/OmniOps/releases", err.headers.get("Location", ""))
            finally:
                err.close()

    def test_download_invalid_filename_returns_400(self):
        from urllib.request import build_opener
        opener = build_opener()
        for bad in ("../secret.py", "sub/dir.exe", "file;cmd"):
            try:
                opener.open(f"{self.root}/downloads/{bad}")
                self.fail(f"Expected 400 for {bad}")
            except HTTPError as err:
                try:
                    self.assertEqual(err.code, 400)
                finally:
                    err.close()

    def test_download_existing_file_served(self):
        from pathlib import Path
        repo_root = Path(__file__).resolve().parent.parent
        downloads_dir = repo_root / "downloads"
        downloads_dir.mkdir(exist_ok=True)
        test_file = downloads_dir / "test-dummy-client.exe"
        try:
            test_file.write_bytes(b"MZ-PE-DUMMY-BINARY-TEST")
            with self.opener.open(f"{self.root}/downloads/test-dummy-client.exe") as resp:
                self.assertEqual(resp.status, 200)
                self.assertEqual(resp.read(), b"MZ-PE-DUMMY-BINARY-TEST")
                self.assertIn("attachment", resp.headers.get("Content-Disposition", ""))
                self.assertIsNotNone(resp.headers.get("X-Checksum-SHA256"))
                import hashlib
                self.assertEqual(resp.headers.get("X-Checksum-SHA256"), hashlib.sha256(b"MZ-PE-DUMMY-BINARY-TEST").hexdigest())
        finally:
            if test_file.exists():
                test_file.unlink()

    def test_downloads_info_endpoint(self):
        import json
        with self.opener.open(f"{self.root}/api/downloads/info") as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["status"], "ok")
            self.assertIn("version", data)
            self.assertIn("files", data)
            filenames = [f["filename"] for f in data["files"]]
            self.assertIn("OmniOps-Edge-Setup.exe", filenames)
            self.assertIn("OmniOps-Coucou-v1.0.apk", filenames)


if __name__ == "__main__":
    unittest.main()
