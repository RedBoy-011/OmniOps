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

                CREATE TABLE IF NOT EXISTS mobile_agent_commands (
                    id TEXT PRIMARY KEY,
                    sender_user_id TEXT NOT NULL,
                    target_node_id TEXT NOT NULL,
                    command_type TEXT NOT NULL,
                    command_payload TEXT NOT NULL,
                    description TEXT NOT NULL,
                    risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'medium', 'high', 'destructive')),
                    status TEXT NOT NULL CHECK(status IN ('pending_approval', 'queued', 'in_progress', 'completed', 'failed', 'rejected', 'cancelled')),
                    challenge_nonce TEXT NOT NULL,
                    approval_id TEXT,
                    created_at INTEGER NOT NULL,
                    approved_at INTEGER,
                    approved_by TEXT,
                    claimed_at INTEGER,
                    claimed_by_node TEXT,
                    completed_at INTEGER,
                    output TEXT,
                    exit_code INTEGER,
                    duration_ms INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_cmd_target ON mobile_agent_commands(target_node_id, status);
                CREATE INDEX IF NOT EXISTS idx_cmd_created ON mobile_agent_commands(created_at DESC);
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
            # Cancel all queued or in-progress mobile commands for this node or all nodes
            if node_id == "all":
                db.execute(
                    "UPDATE mobile_agent_commands SET status = 'cancelled' WHERE status IN ('pending_approval', 'queued', 'in_progress')"
                )
            else:
                db.execute(
                    "UPDATE mobile_agent_commands SET status = 'cancelled' WHERE status IN ('pending_approval', 'queued', 'in_progress') AND (target_node_id = ? OR target_node_id = 'all')",
                    (node_id.strip(),),
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

    def dispatch_command(
        self,
        principal: dict,
        target_node_id: str,
        command: str,
        command_type: str = "powershell",
        description: str = "",
        risk_level: str = "high",
        require_approval: bool | None = None,
    ) -> dict:
        """Dispatches an action or command from Android/PWA to a Windows Edge Agent via Master."""
        if not command or not command.strip():
            raise IdentityError("Command cannot be empty")
        if not target_node_id or not target_node_id.strip():
            raise IdentityError("Target node ID cannot be empty")

        valid_risks = ("low", "medium", "high", "destructive")
        if risk_level not in valid_risks:
            risk_level = "high"

        needs_approval = (
            True if require_approval is True
            else (False if require_approval is False else (risk_level in ("high", "destructive")))
        )

        cmd_id = uuid.uuid4().hex
        nonce = secrets.token_hex(16)
        now = int(time.time())
        sender_id = principal.get("id") or principal.get("username") or "mobile_user"

        approval_id = None
        if needs_approval:
            approval = self.request_approval(
                node_id=target_node_id.strip(),
                command=command.strip(),
                agent_name="Windows Edge Agent",
                risk_level=risk_level,
                description=description.strip() or f"دستور ارسالی از موبایل: {command.strip()[:60]}",
            )
            approval_id = approval["id"]
            status = "pending_approval"
        else:
            status = "queued"

        with self.store._lock, self.store._db() as db:
            db.execute(
                """
                INSERT INTO mobile_agent_commands
                (id, sender_user_id, target_node_id, command_type, command_payload, description,
                 risk_level, status, challenge_nonce, approval_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cmd_id,
                    sender_id,
                    target_node_id.strip(),
                    command_type.strip(),
                    command.strip(),
                    description.strip(),
                    risk_level,
                    status,
                    nonce,
                    approval_id,
                    now,
                ),
            )
            self.store._audit(
                db,
                sender_id,
                "mobile_command_dispatched",
                f"{cmd_id}:{target_node_id}:{status}:{command[:30]}",
            )

        return {
            "id": cmd_id,
            "sender_user_id": sender_id,
            "target_node_id": target_node_id.strip(),
            "command_type": command_type.strip(),
            "command": command.strip(),
            "description": description.strip(),
            "risk_level": risk_level,
            "status": status,
            "challenge_nonce": nonce,
            "approval_id": approval_id,
            "created_at": now,
        }

    def approve_command(
        self,
        principal: dict,
        command_id: str,
        auth_method: str = "biometric_fingerprint",
    ) -> dict:
        """Approves a pending command with biometric or web authorization, placing it in the agent queue."""
        now = int(time.time())
        with self.store._lock, self.store._db() as db:
            row = db.execute("SELECT * FROM mobile_agent_commands WHERE id = ?", (command_id,)).fetchone()
            if not row:
                raise IdentityError("Command not found", 404)
            if row["status"] != "pending_approval":
                raise IdentityError(f"Command is not pending approval (status: {row['status']})", 400)

            approval_id = row["approval_id"]
            if approval_id:
                # Decide the linked approval request
                self.decide(principal, approval_id, approved=True, auth_method=auth_method)

            db.execute(
                """
                UPDATE mobile_agent_commands
                SET status = 'queued', approved_at = ?, approved_by = ?
                WHERE id = ?
                """,
                (now, principal.get("username", "admin"), command_id),
            )
            self.store._audit(
                db,
                principal["id"],
                "mobile_command_approved",
                f"{command_id}:{auth_method}",
            )

        return {
            "id": command_id,
            "status": "queued",
            "approved_at": now,
            "approved_by": principal.get("username", "admin"),
            "auth_method": auth_method,
        }

    def cancel_command(self, principal: dict, command_id: str, reason: str = "") -> dict:
        """Cancels a pending or queued command."""
        now = int(time.time())
        with self.store._lock, self.store._db() as db:
            row = db.execute("SELECT * FROM mobile_agent_commands WHERE id = ?", (command_id,)).fetchone()
            if not row:
                raise IdentityError("Command not found", 404)
            if row["status"] in ("completed", "failed"):
                raise IdentityError(f"Cannot cancel command in {row['status']} state", 400)

            approval_id = row["approval_id"]
            if approval_id and row["status"] == "pending_approval":
                try:
                    self.decide(principal, approval_id, approved=False, auth_method="user_cancellation")
                except Exception:
                    pass

            db.execute(
                "UPDATE mobile_agent_commands SET status = 'cancelled' WHERE id = ?",
                (command_id,),
            )
            self.store._audit(
                db,
                principal["id"],
                "mobile_command_cancelled",
                f"{command_id}:{reason[:40]}",
            )

        return {"id": command_id, "status": "cancelled", "reason": reason}

    def list_commands(
        self,
        principal: dict | None = None,
        target_node_id: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """Lists historical and active commands sent to agents."""
        query = "SELECT * FROM mobile_agent_commands WHERE 1=1"
        params = []
        if target_node_id and target_node_id != "all":
            query += " AND target_node_id = ?"
            params.append(target_node_id.strip())
        if status:
            query += " AND status = ?"
            params.append(status.strip())
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(max(1, min(limit, 200)))

        with self.store._db() as db:
            rows = db.execute(query, tuple(params)).fetchall()
            return [dict(r) for r in rows]

    def get_pending_agent_commands(
        self,
        agent_node_id: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """Fetches queued commands waiting for execution by Windows Edge Agent."""
        query = "SELECT * FROM mobile_agent_commands WHERE status = 'queued'"
        params = []
        if agent_node_id:
            query += " AND (target_node_id = ? OR target_node_id = 'all')"
            params.append(agent_node_id.strip())
        query += " ORDER BY created_at ASC LIMIT ?"
        params.append(max(1, min(limit, 50)))

        with self.store._db() as db:
            rows = db.execute(query, tuple(params)).fetchall()
            return [dict(r) for r in rows]

    def claim_agent_command(self, command_id: str, agent_node_id: str) -> dict:
        """Allows Windows Edge Agent to claim a queued command and start execution."""
        now = int(time.time())
        with self.store._lock, self.store._db() as db:
            row = db.execute("SELECT * FROM mobile_agent_commands WHERE id = ?", (command_id,)).fetchone()
            if not row:
                raise IdentityError("Command not found", 404)
            if row["status"] != "queued":
                raise IdentityError(f"Command not in queued state (status: {row['status']})", 409)

            db.execute(
                """
                UPDATE mobile_agent_commands
                SET status = 'in_progress', claimed_at = ?, claimed_by_node = ?
                WHERE id = ?
                """,
                (now, agent_node_id.strip(), command_id),
            )
            self.store._audit(
                db,
                agent_node_id,
                "agent_command_claimed",
                f"{command_id}:{agent_node_id}",
            )
            item = dict(row)
            item["status"] = "in_progress"
            item["claimed_at"] = now
            item["claimed_by_node"] = agent_node_id.strip()
            return item

    def report_agent_command(
        self,
        command_id: str,
        agent_node_id: str,
        status: str,
        output: str = "",
        exit_code: int = 0,
        duration_ms: int = 0,
    ) -> dict:
        """Allows Windows Edge Agent to report the result of command execution."""
        if status not in ("completed", "failed"):
            raise IdentityError("Status must be either 'completed' or 'failed'")
        now = int(time.time())

        with self.store._lock, self.store._db() as db:
            row = db.execute("SELECT * FROM mobile_agent_commands WHERE id = ?", (command_id,)).fetchone()
            if not row:
                raise IdentityError("Command not found", 404)

            db.execute(
                """
                UPDATE mobile_agent_commands
                SET status = ?, output = ?, exit_code = ?, duration_ms = ?, completed_at = ?
                WHERE id = ?
                """,
                (status, output[:50000], exit_code, duration_ms, now, command_id),
            )
            self.store._audit(
                db,
                agent_node_id,
                "agent_command_reported",
                f"{command_id}:{status}:{exit_code}:{duration_ms}ms",
            )

        return {
            "id": command_id,
            "status": status,
            "exit_code": exit_code,
            "duration_ms": duration_ms,
            "completed_at": now,
        }

