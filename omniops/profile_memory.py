"""Per-profile opt-in conversation history and manually curated memory."""

import uuid

from .identity import IdentityError


class ProfileMemory:
    def __init__(self, store):
        self.store = store
        with store._lock, store._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS chat_history (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    prompt TEXT NOT NULL, reply TEXT NOT NULL, model TEXT NOT NULL, created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS chat_history_owner ON chat_history(user_id, created_at);
                CREATE TABLE IF NOT EXISTS profile_memory (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    content TEXT NOT NULL, created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS profile_memory_owner ON profile_memory(user_id, created_at);
            """)

    @staticmethod
    def _check(principal):
        if 'chat' not in principal.get('capabilities', []):
            raise IdentityError('Profile has no chat permission', 403)

    def history(self, principal):
        self._check(principal)
        with self.store._db() as db:
            rows = db.execute('SELECT id,prompt,reply,model,created_at FROM chat_history WHERE user_id=? '
                              'ORDER BY created_at DESC, rowid DESC LIMIT 100', (principal['id'],)).fetchall()
        return [dict(row) for row in reversed(rows)]

    def remember_chat(self, principal, prompt, reply, model):
        self._check(principal)
        with self.store._lock, self.store._db() as db:
            db.execute('INSERT INTO chat_history VALUES (?,?,?,?,?,?)',
                       (uuid.uuid4().hex, principal['id'], prompt, reply, model, int(self.store.clock())))
            db.execute('DELETE FROM chat_history WHERE user_id=? AND rowid NOT IN '
                       '(SELECT rowid FROM chat_history WHERE user_id=? ORDER BY rowid DESC LIMIT 500)',
                       (principal['id'], principal['id']))

    def delete_history(self, principal):
        self._check(principal)
        with self.store._lock, self.store._db() as db:
            db.execute('DELETE FROM chat_history WHERE user_id=?', (principal['id'],))
            self.store._audit(db, principal['id'], 'chat_history_cleared', principal['id'])

    def notes(self, principal):
        self._check(principal)
        with self.store._db() as db:
            rows = db.execute('SELECT id,content,created_at FROM profile_memory WHERE user_id=? '
                              'ORDER BY created_at DESC, rowid DESC', (principal['id'],)).fetchall()
        return [dict(row) for row in rows]

    def add_note(self, principal, content):
        self._check(principal)
        if not isinstance(content, str) or not 1 <= len(content.strip()) <= 500:
            raise IdentityError('Memory must contain 1-500 characters')
        with self.store._lock, self.store._db() as db:
            count = db.execute('SELECT COUNT(*) FROM profile_memory WHERE user_id=?', (principal['id'],)).fetchone()[0]
            if count >= 50:
                raise IdentityError('Memory limit reached (50)', 409)
            note_id = uuid.uuid4().hex
            db.execute('INSERT INTO profile_memory VALUES (?,?,?,?)',
                       (note_id, principal['id'], content.strip(), int(self.store.clock())))
            self.store._audit(db, principal['id'], 'profile_memory_added', note_id)
        return note_id

    def remove_note(self, principal, note_id):
        self._check(principal)
        if not isinstance(note_id, str) or len(note_id) != 32:
            raise IdentityError('Invalid memory ID')
        with self.store._lock, self.store._db() as db:
            cursor = db.execute('DELETE FROM profile_memory WHERE id=? AND user_id=?', (note_id, principal['id']))
            if cursor.rowcount == 0:
                raise IdentityError('Memory not found', 404)
            self.store._audit(db, principal['id'], 'profile_memory_deleted', note_id)
