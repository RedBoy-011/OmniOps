import json
import time
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
            models = [{"name": "test:1b", "size": 123}]
            if getattr(self.server, 'include_embedding', False):
                models.insert(0, {"name": "embed:latest", "size": 33})
            if getattr(self.server, 'include_second_chat', False):
                models.append({"name": "backup:latest", "size": 999})
            self._reply({"models": models})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path not in ('/api/chat', '/api/show'):
            self.send_error(404)
            return
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == '/api/show':
            self._reply({'capabilities': ['embedding'] if payload['model'].startswith('embed:') else ['completion']})
            return
        self.server.last_request = payload
        if getattr(self.server, 'fail_first_chat', False) and payload['model'] == 'test:1b':
            self.send_error(503)
            return
        self._reply({"message": {"role": "assistant", "content": "پاسخ واقعی آزمایشی"}})


class SlowColdOllama(FakeOllama):
    def do_POST(self):
        time.sleep(0.08)
        super().do_POST()


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

    def test_embedding_model_is_excluded_from_chat_choices(self):
        self.server.include_embedding = True
        try:
            self.assertEqual([model.name for model in self.client.list_chat_models()], ['test:1b'])
            self.assertEqual(len(self.client.list_models()), 2)
        finally:
            self.server.include_embedding = False

    def test_sends_nostream_chat_and_returns_actual_response(self):
        content = self.client.chat("test:1b", [{"role": "user", "content": "سلام"}])
        self.assertEqual(content, "پاسخ واقعی آزمایشی")
        self.assertFalse(self.server.last_request["stream"])

    def test_chat_has_a_longer_deadline_than_health_checks(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), SlowColdOllama)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = OllamaClient(f"http://127.0.0.1:{server.server_port}", timeout_seconds=0.02,
                                  chat_timeout_seconds=2)
            self.assertEqual(client.chat("test:1b", [{"role": "user", "content": "سلام"}]), "پاسخ واقعی آزمایشی")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_failure_is_reported_instead_of_fabricated_answer(self):
        with self.assertRaises(OllamaError):
            self.client._json_request("/missing")

    def test_external_ollama_address_is_rejected(self):
        with self.assertRaises(ValueError):
            OllamaClient("https://example.com")


if __name__ == "__main__":
    unittest.main()
