import unittest

from omniops.policy import (
    Capability,
    Principal,
    Profile,
    may_approve_action,
    may_chat,
    may_read_tool,
    may_request_action,
    may_use_skill,
)
from omniops.router import (
    Model,
    NetworkMode,
    NoEligibleModel,
    Provider,
    ProviderKind,
    RoutingRequest,
    choose_model,
)


class AccessPolicyTests(unittest.TestCase):
    def setUp(self):
        self.chat = Principal("u1", Profile("chat", frozenset({Capability.CHAT})))
        self.operator = Principal(
            "u1",
            Profile(
                "operator",
                frozenset({Capability.CHAT, Capability.TOOL_READ, Capability.ACTION_REQUEST}),
                frozenset({"service.status", "service.restart"}),
                frozenset({"pc-1"}),
            ),
        )
        self.approver = Principal(
            "u2",
            Profile(
                "approver",
                frozenset({Capability.ACTION_APPROVE}),
                frozenset({"service.restart"}),
                frozenset({"pc-1"}),
            ),
        )

    def test_chat_profile_cannot_use_tools_or_skills(self):
        self.assertTrue(may_chat(self.chat).allowed)
        self.assertFalse(may_use_skill(self.chat, True).allowed)
        self.assertFalse(may_read_tool(self.chat, "service.status", "pc-1").allowed)

    def test_tool_and_device_scopes_are_both_required(self):
        self.assertTrue(may_request_action(self.operator, "service.restart", "pc-1").allowed)
        self.assertFalse(may_request_action(self.operator, "service.restart", "pc-2").allowed)
        self.assertFalse(may_request_action(self.operator, "powershell", "pc-1").allowed)

    def test_approval_requires_its_own_scope_and_separate_user(self):
        self.assertTrue(may_approve_action(self.approver, "u1", "service.restart", "pc-1").allowed)
        self.assertFalse(may_approve_action(self.approver, "u2", "service.restart", "pc-1").allowed)
        self.assertFalse(may_approve_action(self.approver, "u1", "service.restart", "pc-2").allowed)


class RoutingPolicyTests(unittest.TestCase):
    def setUp(self):
        self.local = Provider("ollama", ProviderKind.LOCAL, NetworkMode.INTERNAL)
        self.external = Provider("gemini", ProviderKind.EXTERNAL, NetworkMode.DIRECT)
        self.local_model = Model("local-small", "ollama", frozenset({"text"}), 5, 200, 0)
        self.external_model = Model("cloud-large", "gemini", frozenset({"text", "vision"}), 9, 100, 2)

    def test_sensitive_data_never_uses_external_model(self):
        actual = choose_model(
            (self.local, self.external), (self.local_model, self.external_model), RoutingRequest()
        )
        self.assertEqual(actual.model_id, "local-small")

    def test_external_requires_explicit_permission_and_capability(self):
        request = RoutingRequest(frozenset({"vision"}), local_only=False, allow_external=True)
        self.assertEqual(
            choose_model((self.local, self.external), (self.local_model, self.external_model), request).model_id,
            "cloud-large",
        )
        with self.assertRaises(NoEligibleModel):
            choose_model((self.local, self.external), (self.local_model, self.external_model), RoutingRequest(frozenset({"vision"})))

    def test_socks_failure_does_not_fall_back_to_direct(self):
        request = RoutingRequest(
            frozenset({"vision"}), local_only=False, allow_external=True, require_socks_for_external=True
        )
        with self.assertRaises(NoEligibleModel):
            choose_model((self.local, self.external), (self.local_model, self.external_model), request)
        proxy_provider = Provider("gemini", ProviderKind.EXTERNAL, NetworkMode.SOCKS, socks_url="socks5h://127.0.0.1:1080")
        self.assertEqual(
            choose_model((self.local, proxy_provider), (self.local_model, self.external_model), request).model_id,
            "cloud-large",
        )


if __name__ == "__main__":
    unittest.main()
