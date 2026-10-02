"""Durable identities for managed Worker and Edge nodes."""

import hashlib
import hmac
import json
import math
import re
import secrets
import uuid

from .identity import IdentityError

GRANT_TTL = 600
CREDENTIAL_TTL = 30 * 86400


class NodeRegistry:
    def __init__(self, identity):
        self.identity = identity
        with identity._lock, identity._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS node_grants (
                    id TEXT PRIMARY KEY, token_hash BLOB UNIQUE NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('worker','edge')),
                    expires_at INTEGER NOT NULL, used_at INTEGER, revoked_at INTEGER,
                    created_by TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS managed_nodes (
                    id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('worker','edge')),
                    name TEXT NOT NULL, credential_hash BLOB NOT NULL,
                    credential_expires_at INTEGER NOT NULL,
                    created_at INTEGER NOT NULL, last_seen INTEGER,
                    metrics TEXT, revoked_at INTEGER
                );
            """)

    def _now(self):
        return int(self.identity.clock())

    def _digest(self, value):
        return hmac.new(self.identity.signing_key, value.encode("ascii"), hashlib.sha256).digest()

    def _admin(self, principal):
        if principal.get("role") != "superadmin" or "profile.manage" not in principal.get("capabilities", []):
            raise IdentityError("Superadmin node permission required", 403)

    def issue(self, principal, role):
        self._admin(principal)
        if role not in ("worker", "edge"):
            raise IdentityError("Invalid node role")
        raw = secrets.token_urlsafe(32)
        grant_id = uuid.uuid4().hex
        expires = self._now() + GRANT_TTL
        with self.identity._lock, self.identity._db() as db:
            db.execute("INSERT INTO node_grants VALUES (?,?,?,?,?,?,?)",
                       (grant_id, self._digest(raw), role, expires, None, None, principal["id"]))
            self.identity._audit(db, principal["id"], "node_grant_issued", grant_id)
        return {"id": grant_id, "grant": raw, "role": role, "expires_at": expires}

    def cancel_grant(self, principal, grant_id):
        self._admin(principal)
        with self.identity._lock, self.identity._db() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute("UPDATE node_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL AND used_at IS NULL",
                                 (self._now(), grant_id)).rowcount
            if not changed:
                raise IdentityError("Active grant not found", 404)
            self.identity._audit(db, principal["id"], "node_grant_revoked", grant_id)

    def enroll(self, grant, name):
        if not isinstance(grant, str) or not re.fullmatch(r"[A-Za-z0-9_-]{40,100}", grant):
            raise IdentityError("Invalid or expired node grant", 401)
        if not isinstance(name, str) or not re.fullmatch(r"[\w. -]{1,64}", name, re.UNICODE):
            raise IdentityError("Invalid node name")
        now = self._now()
        credential = secrets.token_urlsafe(32)
        node_id = uuid.uuid4().hex
        with self.identity._lock, self.identity._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT id, role FROM node_grants WHERE token_hash=? AND used_at IS NULL "
                             "AND revoked_at IS NULL AND expires_at>?", (self._digest(grant), now)).fetchone()
            if row is None:
                raise IdentityError("Invalid or expired node grant", 401)
            db.execute("UPDATE node_grants SET used_at=? WHERE id=?", (now, row["id"]))
            db.execute("INSERT INTO managed_nodes VALUES (?,?,?,?,?,?,?,?,?)",
                       (node_id, row["role"], name.strip(), self._digest(credential),
                        now + CREDENTIAL_TTL, now, None, None, None))
            self.identity._audit(db, None, "node_enrolled", node_id)
        return {"id": node_id, "role": row["role"], "credential": credential,
                "credential_expires_at": now + CREDENTIAL_TTL}

    def _authenticated(self, db, node_id, credential):
        if not isinstance(node_id, str) or not isinstance(credential, str) or not re.fullmatch(r"[A-Za-z0-9_-]{40,100}", credential):
            raise IdentityError("Invalid node credential", 401)
        row = db.execute("SELECT * FROM managed_nodes WHERE id=?", (node_id,)).fetchone()
        if row is None or row["revoked_at"] is not None or row["credential_expires_at"] <= self._now() or not hmac.compare_digest(row["credential_hash"], self._digest(credential)):
            raise IdentityError("Invalid node credential", 401)
        return row

    def heartbeat(self, node_id, credential, metrics):
        if not isinstance(metrics, dict) or len(json.dumps(metrics)) > 2048:
            raise IdentityError("Invalid node metrics")
        allowed = {"version", "cpu_percent", "ram_percent", "disk_percent", "models"}
        if set(metrics) - allowed or any(key in metrics and (not isinstance(metrics[key], (int, float)) or isinstance(metrics[key], bool) or not math.isfinite(metrics[key]) or not 0 <= metrics[key] <= 100) for key in ("cpu_percent", "ram_percent", "disk_percent")):
            raise IdentityError("Invalid node metrics")
        if "version" in metrics and (not isinstance(metrics["version"], str) or len(metrics["version"]) > 64):
            raise IdentityError("Invalid node version")
        if "models" in metrics and (not isinstance(metrics["models"], list) or len(metrics["models"]) > 100 or any(not isinstance(model, str) or len(model) > 128 for model in metrics["models"])):
            raise IdentityError("Invalid node models")
        with self.identity._lock, self.identity._db() as db:
            db.execute("BEGIN IMMEDIATE")
            node = self._authenticated(db, node_id, credential)
            db.execute("UPDATE managed_nodes SET last_seen=?, metrics=? WHERE id=?",
                       (self._now(), json.dumps(metrics), node_id))
        return {"status": "ok", "checked_at": self._now(), "credential_expires_at": node["credential_expires_at"]}

    def rotate(self, node_id, credential, next_credential):
        if not isinstance(next_credential, str) or not re.fullmatch(r"[A-Za-z0-9_-]{40,100}", next_credential) or next_credential == credential:
            raise IdentityError("Invalid replacement node credential")
        with self.identity._lock, self.identity._db() as db:
            db.execute("BEGIN IMMEDIATE")
            self._authenticated(db, node_id, credential)
            expires = self._now() + CREDENTIAL_TTL
            db.execute("UPDATE managed_nodes SET credential_hash=?, credential_expires_at=? WHERE id=?",
                       (self._digest(next_credential), expires, node_id))
            self.identity._audit(db, node_id, "node_credential_rotated", node_id)
        return {"credential_expires_at": expires}

    def revoke(self, principal, node_id):
        self._admin(principal)
        with self.identity._lock, self.identity._db() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute("UPDATE managed_nodes SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
                                 (self._now(), node_id)).rowcount
            if not changed:
                raise IdentityError("Active node not found", 404)
            self.identity._audit(db, principal["id"], "node_revoked", node_id)

    def list_nodes(self, principal):
        self._admin(principal)
        with self.identity._db() as db:
            rows = db.execute("SELECT id, role, name, credential_expires_at, created_at, last_seen, metrics, revoked_at FROM managed_nodes ORDER BY created_at DESC").fetchall()
            return [{**{key: row[key] for key in row.keys() if key != "metrics"},
                     "metrics": json.loads(row["metrics"]) if row["metrics"] else None} for row in rows]
