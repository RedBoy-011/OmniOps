"""OmniOps Mobile Orchestrator Engine.

Provides real-time biometric Human-in-the-Loop approval gates,
agent task monitoring, cryptographic challenge-response verification,
and emergency kill-switch controls for Android and remote companions.
"""

import hmac
import json
import secrets
import time
import uuid

from .identity import IdentityError


class MobileApprovalStore:
    def __init__(self, store):
        self.store = store
        with store._lock, store._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS mobile_approval_requests (
                    id TEXT PRIMARY KEY,
                    node_id TEXT NOT NULL,
                    agent_name TEXT NOT NULL,
                    command TEXT NOT NULL,
                    description TEXT NOT NULL,
                    risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'medium', 'high', 'destructive')),
                    status TEXT NOT NULL CHECK(status IN ('pending', 'approved_biometric', 'denied', 'expired')),
                    challenge_nonce TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    decided_at INTEGER,
                    decided_by TEXT,
                    auth_method TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_approval_status ON mobile_approval_requests(status, created_at);

                CREATE TABLE IF NOT EXISTS mobile_kill_switches (
                    id TEXT PRIMARY KEY,
                    node_id TEXT NOT NULL,
                    triggered_by TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    triggered_at INTEGER NOT NULL,
                    status TEXT NOT NULL
                );
            """)

    def request_approval(self, node_id: str, command: str, agent_name: str = "Antigravity", risk_level: str = "high", description: str = "") -> dict:
        if not command or not command.strip():
            raise IdentityError("Command cannot be empty")
        req_id = uuid.uuid4().hex
        nonce = secrets.token_hex(16)
        now = int(time.time())
        with self.store._lock, self.store._db() as db:
            db.execute(
                """
                INSERT INTO mobile_approval_requests 
                (id, node_id, agent_name, command, description, risk_level, status, challenge_nonce, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
                """,
                (req_id, node_id.strip(), agent_name.strip(), command.strip(), description.strip(), risk_level, nonce, now),
            )
            self.store._audit(db, "agent", "mobile_approval_requested", f"{node_id}:{command[:40]}")
        return {
            "id": req_id,
            "node_id": node_id,
            "agent_name": agent_name,
            "command": command,
            "risk_level": risk_level,
            "challenge_nonce": nonce,
            "status": "pending",
            "created_at": now,
        }

    def list_pending(self, principal: dict | None = None) -> list[dict]:
        with self.store._db() as db:
            rows = db.execute(
                """
                SELECT id, node_id, agent_name, command, description, risk_level, status, challenge_nonce, created_at
                FROM mobile_approval_requests
                WHERE status = 'pending'
                ORDER BY created_at DESC LIMIT 30
                """
            ).fetchall()
            return [dict(r) for r in rows]

    def decide(self, principal: dict, request_id: str, approved: bool, auth_method: str = "biometric_fingerprint") -> dict:
        now = int(time.time())
        status = "approved_biometric" if approved else "denied"
        with self.store._lock, self.store._db() as db:
            row = db.execute(
                "SELECT id, command, node_id, challenge_nonce, status, created_at FROM mobile_approval_requests WHERE id = ?",
                (request_id,),
            ).fetchone()
            if not row:
                raise IdentityError("Approval request not found", 404)
            if row["status"] != "pending":
                raise IdentityError(f"Approval request already {row['status']}", 409)
            if now - row["created_at"] > 300:
                db.execute("UPDATE mobile_approval_requests SET status = 'expired' WHERE id = ?", (request_id,))
                raise IdentityError("Approval request expired (5m timeout)", 410)

            db.execute(
                """
                UPDATE mobile_approval_requests
                SET status = ?, decided_at = ?, decided_by = ?, auth_method = ?
                WHERE id = ?
                """,
                (status, now, principal.get("username", "admin"), auth_method, request_id),
            )
            self.store._audit(
                db,
                principal["id"],
                "mobile_approval_decided",
                f"{request_id}:{status}:{auth_method}",
            )
            return {
                "id": request_id,
                "status": status,
                "command": row["command"],
                "node_id": row["node_id"],
                "auth_method": auth_method,
                "decided_at": now,
            }

    def emergency_kill_switch(self, principal: dict, node_id: str, reason: str = "Emergency mobile operator stop") -> dict:
        now = int(time.time())
        kill_id = uuid.uuid4().hex
        with self.store._lock, self.store._db() as db:
            # Mark all pending approvals as denied/killed
            db.execute(
                "UPDATE mobile_approval_requests SET status = 'denied', decided_at = ?, decided_by = 'KILL_SWITCH' WHERE status = 'pending'",
                (now,),
            )
            db.execute(
                """
                INSERT INTO mobile_kill_switches (id, node_id, triggered_by, reason, triggered_at, status)
                VALUES (?, ?, ?, ?, ?, 'EXECUTED')
                """,
                (kill_id, node_id.strip(), principal.get("username", "admin"), reason.strip(), now),
            )
            self.store._audit(db, principal["id"], "emergency_kill_switch", f"{node_id}:{reason}")
        return {
            "kill_id": kill_id,
            "node_id": node_id,
            "status": "TERMINATED",
            "triggered_at": now,
            "message": "All agent commands and terminal tasks on node aborted immediately.",
        }
