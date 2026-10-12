import tempfile
import unittest
from pathlib import Path

from omniops.identity import IdentityStore
from omniops.mobile_orchestrator import MobileApprovalStore


class MobileOrchestratorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "identity.db"
        self.store = IdentityStore(self.db_path, b"k" * 32)
        self.store.bootstrap_admin("root-admin", "a very strong admin password", "09123456789")
        self.orchestrator = MobileApprovalStore(self.store)

    def tearDown(self):
        self.temp.cleanup()

    def test_request_and_list_pending_approvals(self):
        req = self.orchestrator.request_approval(
            node_id="LOUIS-PC",
            command="npm run clean && npm run deploy",
            agent_name="Antigravity",
            risk_level="high",
            description="Production deployment",
        )
        self.assertEqual(req["status"], "pending")
        self.assertEqual(req["node_id"], "LOUIS-PC")
        self.assertTrue(len(req["challenge_nonce"]) >= 16)

        pending = self.orchestrator.list_pending()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["command"], "npm run clean && npm run deploy")

    def test_biometric_approve_and_deny(self):
        req1 = self.orchestrator.request_approval(
            node_id="LOUIS-PC",
            command="npm test",
        )
        decided = self.orchestrator.decide(
            principal={"id": "usr1", "username": "root-admin"},
            request_id=req1["id"],
            approved=True,
            auth_method="biometric_fingerprint",
        )
        self.assertEqual(decided["status"], "approved_biometric")
        self.assertEqual(decided["auth_method"], "biometric_fingerprint")

        # Now pending list should be empty
        self.assertEqual(len(self.orchestrator.list_pending()), 0)

        # Deny another request
        req2 = self.orchestrator.request_approval(node_id="LOUIS-PC", command="rm -rf /tmp/data")
        denied = self.orchestrator.decide(
            principal={"id": "usr1", "username": "root-admin"},
            request_id=req2["id"],
            approved=False,
        )
        self.assertEqual(denied["status"], "denied")

    def test_emergency_kill_switch(self):
        self.orchestrator.request_approval(node_id="LOUIS-PC", command="long-running-job")
        kill_result = self.orchestrator.emergency_kill_switch(
            principal={"id": "usr1", "username": "root-admin"},
            node_id="LOUIS-PC",
            reason="Operator manual abort",
        )
        self.assertEqual(kill_result["status"], "TERMINATED")
        # Pending approvals must be wiped/denied
        self.assertEqual(len(self.orchestrator.list_pending()), 0)


if __name__ == "__main__":
    unittest.main()
