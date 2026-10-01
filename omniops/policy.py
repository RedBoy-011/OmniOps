"""Tasmimhaye dastresi dar server, mostaghel az UI va matn-e model."""

from dataclasses import dataclass
from enum import Enum


class Capability(str, Enum):
    CHAT = "chat"
    SKILL_USE = "skill.use"
    TOOL_READ = "tool.read"
    ACTION_REQUEST = "action.request"
    ACTION_APPROVE = "action.approve"
    PROVIDER_MANAGE = "provider.manage"
    PROFILE_MANAGE = "profile.manage"


@dataclass(frozen=True)
class Profile:
    name: str
    capabilities: frozenset[Capability]
    allowed_tools: frozenset[str] = frozenset()
    allowed_devices: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Principal:
    user_id: str
    profile: Profile


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str


def _in_scope(profile: Profile, tool_id: str, device_id: str) -> bool:
    return (tool_id in profile.allowed_tools or "*" in profile.allowed_tools) and (
        device_id in profile.allowed_devices or "*" in profile.allowed_devices
    )


def may_chat(principal: Principal) -> Decision:
    return Decision(Capability.CHAT in principal.profile.capabilities, "chat permission required")


def may_use_skill(principal: Principal, skill_active: bool) -> Decision:
    allowed = skill_active and Capability.CHAT in principal.profile.capabilities and (
        Capability.SKILL_USE in principal.profile.capabilities
    )
    return Decision(allowed, "active skill and chat/skill permissions required")


def may_read_tool(principal: Principal, tool_id: str, device_id: str) -> Decision:
    allowed = Capability.TOOL_READ in principal.profile.capabilities and _in_scope(
        principal.profile, tool_id, device_id
    )
    return Decision(allowed, "read permission and matching tool/device scope required")


def may_request_action(principal: Principal, tool_id: str, device_id: str) -> Decision:
    allowed = Capability.ACTION_REQUEST in principal.profile.capabilities and _in_scope(
        principal.profile, tool_id, device_id
    )
    return Decision(allowed, "request permission and matching tool/device scope required")


def may_approve_action(
    principal: Principal,
    requested_by: str,
    tool_id: str,
    device_id: str,
    *,
    separate_approver: bool = True,
) -> Decision:
    allowed = (
        Capability.ACTION_APPROVE in principal.profile.capabilities
        and _in_scope(principal.profile, tool_id, device_id)
        and (not separate_approver or principal.user_id != requested_by)
    )
    return Decision(allowed, "separate approver and matching permission/scope required")
