from pathlib import Path
import tempfile
import unittest

from omniops.identity import IdentityStore, IdentityError
from omniops.mobile_orchestrator import MobileApprovalStore


class MobileAgentCommandsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = [1800000000]
        self.store = IdentityStore(Path(self.temp.name) / "identity.db", b"s" * 32, lambda: self.now[0])
        self.store.bootstrap_admin("admin", "a sufficiently strong password", "09123456789")
        self.admin = self.store.authenticate(self.store.login("admin", "a sufficiently strong password")["token"])
        self.mobile = MobileApprovalStore(self.store)

    def test_dispatch_high_risk_command_triggers_hitl_approval_and_agent_lifecycle(self):
        """High-risk commands from Mobile/PWA must require Human-in-the-Loop biometric approval before Windows Agent execution."""
        # 1. Dispatch high-risk command from Android/PWA
        dispatched = self.mobile.dispatch_command(
            principal=self.admin,
            target_node_id="windows-edge-louis",
            command="Get-Service | Where-Object Status -eq 'Running'",
            command_type="powershell",
            description="بررسی وضعیت سرویس‌های ویندوز",
            risk_level="high",
        )

        self.assertEqual(dispatched["status"], "pending_approval")
        self.assertEqual(dispatched["target_node_id"], "windows-edge-louis")
        self.assertEqual(dispatched["risk_level"], "high")
        self.assertTrue(dispatched["challenge_nonce"])
        self.assertTrue(dispatched["approval_id"])

        cmd_id = dispatched["id"]

        # 2. Windows Agent must NOT see or claim command while pending approval
        pending_for_agent = self.mobile.get_pending_agent_commands(agent_node_id="windows-edge-louis")
        self.assertEqual(len(pending_for_agent), 0)

        with self.assertRaises(IdentityError) as ctx:
            self.mobile.claim_agent_command(cmd_id, agent_node_id="windows-edge-louis")
        self.assertEqual(ctx.exception.status, 409)

        # 3. Mobile operator performs Biometric Human-in-the-Loop Approval
        approved = self.mobile.approve_command(
            principal=self.admin,
            command_id=cmd_id,
            auth_method="biometric_fingerprint",
        )
        self.assertEqual(approved["status"], "queued")
        self.assertEqual(approved["auth_method"], "biometric_fingerprint")

        # 4. Windows Agent now retrieves queued command from Master
        pending_now = self.mobile.get_pending_agent_commands(agent_node_id="windows-edge-louis")
        self.assertEqual(len(pending_now), 1)
        self.assertEqual(pending_now[0]["id"], cmd_id)

        # 5. Windows Agent claims command
        claimed = self.mobile.claim_agent_command(cmd_id, agent_node_id="windows-edge-louis")
        self.assertEqual(claimed["status"], "in_progress")
        self.assertEqual(claimed["claimed_by_node"], "windows-edge-louis")

        # 6. Windows Agent executes and reports execution result back to Master
        reported = self.mobile.report_agent_command(
            command_id=cmd_id,
            agent_node_id="windows-edge-louis",
            status="completed",
            output="Status: 42 running services. All systems normal.",
            exit_code=0,
            duration_ms=240,
        )
        self.assertEqual(reported["status"], "completed")
        self.assertEqual(reported["exit_code"], 0)
        self.assertEqual(reported["duration_ms"], 240)

        # 7. Check command history
        history = self.mobile.list_commands(self.admin, target_node_id="windows-edge-louis")
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["status"], "completed")
        self.assertIn("42 running services", history[0]["output"])

        # 8. Check Audit Trail in Master SQLite DB
        with self.store._lock, self.store._db() as db:
            audit_events = [
                row[0]
                for row in db.execute(
                    "SELECT event FROM audit WHERE subject_id LIKE ? ORDER BY created_at ASC",
                    (f"%{cmd_id}%",),
                ).fetchall()
            ]
            self.assertIn("mobile_command_dispatched", audit_events)
            self.assertIn("mobile_command_approved", audit_events)
            self.assertIn("agent_command_claimed", audit_events)
            self.assertIn("agent_command_reported", audit_events)

    def test_dispatch_low_risk_command_directly_queued(self):
        """Low-risk commands with require_approval=False bypass pending state and queue immediately."""
        dispatched = self.mobile.dispatch_command(
            principal=self.admin,
            target_node_id="windows-edge-02",
            command="hostname",
            command_type="cmd",
            description="بررسی نام میزبان",
            risk_level="low",
            require_approval=False,
        )
        self.assertEqual(dispatched["status"], "queued")
        self.assertIsNone(dispatched["approval_id"])

        # Directly claimable by agent
        claimed = self.mobile.claim_agent_command(dispatched["id"], agent_node_id="windows-edge-02")
        self.assertEqual(claimed["status"], "in_progress")

    def test_cancel_command_by_mobile_user(self):
        """Dispatched command can be cancelled before execution."""
        dispatched = self.mobile.dispatch_command(
            principal=self.admin,
            target_node_id="windows-edge-03",
            command="Restart-Computer -Force",
            risk_level="destructive",
        )
        cmd_id = dispatched["id"]
        self.assertEqual(dispatched["status"], "pending_approval")

        cancelled = self.mobile.cancel_command(self.admin, cmd_id, reason="لغو توسط کاربر")
        self.assertEqual(cancelled["status"], "cancelled")

        # Agent cannot claim cancelled command
        with self.assertRaises(IdentityError):
            self.mobile.claim_agent_command(cmd_id, agent_node_id="windows-edge-03")

    def test_emergency_kill_switch_aborts_all_commands_for_target_node(self):
        """Emergency kill switch from Android companion immediately terminates all pending and in-progress commands."""
        c1 = self.mobile.dispatch_command(
            principal=self.admin,
            target_node_id="windows-edge-target",
            command="task1",
            risk_level="high",
        )
        c2 = self.mobile.dispatch_command(
            principal=self.admin,
            target_node_id="windows-edge-target",
            command="task2",
            risk_level="low",
            require_approval=False,
        )
        # Claim c2 so it's in_progress
        self.mobile.claim_agent_command(c2["id"], agent_node_id="windows-edge-target")

        # Trigger Kill-Switch
        res = self.mobile.emergency_kill_switch(
            principal=self.admin,
            node_id="windows-edge-target",
            reason="توقف اضطراری از اپلیکیشن اندروید",
        )
        self.assertEqual(res["status"], "TERMINATED")

        # Check that both c1 and c2 are cancelled
        cmds = self.mobile.list_commands(self.admin, target_node_id="windows-edge-target")
        for c in cmds:
            self.assertEqual(c["status"], "cancelled")


class MobileAgentGatewayHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import json
        import threading
        from http.server import ThreadingHTTPServer
        from urllib.request import build_opener, ProxyHandler
        from omniops.server import make_server
        from test_ollama import FakeOllama

        cls.json = json
        cls.temp = tempfile.TemporaryDirectory()
        cls.db_path = Path(cls.temp.name) / "identity.db"
        cls.store = IdentityStore(cls.db_path, b"w" * 32)
        cls.store.bootstrap_admin("admin", "a very strong admin password", "09123456789")

        web_dist = Path(cls.temp.name) / "web"
        web_dist.mkdir()
        (web_dist / "index.html").write_text("<!doctype html><html>OmniOps</html>", encoding="utf-8")

        cls.ollama = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
        cls.ollama_thread = threading.Thread(target=cls.ollama.serve_forever, daemon=True)
        cls.ollama_thread.start()

        cls.server = make_server(
            "127.0.0.1", 0, "testing-a-unique-gateway-key-long-enough",
            f"http://127.0.0.1:{cls.ollama.server_port}", cls.store, web_dist
        )
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

    def _call(self, method, path, payload=None, token=None):
        from urllib.request import Request
        data = None if payload is None else self.json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = Request(self.root + path, data=data, headers=headers, method=method)
        with self.opener.open(req, timeout=10) as resp:
            return resp.status, self.json.load(resp)

    def test_http_mobile_command_dispatch_approval_and_execution_lifecycle(self):
        """End-to-end HTTP validation: Mobile app dispatches to Master, operator approves, Windows Agent executes and reports."""
        # 1. Login as mobile web user
        status, login_res = self._call("POST", "/api/auth/login", {"username": "admin", "password": "a very strong admin password"})
        self.assertEqual(status, 200)
        web_token = login_res["token"]

        # 2. Issue pairing code and redeem as Windows Edge Agent
        status, pairing_res = self._call("POST", "/api/agent/pairing", {}, token=web_token)
        self.assertEqual(status, 201)
        code = pairing_res["code"]

        status, redeem_res = self._call("POST", "/api/agent/redeem", {"code": code, "device_id": "windows-edge-device-01"})
        self.assertEqual(status, 200)
        agent_token = redeem_res["token"]

        # 3. Mobile app dispatches high-risk command to Windows Agent via Master
        status, dispatch_res = self._call(
            "POST",
            "/api/mobile/commands/dispatch",
            {
                "target_node_id": "windows-edge-device-01",
                "command": "Get-ComputerInfo | Select-Object WindowsVersion",
                "command_type": "powershell",
                "description": "استعلام نسخه ویندوز از اپ اندروید",
                "risk_level": "high",
            },
            token=web_token,
        )
        self.assertEqual(status, 201)
        self.assertEqual(dispatch_res["status"], "pending_approval")
        cmd_id = dispatch_res["id"]
        self.assertTrue(dispatch_res["approval_id"])

        # 4. Agent polls pending commands: should be empty while waiting for biometric approval
        status, pending_res = self._call("GET", "/api/agent/commands/pending", token=agent_token)
        self.assertEqual(status, 200)
        self.assertEqual(len(pending_res["commands"]), 0)

        # 5. Mobile operator approves via Biometric Fingerprint
        status, approve_res = self._call(
            "POST",
            "/api/mobile/commands/approve",
            {"command_id": cmd_id, "auth_method": "biometric_fingerprint"},
            token=web_token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(approve_res["status"], "queued")

        # 6. Windows Agent polls again: queued command received
        status, pending_now = self._call("GET", "/api/agent/commands/pending", token=agent_token)
        self.assertEqual(status, 200)
        self.assertEqual(len(pending_now["commands"]), 1)
        self.assertEqual(pending_now["commands"][0]["id"], cmd_id)

        # 7. Windows Agent claims command
        status, claim_res = self._call("POST", "/api/agent/commands/claim", {"command_id": cmd_id}, token=agent_token)
        self.assertEqual(status, 200)
        self.assertEqual(claim_res["status"], "in_progress")

        # 8. Windows Agent reports completion
        status, report_res = self._call(
            "POST",
            "/api/agent/commands/report",
            {
                "command_id": cmd_id,
                "status": "completed",
                "output": "WindowsVersion: 24H2 Enterprise",
                "exit_code": 0,
                "duration_ms": 185,
            },
            token=agent_token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(report_res["status"], "completed")

        # 9. Mobile app checks command history
        status, history_res = self._call("GET", "/api/mobile/commands/history", token=web_token)
        self.assertEqual(status, 200)
        matched = [c for c in history_res["commands"] if c["id"] == cmd_id]
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["status"], "completed")
        self.assertIn("24H2 Enterprise", matched[0]["output"])


if __name__ == "__main__":
    unittest.main()

