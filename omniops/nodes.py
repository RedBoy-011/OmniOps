"""Durable identities for managed Worker and Edge nodes."""

import hashlib
import hmac
import json
import os
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
                CREATE TABLE IF NOT EXISTS model_pulls (
                    id TEXT PRIMARY KEY, node_id TEXT NOT NULL, model TEXT NOT NULL,
                    status TEXT NOT NULL, progress INTEGER, detail TEXT NOT NULL,
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
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
            columns = {row[1] for row in db.execute("PRAGMA table_info(model_pulls)")}
            if "action" not in columns:
                db.execute("ALTER TABLE model_pulls ADD COLUMN action TEXT NOT NULL DEFAULT 'pull'")

    def _now(self):
        return int(self.identity.clock())

    def _digest(self, value):
        return hmac.new(self.identity.signing_key, value.encode("ascii"), hashlib.sha256).digest()

    def _admin(self, principal):
        if principal.get("role") != "superadmin" or "profile.manage" not in principal.get("capabilities", []):
            raise IdentityError("Superadmin node permission required", 403)

    def issue(self, principal, role):
        self._admin(principal)
        return self._issue(role, principal["id"], "node_grant_issued")

    def issue_local_root(self, role):
        if not hasattr(os, "geteuid") or os.geteuid() != 0:
            raise IdentityError("Local root access required", 403)
        return self._issue(role, "system:local-root", "node_grant_issued_by_local_root")

    def _issue(self, role, actor_id, event):
        if role not in ("worker", "edge"):
            raise IdentityError("Invalid node role")
        raw = secrets.token_urlsafe(32)
        grant_id = uuid.uuid4().hex
        expires = self._now() + GRANT_TTL
        with self.identity._lock, self.identity._db() as db:
            db.execute("INSERT INTO node_grants VALUES (?,?,?,?,?,?,?)",
                       (grant_id, self._digest(raw), role, expires, None, None, actor_id))
            self.identity._audit(db, actor_id, event, grant_id)
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

    def enroll(self, grant, name, requested_role=None):
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
            if requested_role is not None and requested_role != row["role"]:
                raise IdentityError("Node grant does not match this installer role", 403)
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
        if not isinstance(metrics, dict) or len(json.dumps(metrics)) > 65536:
            raise IdentityError("Invalid node metrics")
        allowed = {"version", "cpu_percent", "ram_percent", "disk_percent", "disk_total_gb", "disk_used_gb", "disk_free_gb", "disk_breakdown", "models"}
        if set(metrics) - allowed or any(key in metrics and (not isinstance(metrics[key], (int, float)) or isinstance(metrics[key], bool) or not math.isfinite(metrics[key]) or not 0 <= metrics[key] <= 100) for key in ("cpu_percent", "ram_percent", "disk_percent")):
            raise IdentityError("Invalid node metrics")
        if any(key in metrics and (not isinstance(metrics[key], (int, float)) or isinstance(metrics[key], bool) or not math.isfinite(metrics[key]) or metrics[key] < 0) for key in ("disk_total_gb", "disk_used_gb", "disk_free_gb")):
            raise IdentityError("Invalid node metrics")
        if "disk_breakdown" in metrics and not isinstance(metrics["disk_breakdown"], dict):
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

    def delete(self, principal, node_id):
        self._admin(principal)
        if not isinstance(node_id, str) or not re.fullmatch(r"[0-9a-f]{32}", node_id):
            raise IdentityError("Invalid node ID")
        with self.identity._lock, self.identity._db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM model_pulls WHERE node_id=?", (node_id,))
            changed = db.execute("DELETE FROM managed_nodes WHERE id=?", (node_id,)).rowcount
            if not changed:
                raise IdentityError("Node not found", 404)
            self.identity._audit(db, principal["id"], "node_deleted", node_id)

    def _enrich_breakdown_with_db_failures(self, db, node_id, breakdown):
        if not isinstance(breakdown, dict):
            return breakdown
        try:
            failed_rows = db.execute(
                "SELECT id, model, detail, updated_at FROM model_pulls WHERE node_id=? AND status='failed' ORDER BY updated_at DESC LIMIT 20",
                (node_id,)
            ).fetchall()
            if failed_rows:
                failed_category = breakdown.get("failed_models") or {
                    "count": 0, "size_bytes": 0, "size_gb": 0.0, "size_mb": 0.0, "items": []
                }
                items = list(failed_category.get("items") or [])
                existing_names = {it.get("name") for it in items if isinstance(it, dict)}
                added = 0
                for r in failed_rows:
                    if r["model"] not in existing_names:
                        items.append({
                            "name": r["model"],
                            "path": f"job:{r['id']}",
                            "size_bytes": 0,
                            "size_mb": 0.0,
                            "size_gb": 0.0,
                            "reason": f"خطا در دانلود یا استقرار مدل: {r['detail']}"
                        })
                        existing_names.add(r["model"])
                        added += 1
                if added > 0:
                    failed_category["items"] = items[:20]
                    failed_category["count"] = max(failed_category.get("count", 0), len(items))
                    breakdown["failed_models"] = failed_category
                    diags = breakdown.get("diagnostics") or []
                    diags = [d for d in diags if "دیسک در وضعیت بهینه است" not in d]
                    diags.append(f"مدل‌های ناموفق ثبت‌شده در پایگاه: {len(items)} مورد خطا")
                    breakdown["diagnostics"] = diags
        except Exception:
            pass
        return breakdown

    def list_nodes(self, principal):
        self._admin(principal)
        with self.identity._db() as db:
            rows = db.execute("SELECT id, role, name, credential_expires_at, created_at, last_seen, metrics, revoked_at FROM managed_nodes ORDER BY created_at DESC").fetchall()
            nodes = []
            for row in rows:
                item = {key: row[key] for key in row.keys() if key != "metrics"}
                metrics = json.loads(row["metrics"]) if row["metrics"] else None
                if metrics and item.get("role") == "worker":
                    if "disk_breakdown" in metrics and metrics["disk_breakdown"]:
                        metrics["disk_breakdown"] = self._enrich_breakdown_with_db_failures(db, item["id"], metrics["disk_breakdown"])
                item["metrics"] = metrics
                nodes.append(item)
            return nodes

    def get_node(self, principal, node_id):
        self._admin(principal)
        if not isinstance(node_id, str) or not re.fullmatch(r"[0-9a-f]{32}", node_id):
            raise IdentityError("Invalid node ID")
        with self.identity._lock, self.identity._db() as db:
            row = db.execute("SELECT * FROM managed_nodes WHERE id=?", (node_id,)).fetchone()
            if row is None:
                raise IdentityError("Node not found", 404)
            item = {key: row[key] for key in row.keys() if key != "metrics"}
            item["metrics"] = json.loads(row["metrics"]) if row["metrics"] else None
            return item

    def authenticate_node(self, node_id, credential):
        with self.identity._lock, self.identity._db() as db:
            row = self._authenticated(db, node_id, credential)
            item = {key: row[key] for key in row.keys() if key != "metrics"}
            item["metrics"] = json.loads(row["metrics"]) if row["metrics"] else None
            return item

    def clean_node_disk(self, principal, node_id, targets=None):
        self._admin(principal)
        if not isinstance(node_id, str) or not re.fullmatch(r"[0-9a-f]{32}", node_id):
            raise IdentityError("Invalid node ID")
        with self.identity._lock, self.identity._db() as db:
            db.execute("BEGIN IMMEDIATE")
            node = db.execute("SELECT * FROM managed_nodes WHERE id=?", (node_id,)).fetchone()
            if node is None or node["role"] != "worker" or node["revoked_at"] is not None:
                raise IdentityError("Active Worker not found", 404)
            from omniops.node_client import diagnose_worker_disk
            result = diagnose_worker_disk(clean=True)
            self.identity._audit(db, principal["id"], "worker_disk_cleaned", node_id)
            return {
                "status": "ok",
                "node_id": node_id,
                "freed_bytes": result.get("freed_bytes", 0),
                "freed_gb": result.get("freed_gb", 0.0),
                "message": f"عملیات پاکسازی با موفقیت انجام شد ({result.get('freed_gb', 0)} گیگابایت آزاد شد)."
            }

    def get_node_disk_diagnostics(self, principal, node_id):
        self._admin(principal)
        if not isinstance(node_id, str) or not re.fullmatch(r"[0-9a-f]{32}", node_id):
            raise IdentityError("Invalid node ID")
        with self.identity._db() as db:
            node = db.execute("SELECT * FROM managed_nodes WHERE id=?", (node_id,)).fetchone()
            if node is None or node["role"] != "worker" or node["revoked_at"] is not None:
                raise IdentityError("Active Worker not found", 404)
            metrics = json.loads(node["metrics"]) if node["metrics"] else {}
            breakdown = metrics.get("disk_breakdown")
            if not breakdown:
                from omniops.node_client import diagnose_worker_disk
                breakdown = diagnose_worker_disk(clean=False)
            breakdown = self._enrich_breakdown_with_db_failures(db, node_id, breakdown)
            return breakdown

    def optimize_worker_resources(self, principal, node_id):
        self._admin(principal)
        if not isinstance(node_id, str) or not re.fullmatch(r"[0-9a-f]{32}", node_id):
            raise IdentityError("Invalid node ID")
        with self.identity._lock, self.identity._db() as db:
            db.execute("BEGIN IMMEDIATE")
            node = db.execute("SELECT * FROM managed_nodes WHERE id=?", (node_id,)).fetchone()
            if node is None or node["role"] != "worker" or node["revoked_at"] is not None:
                raise IdentityError("Active Worker not found", 404)

            before_metrics = json.loads(node["metrics"]) if node["metrics"] else {}
            before_total = float(before_metrics.get("disk_total_gb") or 0.0)
            before_used = float(before_metrics.get("disk_used_gb") or 0.0)
            before_free = float(before_metrics.get("disk_free_gb") or 0.0)
            before_pct = float(before_metrics.get("disk_percent") or 0.0)
            healthy_models = list(before_metrics.get("models") or [])

            # Clear failed model pull jobs in database
            failed_rows = db.execute("SELECT id, model FROM model_pulls WHERE node_id=? AND status='failed'", (node_id,)).fetchall()
            failed_count = len(failed_rows)
            if failed_count > 0:
                db.execute("DELETE FROM model_pulls WHERE node_id=? AND status='failed'", (node_id,))

            # Execute safe disk cleanup (cleans temp files and incomplete model layers, preserves healthy models)
            from omniops.node_client import diagnose_worker_disk, get_local_disk_metrics
            clean_res = diagnose_worker_disk(clean=True)
            freed_bytes = clean_res.get("freed_bytes", 0)
            freed_gb = clean_res.get("freed_gb", 0.0)
            incomplete_count = clean_res.get("incomplete_models", {}).get("count", 0)
            temp_count = clean_res.get("temp_files", {}).get("count", 0)
            wasted_before_gb = clean_res.get("total_wasted_gb", 0.0)

            # Recompute or estimate updated metrics
            sys_total, sys_used, sys_free, sys_pct = get_local_disk_metrics()
            if sys_total > 0:
                after_total, after_used, after_free, after_pct = sys_total, sys_used, sys_free, sys_pct
            elif before_total > 0:
                after_total = before_total
                after_used = max(0.0, round(before_used - freed_gb, 2))
                after_free = min(after_total, round(before_free + freed_gb, 2))
                after_pct = round((after_used / after_total) * 100.0, 1) if after_total > 0 else 0.0
            else:
                after_total, after_used, after_free, after_pct = 0.0, 0.0, 0.0, 0.0

            after_metrics = dict(before_metrics)
            after_metrics["disk_total_gb"] = after_total
            after_metrics["disk_used_gb"] = after_used
            after_metrics["disk_free_gb"] = after_free
            after_metrics["disk_percent"] = after_pct
            after_metrics["disk_breakdown"] = {
                "total_wasted_bytes": 0,
                "total_wasted_gb": 0.0,
                "freed_bytes": freed_bytes,
                "freed_gb": freed_gb,
                "incomplete_models": {"count": 0, "size_bytes": 0, "size_gb": 0.0, "size_mb": 0.0, "items": []},
                "failed_models": {"count": 0, "size_bytes": 0, "size_gb": 0.0, "size_mb": 0.0, "items": []},
                "temp_files": {"count": 0, "size_bytes": 0, "size_gb": 0.0, "size_mb": 0.0, "items": []},
                "diagnostics": ["منابع Worker با موفقیت پالایش و بهینه‌سازی شدند. فضای دیسک در وضعیت ایده‌آل است."]
            }
            # Preserve healthy models intact
            after_metrics["models"] = healthy_models
            db.execute("UPDATE managed_nodes SET metrics=? WHERE id=?", (json.dumps(after_metrics), node_id))

            # Audit logging
            self.identity._audit(db, principal["id"], "worker_resources_optimized", node_id)

            actions = []
            if incomplete_count > 0:
                actions.append(f"پاکسازی {incomplete_count} فایل و لایه ناقص ناشی از دانلود ناتمام مدل‌ها")
            else:
                actions.append("پایش لایه‌ها: لایه یا فایل ناقصی یافت نشد")

            if failed_count > 0:
                actions.append(f"حذف و پاکسازی بقایای {failed_count} مدل ناموفق از صف و پایگاه داده")
            else:
                actions.append("پایش مدل‌ها: مدل ناموفقی در صف یا پایگاه وجود نداشت")

            if temp_count > 0:
                actions.append(f"پاکسازی {temp_count} فایل موقت، بافر و کش‌های منقضی سیستم Worker")
            else:
                actions.append("پایش موقت: فایل موقت منقضی‌شده‌ای وجود نداشت")

            actions.append(f"تأییدیه نهایی: تعداد {len(healthy_models)} مدل سالم بدون هیچ آسیبی حفظ شدند")

            return {
                "status": "ok",
                "node_id": node_id,
                "node_name": node["name"],
                "optimized_at": self._now(),
                "before": {
                    "disk_total_gb": before_total,
                    "disk_used_gb": before_used,
                    "disk_free_gb": before_free,
                    "disk_percent": before_pct,
                    "wasted_gb": wasted_before_gb,
                    "incomplete_count": incomplete_count,
                    "failed_count": failed_count,
                    "temp_count": temp_count
                },
                "after": {
                    "disk_total_gb": after_total,
                    "disk_used_gb": after_used,
                    "disk_free_gb": after_free,
                    "disk_percent": after_pct,
                    "wasted_gb": 0.0,
                    "freed_gb": freed_gb,
                    "freed_bytes": freed_bytes
                },
                "actions_taken": actions,
                "healthy_models": {
                    "count": len(healthy_models),
                    "models": healthy_models,
                    "status": "دست‌نخورده و کاملاً سالم"
                },
                "audit_event": "worker_resources_optimized"
            }


    def queue_model_pull_local_root(self, node_id, model):
        if not hasattr(os, 'geteuid') or os.geteuid() != 0:
            raise IdentityError('Local root access required', 403)
        return self.queue_model_pull({'id': 'system:local-root', 'role': 'superadmin',
                                      'capabilities': ['profile.manage']}, node_id, model)

    def queue_model_delete_local_root(self, node_id, model):
        if not hasattr(os, 'geteuid') or os.geteuid() != 0:
            raise IdentityError('Local root access required', 403)
        return self.queue_model_delete({'id': 'system:local-root', 'role': 'superadmin',
                                        'capabilities': ['profile.manage']}, node_id, model)

    def queue_model_pull(self, principal, node_id, model):
        return self._queue_model_job(principal, node_id, model, 'pull')

    def queue_model_delete(self, principal, node_id, model):
        return self._queue_model_job(principal, node_id, model, 'delete')

    def _queue_model_job(self, principal, node_id, model, action):
        self._admin(principal)
        if action not in ('pull', 'delete'):
            raise IdentityError('Invalid model action')
        if not isinstance(node_id, str) or not re.fullmatch(r"[0-9a-f]{32}", node_id):
            raise IdentityError("Invalid worker ID")
        if not isinstance(model, str) or len(model) > 128 or not re.fullmatch(
                r"[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?", model
        ) or '..' in model or '//' in model:
            raise IdentityError("Invalid Ollama model name")
        with self.identity._lock, self.identity._db() as db:
            db.execute("BEGIN IMMEDIATE")
            node = db.execute("SELECT role, last_seen, revoked_at FROM managed_nodes WHERE id=?", (node_id,)).fetchone()
            if node is None or node['role'] != 'worker' or node['revoked_at'] is not None:
                raise IdentityError("Active Worker not found", 404)
            if node['last_seen'] is None or self._now() - node['last_seen'] >= 90:
                raise IdentityError("Worker is offline", 409)
            existing = db.execute("SELECT 1 FROM model_pulls WHERE node_id=? AND status IN ('queued','running')",
                                  (node_id,)).fetchone()
            if existing:
                raise IdentityError("Worker already has a model operation", 409)
            job_id = uuid.uuid4().hex
            now = self._now()
            db.execute("INSERT INTO model_pulls (id,node_id,model,status,progress,detail,created_at,updated_at,created_by,action) VALUES (?,?,?,?,?,?,?,?,?,?)",
                       (job_id, node_id, model, 'queued', None, 'در صف', now, now, principal['id'], action))
            self.identity._audit(db, principal['id'], 'model_' + action + '_queued', job_id)
        return {'id': job_id, 'status': 'queued'}

    def list_model_pulls(self, principal):
        self._admin(principal)
        with self.identity._db() as db:
            rows = db.execute("SELECT id, node_id, model, status, progress, detail, created_at, updated_at, action "
                              "FROM model_pulls ORDER BY created_at DESC LIMIT 100").fetchall()
            return [dict(row) for row in rows]

    def cancel_model_pull(self, principal, job_id):
        self._admin(principal)
        if not isinstance(job_id, str):
            raise IdentityError("Invalid job ID", 400)
        with self.identity._lock, self.identity._db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM model_pulls WHERE id=?", (job_id,))
            self.identity._audit(db, principal["id"], "model_pull_dismissed", job_id)
        return {"status": "ok", "id": job_id}

    def claim_model_pull(self, node_id, credential):
        with self.identity._lock, self.identity._db() as db:
            db.execute('BEGIN IMMEDIATE')
            node = self._authenticated(db, node_id, credential)
            if node['role'] != 'worker':
                raise IdentityError('Worker role required', 403)
            # Job-e ghat shodeh bad az panj daghigheh dobareh dar saf gharar migirad.
            db.execute("UPDATE model_pulls SET status='queued', detail='تلاش دوباره پس از قطع Worker', "
                       "updated_at=? WHERE node_id=? AND status='running' AND updated_at<? AND action='pull'",
                       (self._now(), node_id, self._now()-300))
            db.execute("UPDATE model_pulls SET status='failed', detail='Delete result unknown after Worker disconnect; check inventory', "
                       "updated_at=? WHERE node_id=? AND status='running' AND updated_at<? AND action='delete'",
                       (self._now(), node_id, self._now()-300))
            active = db.execute("SELECT id FROM model_pulls WHERE node_id=? AND status='running'", (node_id,)).fetchone()
            if active:
                return None
            row = db.execute("SELECT id, model, action FROM model_pulls WHERE node_id=? AND status='queued' "
                             "ORDER BY created_at LIMIT 1", (node_id,)).fetchone()
            if row is None:
                return None
            db.execute("UPDATE model_pulls SET status='running', detail=?, updated_at=? WHERE id=?",
                       ('Starting deletion' if row['action'] == 'delete' else 'Starting download', self._now(), row['id']))
            return dict(row)

    def report_model_pull(self, node_id, credential, job_id, status, progress, detail):
        if status not in ('running', 'completed', 'failed') or not isinstance(detail, str) or len(detail) > 160:
            raise IdentityError('Invalid model download status')
        if progress is not None and (type(progress) is not int or not 0 <= progress <= 100):
            raise IdentityError('Invalid model download progress')
        if not isinstance(job_id, str) or not re.fullmatch(r'[0-9a-f]{32}', job_id):
            raise IdentityError('Invalid model download ID')
        with self.identity._lock, self.identity._db() as db:
            db.execute('BEGIN IMMEDIATE')
            node = self._authenticated(db, node_id, credential)
            if node['role'] != 'worker':
                raise IdentityError('Worker role required', 403)
            changed = db.execute("UPDATE model_pulls SET status=?, progress=?, detail=?, updated_at=? "
                                 "WHERE id=? AND node_id=? AND status='running'",
                                 (status, progress, detail, self._now(), job_id, node_id)).rowcount
            if not changed:
                raise IdentityError('Active model download not found', 404)
            if status != 'running':
                action = db.execute('SELECT action FROM model_pulls WHERE id=?', (job_id,)).fetchone()['action']
                self.identity._audit(db, node_id, 'model_' + action + '_' + status, job_id)
        return {'status': status}
