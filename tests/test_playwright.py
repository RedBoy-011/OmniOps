import base64
import os
from pathlib import Path
import tempfile
import unittest

from omniops.identity import IdentityStore, IdentityError
from omniops.nodes import NodeRegistry
from omniops.mobile_orchestrator import MobileApprovalStore
from omniops import playwright_worker
from omniops.playwright_worker import (
    DEFAULT_ALLOWED_DOMAINS,
    DomainBlockedError,
    LightweightBrowserEngine,
    PlaywrightWorkerError,
    WorkerOnlyError,
    execute_browser_scenario,
    is_domain_allowed,
    parse_scenario,
    verify_worker_role,
)


class PlaywrightWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = [1800000000]
        self.store = IdentityStore(Path(self.temp.name) / "identity.db", b"s" * 32, lambda: self.now[0])
        self.store.bootstrap_admin("admin", "a sufficiently strong password", "09123456789")
        self.admin = self.store.authenticate(self.store.login("admin", "a sufficiently strong password")["token"])
        self.nodes = NodeRegistry(self.store)
        self.mobile_store = MobileApprovalStore(self.store)

    def test_worker_only_role_enforcement(self):
        """Playwright and browser execution MUST be restricted exclusively to Worker nodes."""
        # Allowed on Worker
        verify_worker_role("worker", "worker-node-1")

        # Rejected on non-Worker nodes
        for forbidden_role in ["edge", "master", "admin", "client", "guest", ""]:
            with self.assertRaises(WorkerOnlyError) as ctx:
                verify_worker_role(forbidden_role, "test-node")
            self.assertEqual(ctx.exception.status, 403)
            self.assertIn("فقط بر روی گره‌های Worker مجاز است", str(ctx.exception))

        # Direct execution attempt with non-worker role must raise WorkerOnlyError
        yaml_scenario = """
name: Edge Forbidden Test
steps:
  - goto: https://example.com
"""
        with self.assertRaises(WorkerOnlyError):
            execute_browser_scenario(
                scenario_input=yaml_scenario,
                node_id="edge-node-01",
                node_role="edge",
                identity=self.store,
            )

    def test_domain_allowlist_matching(self):
        """Domain allowlist must allow whitelisted domains/wildcards and reject others."""
        # Defaults allow localhost, github.com, example.com, etc.
        self.assertTrue(is_domain_allowed("http://localhost:8000/api"))
        self.assertTrue(is_domain_allowed("http://127.0.0.1:9443/"))
        self.assertTrue(is_domain_allowed("https://github.com/RedBoy-011/OmniOps"))
        self.assertTrue(is_domain_allowed("https://raw.githubusercontent.com/"))
        self.assertTrue(is_domain_allowed("https://api.github.com/repos"))
        self.assertTrue(is_domain_allowed("https://example.com/test"))

        # Disallowed
        self.assertFalse(is_domain_allowed("https://malicious-site.com/steal"))
        self.assertFalse(is_domain_allowed("https://unauthorized-domain.org"))
        self.assertFalse(is_domain_allowed("ftp://some-ftp-server.net"))

        # Custom allowlist with wildcards
        custom_allow = ["*.internal.corp", "trusted.io"]
        self.assertTrue(is_domain_allowed("https://app.internal.corp/home", custom_allow))
        self.assertTrue(is_domain_allowed("https://trusted.io/dashboard", custom_allow))
        self.assertFalse(is_domain_allowed("https://github.com", custom_allow))

    def test_yaml_and_json_scenario_parser(self):
        """Scenario parser should support YAML string, JSON string, and dict input."""
        yaml_text = """
name: Automated Health Check
allowed_domains:
  - internal.service
steps:
  - goto: https://example.com
  - click: button#run-test
  - fill: input[name=query], value: omniops-worker
  - wait_for: 0.1
  - evaluate: document.title
  - screenshot: true
"""
        parsed = parse_scenario(yaml_text)
        self.assertEqual(parsed.get("name"), "Automated Health Check")
        self.assertIn("internal.service", parsed.get("allowed_domains", []))
        self.assertEqual(len(parsed.get("steps", [])), 6)
        self.assertEqual(parsed["steps"][0]["goto"], "https://example.com")
        self.assertEqual(parsed["steps"][1]["click"], "button#run-test")
        self.assertEqual(parsed["steps"][2]["value"], "omniops-worker")

        # Empty input error handling
        with self.assertRaises(PlaywrightWorkerError):
            parse_scenario("")

        # Missing steps error handling
        with self.assertRaises(PlaywrightWorkerError):
            parse_scenario("name: No Steps Here\n")

    def test_execute_browser_scenario_and_audit(self):
        """Execute browser scenario on Worker node, producing structured output and Audit record."""
        scenario_yaml = """
name: Worker Smoke Test
steps:
  - goto: https://example.com
  - click: a.more-info
  - fill: input.search, value: worker-task
  - screenshot: true
  - evaluate: document.title
"""
        result = execute_browser_scenario(
            scenario_input=scenario_yaml,
            node_id="worker-node-101",
            node_role="worker",
            identity=self.store,
            approval_store=self.mobile_store,
            actor_id="admin-user",
        )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["scenario_name"], "Worker Smoke Test")
        self.assertEqual(result["node_id"], "worker-node-101")
        self.assertEqual(result["node_role"], "worker")
        self.assertEqual(result["steps_count"], 5)
        self.assertEqual(len(result["steps_executed"]), 5)
        self.assertGreaterEqual(result["screenshots_count"], 1)
        self.assertTrue(result["screenshots"][0]["base64"])
        self.assertGreaterEqual(result["duration_ms"], 1)

        # Verify audit log in SQLite DB
        with self.store._lock, self.store._db() as db:
            rows = db.execute(
                "SELECT event, subject_id FROM audit WHERE event = 'playwright_scenario_executed'"
            ).fetchall()
            self.assertEqual(len(rows), 1)
            self.assertIn("Worker Smoke Test", rows[0][1])
            self.assertIn("worker-node-101", rows[0][1])

    def test_human_in_the_loop_approval_policy(self):
        """Accessing an unlisted domain triggers Human-in-the-Loop policy gate with pending approval."""
        unlisted_scenario = """
name: Access External API
steps:
  - goto: https://unknown-unlisted-service.io/dashboard
  - screenshot: true
"""
        # When approval_store is active: returns status='pending_approval' with challenge nonce
        result = execute_browser_scenario(
            scenario_input=unlisted_scenario,
            node_id="worker-node-101",
            node_role="worker",
            identity=self.store,
            approval_store=self.mobile_store,
            actor_id="admin-user",
        )

        self.assertEqual(result["status"], "pending_approval")
        self.assertEqual(result["blocked_domain"], "unknown-unlisted-service.io")
        self.assertTrue(result["approval_id"])
        self.assertTrue(result["challenge_nonce"])

        # Check approval exists in MobileApprovalStore
        pending = self.mobile_store.list_pending(self.admin)
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["id"], result["approval_id"])
        self.assertIn("unknown-unlisted-service.io", pending[0]["description"])

        # Verify audit log recorded approval request
        with self.store._lock, self.store._db() as db:
            audit_reqs = db.execute(
                "SELECT event, subject_id FROM audit WHERE event = 'playwright_approval_requested'"
            ).fetchall()
            self.assertEqual(len(audit_reqs), 1)
            self.assertIn("unknown-unlisted-service.io", audit_reqs[0][1])

        # Without approval store: immediately raises DomainBlockedError (status 403)
        with self.assertRaises(DomainBlockedError) as ctx:
            execute_browser_scenario(
                scenario_input=unlisted_scenario,
                node_id="worker-node-101",
                node_role="worker",
                identity=self.store,
                approval_store=None,
            )
        self.assertEqual(ctx.exception.status, 403)

    def test_node_registry_worker_authentication(self):
        """Node registry provides secure authentication and lookup for worker execution."""
        # Enroll a worker node
        worker_grant = self.nodes.issue(self.admin, "worker")["grant"]
        worker_node = self.nodes.enroll(worker_grant, "worker-prod-1")

        # Enroll an edge node
        edge_grant = self.nodes.issue(self.admin, "edge")["grant"]
        edge_node = self.nodes.enroll(edge_grant, "edge-device-1")

        # Authenticate nodes
        auth_worker = self.nodes.authenticate_node(worker_node["id"], worker_node["credential"])
        self.assertEqual(auth_worker["role"], "worker")

        auth_edge = self.nodes.authenticate_node(edge_node["id"], edge_node["credential"])
        self.assertEqual(auth_edge["role"], "edge")

        # Lookup node
        fetched_worker = self.nodes.get_node(self.admin, worker_node["id"])
        self.assertEqual(fetched_worker["role"], "worker")

        fetched_edge = self.nodes.get_node(self.admin, edge_node["id"])
        self.assertEqual(fetched_edge["role"], "edge")


if __name__ == "__main__":
    unittest.main()
