"""Owner-scoped project list and durable task drafts without tool execution."""

import base64
import binascii
import uuid

from .identity import IdentityError


class WorkspaceStore:
    def __init__(self, store):
        self.store = store
        with store._lock, store._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS workspace_projects (
                    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL, created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS workspace_project_owner ON workspace_projects(owner_id, created_at);
                CREATE TABLE IF NOT EXISTS workspace_tasks (
                    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
                    description TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','cancelled')),
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS workspace_task_owner ON workspace_tasks(owner_id, created_at);
                CREATE TABLE IF NOT EXISTS workspace_attachments (
                    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
                    name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
                    content BLOB NOT NULL, created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS workspace_attachment_owner ON workspace_attachments(owner_id, project_id);
            """)

    @staticmethod
    def _cap(principal, capability):
        if capability not in principal.get('capabilities', []):
            raise IdentityError(f'{capability} permission required', 403)

    def list_projects(self, principal):
        self._cap(principal, 'chat')
        with self.store._db() as db:
            return [dict(row) for row in db.execute(
                'SELECT id,name,created_at FROM workspace_projects WHERE owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT 30',
                (principal['id'],))]

    def create_project(self, principal, name):
        self._cap(principal, 'chat')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
            raise IdentityError('Project name must contain 1-100 characters')
        with self.store._lock, self.store._db() as db:
            if db.execute('SELECT COUNT(*) FROM workspace_projects WHERE owner_id=?', (principal['id'],)).fetchone()[0] >= 30:
                raise IdentityError('Project limit reached', 409)
            project_id = uuid.uuid4().hex
            db.execute('INSERT INTO workspace_projects VALUES (?,?,?,?)',
                       (project_id, principal['id'], name.strip(), int(self.store.clock())))
            self.store._audit(db, principal['id'], 'workspace_project_created', project_id)
        return {'id': project_id, 'name': name.strip()}

    def list_tasks(self, principal):
        self._cap(principal, 'action.request')
        with self.store._db() as db:
            return [dict(row) for row in db.execute(
                'SELECT id,project_id,description,status,created_at,updated_at FROM workspace_tasks '
                'WHERE owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT 200', (principal['id'],))]

    def create_task(self, principal, project_id, description):
        self._cap(principal, 'action.request')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        if not isinstance(description, str) or not 1 <= len(description.strip()) <= 2000:
            raise IdentityError('Task description must contain 1-2000 characters')
        with self.store._lock, self.store._db() as db:
            if not db.execute('SELECT 1 FROM workspace_projects WHERE id=? AND owner_id=?',
                              (project_id, principal['id'])).fetchone():
                raise IdentityError('Project not found', 404)
            if db.execute('SELECT COUNT(*) FROM workspace_tasks WHERE owner_id=? AND status=?',
                          (principal['id'], 'draft')).fetchone()[0] >= 200:
                raise IdentityError('Task draft limit reached', 409)
            task_id = uuid.uuid4().hex
            now = int(self.store.clock())
            db.execute('INSERT INTO workspace_tasks VALUES (?,?,?,?,?,?,?)',
                       (task_id, principal['id'], project_id, description.strip(), 'draft', now, now))
            self.store._audit(db, principal['id'], 'workspace_task_draft_created', task_id)
        return {'id': task_id, 'status': 'draft'}

    def cancel_task(self, principal, task_id):
        self._cap(principal, 'action.request')
        if not isinstance(task_id, str) or len(task_id) != 32:
            raise IdentityError('Invalid task ID')
        with self.store._lock, self.store._db() as db:
            changed = db.execute('UPDATE workspace_tasks SET status=?, updated_at=? '
                                 'WHERE id=? AND owner_id=? AND status=?',
                                 ('cancelled', int(self.store.clock()), task_id, principal['id'], 'draft')).rowcount
            if changed != 1:
                raise IdentityError('Draft task not found', 404)
            self.store._audit(db, principal['id'], 'workspace_task_draft_cancelled', task_id)
        return {'status': 'cancelled'}

    def list_attachments(self, principal, project_id):
        self._cap(principal, 'chat')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        with self.store._db() as db:
            if not db.execute('SELECT 1 FROM workspace_projects WHERE id=? AND owner_id=?',
                              (project_id, principal['id'])).fetchone():
                raise IdentityError('Project not found', 404)
            return [dict(row) for row in db.execute(
                'SELECT id,project_id,name,mime,size,created_at FROM workspace_attachments '
                'WHERE owner_id=? AND project_id=? ORDER BY created_at DESC, rowid DESC',
                (principal['id'], project_id))]

    def add_attachment(self, principal, project_id, name, mime, encoded):
        self._cap(principal, 'chat')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120 or any(
                c in name for c in ('/', '\\', '\x00', '\n', '\r')):
            raise IdentityError('Invalid attachment name')
        if mime not in ('text/plain', 'image/png', 'image/jpeg', 'image/webp'):
            raise IdentityError('Unsupported attachment type')
        if not isinstance(encoded, str) or len(encoded) > 350000:
            raise IdentityError('Attachment exceeds 256 KiB', 413)
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise IdentityError('Invalid attachment encoding') from exc
        if not 0 < len(content) <= 256 * 1024:
            raise IdentityError('Attachment exceeds 256 KiB', 413)
        if mime == 'text/plain':
            try:
                text = content.decode('utf-8')
            except UnicodeDecodeError as exc:
                raise IdentityError('Text attachment must be UTF-8') from exc
            if '\x00' in text:
                raise IdentityError('Invalid text attachment')
        elif mime == 'image/png' and not content.startswith(b'\x89PNG\r\n\x1a\n'):
            raise IdentityError('Invalid PNG image')
        elif mime == 'image/jpeg' and not content.startswith(b'\xff\xd8\xff'):
            raise IdentityError('Invalid JPEG image')
        elif mime == 'image/webp' and not (content.startswith(b'RIFF') and content[8:12] == b'WEBP'):
            raise IdentityError('Invalid WebP image')
        with self.store._lock, self.store._db() as db:
            if not db.execute('SELECT 1 FROM workspace_projects WHERE id=? AND owner_id=?',
                              (project_id, principal['id'])).fetchone():
                raise IdentityError('Project not found', 404)
            count, total = db.execute('SELECT COUNT(*), COALESCE(SUM(size),0) FROM workspace_attachments '
                                      'WHERE owner_id=?', (principal['id'],)).fetchone()
            if count >= 50 or total + len(content) > 10 * 1024 * 1024:
                raise IdentityError('Attachment quota reached', 409)
            attachment_id = uuid.uuid4().hex
            created = int(self.store.clock())
            db.execute('INSERT INTO workspace_attachments VALUES (?,?,?,?,?,?,?,?)',
                       (attachment_id, principal['id'], project_id, name.strip(), mime, len(content), content, created))
            self.store._audit(db, principal['id'], 'workspace_attachment_added', attachment_id)
        return {'id': attachment_id, 'project_id': project_id, 'name': name.strip(),
                'mime': mime, 'size': len(content), 'created_at': created}

    def remove_attachment(self, principal, attachment_id):
        self._cap(principal, 'chat')
        if not isinstance(attachment_id, str) or len(attachment_id) != 32:
            raise IdentityError('Invalid attachment ID')
        with self.store._lock, self.store._db() as db:
            changed = db.execute('DELETE FROM workspace_attachments WHERE id=? AND owner_id=?',
                                 (attachment_id, principal['id'])).rowcount
            if changed != 1:
                raise IdentityError('Attachment not found', 404)
            self.store._audit(db, principal['id'], 'workspace_attachment_removed', attachment_id)
        return {'status': 'removed'}
