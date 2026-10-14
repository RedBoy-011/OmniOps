import base64
import json
import tempfile
import threading
import unittest
from unittest.mock import patch
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

    def test_project_files_preview_endpoints(self):
        admin = self.store.login("root-admin", "a very strong admin password")["token"]
        code, files_res = self.call("GET", "/api/web/project/files", token=admin)
        self.assertEqual(code, 200)
        self.assertTrue(any(f["path"] == "README.md" for f in files_res["files"]))

        code, file_res = self.call("GET", "/api/web/project/file?path=README.md", token=admin)
        self.assertEqual(code, 200)
        self.assertEqual(file_res["path"], "README.md")
        self.assertTrue(len(file_res["content"]) > 0)
        self.assertEqual(file_res["type"], "markdown")


    def test_system_metrics_endpoint(self):
        self.assertEqual(self.call("GET", "/api/admin/system/metrics")[0], 401)
        self.store.register("operator-metrics", "operator password 123!", "09127777777", "127.0.0.1")
        principal = self.store.authenticate(self.admin, "web")
        pending_id = [u["id"] for u in self.store.pending(principal) if u["username"] == "operator-metrics"][0]
        self.store.decide(principal, pending_id, True, ["chat"])
        member = self.call("POST", "/api/auth/login", {"username": "operator-metrics", "password": "operator password 123!"})[1]["token"]
        self.assertEqual(self.call("GET", "/api/admin/system/metrics", token=member)[0], 403)

        code, metrics = self.call("GET", "/api/admin/system/metrics", token=self.admin)
        self.assertEqual(code, 200)
        self.assertIn("cpu", metrics)
        self.assertIn("ram", metrics)
        self.assertIn("disk", metrics)
        self.assertIn("gpu", metrics)
        self.assertIn("runtime", metrics)
        self.assertGreaterEqual(metrics["cpu"]["cores"], 1)

        code, ops = self.call("GET", "/api/admin/operations", token=self.admin)
        self.assertEqual(code, 200)
        self.assertIn("hardware", ops)

    def test_chat_sessions_endpoints(self):
        admin = self.store.login("root-admin", "a very strong admin password")["token"]
        code, sess_res = self.call("POST", "/api/chat/sessions", {"title": "تست چند نشستی"}, token=admin)
        self.assertEqual(code, 201)
        sess_id = sess_res["session"]["id"]
        self.assertEqual(sess_res["session"]["title"], "تست چند نشستی")

        code, list_res = self.call("GET", "/api/chat/sessions", token=admin)
        self.assertEqual(code, 200)
        self.assertTrue(any(s["id"] == sess_id for s in list_res["sessions"]))

        code, chat_res = self.call("POST", "/api/web/chat", {"message": "پیام ۱", "save_history": True, "session_id": sess_id}, token=admin)
        self.assertEqual(code, 200)

        code, hist_res = self.call("GET", f"/api/chat/history?session_id={sess_id}", token=admin)
        self.assertEqual(code, 200)
        self.assertTrue(any(h["prompt"] == "پیام ۱" for h in hist_res["entries"]))

        code, rename_res = self.call("POST", "/api/chat/sessions/rename", {"id": sess_id, "title": "عنوان جدید"}, token=admin)
        self.assertEqual(code, 200)
        self.assertEqual(rename_res["title"], "عنوان جدید")

        code, del_res = self.call("POST", "/api/chat/sessions/delete", {"id": sess_id}, token=admin)
        self.assertEqual(code, 200)
        self.assertEqual(del_res["status"], "deleted")

    def test_backup_endpoints(self):
        admin = self.store.login("root-admin", "a very strong admin password")["token"]

        # Create backup via POST
        code, create_res = self.call("POST", "/api/admin/system/backups", {}, token=admin)
        self.assertEqual(code, 201)
        self.assertEqual(create_res["status"], "created")
        filename = create_res["filename"]

        # List backups via GET
        code, list_res = self.call("GET", "/api/admin/system/backups", token=admin)
        self.assertEqual(code, 200)
        self.assertTrue(any(b["filename"] == filename for b in list_res["backups"]))

        # Download backup
        req = Request(f"{self.root}/api/admin/system/backups/download?filename={filename}", headers={"Authorization": f"Bearer {admin}"})
        with self.opener.open(req, timeout=3) as res:
            self.assertEqual(res.status, 200)
            self.assertEqual(res.headers.get("Content-Type"), "application/octet-stream")
            data = res.read()
            self.assertGreater(len(data), 0)

    def test_system_update_endpoints(self):
        admin = self.store.login("root-admin", "a very strong admin password")["token"]

        # Check update status
        code, status_res = self.call("GET", "/api/admin/system/update-status", token=admin)
        self.assertEqual(code, 200)
        self.assertIn("update_available", status_res)
        self.assertIn("current_commit", status_res)
        self.assertIn("latest_commit", status_res)

        # Apply update
        with patch("omniops.updater.apply_update", return_value={"status": "updated", "message": "ok", "previous_commit": "1111111", "new_commit": "2222222"}):
            code, update_res = self.call("POST", "/api/admin/system/update", {}, token=admin)
            self.assertEqual(code, 200)
            self.assertEqual(update_res["status"], "updated")
            self.assertEqual(update_res["new_commit"], "2222222")

    def test_user_management_and_profile_endpoints(self):
        admin = self.store.login("root-admin", "a very strong admin password")["token"]

        # List all users
        code, res = self.call("GET", "/api/admin/users", token=admin)
        self.assertEqual(code, 200)
        self.assertIn("users", res)
        self.assertGreaterEqual(len(res["users"]), 1)

        # Profile report
        code, prof_res = self.call("GET", "/api/user/profile", token=admin)
        self.assertEqual(code, 200)
        self.assertIn("user", prof_res)
        self.assertIn("stats", prof_res)
        self.assertIn("total_sessions", prof_res["stats"])

        # Update profile
        code, edit_res = self.call("POST", "/api/user/profile", {"mobile": "09129876543"}, token=admin)
        self.assertEqual(code, 200)
        self.assertEqual(edit_res["user"]["mobile"], "+989129876543")

        # Change password
        code, pass_res = self.call(
            "POST",
            "/api/user/change-password",
            {"old_password": "a very strong admin password", "new_password": "a brand new admin password 1234"},
            token=admin,
        )
        self.assertEqual(code, 200)
        self.assertEqual(pass_res["status"], "ok")

        # Restore password back
        self.store.change_password({"id": prof_res["user"]["id"]}, "a brand new admin password 1234", "a very strong admin password")

    def test_admin_node_ping_endpoint(self):
        admin = self.store.login("root-admin", "a very strong admin password")["token"]
        with patch("omniops.server.OllamaClient.ping", return_value={
            "status": "up",
            "latency_ms": 12,
            "version": "0.1.32",
            "model_count": 2,
            "base_url": "http://127.0.0.1:11434",
        }):
            code, res = self.call("GET", "/api/admin/nodes/ping", token=admin)
            self.assertEqual(code, 200)
            self.assertEqual(res["status"], "up")
            self.assertEqual(res["latency_ms"], 12)
            self.assertEqual(res["version"], "0.1.32")

        # Unauthenticated request returns 401
        code, _ = self.call("GET", "/api/admin/nodes/ping")
        self.assertEqual(code, 401)

    def test_chat_with_multi_file_knowledge_binder(self):
        admin = self.store.login("root-admin", "a very strong admin password")["token"]
        payload = {
            "message": "تحلیل مقایسه‌ای انجام بده",
            "attached_files": [
                {"name": "doc1.txt", "content": "محتوای سند اول برای تحلیل"},
                {"name": "doc2.md", "content": "محتوای سند دوم برای مقایسه"},
            ],
        }
        status, answer = self.call("POST", "/api/web/chat", payload, admin)
        self.assertEqual(status, 200)
        self.assertIn("reply", answer)
        self.assertTrue(len(answer["reply"]) > 0)

    def test_workspace_project_inspection_and_tools_endpoints(self):
        admin = self.store.login("root-admin", "a very strong admin password")["token"]
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            (tmp_path / "package.json").write_text('{"name": "demo-proj", "dependencies": {"fastify": "^4.0.0"}}', encoding="utf-8")
            (tmp_path / "README.md").write_text("# Demo Incomplete App\nNeeds completion by agent.", encoding="utf-8")
            (tmp_path / "app.js").write_text('console.log("running");', encoding="utf-8")

            # 1. Create project with root_path
            code, proj = self.call("POST", "/api/web/workspace/projects", {"name": "Demo Ingest", "root_path": str(tmp_path)}, admin)
            self.assertEqual(code, 201)
            p_id = proj["id"]

            # 2. Inspect project
            code, inspect_res = self.call("GET", f"/api/web/workspace/project/inspect?project_id={p_id}", token=admin)
            self.assertEqual(code, 200)
            self.assertEqual(inspect_res["project_type"], "nodejs")
            self.assertEqual(inspect_res["framework"], "Fastify")
            self.assertTrue(inspect_res["has_readme"])
            self.assertIn("Demo Incomplete App", inspect_res["readme_preview"])

            # 3. List files
            code, files_res = self.call("GET", f"/api/web/workspace/project/files?project_id={p_id}", token=admin)
            self.assertEqual(code, 200)
            names = [e["name"] for e in files_res["entries"]]
            self.assertIn("package.json", names)
            self.assertIn("app.js", names)

            # 4. Read file
            code, read_res = self.call("GET", f"/api/web/workspace/project/file?project_id={p_id}&path=app.js", token=admin)
            self.assertEqual(code, 200)
            self.assertIn('console.log("running");', read_res["content"])

            # 5. Write file
            code, write_res = self.call("POST", "/api/web/workspace/project/file", {
                "project_id": p_id,
                "path": "server.js",
                "content": 'console.log("new server");',
            }, token=admin)
            self.assertEqual(code, 200)
            self.assertTrue((tmp_path / "server.js").is_file())

            # 6. Execute safe command
            import sys
            code, cmd_res = self.call("POST", "/api/web/workspace/project/command", {
                "project_id": p_id,
                "command": f'"{sys.executable}" -c "print(40 + 2)"',
            }, token=admin)
            self.assertEqual(code, 200)
            self.assertEqual(cmd_res["exit_code"], 0)
            self.assertIn("42", cmd_res["stdout"])

    def test_workspace_agent_runs_api_endpoints(self):
        admin = self.store.login("root-admin", "a very strong admin password")["token"]
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            (tmp_path / "package.json").write_text('{"name": "test-agent-run", "dependencies": {"react": "19.0.0"}}', encoding="utf-8")
            (tmp_path / "TODO.md").write_text("- [ ] Task 1: Complete testing\n", encoding="utf-8")

            # Create project
            code, proj_res = self.call("POST", "/api/web/workspace/projects", {
                "name": "Integration Run Project",
                "root_path": str(tmp_path)
            }, admin)
            self.assertEqual(code, 201)
            p_id = proj_res["id"]

            # Start agent run
            code, start_res = self.call("POST", "/api/web/workspace/task/run", {
                "project_id": p_id,
                "prompt": "بررسی خودکار و تست پروژه"
            }, admin)
            self.assertEqual(code, 201)
            run = start_res["run"]
            run_id = run["id"]
            self.assertEqual(run["project_id"], p_id)
            self.assertIn(run["status"], ("in_progress", "completed"))

            # List runs
            code, list_res = self.call("GET", f"/api/web/workspace/task/runs?project_id={p_id}", None, admin)
            self.assertEqual(code, 200)
            self.assertEqual(len(list_res["runs"]), 1)

            # Get single run
            code, get_res = self.call("GET", f"/api/web/workspace/task/run?run_id={run_id}", None, admin)
            self.assertEqual(code, 200)
            self.assertEqual(get_res["run"]["id"], run_id)

            # Advance run
            code, adv_res = self.call("POST", "/api/web/workspace/task/run/advance", {
                "run_id": run_id
            }, admin)
            self.assertEqual(code, 200)
            self.assertEqual(adv_res["run"]["status"], "completed")
            self.assertTrue(len(adv_res["run"]["result_summary"]) > 0)

            # Start run with specialized role
            code, coder_start = self.call("POST", "/api/web/workspace/task/run", {
                "project_id": p_id,
                "prompt": "کدنویسی و توسعه ماژول جدید",
                "role": "coder"
            }, admin)
            self.assertEqual(code, 201)
            self.assertEqual(coder_start["run"]["role"], "coder")
            coder_run_id = coder_start["run"]["id"]

            # Propose file patch via API
            code, patch_res = self.call("POST", "/api/web/workspace/project/patch", {
                "project_id": p_id,
                "path": "package.json",
                "content": '{"name": "test-agent-run", "dependencies": {"react": "19.0.0", "lodash": "4.17.21"}}',
                "apply": True
            }, admin)
            self.assertEqual(code, 200)
            self.assertTrue(patch_res["applied"])
            self.assertGreater(patch_res["additions"], 0)
            self.assertIn("lodash", (tmp_path / "package.json").read_text(encoding="utf-8"))

            # Admin governance: list all runs
            code, all_runs_res = self.call("GET", "/api/admin/workspace/agent/runs?limit=20", None, admin)
            self.assertEqual(code, 200)
            self.assertGreaterEqual(len(all_runs_res["runs"]), 2)
            self.assertIn("owner_username", all_runs_res["runs"][0])

            # Admin emergency stop on coder run
            code, stop_res = self.call("POST", "/api/admin/workspace/agent/runs/stop", {
                "run_id": coder_run_id,
                "reason": "توقف اداری به منظور بررسی پچ"
            }, admin)
            self.assertEqual(code, 200)
            self.assertEqual(stop_res["run"]["status"], "cancelled")

            # Admin sandbox policy GET & POST
            code, policy_res = self.call("GET", "/api/admin/workspace/sandbox/policy", None, admin)
            self.assertEqual(code, 200)
            self.assertIn("policy", policy_res)
            self.assertEqual(policy_res["policy"]["max_timeout_seconds"], 30)

            code, update_pol_res = self.call("POST", "/api/admin/workspace/sandbox/policy", {
                "max_timeout_seconds": 25,
                "strict_mode": False,
                "allowed_prefixes": ["git", "npm", "python"],
                "blocked_commands": ["format", "shutdown"]
            }, admin)
            self.assertEqual(code, 200)
            self.assertEqual(update_pol_res["policy"]["max_timeout_seconds"], 25)

            # Start Swarm run via API
            code, swarm_res = self.call("POST", "/api/web/workspace/task/run", {
                "project_id": p_id,
                "prompt": "اجرای هماهنگ گروهی برای توسعه سیستم",
                "mode": "swarm"
            }, admin)
            self.assertEqual(code, 201)
            self.assertEqual(swarm_res["run"]["mode"], "swarm")
            self.assertIn("subagents", swarm_res["run"])
            self.assertEqual(len(swarm_res["run"]["subagents"]), 3)

            # Patch history listing and 1-click rollback via API
            code, patches_res = self.call("GET", f"/api/web/workspace/project/patches?project_id={p_id}", None, admin)
            self.assertEqual(code, 200)
            self.assertGreaterEqual(len(patches_res["patches"]), 1)
            applied_patch = patches_res["patches"][0]
            self.assertEqual(applied_patch["status"], "applied")
            self.assertEqual(applied_patch["path"], "package.json")

            code, rb_res = self.call("POST", "/api/web/workspace/project/patches/rollback", {
                "patch_id": applied_patch["id"]
            }, admin)
            self.assertEqual(code, 200)
            self.assertEqual(rb_res["patch"]["status"], "reverted")
            self.assertIsNotNone(rb_res["patch"]["reverted_at"])

            # Governance Webhooks API (Superadmin CRUD and test ping)
            code, wh_create = self.call("POST", "/api/admin/workspace/webhooks", {
                "name": "Integration Webhook Destination",
                "url": "http://127.0.0.1:9191/webhook-sink",
                "secret": "my-secret-token",
                "events": ["emergency_stop", "sandbox_violation", "waiting_approval"]
            }, admin)
            self.assertEqual(code, 200)
            self.assertIn("webhook", wh_create)
            wh_id = wh_create["webhook"]["id"]

            code, wh_list = self.call("GET", "/api/admin/workspace/webhooks", None, admin)
            self.assertEqual(code, 200)
            self.assertTrue(any(w["id"] == wh_id for w in wh_list["webhooks"]))

            code, test_res = self.call("POST", "/api/admin/workspace/webhooks/test", {
                "webhook_id": wh_id
            }, admin)
            self.assertEqual(code, 200)
            self.assertEqual(test_res["status"], "error")

            code, del_res = self.call("POST", "/api/admin/workspace/webhooks/delete", {
                "webhook_id": wh_id
            }, admin)
            self.assertEqual(code, 200)
            self.assertEqual(del_res["status"], "deleted")

            # Project Code Search API
            code, search_res = self.call("POST", "/api/web/workspace/project/search", {
                "project_id": p_id,
                "query": "react",
                "case_sensitive": False
            }, admin)
            self.assertEqual(code, 200)
            self.assertGreaterEqual(search_res["total_matches"], 1)
            self.assertEqual(search_res["results"][0]["path"], "package.json")

            # Command History API
            code, history_res = self.call("GET", f"/api/web/workspace/project/commands?project_id={p_id}", None, admin)
            self.assertEqual(code, 200)
            self.assertIn("commands", history_res)

            # Interactive Agent Feedback API
            # Start run for feedback test
            code, run_fb = self.call("POST", "/api/web/workspace/task/run", {
                "project_id": p_id,
                "prompt": "بررسی اولیه وابستگی‌ها"
            }, admin)
            self.assertEqual(code, 201)
            target_run_id = run_fb["run"]["id"]

            code, fb_res = self.call("POST", "/api/web/workspace/task/run/feedback", {
                "run_id": target_run_id,
                "message": "پیشنهاد تکمیلی برای بهینه‌سازی ساختار ماژول‌ها"
            }, admin)
            self.assertEqual(code, 200)
            self.assertIn("run", fb_res)
            self.assertTrue(any(l.get("type") == "user_feedback" for l in fb_res["run"]["logs"]))

            # Git Status API
            code, git_res = self.call("GET", f"/api/web/workspace/project/git/status?project_id={p_id}", None, admin)
            self.assertEqual(code, 200)
            self.assertIn("is_git_repo", git_res)

            # Artifacts API Lifecycle
            code, art_create = self.call("POST", "/api/web/workspace/project/artifacts", {
                "project_id": p_id,
                "title": "ممیزی امنیتی فریم‌ورک",
                "artifact_type": "review",
                "content": "# گزارش ممیزی امنیتی\nکلیه پکیج‌ها بررسی شدند."
            }, admin)
            self.assertEqual(code, 201)
            self.assertIn("artifact", art_create)
            art_id = art_create["artifact"]["id"]

            code, art_list = self.call("GET", f"/api/web/workspace/project/artifacts?project_id={p_id}", None, admin)
            self.assertEqual(code, 200)
            self.assertGreaterEqual(len(art_list["artifacts"]), 1)
            self.assertEqual(art_list["artifacts"][0]["title"], "ممیزی امنیتی فریم‌ورک")

            code, art_single = self.call("GET", f"/api/web/workspace/project/artifact?project_id={p_id}&artifact_id={art_id}", None, admin)
            self.assertEqual(code, 200)
            self.assertEqual(art_single["artifact"]["id"], art_id)

            code, art_del = self.call("POST", "/api/web/workspace/project/artifacts/delete", {
                "project_id": p_id,
                "artifact_id": art_id
            }, admin)
            self.assertEqual(code, 200)
            self.assertEqual(art_del["status"], "deleted")


if __name__ == "__main__":
    unittest.main()


