"""Device Relay Engine: Manages temporary short-code pairing, device presence, and Android-to-Windows command dispatching."""

import random
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class PairingSession:
    code: str
    windows_agent_id: str
    windows_agent_name: str
    created_at: float
    expires_at: float
    redeemed: bool = False
    android_device_id: Optional[str] = None


@dataclass
class ConnectedAgent:
    agent_id: str
    agent_name: str
    device_type: str  # "windows" | "android"
    last_heartbeat: float
    ip_address: str = "127.0.0.1"
    linked_windows_agent_id: Optional[str] = None


class DeviceRelayEngine:
    """Manages cross-device pairing between Windows Desktop Agents and Android Mobile Clients."""

    def __init__(self, code_ttl_seconds: float = 600.0, heartbeat_timeout_seconds: float = 40.0):
        self._lock = threading.RLock()
        self.code_ttl_seconds = code_ttl_seconds
        self.heartbeat_timeout_seconds = heartbeat_timeout_seconds
        self._pairing_codes: Dict[str, PairingSession] = {}  # 6-digit code -> session
        self._agents: Dict[str, ConnectedAgent] = {}         # agent_id -> ConnectedAgent
        self._action_queues: Dict[str, List[Dict[str, Any]]] = {}  # agent_id -> pending actions

    def generate_short_code(self, windows_agent_id: str, windows_agent_name: str = "Windows Desktop") -> str:
        """Generates a secure 6-digit temporary pairing code."""
        with self._lock:
            # Generate random 6-digit string
            code = f"{random.randint(100000, 999999)}"
            now = time.time()
            session = PairingSession(
                code=code,
                windows_agent_id=windows_agent_id,
                windows_agent_name=windows_agent_name,
                created_at=now,
                expires_at=now + self.code_ttl_seconds,
            )
            self._pairing_codes[code] = session
            # Also register/update windows agent presence
            self.agent_heartbeat(windows_agent_id, windows_agent_name, "windows")
            return code

    def redeem_short_code(self, code: str, android_device_id: str, android_device_name: str = "Android Mobile") -> Optional[Dict[str, Any]]:
        """Redeems a 6-digit pairing code from Android, linking it to the Windows Agent."""
        with self._lock:
            session = self._pairing_codes.get(code)
            now = time.time()
            if not session:
                return None
            if session.expires_at < now:
                del self._pairing_codes[code]
                return None

            session.redeemed = True
            session.android_device_id = android_device_id

            # Register Android agent and link to Windows agent
            self._agents[android_device_id] = ConnectedAgent(
                agent_id=android_device_id,
                agent_name=android_device_name,
                device_type="android",
                last_heartbeat=now,
                linked_windows_agent_id=session.windows_agent_id,
            )

            return {
                "status": "paired",
                "linked_windows_agent_id": session.windows_agent_id,
                "windows_agent_name": session.windows_agent_name,
                "token": f"tok-mobile-{android_device_id}-{int(now)}",
            }

    def agent_heartbeat(self, agent_id: str, agent_name: str, device_type: str = "windows") -> None:
        """Records a heartbeat from an agent."""
        with self._lock:
            now = time.time()
            if agent_id in self._agents:
                self._agents[agent_id].last_heartbeat = now
                self._agents[agent_id].agent_name = agent_name
            else:
                self._agents[agent_id] = ConnectedAgent(
                    agent_id=agent_id,
                    agent_name=agent_name,
                    device_type=device_type,
                    last_heartbeat=now,
                )

    def is_windows_agent_online(self, windows_agent_id: Optional[str] = None) -> bool:
        """Checks if a specific Windows Agent (or any Windows Agent) is online."""
        with self._lock:
            now = time.time()
            if windows_agent_id:
                agent = self._agents.get(windows_agent_id)
                if agent and agent.device_type == "windows":
                    return (now - agent.last_heartbeat) < self.heartbeat_timeout_seconds
                return False

            # Check if any Windows agent is online
            for agent in self._agents.values():
                if agent.device_type == "windows" and (now - agent.last_heartbeat) < self.heartbeat_timeout_seconds:
                    return True
            return False

    def get_agent_status(self, agent_id: str) -> Dict[str, Any]:
        """Returns agent connection status and linked Windows agent presence."""
        with self._lock:
            agent = self._agents.get(agent_id)
            now = time.time()
            if not agent:
                # Default check if any windows agent is online
                any_win = self.is_windows_agent_online()
                return {
                    "registered": False,
                    "windows_agent_online": any_win,
                }

            linked_win_id = agent.linked_windows_agent_id
            win_online = self.is_windows_agent_online(linked_win_id) if linked_win_id else self.is_windows_agent_online()

            return {
                "agent_id": agent.agent_id,
                "device_type": agent.device_type,
                "is_online": (now - agent.last_heartbeat) < self.heartbeat_timeout_seconds,
                "linked_windows_agent_id": linked_win_id,
                "windows_agent_online": win_online,
            }

    def queue_remote_action(self, windows_agent_id: str, action: Dict[str, Any]) -> str:
        """Enqueues an action requested by Android for execution by the Windows Agent."""
        with self._lock:
            if windows_agent_id not in self._action_queues:
                self._action_queues[windows_agent_id] = []
            action_id = f"act-{len(self._action_queues[windows_agent_id]) + 1}-{int(time.time() * 1000)}"
            action["action_id"] = action_id
            action["timestamp"] = time.time()
            action["status"] = "pending"
            self._action_queues[windows_agent_id].append(action)
            return action_id

    def poll_remote_actions(self, windows_agent_id: str) -> List[Dict[str, Any]]:
        """Polls pending actions for a Windows Agent."""
        with self._lock:
            actions = self._action_queues.get(windows_agent_id, [])
            pending = [a for a in actions if a.get("status") == "pending"]
            for a in pending:
                a["status"] = "in_progress"
            return pending

    def complete_remote_action(self, windows_agent_id: str, action_id: str, result: Dict[str, Any]) -> bool:
        """Marks an action as completed and stores the execution result."""
        with self._lock:
            actions = self._action_queues.get(windows_agent_id, [])
            for a in actions:
                if a.get("action_id") == action_id:
                    a["status"] = "completed"
                    a["result"] = result
                    a["completed_at"] = time.time()
                    return True
            return False

    def get_action_status(self, action_id: str) -> Optional[Dict[str, Any]]:
        """Finds status of an action across all queues."""
        with self._lock:
            for actions in self._action_queues.values():
                for a in actions:
                    if a.get("action_id") == action_id:
                        return a
            return None
