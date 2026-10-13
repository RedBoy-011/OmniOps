"""Per-profile opt-in conversation history, multi-session topics, and manually curated memory."""

from __future__ import annotations

import uuid
from typing import Any

from .identity import IdentityError


class ProfileMemory:
    def __init__(self, store: Any):
        self.store = store
        with store._lock, store._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS chat_sessions_owner ON chat_sessions(user_id, updated_at);
                CREATE TABLE IF NOT EXISTS chat_history (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    prompt TEXT NOT NULL, reply TEXT NOT NULL, model TEXT NOT NULL, created_at INTEGER NOT NULL,
                    session_id TEXT
                );
                CREATE INDEX IF NOT EXISTS chat_history_owner ON chat_history(user_id, created_at);
                CREATE TABLE IF NOT EXISTS profile_memory (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    content TEXT NOT NULL, created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS profile_memory_owner ON profile_memory(user_id, created_at);
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(chat_history)")}
            if "session_id" not in columns:
                db.execute("ALTER TABLE chat_history ADD COLUMN session_id TEXT")
            db.execute("CREATE INDEX IF NOT EXISTS chat_history_session ON chat_history(session_id, created_at)")

    @staticmethod
    def _check(principal: dict[str, Any]):
        if "chat" not in principal.get("capabilities", []):
            raise IdentityError("Profile has no chat permission", 403)

    def list_sessions(self, principal: dict[str, Any]) -> list[dict[str, Any]]:
        self._check(principal)
        with self.store._db() as db:
            rows = db.execute("""
                SELECT s.id, s.title, s.created_at, s.updated_at,
                       COUNT(h.id) AS message_count
                FROM chat_sessions s
                LEFT JOIN chat_history h ON h.session_id = s.id
                WHERE s.user_id = ?
                GROUP BY s.id
                ORDER BY s.updated_at DESC
            """, (principal["id"],)).fetchall()
        return [dict(row) for row in rows]

    def create_session(self, principal: dict[str, Any], title: str | None = None) -> dict[str, Any]:
        self._check(principal)
        sess_title = title.strip()[:60] if isinstance(title, str) and title.strip() else "گفتگوی جدید"
        now = int(self.store.clock())
        sess_id = uuid.uuid4().hex
        with self.store._lock, self.store._db() as db:
            db.execute("INSERT INTO chat_sessions VALUES (?, ?, ?, ?, ?)",
                       (sess_id, principal["id"], sess_title, now, now))
        return {
            "id": sess_id,
            "title": sess_title,
            "created_at": now,
            "updated_at": now,
            "message_count": 0,
        }

    def rename_session(self, principal: dict[str, Any], session_id: str, new_title: str) -> dict[str, Any]:
        self._check(principal)
        if not isinstance(new_title, str) or not 1 <= len(new_title.strip()) <= 100:
            raise IdentityError("عنوان گفتگو باید بین ۱ تا ۱۰۰ کاراکتر باشد")
        with self.store._lock, self.store._db() as db:
            rowcount = db.execute("UPDATE chat_sessions SET title=?, updated_at=? WHERE id=? AND user_id=?",
                                  (new_title.strip(), int(self.store.clock()), session_id, principal["id"])).rowcount
            if rowcount == 0:
                raise IdentityError("گفتگو یافت نشد", 404)
        return {"id": session_id, "title": new_title.strip()}

    def delete_session(self, principal: dict[str, Any], session_id: str) -> dict[str, str]:
        self._check(principal)
        with self.store._lock, self.store._db() as db:
            db.execute("DELETE FROM chat_history WHERE session_id=? AND user_id=?", (session_id, principal["id"]))
            rowcount = db.execute("DELETE FROM chat_sessions WHERE id=? AND user_id=?", (session_id, principal["id"])).rowcount
            if rowcount == 0:
                raise IdentityError("گفتگو یافت نشد", 404)
        return {"status": "deleted", "id": session_id}

    def history(self, principal: dict[str, Any], session_id: str | None = None) -> list[dict[str, Any]]:
        self._check(principal)
        with self.store._db() as db:
            if session_id:
                rows = db.execute(
                    "SELECT id, prompt, reply, model, created_at, session_id FROM chat_history "
                    "WHERE user_id=? AND session_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100",
                    (principal["id"], session_id),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT id, prompt, reply, model, created_at, session_id FROM chat_history "
                    "WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100",
                    (principal["id"],),
                ).fetchall()
        return [dict(row) for row in reversed(rows)]

    def remember_chat(
        self,
        principal: dict[str, Any],
        prompt: str,
        reply: str,
        model: str,
        session_id: str | None = None,
    ) -> None:
        self._check(principal)
        now = int(self.store.clock())
        with self.store._lock, self.store._db() as db:
            target_sess_id = session_id
            if not target_sess_id:
                active = db.execute(
                    "SELECT id, title FROM chat_sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT 1",
                    (principal["id"],),
                ).fetchone()
                if active:
                    target_sess_id = active["id"]
                    if active["title"] in ("گفتگوی جدید", "New Chat") and prompt.strip():
                        auto_title = prompt.strip()[:40]
                        db.execute("UPDATE chat_sessions SET title=?, updated_at=? WHERE id=?",
                                   (auto_title, now, target_sess_id))
                    else:
                        db.execute("UPDATE chat_sessions SET updated_at=? WHERE id=?", (now, target_sess_id))
                else:
                    target_sess_id = uuid.uuid4().hex
                    first_title = prompt.strip()[:40] if prompt.strip() else "گفتگوی جدید"
                    db.execute("INSERT INTO chat_sessions VALUES (?, ?, ?, ?, ?)",
                               (target_sess_id, principal["id"], first_title, now, now))
            else:
                sess = db.execute(
                    "SELECT title FROM chat_sessions WHERE id=? AND user_id=?",
                    (target_sess_id, principal["id"]),
                ).fetchone()
                if sess and sess["title"] in ("گفتگوی جدید", "New Chat") and prompt.strip():
                    auto_title = prompt.strip()[:40]
                    db.execute("UPDATE chat_sessions SET title=?, updated_at=? WHERE id=?",
                               (auto_title, now, target_sess_id))
                else:
                    db.execute("UPDATE chat_sessions SET updated_at=? WHERE id=?", (now, target_sess_id))

            db.execute("INSERT INTO chat_history VALUES (?,?,?,?,?,?,?)",
                       (uuid.uuid4().hex, principal["id"], prompt, reply, model, now, target_sess_id))
            db.execute(
                "DELETE FROM chat_history WHERE user_id=? AND rowid NOT IN "
                "(SELECT rowid FROM chat_history WHERE user_id=? ORDER BY rowid DESC LIMIT 500)",
                (principal["id"], principal["id"]),
            )

    def delete_history(self, principal: dict[str, Any], session_id: str | None = None) -> None:
        self._check(principal)
        with self.store._lock, self.store._db() as db:
            if session_id:
                db.execute("DELETE FROM chat_history WHERE user_id=? AND session_id=?",
                           (principal["id"], session_id))
            else:
                db.execute("DELETE FROM chat_history WHERE user_id=?", (principal["id"],))
                db.execute("DELETE FROM chat_sessions WHERE user_id=?", (principal["id"],))
            self.store._audit(db, principal["id"], "chat_history_cleared", session_id or principal["id"])

    def notes(self, principal: dict[str, Any]) -> list[dict[str, Any]]:
        self._check(principal)
        with self.store._db() as db:
            rows = db.execute("SELECT id,content,created_at FROM profile_memory WHERE user_id=? "
                              "ORDER BY created_at DESC, rowid DESC", (principal["id"],)).fetchall()
        return [dict(row) for row in rows]

    def add_note(self, principal: dict[str, Any], content: str) -> str:
        self._check(principal)
        if not isinstance(content, str) or not 1 <= len(content.strip()) <= 500:
            raise IdentityError("Memory must contain 1-500 characters")
        with self.store._lock, self.store._db() as db:
            count = db.execute("SELECT COUNT(*) FROM profile_memory WHERE user_id=?", (principal["id"],)).fetchone()[0]
            if count >= 50:
                raise IdentityError("Memory limit reached (50)", 409)
            note_id = uuid.uuid4().hex
            db.execute("INSERT INTO profile_memory VALUES (?,?,?,?)",
                       (note_id, principal["id"], content.strip(), int(self.store.clock())))
            self.store._audit(db, principal["id"], "profile_memory_added", note_id)
        return note_id

    def remove_note(self, principal: dict[str, Any], note_id: str) -> None:
        self._check(principal)
        if not isinstance(note_id, str) or len(note_id) != 32:
            raise IdentityError("Invalid memory ID")
        with self.store._lock, self.store._db() as db:
            cursor = db.execute("DELETE FROM profile_memory WHERE id=? AND user_id=?", (note_id, principal["id"]))
            if cursor.rowcount == 0:
                raise IdentityError("Memory not found", 404)
            self.store._audit(db, principal["id"], "profile_memory_deleted", note_id)
