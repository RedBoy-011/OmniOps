import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from omniops.ollama import OllamaClient, OllamaError


class FakeOllama(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _reply(self, data):
        encoded = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/api/tags":
            self._reply({"models": [{"name": "test:1b", "size": 123}]})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/api/chat":
            self.send_error(404)
            return
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.last_request = payload
        self._reply({"message": {"role": "assistant", "content": "پاسخ واقعی آزمایشی"}})


class OllamaAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.client = OllamaClient(f"http://127.0.0.1:{cls.server.server_port}")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_discovers_models_from_http_response(self):
        self.assertEqual(self.client.list_models()[0].name, "test:1b")

    def test_sends_nostream_chat_and_returns_actual_response(self):
        content = self.client.chat("test:1b", [{"role": "user", "content": "سلام"}])
        self.assertEqual(content, "پاسخ واقعی آزمایشی")
        self.assertFalse(self.server.last_request["stream"])

    def test_failure_is_reported_instead_of_fabricated_answer(self):
        with self.assertRaises(OllamaError):
            self.client._json_request("/missing")

    def test_external_ollama_address_is_rejected(self):
        with self.assertRaises(ValueError):
            OllamaClient("https://example.com")


if __name__ == "__main__":
    unittest.main()
