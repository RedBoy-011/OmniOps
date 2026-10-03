"""Owner-scoped project list and durable task drafts without tool execution."""

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
