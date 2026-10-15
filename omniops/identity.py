"""Hoviat-e yek sazman, saf-e taeed va jofte-sazi-e movaghat-e agent."""

import base64
import binascii
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


WEB_TTL = 30 * 86400
AGENT_TTL = 8 * 3600
AGENT_LEASE = 50
PIN_TTL = 120
PASSWORD_N, PASSWORD_R, PASSWORD_P = 1 << 14, 8, 5
DEFAULT_CAPABILITIES = ("chat",)
ADMIN_CAPABILITIES = (
    "chat", "skill.use", "tool.read", "action.request", "action.approve",
    "agent.pair", "user.approve", "profile.manage", "provider.manage", "provider.use",
)
DEFAULT_HOURLY_CHAT_LIMIT = 60


class IdentityError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _password_hash(password: str) -> str:
    if not isinstance(password, str) or not 4 <= len(password) <= 1024:
        raise IdentityError("Password must contain 4–1024 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=PASSWORD_N, r=PASSWORD_R,
        p=PASSWORD_P, maxmem=64 * 1024 * 1024, dklen=32,
    )
    return f"scrypt${PASSWORD_N}${PASSWORD_R}${PASSWORD_P}${_b64(salt)}${_b64(digest)}"


def _verify_password(password: str, saved: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = saved.split("$")
        if algorithm != "scrypt" or (int(n), int(r), int(p)) != (PASSWORD_N, PASSWORD_R, PASSWORD_P):
            return False
        digest = hashlib.scrypt(
            password.encode(), salt=_unb64(salt), n=PASSWORD_N, r=PASSWORD_R,
            p=PASSWORD_P, maxmem=64 * 1024 * 1024, dklen=32,
        )
        return hmac.compare_digest(digest, _unb64(expected))
    except (ValueError, TypeError):
        return False


def _normalize_mobile(mobile: str) -> str:
    if not isinstance(mobile, str):
        raise IdentityError("Mobile number is required")
    digits = mobile.strip().translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
    if not re.fullmatch(r"(?:\+98|0)9\d{9}", digits):
        raise IdentityError("Enter a valid Iranian mobile number")
    return "+98" + digits[-10:]


def _normalize_username(username: str) -> tuple[str, str]:
    if not isinstance(username, str):
        raise IdentityError("Username is required")
    display = username.strip()
    if not re.fullmatch(r"[\w.-]{3,32}", display, re.UNICODE):
        raise IdentityError("Username must contain 3–32 letters, numbers, dots or hyphens")
    return display, display.casefold()


class IdentityStore:
    def __init__(self, path: str | Path, signing_key: bytes, clock=time.time):
        if len(signing_key) < 32:
            raise ValueError("Signing key needs at least 32 random bytes")
        self.path = str(path)
        self.signing_key = signing_key
        self.clock = clock
        self._lock = threading.RLock()
        with self._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT UNIQUE NOT NULL,
                    mobile TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending','active','rejected')),
                    role TEXT NOT NULL CHECK(role IN ('superadmin','member')),
                    capabilities TEXT NOT NULL, created_at INTEGER NOT NULL,
                    decided_by TEXT, decided_at INTEGER
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    jti TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    audience TEXT NOT NULL CHECK(audience IN ('web','agent')),
                    device_id TEXT, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
                    revoked INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS pairings (
                    user_id TEXT PRIMARY KEY REFERENCES users(id), code_hash BLOB UNIQUE NOT NULL,
                    expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS rate_limits (
                    scope TEXT PRIMARY KEY, window_at INTEGER NOT NULL, failures INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audit (
                    id TEXT PRIMARY KEY, actor_id TEXT, event TEXT NOT NULL,
                    subject_id TEXT, created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS settings (
                    name TEXT PRIMARY KEY, value TEXT NOT NULL,
                    changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL
                );
            """)

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=5000")
        try:
            with db:
                yield db
        finally:
            db.close()

    def _audit(self, db, actor: str | None, event: str, subject: str | None):
        db.execute("INSERT INTO audit VALUES (?,?,?,?,?)", (uuid.uuid4().hex, actor, event, subject, int(self.clock())))

    def ollama_endpoint(self) -> str | None:
        with self._db() as db:
            row = db.execute("SELECT value FROM settings WHERE name=?", ("ollama_endpoint",)).fetchone()
            return row["value"] if row else None

    def set_ollama_endpoint(self, principal: dict, endpoint: str):
        if principal.get("role") != "superadmin" or "provider.manage" not in principal.get("capabilities", []):
            raise IdentityError("Superadmin provider permission required", 403)
        with self._lock, self._db() as db:
            db.execute("INSERT INTO settings (name, value, changed_by, changed_at) VALUES (?, ?, ?, ?) "
                       "ON CONFLICT(name) DO UPDATE SET value=excluded.value, "
                       "changed_by=excluded.changed_by, changed_at=excluded.changed_at",
                       ("ollama_endpoint", endpoint, principal["id"], int(self.clock())))
            self._audit(db, principal["id"], "ollama_endpoint_changed", None)

    def theme_palette(self) -> str:
        with self._db() as db:
            row = db.execute("SELECT value FROM settings WHERE name=?", ("theme_palette",)).fetchone()
            val = row["value"] if row else None
            return val if val in ("magenta", "cyan", "emerald", "amber", "indigo") else "magenta"

    def set_theme_palette(self, principal: dict, palette: str) -> str:
        if principal.get("role") != "superadmin":
            raise IdentityError("Superadmin permission required to change system theme", 403)
        p = str(palette or "").strip().lower()
        if p not in ("magenta", "cyan", "emerald", "amber", "indigo"):
            raise IdentityError("Invalid theme palette", 400)
        with self._lock, self._db() as db:
            db.execute("INSERT INTO settings (name, value, changed_by, changed_at) VALUES (?, ?, ?, ?) "
                       "ON CONFLICT(name) DO UPDATE SET value=excluded.value, "
                       "changed_by=excluded.changed_by, changed_at=excluded.changed_at",
                       ("theme_palette", p, principal["id"], int(self.clock())))
            self._audit(db, principal["id"], "theme_palette_changed", p)
        return p

    def bootstrap_admin(self, username: str, password: str, mobile: str) -> str:
        display, key = _normalize_username(username)
        number = _normalize_mobile(mobile)
        encoded = _password_hash(password)
        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                raise IdentityError("Bootstrap is only available before the first user", 409)
            user_id = uuid.uuid4().hex
            db.execute(
                "INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (user_id, display, key, number, encoded, "active", "superadmin",
                 json.dumps(ADMIN_CAPABILITIES), int(self.clock()), None, None),
            )
            self._audit(db, user_id, "bootstrap_admin", user_id)
            return user_id

    def reset_admin(self, username: str, password: str, mobile: str = "09120000000") -> str:
        display, key = _normalize_username(username)
        number = _normalize_mobile(mobile)
        encoded = _password_hash(password)
        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT id FROM users WHERE role='superadmin' LIMIT 1").fetchone()
            if row:
                user_id = row["id"]
                conflict = db.execute(
                    "SELECT id FROM users WHERE (username_key=? OR mobile=?) AND id != ? LIMIT 1",
                    (key, number, user_id),
                ).fetchone()
                if conflict:
                    cid = conflict["id"]
                    db.execute("DELETE FROM sessions WHERE user_id=?", (cid,))
                    db.execute("DELETE FROM pairings WHERE user_id=?", (cid,))
                    db.execute("DELETE FROM users WHERE id=?", (cid,))
                db.execute(
                    "UPDATE users SET username=?, username_key=?, mobile=?, password_hash=?, "
                    "status='active', capabilities=?, decided_at=? WHERE id=?",
                    (display, key, number, encoded, json.dumps(ADMIN_CAPABILITIES), int(self.clock()), user_id),
                )
                db.execute("UPDATE sessions SET revoked=1 WHERE user_id=?", (user_id,))
                self._audit(db, user_id, "admin_reset", user_id)
                return user_id

            existing = db.execute(
                "SELECT id FROM users WHERE username_key=? OR mobile=? LIMIT 1",
                (key, number),
            ).fetchone()
            if existing:
                user_id = existing["id"]
                db.execute(
                    "UPDATE users SET username=?, username_key=?, mobile=?, password_hash=?, "
                    "status='active', role='superadmin', capabilities=?, decided_at=? WHERE id=?",
                    (display, key, number, encoded, json.dumps(ADMIN_CAPABILITIES), int(self.clock()), user_id),
                )
                db.execute("UPDATE sessions SET revoked=1 WHERE user_id=?", (user_id,))
                self._audit(db, user_id, "admin_reset", user_id)
                return user_id

            user_id = uuid.uuid4().hex
            db.execute(
                "INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (user_id, display, key, number, encoded, "active", "superadmin",
                 json.dumps(ADMIN_CAPABILITIES), int(self.clock()), None, None),
            )
            self._audit(db, user_id, "admin_reset", user_id)
            return user_id

    def has_active_admin(self) -> bool:
        with self._db() as db:
            return db.execute(
                "SELECT 1 FROM users WHERE role='superadmin' AND status='active' LIMIT 1"
            ).fetchone() is not None

    def register(self, username: str, password: str, mobile: str, remote_ip: str = "local") -> str:
        display, key = _normalize_username(username)
        number = _normalize_mobile(mobile)
        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            self._rate(db, "register:ip:" + remote_ip, 5)
            self._rate(db, "register:ip:" + remote_ip, 5, failure=True)
        encoded = _password_hash(password)
        with self._lock, self._db() as db:
            try:
                user_id = uuid.uuid4().hex
                db.execute(
                    "INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (user_id, display, key, number, encoded, "pending", "member",
                     json.dumps(DEFAULT_CAPABILITIES), int(self.clock()), None, None),
                )
                self._audit(db, None, "register_pending", user_id)
            except sqlite3.IntegrityError as exc:
                raise IdentityError("Username or mobile number is already registered", 409) from exc
        return user_id

    def _rate(self, db, scope: str, limit: int, *, failure: bool = False):
        now = int(self.clock())
        row = db.execute("SELECT window_at,failures FROM rate_limits WHERE scope=?", (scope,)).fetchone()
        count = row["failures"] if row and now - row["window_at"] < 60 else 0
        if count >= limit:
            raise IdentityError("Too many attempts; retry later", 429)
        if failure:
            db.execute(
                "INSERT INTO rate_limits(scope,window_at,failures) VALUES (?,?,?) "
                "ON CONFLICT(scope) DO UPDATE SET window_at=excluded.window_at, failures=excluded.failures",
                (scope, row["window_at"] if count else now, count + 1),
            )

    def _make_token(self, db, user, audience: str, device_id: str | None = None) -> str:
        now = int(self.clock())
        jti = uuid.uuid4().hex
        expires = now + (AGENT_TTL if audience == "agent" else WEB_TTL)
        db.execute(
            "INSERT INTO sessions VALUES (?,?,?,?,?,?,0)",
            (jti, user["id"], audience, device_id, expires, now),
        )
        header = _b64(b'{"alg":"HS256","typ":"JWT"}')
        payload = _b64(json.dumps({
            "iss": "OmniOps", "aud": audience, "sub": user["id"],
            "jti": jti, "iat": now, "exp": expires,
        }, separators=(",", ":")).encode())
        signature = _b64(hmac.digest(self.signing_key, f"{header}.{payload}".encode(), "sha256"))
        return f"{header}.{payload}.{signature}"

    def _public_user(self, row) -> dict:
        caps = json.loads(row["capabilities"]) if isinstance(row["capabilities"], str) else row["capabilities"]
        data = {
            "id": row["id"],
            "username": row["username"],
            "role": row["role"],
            "status": row["status"],
            "capabilities": caps,
        }
        keys = row.keys() if hasattr(row, "keys") else ()
        if "mobile" in keys:
            data["mobile"] = row["mobile"]
        if "created_at" in keys:
            data["created_at"] = row["created_at"]
        return data

    def login(self, username: str, password: str, remote_ip: str = "local") -> dict:
        _, key = _normalize_username(username)
        if not isinstance(password, str):
            raise IdentityError("نام کاربری یا رمز عبور درست نیست.", 401)
        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            self._rate(db, "login:" + key, 5)
            self._rate(db, "login:ip:" + remote_ip, 10)
            user = db.execute("SELECT * FROM users WHERE username_key=?", (key,)).fetchone()
            if user is None or not _verify_password(password, user["password_hash"]):
                self._rate(db, "login:" + key, 5, failure=True)
                self._rate(db, "login:ip:" + remote_ip, 10, failure=True)
                db.commit()
                raise IdentityError("نام کاربری یا رمز عبور درست نیست.", 401)
            if user["status"] != "active":
                raise IdentityError("Account is awaiting administrator approval", 403)
            token = self._make_token(db, user, "web")
            pending = db.execute("SELECT COUNT(*) FROM users WHERE status='pending'").fetchone()[0] if user["role"] == "superadmin" else 0
            self._audit(db, user["id"], "login", user["id"])
            return {"token": token, "user": self._public_user(user), "pending_count": pending}

    def authenticate(self, token: str, audience: str = "web") -> dict:
        try:
            header, body, signature = token.split(".")
            expected = _b64(hmac.digest(self.signing_key, f"{header}.{body}".encode(), "sha256"))
            if not hmac.compare_digest(signature, expected) or json.loads(_unb64(header)) != {"alg": "HS256", "typ": "JWT"}:
                raise ValueError("signature")
            payload = json.loads(_unb64(body))
            now = int(self.clock())
            if payload["aud"] != audience or payload["iss"] != "OmniOps" or payload["exp"] <= now:
                raise ValueError("claims")
        except (ValueError, KeyError, TypeError, UnicodeDecodeError, binascii.Error):
            raise IdentityError("Invalid or expired session", 401) from None
        with self._db() as db:
            row = db.execute(
                "SELECT s.*,u.username,u.mobile,u.role,u.capabilities,u.status,u.created_at FROM sessions s "
                "JOIN users u ON u.id=s.user_id WHERE s.jti=? AND s.user_id=?",
                (payload["jti"], payload["sub"]),
            ).fetchone()
            if (row is None or row["revoked"] or row["audience"] != audience or row["expires_at"] != payload["exp"]
                or row["status"] != "active" or (audience == "agent" and now - row["last_seen"] > AGENT_LEASE)):
                raise IdentityError("Session is no longer active", 401)
            return {"id": row["user_id"], "username": row["username"], "mobile": row["mobile"], "role": row["role"],
                    "status": row["status"], "capabilities": json.loads(row["capabilities"]), "created_at": row["created_at"],
                    "jti": row["jti"], "device_id": row["device_id"]}

    def _require_admin(self, actor: dict):
        if actor["role"] != "superadmin" or "user.approve" not in actor["capabilities"]:
            raise IdentityError("SuperAdmin approval capability required", 403)

    def pending(self, actor: dict) -> list[dict]:
        self._require_admin(actor)
        with self._db() as db:
            return [{"id": r["id"], "username": r["username"], "mobile": r["mobile"],
                     "created_at": r["created_at"]} for r in db.execute(
                "SELECT id,username,mobile,created_at FROM users WHERE status='pending' ORDER BY created_at,id"
            )]

    def decide(self, actor: dict, user_id: str, approve: bool, capabilities: list[str] | None = None):
        self._require_admin(actor)
        if capabilities is None:
            capabilities = list(DEFAULT_CAPABILITIES)
        if not isinstance(capabilities, list) or not all(isinstance(c, str) and c in ADMIN_CAPABILITIES for c in capabilities):
            raise IdentityError("Unknown profile capability")
        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE users SET status=?, capabilities=?, decided_by=?, decided_at=? "
                "WHERE id=? AND status='pending' AND role='member'",
                ("active" if approve else "rejected", json.dumps(sorted(set(capabilities))),
                 actor["id"], int(self.clock()), user_id),
            ).rowcount
            if changed != 1:
                raise IdentityError("Pending user not found", 404)
            self._audit(db, actor["id"], "approve_user" if approve else "reject_user", user_id)

    def list_users(self, actor: dict) -> list[dict]:
        self._require_admin(actor)
        with self._db() as db:
            rows = db.execute(
                "SELECT id, username, mobile, role, status, capabilities, created_at, decided_by, decided_at "
                "FROM users ORDER BY created_at DESC, id"
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "username": r["username"],
                    "mobile": r["mobile"],
                    "role": r["role"],
                    "status": r["status"],
                    "capabilities": json.loads(r["capabilities"]),
                    "created_at": r["created_at"],
                    "decided_by": r["decided_by"],
                    "decided_at": r["decided_at"],
                    "chat_quota": self.get_user_chat_quota(r["id"], r["role"]),
                }
                for r in rows
            ]

    def update_user_access(
        self,
        actor: dict,
        user_id: str,
        *,
        role: str | None = None,
        status: str | None = None,
        capabilities: list[str] | None = None,
    ) -> dict:
        self._require_admin(actor)
        if not isinstance(user_id, str):
            raise IdentityError("User ID is required", 400)
        if role is not None and role not in ("superadmin", "member"):
            raise IdentityError("Role must be 'superadmin' or 'member'", 400)
        if status is not None and status not in ("active", "pending", "rejected"):
            raise IdentityError("Status must be 'active', 'pending', or 'rejected'", 400)
        if capabilities is not None:
            if not isinstance(capabilities, list) or not all(isinstance(c, str) and c in ADMIN_CAPABILITIES for c in capabilities):
                raise IdentityError("Invalid capability specified", 400)

        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            target = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            if target is None:
                raise IdentityError("User not found", 404)

            new_role = role if role is not None else target["role"]
            new_status = status if status is not None else target["status"]
            new_caps = json.dumps(sorted(set(capabilities))) if capabilities is not None else target["capabilities"]

            # Prevent demoting or deactivating the last active superadmin
            if target["role"] == "superadmin" and target["status"] == "active":
                if new_role != "superadmin" or new_status != "active":
                    other_admins = db.execute(
                        "SELECT COUNT(*) FROM users WHERE role='superadmin' AND status='active' AND id != ?",
                        (user_id,),
                    ).fetchone()[0]
                    if other_admins == 0:
                        raise IdentityError("حداقل یک مدیر کل فعال در سامانه باید باقی بماند.", 400)

            now = int(self.clock())
            db.execute(
                "UPDATE users SET role=?, status=?, capabilities=?, decided_by=?, decided_at=? WHERE id=?",
                (new_role, new_status, new_caps, actor["id"], now, user_id),
            )
            if new_status != "active":
                db.execute("UPDATE sessions SET revoked=1 WHERE user_id=?", (user_id,))
            self._audit(db, actor["id"], "user_access_updated", user_id)
            updated = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            return self._public_user(updated)

    def update_profile(self, actor: dict, *, username: str | None = None, mobile: str | None = None) -> dict:
        if username is None and mobile is None:
            raise IdentityError("Username or mobile must be provided", 400)
        new_username = None
        new_key = None
        new_mobile = None
        if username is not None:
            new_username, new_key = _normalize_username(username)
        if mobile is not None:
            new_mobile = _normalize_mobile(mobile)

        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            target = db.execute("SELECT * FROM users WHERE id=?", (actor["id"],)).fetchone()
            if target is None:
                raise IdentityError("User not found", 404)

            if new_key is not None:
                conflict = db.execute(
                    "SELECT 1 FROM users WHERE username_key=? AND id != ? LIMIT 1",
                    (new_key, actor["id"]),
                ).fetchone()
                if conflict:
                    raise IdentityError("این نام کاربری قبلاً در سامانه ثبت شده است.", 409)

            if new_mobile is not None:
                conflict = db.execute(
                    "SELECT 1 FROM users WHERE mobile=? AND id != ? LIMIT 1",
                    (new_mobile, actor["id"]),
                ).fetchone()
                if conflict:
                    raise IdentityError("این شماره موبایل قبلاً در سامانه ثبت شده است.", 409)

            uname = new_username if new_username is not None else target["username"]
            ukey = new_key if new_key is not None else target["username_key"]
            umobile = new_mobile if new_mobile is not None else target["mobile"]

            db.execute(
                "UPDATE users SET username=?, username_key=?, mobile=? WHERE id=?",
                (uname, ukey, umobile, actor["id"]),
            )
            self._audit(db, actor["id"], "profile_updated", actor["id"])
            updated = db.execute("SELECT * FROM users WHERE id=?", (actor["id"],)).fetchone()
            return self._public_user(updated)

    def change_password(self, actor: dict, old_password: str, new_password: str) -> dict:
        if not isinstance(old_password, str) or not old_password:
            raise IdentityError("رمز عبور فعلی الزامی است.", 400)
        encoded_new = _password_hash(new_password)

        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            target = db.execute("SELECT * FROM users WHERE id=?", (actor["id"],)).fetchone()
            if target is None:
                raise IdentityError("User not found", 404)

            if not _verify_password(old_password, target["password_hash"]):
                raise IdentityError("رمز عبور فعلی نادرست است.", 400)

            db.execute("UPDATE users SET password_hash=? WHERE id=?", (encoded_new, actor["id"]))
            current_jti = actor.get("jti")
            if current_jti:
                db.execute("UPDATE sessions SET revoked=1 WHERE user_id=? AND jti != ?", (actor["id"], current_jti))
            else:
                db.execute("UPDATE sessions SET revoked=1 WHERE user_id=?", (actor["id"],))

            self._audit(db, actor["id"], "password_changed", actor["id"])
            return {"status": "ok", "message": "رمز عبور شما با موفقیت تغییر کرد."}

    def user_profile_report(self, actor: dict, target_user_id: str | None = None) -> dict:
        uid = target_user_id or actor["id"]
        if target_user_id and target_user_id != actor["id"]:
            self._require_admin(actor)

        now = int(self.clock())
        with self._db() as db:
            user_row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
            if user_row is None:
                raise IdentityError("User not found", 404)

            has_sessions = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_sessions'"
            ).fetchone() is not None
            total_sessions = 0
            if has_sessions:
                total_sessions = db.execute(
                    "SELECT COUNT(*) FROM chat_sessions WHERE user_id=?", (uid,)
                ).fetchone()[0]

            has_history = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_history'"
            ).fetchone() is not None
            total_messages = 0
            if has_history:
                total_messages = db.execute(
                    "SELECT COUNT(*) FROM chat_history WHERE user_id=?", (uid,)
                ).fetchone()[0]

            active_web = db.execute(
                "SELECT COUNT(*) FROM sessions WHERE user_id=? AND audience='web' AND revoked=0 AND expires_at>?",
                (uid, now),
            ).fetchone()[0]

            active_agent = db.execute(
                "SELECT COUNT(*) FROM sessions WHERE user_id=? AND audience='agent' AND revoked=0 AND expires_at>?",
                (uid, now),
            ).fetchone()[0]

            return {
                "user": self._public_user(user_row),
                "stats": {
                    "total_sessions": total_sessions,
                    "total_messages": total_messages,
                    "active_web_sessions": active_web,
                    "active_agent_sessions": active_agent,
                },
                "chat_quota": self.get_user_chat_quota(uid, user_row["role"]),
            }

    def _pin_digest(self, pin: str) -> bytes:
        return hmac.digest(self.signing_key, ("pair:" + pin).encode(), "sha256")

    def create_pairing(self, actor: dict) -> dict:
        if "agent.pair" not in actor["capabilities"]:
            raise IdentityError("Profile cannot pair an agent", 403)
        now = int(self.clock())
        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM pairings WHERE expires_at<=?", (now,))
            for _ in range(20):
                pin = f"{secrets.randbelow(1_000_000):06d}"
                if not db.execute("SELECT 1 FROM pairings WHERE code_hash=?", (self._pin_digest(pin),)).fetchone():
                    break
            else:
                raise IdentityError("Could not allocate a pairing code", 503)
            db.execute("INSERT OR REPLACE INTO pairings VALUES (?,?,?,0)",
                       (actor["id"], self._pin_digest(pin), now + PIN_TTL))
            self._audit(db, actor["id"], "pair_code_issued", actor["id"])
            return {"code": pin, "expires_at": now + PIN_TTL}

    def redeem_pairing(self, pin: str, device_id: str, remote_ip: str) -> dict:
        if not isinstance(pin, str) or not re.fullmatch(r"\d{6}", pin):
            raise IdentityError("Invalid pairing code", 401)
        if not isinstance(device_id, str) or not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", device_id):
            raise IdentityError("Invalid device identifier")
        now = int(self.clock())
        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            self._rate(db, "pair:global", 30)
            self._rate(db, "pair:ip:" + remote_ip, 5)
            row = db.execute(
                "SELECT p.*,u.id,u.username,u.role,u.status,u.capabilities FROM pairings p "
                "JOIN users u ON u.id=p.user_id WHERE p.code_hash=?",
                (self._pin_digest(pin),),
            ).fetchone()
            if row is None or row["expires_at"] <= now or row["status"] != "active":
                self._rate(db, "pair:global", 30, failure=True)
                self._rate(db, "pair:ip:" + remote_ip, 5, failure=True)
                db.commit()
                raise IdentityError("Invalid or expired pairing code", 401)
            db.execute("DELETE FROM pairings WHERE user_id=?", (row["user_id"],))
            token = self._make_token(db, row, "agent", device_id)
            self._audit(db, row["id"], "agent_paired", device_id)
            return {"token": token, "expires_in": AGENT_TTL, "lease_seconds": AGENT_LEASE,
                    "profile": self._public_user(row)}

    def heartbeat(self, principal: dict):
        with self._db() as db:
            db.execute("UPDATE sessions SET last_seen=? WHERE jti=? AND audience='agent' AND revoked=0",
                       (int(self.clock()), principal["jti"]))

    def revoke(self, principal: dict):
        with self._db() as db:
            db.execute("UPDATE sessions SET revoked=1 WHERE jti=?", (principal["jti"],))
            self._audit(db, principal["id"], "session_revoked", principal["jti"])

    def create_backup(self, principal: dict) -> dict:
        if principal.get("role") != "superadmin":
            raise IdentityError("Superadmin access required", 403)
        db_path = Path(self.path).resolve()
        backups_dir = db_path.parent / "backups"
        backups_dir.mkdir(parents=True, exist_ok=True)
        backup_filename = f"identity-{int(self.clock())}.db"
        backup_target = backups_dir / backup_filename

        with self._lock, self._db() as source_db:
            target_db = sqlite3.connect(str(backup_target))
            try:
                source_db.backup(target_db)
            finally:
                target_db.close()

        size_bytes = backup_target.stat().st_size
        with self._db() as db:
            self._audit(db, principal["id"], "backup_created", backup_filename)
        return {
            "status": "created",
            "filename": backup_filename,
            "size_bytes": size_bytes,
            "created_at": int(self.clock()),
        }

    def list_backups(self, principal: dict) -> list[dict]:
        if principal.get("role") != "superadmin":
            raise IdentityError("Superadmin access required", 403)
        db_path = Path(self.path).resolve()
        backups_dir = db_path.parent / "backups"
        if not backups_dir.is_dir():
            return []
        results = []
        for p in sorted(backups_dir.glob("identity-*.db"), key=lambda f: f.stat().st_mtime, reverse=True):
            if p.is_file():
                results.append({
                    "filename": p.name,
                    "size_bytes": p.stat().st_size,
                    "created_at": int(p.stat().st_mtime),
                })
        return results

    def get_backup_path(self, principal: dict, filename: str) -> Path:
        if principal.get("role") != "superadmin":
            raise IdentityError("Superadmin access required", 403)
        if not isinstance(filename, str) or not re.match(r"^identity-[a-zA-Z0-9_\-\.]+\.db$", filename):
            raise IdentityError("Invalid backup filename", 400)
        db_path = Path(self.path).resolve()
        backups_dir = db_path.parent / "backups"
        backup_target = (backups_dir / filename).resolve()
        if not backup_target.is_file() or not backup_target.is_relative_to(backups_dir):
            raise IdentityError("Backup file not found", 404)
        return backup_target

    def list_audit(self, principal: dict, limit: int = 100, event: str | None = None) -> list[dict]:
        if principal.get("role") != "superadmin":
            raise IdentityError("Superadmin access required", 403)
        with self._db() as db:
            query = """
                SELECT a.id, a.actor_id, a.event, a.subject_id, a.created_at, u.username as actor_name
                FROM audit a
                LEFT JOIN users u ON a.actor_id = u.id
            """
            params = []
            if event:
                query += " WHERE a.event = ?"
                params.append(event)
            query += " ORDER BY a.created_at DESC LIMIT ?"
            params.append(max(1, min(int(limit), 200)))
            rows = db.execute(query, params).fetchall()
            return [dict(r) for r in rows]

    def check_and_increment_chat_quota(self, principal: dict) -> dict:
        if principal.get("role") == "superadmin":
            return {"allowed": True, "unlimited": True, "used": 0, "limit": None}

        scope = f"chat:user:{principal['id']}"
        limit = DEFAULT_HOURLY_CHAT_LIMIT
        now = int(self.clock())
        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT window_at, failures FROM rate_limits WHERE scope=?", (scope,)).fetchone()
            count = row["failures"] if row and now - row["window_at"] < 3600 else 0
            if count >= limit:
                raise IdentityError(
                    f"سقف مجاز درخواست‌های چت ساعتی شما ({limit} درخواست در ساعت) تکمیل شده است. لطفاً کمی بعد مجدداً تلاش کنید.",
                    429,
                )
            window_at = row["window_at"] if (row and count > 0) else now
            db.execute(
                "INSERT INTO rate_limits(scope, window_at, failures) VALUES (?, ?, ?) "
                "ON CONFLICT(scope) DO UPDATE SET window_at=excluded.window_at, failures=excluded.failures",
                (scope, window_at, count + 1),
            )
            return {
                "allowed": True,
                "unlimited": False,
                "used": count + 1,
                "limit": limit,
                "remaining": max(0, limit - (count + 1)),
            }

    def get_user_chat_quota(self, user_id: str, role: str) -> dict:
        if role == "superadmin":
            return {"unlimited": True, "used": 0, "limit": None, "remaining": None}
        scope = f"chat:user:{user_id}"
        limit = DEFAULT_HOURLY_CHAT_LIMIT
        now = int(self.clock())
        with self._db() as db:
            row = db.execute("SELECT window_at, failures FROM rate_limits WHERE scope=?", (scope,)).fetchone()
            count = row["failures"] if row and now - row["window_at"] < 3600 else 0
            return {
                "unlimited": False,
                "used": count,
                "limit": limit,
                "remaining": max(0, limit - count),
                "reset_in_seconds": max(0, 3600 - (now - row["window_at"])) if row and count > 0 else 0,
            }

    def reset_user_chat_quota(self, actor: dict, target_user_id: str) -> dict:
        self._require_admin(actor)
        if not isinstance(target_user_id, str):
            raise IdentityError("User ID is required", 400)
        scope = f"chat:user:{target_user_id}"
        with self._lock, self._db() as db:
            db.execute("DELETE FROM rate_limits WHERE scope=?", (scope,))
            self._audit(db, actor["id"], "chat_quota_reset", target_user_id)
        return {"status": "ok", "user_id": target_user_id}

