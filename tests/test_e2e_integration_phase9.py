# tests/test_e2e_integration_phase9.py
# Comprehensive Phase 9 End-to-End Integration Test Suite:
# 1. Global Theme Token Synchronization across Web, Windows Edge, and Android.
# 2. Windows Agent Pairing, Liveness State Tracking (available / busy / inactive).
# 3. Android Mobile Guard (rejection of commands and steering when offline).
# 4. End-to-end Mobile Project Continuation and Steering (continue, pause, guidance, stop).

import json
import os
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from omniops.identity import IdentityStore
from omniops.server import make_server
from omniops.workspace import WorkspaceStore


class FakeOllamaHandler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/api/tags":
            self._send(200, {"models": [{"name": "qwen2.5:7b-instruct"}]})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        self._send(200, {"message": {"content": "ok"}})

    def log_message(self, *args):
        pass


class Phase9EndToEndIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.root_path = Path(cls.temp_dir.name)
        cls.db_path = cls.root_path / "identity.db"
        cls.store = IdentityStore(cls.db_path, signing_key=b"test-secret-key-0123456789abcdef")
        cls.store.bootstrap_admin("admin", "admin-super-password-2026", "+989120000000")

        cls.web_dist = cls.root_path / "web_dist"
        cls.web_dist.mkdir()
        (cls.web_dist / "index.html").write_text("<!doctype html><html>OmniOps Web</html>", encoding="utf-8")

        # Fake Ollama Mock Server
        cls.ollama_server = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllamaHandler)
        cls.ollama_thread = threading.Thread(target=cls.ollama_server.serve_forever, daemon=True)
        cls.ollama_thread.start()

        # OmniOps Master Gateway
        cls.master_server = make_server(
            "127.0.0.1",
            0,
            "omniops-master-gateway-secret-token-32chars",
            f"http://127.0.0.1:{cls.ollama_server.server_port}",
            cls.store,
            cls.web_dist,
        )
        cls.master_thread = threading.Thread(target=cls.master_server.serve_forever, daemon=True)
        cls.master_thread.start()
        cls.master_url = f"http://127.0.0.1:{cls.master_server.server_port}"
        cls.opener = build_opener(ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.master_server.shutdown()
        cls.master_server.server_close()
        cls.master_thread.join(timeout=2)
        cls.ollama_server.shutdown()
        cls.ollama_server.server_close()
        cls.ollama_thread.join(timeout=2)
        cls.temp_dir.cleanup()

    def _call(self, method, path, payload=None, token=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = Request(self.master_url + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=10) as resp:
                return resp.status, json.load(resp)
        except HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_e2e_full_system_lifecycle_theme_agent_and_mobile_continuation(self):
        """End-to-end integration test validating the entire 10-phase architecture:
        1. Login & Theme Synchronization across all clients.
        2. Offline Agent Guard preventing unauthorized/disconnected actions.
        3. Temporary 6-digit PIN pairing of Windows Edge Agent.
        4. Dynamic 3-state detection (available / busy / inactive).
        5. Mobile dispatch, biometric gate approval, execution and audit logging.
        6. Workspace project creation and real-time mobile process steering (continue, pause, stop).
        """
        # =====================================================================
        # Step 1: Admin Login & Global Theme Synchronization
        # =====================================================================
        status, login_res = self._call("POST", "/api/auth/login", {"username": "admin", "password": "admin-super-password-2026"})
        self.assertEqual(status, 200)
        admin_token = login_res["token"]

        # Default theme check (Magenta Velvet default token)
        status, theme_res = self._call("GET", "/api/theme")
        self.assertEqual(status, 200)
        self.assertIn("palette", theme_res)
        self.assertEqual(theme_res["palette"], "magenta")

        # Admin switches palette to Cyan and checks sync
        status, update_theme = self._call("POST", "/api/admin/theme", {"palette": "cyan"}, token=admin_token)
        self.assertEqual(status, 200)
        self.assertEqual(update_theme["palette"], "cyan")

        status, theme_after = self._call("GET", "/api/theme")
        self.assertEqual(status, 200)
        self.assertEqual(theme_after["palette"], "cyan")

        # Switch back to default Magenta Velvet
        self._call("POST", "/api/admin/theme", {"palette": "magenta"}, token=admin_token)

        # =====================================================================
        # Step 2: Offline Agent Guard (Mobile verifies Windows Agent is offline)
        # =====================================================================
        status, mobile_status = self._call("GET", "/api/mobile/status", token=admin_token)
        self.assertEqual(status, 200)
        self.assertEqual(mobile_status["agent_state"], "inactive")
        self.assertEqual(mobile_status["agent_state_label"], "غیرفعال")
        self.assertFalse(mobile_status["agent_online"])

        # Dispatch command while offline -> MUST fail with 400 and explicit message
        status, err_dispatch = self._call(
            "POST",
            "/api/mobile/commands/dispatch",
            {
                "target_node_id": "windows-edge",
                "command": "dir",
                "risk_level": "high",
            },
            token=admin_token,
        )
        self.assertEqual(status, 400)
        self.assertIn("ایجنت ویندوز غیرفعال است", err_dispatch["error"]["message"])

        # Steer process while offline -> MUST fail with 400
        status, err_steer = self._call(
            "POST",
            "/api/mobile/projects/steer",
            {"run_id": "dummy-run-id", "action": "continue"},
            token=admin_token,
        )
        self.assertEqual(status, 400)
        self.assertIn("ایجنت ویندوز غیرفعال است", err_steer["error"]["message"])

        # =====================================================================
        # Step 3: Issue 6-Digit Temporary PIN & Pair Windows Edge Agent
        # =====================================================================
        status, pairing_res = self._call("POST", "/api/agent/pairing", {}, token=admin_token)
        self.assertEqual(status, 201)
        pin_code = pairing_res["code"]
        self.assertEqual(len(pin_code), 6)
        self.assertTrue(pin_code.isdigit())

        # Windows Agent redeems 6-digit PIN
        status, redeem_res = self._call("POST", "/api/agent/redeem", {"code": pin_code, "device_id": "LOUIS-PC-EDGE"})
        self.assertEqual(status, 200)
        agent_token = redeem_res["token"]

        # =====================================================================
        # Step 4: Verify Windows Agent is Now Online & Available
        # =====================================================================
        status, online_status = self._call("GET", "/api/mobile/status", token=admin_token)
        self.assertEqual(status, 200)
        self.assertEqual(online_status["agent_state"], "available")
        self.assertEqual(online_status["agent_state_label"], "در دسترس")
        self.assertTrue(online_status["agent_online"])

        # =====================================================================
        # Step 5: Mobile Dispatches Command -> Biometric Gate Approval -> Execution
        # =====================================================================
        status, dispatch_res = self._call(
            "POST",
            "/api/mobile/commands/dispatch",
            {
                "target_node_id": "LOUIS-PC-EDGE",
                "command": "Get-Process | Where-Object CPU -gt 10",
                "command_type": "powershell",
                "description": "بررسی پردازش‌های سنگین از کنسول همراه",
                "risk_level": "high",
            },
            token=admin_token,
        )
        self.assertEqual(status, 201)
        self.assertEqual(dispatch_res["status"], "pending_approval")
        cmd_id = dispatch_res["id"]

        # Mobile operator approves via Biometric Fingerprint
        status, approve_res = self._call(
            "POST",
            "/api/mobile/commands/approve",
            {"command_id": cmd_id, "auth_method": "biometric_fingerprint"},
            token=admin_token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(approve_res["status"], "queued")

        # Windows Agent claims command
        status, claim_res = self._call("POST", "/api/agent/commands/claim", {"command_id": cmd_id}, token=agent_token)
        self.assertEqual(status, 200)
        self.assertEqual(claim_res["status"], "in_progress")

        # Windows Agent reports completion
        status, report_res = self._call(
            "POST",
            "/api/agent/commands/report",
            {
                "command_id": cmd_id,
                "status": "completed",
                "output": "Process CPU telemetry verified",
                "exit_code": 0,
                "duration_ms": 75,
            },
            token=agent_token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(report_res["status"], "completed")

        # =====================================================================
        # Step 6: Workspace Project & Active Run Steering from Android
        # =====================================================================
        # Create a workspace project
        status, proj_res = self._call(
            "POST",
            "/api/web/workspace/projects",
            {"name": "OmniOps Autonomous Agent Core", "description": "پروژه هوشمند لوکال ویندوز"},
            token=admin_token,
        )
        self.assertEqual(status, 201)
        project_id = proj_res["id"]

        # Mobile checks projects list
        status, mobile_projects = self._call("GET", "/api/mobile/projects", token=admin_token)
        self.assertEqual(status, 200)
        self.assertEqual(mobile_projects["agent_state"], "available")
        self.assertTrue(len(mobile_projects["projects"]) >= 1)
        matched_proj = [p for p in mobile_projects["projects"] if p["id"] == project_id]
        self.assertEqual(len(matched_proj), 1)

        # Insert a running agent run in the database to simulate active process execution
        with self.store._db() as db:
            run_id = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
            db.execute(
                "INSERT INTO workspace_agent_runs (id, owner_id, project_id, prompt, role, mode, status, current_step_index, plan_steps, logs, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 'architect', 'single', 'in_progress', 0, '[]', '[]', ?, ?)",
                (run_id, login_res["user"]["id"], project_id, "طراحی معماری سیستم لوکال", int(time.time()), int(time.time())),
            )
            db.commit()

        # Mobile queries active runs
        status, mobile_projects = self._call("GET", "/api/mobile/projects", token=admin_token)
        self.assertEqual(status, 200)
        self.assertTrue(any(r["id"] == run_id for r in mobile_projects["runs"]))

        # Mobile steers running project: Pause
        status, steer_pause = self._call(
            "POST",
            "/api/mobile/projects/steer",
            {"run_id": run_id, "action": "pause"},
            token=admin_token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(steer_pause["action"], "pause")

        # Mobile steers running project: Guidance Feedback
        status, steer_guidance = self._call(
            "POST",
            "/api/mobile/projects/steer",
            {"run_id": run_id, "action": "guidance", "guidance": "تست‌های بخش شبکه را با اولویت بالا انجام بده"},
            token=admin_token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(steer_guidance["action"], "guidance")

        # Mobile steers running project: Step Continue
        status, steer_cont = self._call(
            "POST",
            "/api/mobile/projects/steer",
            {"run_id": run_id, "action": "continue"},
            token=admin_token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(steer_cont["action"], "continue")

        # Mobile steers running project: Emergency Stop
        status, steer_stop = self._call(
            "POST",
            "/api/mobile/projects/steer",
            {"run_id": run_id, "action": "stop", "guidance": "توقف توسط اپراتور موبایل"},
            token=admin_token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(steer_stop["action"], "stop")


if __name__ == "__main__":
    unittest.main()
