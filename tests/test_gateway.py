import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

from omniops.server import make_server
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

    def test_non_loopback_server_and_weak_key_rejected(self):
        with self.assertRaises(ValueError):
            make_server("0.0.0.0", 0, self.key, "http://127.0.0.1:11434")
        with self.assertRaises(ValueError):
            make_server("127.0.0.1", 0, "weak", "http://127.0.0.1:11434")


if __name__ == "__main__":
    unittest.main()
