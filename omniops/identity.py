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


WEB_TTL = 3600
AGENT_TTL = 8 * 3600
AGENT_LEASE = 50
PIN_TTL = 120
PASSWORD_N, PASSWORD_R, PASSWORD_P = 1 << 14, 8, 5
DEFAULT_CAPABILITIES = ("chat",)
ADMIN_CAPABILITIES = (
    "chat", "skill.use", "tool.read", "action.request", "action.approve",
    "agent.pair", "user.approve", "profile.manage", "provider.manage",
)


class IdentityError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _password_hash(password: str) -> str:
    if not isinstance(password, str) or not 12 <= len(password) <= 1024:
        raise IdentityError("Password must contain 12–1024 characters")
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
        return {"id": row["id"], "username": row["username"], "role": row["role"],
                "status": row["status"], "capabilities": json.loads(row["capabilities"])}

    def login(self, username: str, password: str, remote_ip: str = "local") -> dict:
        _, key = _normalize_username(username)
        if not isinstance(password, str):
            raise IdentityError("Invalid username or password", 401)
        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            self._rate(db, "login:" + key, 5)
            self._rate(db, "login:ip:" + remote_ip, 10)
            user = db.execute("SELECT * FROM users WHERE username_key=?", (key,)).fetchone()
            if user is None or not _verify_password(password, user["password_hash"]):
                self._rate(db, "login:" + key, 5, failure=True)
                self._rate(db, "login:ip:" + remote_ip, 10, failure=True)
                db.commit()
                raise IdentityError("Invalid username or password", 401)
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
                "SELECT s.*,u.username,u.role,u.capabilities,u.status FROM sessions s "
                "JOIN users u ON u.id=s.user_id WHERE s.jti=? AND s.user_id=?",
                (payload["jti"], payload["sub"]),
            ).fetchone()
            if (row is None or row["revoked"] or row["audience"] != audience or row["expires_at"] != payload["exp"]
                or row["status"] != "active" or (audience == "agent" and now - row["last_seen"] > AGENT_LEASE)):
                raise IdentityError("Session is no longer active", 401)
            return {"id": row["user_id"], "username": row["username"], "role": row["role"],
                    "capabilities": json.loads(row["capabilities"]), "jti": row["jti"],
                    "device_id": row["device_id"]}

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
