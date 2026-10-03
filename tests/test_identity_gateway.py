import base64
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
            with self.opener.open(req, timeout=12) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_opt_in_chat_history_and_profile_memory_endpoints(self):
        admin = self.store.login("root-admin", "a very strong admin password")["token"]
        self.assertEqual(self.call("GET", "/api/chat/history")[0], 401)
        self.assertEqual(self.call("GET", "/api/chat/history", token=admin), (200, {"entries": []}))
        status, answer = self.call("POST", "/api/web/chat", {"message": "hello"}, admin)
        self.assertEqual(status, 200)
        self.assertEqual(self.call("GET", "/api/chat/history", token=admin)[1]["entries"], [])
        self.assertEqual(self.call("POST", "/api/web/chat", {"message": "hello", "save_history": True}, admin)[0], 200)
        history = self.call("GET", "/api/chat/history", token=admin)[1]["entries"]
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["reply"], answer["reply"])
        status, note = self.call("POST", "/api/chat/memory/add", {"content": "prefers short answers"}, admin)
        self.assertEqual(status, 201)
        self.assertEqual(len(self.call("GET", "/api/chat/memory", token=admin)[1]["notes"]), 1)
        self.assertEqual(self.call("POST", "/api/chat/memory/remove", {"id": note["id"]}, admin)[0], 200)
        self.assertEqual(self.call("POST", "/api/chat/history/clear", {}, admin)[0], 200)
        self.assertEqual(self.call("GET", "/api/chat/history", token=admin)[1]["entries"], [])

    def test_node_identity_endpoints_reject_http_even_with_forwarded_header(self):
        token = self.store.login("root-admin", "a very strong admin password")["token"]
        self.assertEqual(self.call("POST", "/api/admin/nodes/grants", {"role": "worker"}, token)[0], 426)
        self.assertEqual(self.call("POST", "/api/nodes/enroll", {"grant": "fake"})[0], 426)
        self.assertEqual(self.call("GET", "/api/admin/nodes", token=token)[0], 426)
        req = Request(self.root + "/api/nodes/heartbeat", data=b"{}",
                      headers={"X-Forwarded-Proto": "https"}, method="POST")
        with self.assertRaises(HTTPError) as error:
            self.opener.open(req)
        self.assertEqual(error.exception.code, 426)
        error.exception.close()

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
        code, operations = self.call("GET", "/api/admin/operations", token=admin_token)
        self.assertEqual(code, 200)
        self.assertEqual(operations["master"], "up")
        self.assertEqual(operations["ollama"]["status"], "up")
        self.assertTrue(operations["ollama"]["models"])
        self.assertEqual([node["kind"] for node in operations["nodes"]], ["master", "worker"])
        self.assertEqual(operations["nodes"][1]["models"], operations["ollama"]["models"])
        self.assertIsInstance(operations["nodes"][1]["latency_ms"], int)
        code, pending = self.call("GET", "/api/admin/pending", token=admin_token)
        self.assertEqual(code, 200)
        selected = next(u for u in pending["users"] if u["username"] == "new-operator")
        code, approved = self.call("POST", f"/api/admin/pending/{selected['id']}/approve", {
            "capabilities": ["chat", "agent.pair", "action.request"],
        }, admin_token)
        self.assertEqual((code, approved["status"]), (200, "active"))
        code, member_login = self.call("POST", "/api/auth/login", {
            "username": "new-operator", "password": "operator password 123!",
        })
        self.assertEqual(code, 200)
        member_token = member_login["token"]
        self.assertEqual(self.call("GET", "/api/admin/operations", token=member_token)[0], 403)
        self.assertEqual(self.call("GET", "/api/admin/pending", token=member_token)[0], 403)
        code, pairing = self.call("POST", "/api/agent/pairing", {}, member_token)
        self.assertEqual(code, 201)
        code, paired = self.call("POST", "/api/agent/redeem", {
            "code": pairing["code"], "device_id": "my-pc-01",
        })
        self.assertEqual(code, 200)
        self.assertEqual(self.call('GET', '/api/web/models', token=member_token)[1]['models'], ['ollama/test:1b'])
        self.assertEqual(self.call('POST', '/api/web/chat', {'message': 'سلام'}, member_token)[1]['reply'], 'پاسخ واقعی آزمایشی')
        self.assertEqual(self.call('GET', '/api/web/models')[0], 401)
        agent_token = paired["token"]
        status, project = self.call("POST", "/api/web/workspace/projects", {"name": "First project"}, member_token)
        self.assertEqual(status, 201)
        self.assertEqual(self.call("GET", "/api/web/workspace/projects", token=admin_token)[1]["projects"], [])
        content = base64.b64encode('test attachment'.encode()).decode()
        status, attachment = self.call('POST', '/api/web/workspace/attachments', {
            'project_id': project['id'], 'name': 'note.txt', 'mime': 'text/plain', 'content_base64': content}, member_token)
        self.assertEqual(status, 201)
        attachment_path = '/api/web/workspace/attachments?project_id=' + project['id']
        self.assertEqual(self.call('GET', attachment_path, token=member_token)[1]['attachments'][0]['id'], attachment['id'])
        self.assertEqual(self.call('GET', attachment_path, token=admin_token)[0], 404)
        self.assertEqual(self.call('POST', '/api/web/workspace/attachments/remove', {'id': attachment['id']}, admin_token)[0], 404)
        self.assertEqual(self.call('POST', '/api/agent/workspace/attachments/remove', {'id': attachment['id']}, agent_token)[0], 200)
        self.assertEqual(self.call('GET', attachment_path, token=member_token)[1]['attachments'], [])
        self.assertEqual(self.call("GET", "/api/agent/workspace/projects", token=member_token)[0], 401)
        self.assertEqual(self.call("GET", "/api/agent/workspace/projects", token=agent_token)[1]["projects"][0]["id"], project["id"])
        status, task = self.call("POST", "/api/agent/workspace/tasks", {"project_id": project["id"], "description": "Report draft"}, agent_token)
        self.assertEqual((status, task["status"]), (201, "draft"))
        self.assertEqual(self.call("GET", "/api/web/workspace/tasks", token=admin_token)[1]["tasks"], [])
        self.assertEqual(self.call("GET", "/api/web/workspace/tasks", token=member_token)[1]["tasks"][0]["id"], task["id"])
        self.assertEqual(self.call("POST", "/api/web/workspace/tasks/cancel", {"id": task["id"]}, member_token)[0], 200)
        self.assertEqual(self.call("GET", "/api/agent/history", token=member_token)[0], 401)
        self.assertEqual(self.call("GET", "/api/chat/history", token=agent_token)[0], 401)
        self.assertEqual(self.call("POST", "/api/agent/chat", {"message": "private", "save_history": True}, agent_token)[0], 200)
        self.assertEqual(len(self.call("GET", "/api/agent/history", token=agent_token)[1]["entries"]), 1)
        self.assertEqual(len(self.call("GET", "/api/chat/history", token=member_token)[1]["entries"]), 1)
        self.assertEqual(self.call("GET", "/api/chat/history", token=admin_token)[1]["entries"], [])
        self.assertEqual(self.call("POST", "/api/agent/memory/add", {"content": "private note"}, agent_token)[0], 201)
        self.assertEqual(len(self.call("GET", "/api/chat/memory", token=member_token)[1]["notes"]), 1)
        self.assertEqual(self.call("GET", "/api/chat/memory", token=admin_token)[1]["notes"], [])
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

    def test_auto_chat_falls_back_to_another_local_chat_model(self):
        self.ollama.include_second_chat = True
        self.ollama.fail_first_chat = True
        try:
            token = self.store.login('root-admin', 'a very strong admin password')['token']
            code, result = self.call('POST', '/api/web/chat', {'message': 'سلام', 'model': 'auto'}, token)
            self.assertEqual(code, 200)
            self.assertEqual(result['model'], 'ollama/backup:latest')
            self.assertEqual(self.call('POST', '/api/web/chat', {
                'message': 'سلام', 'model': 'ollama/test:1b'}, token)[0], 503)
        finally:
            self.ollama.include_second_chat = False
            self.ollama.fail_first_chat = False

    def test_web_ui_is_served_same_origin(self):
        with self.opener.open(self.root + "/", timeout=2) as result:
            self.assertEqual(result.status, 200)
            self.assertIn(b"OmniOps", result.read())
            self.assertIn("'self'", result.headers["Content-Security-Policy"])

    def test_operations_keeps_master_available_when_ollama_is_down(self):
        server = make_server("127.0.0.1", 0, "testing-a-unique-gateway-key-long-enough", "http://127.0.0.1:1", self.store)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            code, login = self.call("POST", "/api/auth/login", {
                "username": "root-admin", "password": "a very strong admin password",
            })
            request = Request(f"http://127.0.0.1:{server.server_port}/api/admin/operations", headers={
                "Authorization": f"Bearer {login['token']}"
            })
            with self.opener.open(request, timeout=3) as response:
                operations = json.load(response)
                self.assertEqual((code, response.status, operations["master"]), (200, 200, "up"))
                self.assertEqual(operations["ollama"], {"url": "http://127.0.0.1:1", "status": "unreachable", "models": []})
                self.assertEqual([node["status"] for node in operations["nodes"]], ["up", "unreachable"])
                self.assertIsNone(operations["nodes"][1]["latency_ms"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class SecondWorker(FakeOllama):
    def do_GET(self):
        if self.path == "/api/tags":
            self._reply({"models": [{"name": "second:2b", "size": 456}]})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == '/api/show':
            self._reply({'capabilities': ['completion']})
            return
        if self.path != "/api/chat":
            self.send_error(404)
            return
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.last_request = payload
        self._reply({"message": {"role": "assistant", "content": "second worker"}})


class EmptyWorker(FakeOllama):
    def do_GET(self):
        if self.path == "/api/tags":
            self._reply({"models": []})
        else:
            self.send_error(404)


class WorkerEndpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "identity.db"
        self.store = IdentityStore(self.path, b"q" * 32)
        self.store.bootstrap_admin("root-admin", "a very strong admin password", "09123456789")
        self.first = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
        self.second = ThreadingHTTPServer(("127.0.0.1", 0), SecondWorker)
        self.workers = [threading.Thread(target=worker.serve_forever, daemon=True) for worker in (self.first, self.second)]
        for thread in self.workers:
            thread.start()
        self.first_url = f"http://127.0.0.1:{self.first.server_port}"
        self.second_url = f"http://127.0.0.1:{self.second.server_port}"
        self.server = make_server("127.0.0.1", 0, "testing-a-unique-gateway-key-long-enough", self.first_url, self.store)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.root = f"http://127.0.0.1:{self.server.server_port}"
        self.opener = build_opener(ProxyHandler({}))
        self.admin = self.call("POST", "/api/auth/login", {"username": "root-admin", "password": "a very strong admin password"})[1]["token"]

    def tearDown(self):
        for server, thread in [(self.server, self.thread), (self.first, self.workers[0]), (self.second, self.workers[1])]:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.temp.cleanup()

    call = IdentityGatewayTests.call

    def test_endpoint_requires_privilege_and_retains_previous_on_failure(self):
        self.assertEqual(self.call("POST", "/api/admin/ollama-endpoint", {"url": self.second_url})[0], 401)
        self.store.register("operator-two", "operator password 123!", "09128888888", "127.0.0.1")
        member_id = self.store.pending(self.store.authenticate(self.admin, "web"))[0]["id"]
        self.store.decide(self.store.authenticate(self.admin, "web"), member_id, True, ["chat", "agent.pair"])
        member = self.call("POST", "/api/auth/login", {"username": "operator-two", "password": "operator password 123!"})[1]["token"]
        self.assertEqual(self.call("POST", "/api/admin/ollama-endpoint", {"url": self.second_url}, member)[0], 403)
        self.assertEqual(self.call("POST", "/api/admin/ollama-endpoint", {"url": "https://example.com"}, self.admin)[0], 400)
        self.assertEqual(self.call("POST", "/api/admin/ollama-endpoint", {"url": "http://127.0.0.1:1"}, self.admin)[0], 503)
        self.assertIsNone(self.store.ollama_endpoint())
        self.assertEqual(self.call("POST", "/api/admin/ollama-endpoint", {"url": self.second_url}, self.admin)[0], 200)
        self.assertEqual(self.call("POST", "/api/admin/ollama-endpoint", {"url": "http://127.0.0.1:1"}, self.admin)[0], 503)
        self.assertEqual(IdentityStore(self.path, b"q" * 32).ollama_endpoint(), self.second_url)

    def test_running_worker_without_models_is_distinct_from_a_disconnect(self):
        empty = ThreadingHTTPServer(("127.0.0.1", 0), EmptyWorker)
        thread = threading.Thread(target=empty.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{empty.server_port}"
            self.assertEqual(self.call("POST", "/api/admin/ollama-endpoint", {"url": url}, self.admin)[0], 200)
            code, result = self.call("GET", "/api/admin/operations", token=self.admin)
            self.assertEqual(code, 200)
            self.assertEqual(result["ollama"]["status"], "no_models")
            self.assertEqual(result["nodes"][1]["models"], [])
            self.assertEqual(result["nodes"][0]["status"], "up")
        finally:
            empty.shutdown()
            empty.server_close()
            thread.join(timeout=2)

    def test_model_and_chat_switch_without_restarting_master(self):
        self.assertEqual(self.call("POST", "/api/admin/ollama-endpoint", {"url": self.second_url}, self.admin)[0], 200)
        self.assertEqual(self.call("GET", "/api/admin/operations", token=self.admin)[1]["ollama"]["url"], self.second_url)
        self.assertEqual(self.call("GET", "/v1/models", token="testing-a-unique-gateway-key-long-enough")[1]["data"][0]["id"], "ollama/second:2b")
        self.store.register("operator-two", "operator password 123!", "09128888888", "127.0.0.1")
        principal = self.store.authenticate(self.admin, "web")
        self.store.decide(principal, self.store.pending(principal)[0]["id"], True, ["chat", "agent.pair"])
        member = self.call("POST", "/api/auth/login", {"username": "operator-two", "password": "operator password 123!"})[1]["token"]
        pairing = self.call("POST", "/api/agent/pairing", {}, member)[1]["code"]
        agent = self.call("POST", "/api/agent/redeem", {"code": pairing, "device_id": "pc-02"})[1]["token"]
        self.assertEqual(self.call("GET", "/api/agent/models", token=agent)[1]["models"], ["ollama/second:2b"])
        self.assertEqual(self.call("POST", "/api/agent/chat", {"message": "hi"}, agent)[1]["reply"], "second worker")
        self.assertEqual(self.second.last_request["model"], "second:2b")
        self.assertEqual(self.call("POST", "/v1/chat/completions", {"model": "ollama/second:2b", "messages": [{"role": "user", "content": "hi"}]}, "testing-a-unique-gateway-key-long-enough")[1]["choices"][0]["message"]["content"], "second worker")


if __name__ == "__main__":
    unittest.main()
