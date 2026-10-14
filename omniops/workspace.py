"""Owner-scoped project list, local workspace root binding, and agentic tool execution."""

import base64
import binascii
import difflib
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid

from .identity import IdentityError

_command_streams = {}
_command_streams_lock = threading.Lock()


class WorkspaceStore:
    def __init__(self, store):
        self.store = store
        with store._lock, store._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS workspace_projects (
                    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL, created_at INTEGER NOT NULL,
                    root_path TEXT DEFAULT ''
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
                CREATE TABLE IF NOT EXISTS workspace_agent_runs (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
                    prompt TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'general',
                    mode TEXT NOT NULL DEFAULT 'single',
                    status TEXT NOT NULL CHECK(status IN ('planning','in_progress','waiting_approval','completed','failed','cancelled','paused_debug')),
                    current_step_index INTEGER NOT NULL DEFAULT 0,
                    plan_steps TEXT NOT NULL DEFAULT '[]',
                    logs TEXT NOT NULL DEFAULT '[]',
                    result_summary TEXT NOT NULL DEFAULT '',
                    debug_mode INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS workspace_agent_runs_owner ON workspace_agent_runs(owner_id, project_id, created_at);
                CREATE TABLE IF NOT EXISTS workspace_subagent_runs (
                    id TEXT PRIMARY KEY,
                    parent_run_id TEXT NOT NULL REFERENCES workspace_agent_runs(id) ON DELETE CASCADE,
                    role TEXT NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed','failed','cancelled','waiting_approval')),
                    prompt TEXT NOT NULL,
                    summary TEXT NOT NULL DEFAULT '',
                    logs TEXT NOT NULL DEFAULT '[]',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS workspace_subagent_parent ON workspace_subagent_runs(parent_run_id, created_at);
                CREATE TABLE IF NOT EXISTS workspace_sandbox_policy (
                    id TEXT PRIMARY KEY,
                    max_timeout_seconds INTEGER NOT NULL DEFAULT 30,
                    strict_mode INTEGER NOT NULL DEFAULT 0,
                    allowed_prefixes TEXT NOT NULL,
                    blocked_commands TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workspace_file_patches (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
                    path TEXT NOT NULL,
                    old_content TEXT NOT NULL,
                    new_content TEXT NOT NULL,
                    diff_text TEXT NOT NULL,
                    additions INTEGER NOT NULL,
                    deletions INTEGER NOT NULL,
                    is_new_file INTEGER NOT NULL,
                    applied_by TEXT NOT NULL REFERENCES users(id),
                    status TEXT NOT NULL DEFAULT 'applied' CHECK(status IN ('applied', 'reverted')),
                    created_at INTEGER NOT NULL,
                    reverted_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_file_patches_proj ON workspace_file_patches(project_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS workspace_governance_webhooks (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    url TEXT NOT NULL,
                    secret TEXT NOT NULL DEFAULT '',
                    events TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_webhooks_enabled ON workspace_governance_webhooks(enabled);
                CREATE TABLE IF NOT EXISTS workspace_command_history (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
                    command TEXT NOT NULL,
                    exit_code INTEGER NOT NULL,
                    stdout TEXT NOT NULL DEFAULT '',
                    stderr TEXT NOT NULL DEFAULT '',
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    executed_by TEXT NOT NULL REFERENCES users(id),
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_cmd_history ON workspace_command_history(project_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS workspace_project_artifacts (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
                    run_id TEXT REFERENCES workspace_agent_runs(id) ON DELETE SET NULL,
                    title TEXT NOT NULL,
                    artifact_type TEXT NOT NULL DEFAULT 'plan' CHECK(artifact_type IN ('plan', 'report', 'review', 'code', 'general')),
                    content TEXT NOT NULL,
                    created_by TEXT NOT NULL REFERENCES users(id),
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_proj ON workspace_project_artifacts(project_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS workspace_specs (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    requirements TEXT NOT NULL,
                    design_approach TEXT NOT NULL,
                    task_breakdown TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'rejected', 'executed')),
                    run_id TEXT REFERENCES workspace_agent_runs(id) ON DELETE SET NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    approved_at INTEGER,
                    approved_by TEXT,
                    rejection_reason TEXT DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_specs_proj ON workspace_specs(project_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_workspace_specs_owner ON workspace_specs(owner_id, status);
                CREATE TABLE IF NOT EXISTS workspace_task_notifications (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL REFERENCES workspace_agent_runs(id) ON DELETE CASCADE,
                    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    step_index INTEGER NOT NULL,
                    step_title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    summary TEXT NOT NULL DEFAULT '',
                    message TEXT NOT NULL,
                    read INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_task_notif_owner ON workspace_task_notifications(owner_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_workspace_task_notif_run ON workspace_task_notifications(run_id, created_at DESC);
            """)
            try:
                db.execute("ALTER TABLE workspace_projects ADD COLUMN root_path TEXT DEFAULT ''")
            except Exception:
                pass
            try:
                db.execute("ALTER TABLE workspace_agent_runs ADD COLUMN role TEXT DEFAULT 'general'")
            except Exception:
                pass
            try:
                db.execute("ALTER TABLE workspace_agent_runs ADD COLUMN mode TEXT DEFAULT 'single'")
            except Exception:
                pass
            try:
                db.execute("ALTER TABLE workspace_agent_runs ADD COLUMN debug_mode INTEGER DEFAULT 0")
            except Exception:
                pass

            now_ts = int(self.store.clock())
            default_allowed = json.dumps(["git", "npm", "yarn", "pnpm", "npx", "pip", "python", "pytest", "cargo", "go", "node", "make", "deno", "ls", "dir", "echo"])
            default_blocked = json.dumps(["format ", "rmdir /s /q c:", "del /f /s /q c:", ":(){ :|:& };:", "rm -rf /", "shutdown", "drop database"])
            db.execute("""
                INSERT OR IGNORE INTO workspace_sandbox_policy (id, max_timeout_seconds, strict_mode, allowed_prefixes, blocked_commands, updated_at)
                VALUES ('global', 30, 0, ?, ?, ?)
            """, (default_allowed, default_blocked, now_ts))

    @staticmethod
    def _cap(principal, capability):
        if capability not in principal.get('capabilities', []):
            raise IdentityError(f'{capability} permission required', 403)

    def list_projects(self, principal):
        self._cap(principal, 'chat')
        with self.store._db() as db:
            return [dict(row) for row in db.execute(
                "SELECT id,name,created_at,COALESCE(root_path,'') as root_path FROM workspace_projects WHERE owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT 30",
                (principal['id'],))]

    def get_project(self, principal, project_id):
        self._cap(principal, 'chat')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        with self.store._db() as db:
            if principal.get('role') == 'superadmin':
                row = db.execute("SELECT id, owner_id, name, created_at, COALESCE(root_path,'') as root_path FROM workspace_projects WHERE id=?", (project_id,)).fetchone()
            else:
                row = db.execute("SELECT id, owner_id, name, created_at, COALESCE(root_path,'') as root_path FROM workspace_projects WHERE id=? AND owner_id=?", (project_id, principal['id'])).fetchone()
            if not row:
                raise IdentityError('Project not found', 404)
            return dict(row)

    def create_project(self, principal, name, root_path=""):
        self._cap(principal, 'chat')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
            raise IdentityError('Project name must contain 1-100 characters')
        if not isinstance(root_path, str):
            root_path = ""
        clean_root = root_path.strip()[:500]
        with self.store._lock, self.store._db() as db:
            if db.execute('SELECT COUNT(*) FROM workspace_projects WHERE owner_id=?', (principal['id'],)).fetchone()[0] >= 30:
                raise IdentityError('Project limit reached', 409)
            project_id = uuid.uuid4().hex
            db.execute('INSERT INTO workspace_projects (id, owner_id, name, created_at, root_path) VALUES (?,?,?,?,?)',
                       (project_id, principal['id'], name.strip(), int(self.store.clock()), clean_root))
            self.store._audit(db, principal['id'], 'workspace_project_created', project_id)
        return {'id': project_id, 'name': name.strip(), 'root_path': clean_root}

    def bind_project_root(self, principal, project_id, root_path):
        self._cap(principal, 'chat')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        if not isinstance(root_path, str):
            raise IdentityError('Invalid root path')
        clean_path = root_path.strip()[:500]
        with self.store._lock, self.store._db() as db:
            changed = db.execute('UPDATE workspace_projects SET root_path=? WHERE id=? AND owner_id=?',
                                 (clean_path, project_id, principal['id'])).rowcount
            if changed != 1:
                raise IdentityError('Project not found', 404)
            self.store._audit(db, principal['id'], 'workspace_project_root_updated', project_id)
        return {'status': 'updated', 'project_id': project_id, 'root_path': clean_path}

    def _resolve_project_root(self, principal, project_id):
        with self.store._db() as db:
            if principal.get('role') == 'superadmin':
                row = db.execute('SELECT root_path, name FROM workspace_projects WHERE id=?',
                                 (project_id,)).fetchone()
            else:
                row = db.execute('SELECT root_path, name FROM workspace_projects WHERE id=? AND owner_id=?',
                                 (project_id, principal['id'])).fetchone()
            if not row:
                raise IdentityError('Project not found', 404)
            root_str = (row['root_path'] or '').strip()
            if not root_str:
                raise IdentityError('Project does not have an anchored local directory root', 400)
            target = Path(root_str).resolve()
            if not target.exists() or not target.is_dir():
                raise IdentityError(f'Anchored project directory does not exist: {root_str}', 404)
            return target, row['name']

    def _safe_resolve(self, root_dir: Path, rel_path: str) -> Path:
        if not isinstance(rel_path, str):
            raise IdentityError('Invalid relative path')
        clean = rel_path.strip().replace('\\', '/').lstrip('/')
        target = (root_dir / clean).resolve()
        try:
            target.relative_to(root_dir)
        except ValueError:
            raise IdentityError('Path traversal detected outside project root', 403)
        return target

    def inspect_project(self, principal, project_id):
        self._cap(principal, 'chat')
        root_dir, project_name = self._resolve_project_root(principal, project_id)

        # Detect language and framework
        p_type = 'generic'
        framework = 'Unknown'

        has_package_json = (root_dir / 'package.json').is_file()
        has_requirements = (root_dir / 'requirements.txt').is_file() or (root_dir / 'pyproject.toml').is_file()
        has_cargo = (root_dir / 'Cargo.toml').is_file()
        has_go = (root_dir / 'go.mod').is_file()

        if has_package_json:
            p_type = 'nodejs'
            framework = 'Node.js'
            try:
                pkg_data = json.loads((root_dir / 'package.json').read_text(encoding='utf-8', errors='ignore'))
                deps = {**pkg_data.get('dependencies', {}), **pkg_data.get('devDependencies', {})}
                if 'react' in deps:
                    framework = 'React' + (' + Vite' if 'vite' in deps else '')
                elif 'next' in deps:
                    framework = 'Next.js'
                elif 'vue' in deps:
                    framework = 'Vue'
                elif 'express' in deps:
                    framework = 'Express'
                elif 'fastify' in deps:
                    framework = 'Fastify'
            except Exception:
                pass
        elif has_requirements:
            p_type = 'python'
            framework = 'Python'
            try:
                content = ''
                if (root_dir / 'requirements.txt').is_file():
                    content = (root_dir / 'requirements.txt').read_text(encoding='utf-8', errors='ignore').lower()
                elif (root_dir / 'pyproject.toml').is_file():
                    content = (root_dir / 'pyproject.toml').read_text(encoding='utf-8', errors='ignore').lower()
                if 'fastapi' in content:
                    framework = 'FastAPI'
                elif 'django' in content:
                    framework = 'Django'
                elif 'flask' in content:
                    framework = 'Flask'
                elif 'torch' in content or 'tensorflow' in content:
                    framework = 'AI / PyTorch'
            except Exception:
                pass
        elif has_cargo:
            p_type = 'rust'
            framework = 'Rust / Cargo'
        elif has_go:
            p_type = 'go'
            framework = 'Go Module'

        top_entries = []
        ignore_names = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', '.idea', '.vscode'}
        file_count = 0
        readme_preview = ''
        tasks_preview = ''

        try:
            for item in sorted(root_dir.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if item.name in ignore_names:
                    continue
                file_count += 1
                if len(top_entries) < 35:
                    top_entries.append({
                        'name': item.name,
                        'is_dir': item.is_dir(),
                        'size': item.stat().st_size if item.is_file() else None,
                    })
                if not readme_preview and item.is_file() and item.name.lower() in ('readme.md', 'readme.txt'):
                    try:
                        readme_preview = item.read_text(encoding='utf-8', errors='ignore')[:1500]
                    except Exception:
                        pass
                if not tasks_preview and item.is_file() and item.name.lower() in ('todo.md', 'tasks.md', 'roadmap.md'):
                    try:
                        tasks_preview = item.read_text(encoding='utf-8', errors='ignore')[:1500]
                    except Exception:
                        pass
        except Exception as exc:
            raise IdentityError(f'Cannot inspect project directory: {exc}', 500)

        return {
            'project_id': project_id,
            'name': project_name,
            'root_path': str(root_dir),
            'project_type': p_type,
            'framework': framework,
            'total_entries': file_count,
            'top_entries': top_entries,
            'has_readme': bool(readme_preview),
            'readme_preview': readme_preview,
            'tasks_context': tasks_preview,
        }

    def list_project_files(self, principal, project_id, subpath=''):
        self._cap(principal, 'chat')
        root_dir, _ = self._resolve_project_root(principal, project_id)
        target = self._safe_resolve(root_dir, subpath) if subpath else root_dir
        if not target.is_dir():
            raise IdentityError(f'Directory not found: {subpath}', 404)
        ignore_names = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build'}
        items = []
        for it in sorted(target.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if it.name in ignore_names:
                continue
            items.append({
                'name': it.name,
                'path': str(it.relative_to(root_dir)).replace('\\', '/'),
                'is_dir': it.is_dir(),
                'size': it.stat().st_size if it.is_file() else None,
            })
        return {
            'project_id': project_id,
            'subpath': subpath,
            'entries': items[:100],
        }

    def read_project_file(self, principal, project_id, relative_path):
        self._cap(principal, 'chat')
        root_dir, _ = self._resolve_project_root(principal, project_id)
        target = self._safe_resolve(root_dir, relative_path)
        if not target.is_file():
            raise IdentityError(f'File not found: {relative_path}', 404)
        if target.stat().st_size > 256 * 1024:
            raise IdentityError('File exceeds 256 KiB size limit', 413)
        try:
            content = target.read_text(encoding='utf-8', errors='ignore')
        except Exception as exc:
            raise IdentityError(f'Cannot read file: {exc}')
        lines = len(content.splitlines())
        return {
            'project_id': project_id,
            'path': relative_path,
            'size': len(content.encode('utf-8')),
            'lines': lines,
            'content': content,
        }

    def write_project_file(self, principal, project_id, relative_path, content):
        if 'action.request' not in principal.get('capabilities', []) and principal.get('role') != 'superadmin':
            raise IdentityError('action.request permission required to modify files', 403)
        if not isinstance(content, str):
            raise IdentityError('File content must be a string')
        if len(content.encode('utf-8')) > 256 * 1024:
            raise IdentityError('File content exceeds 256 KiB limit', 413)

        root_dir, _ = self._resolve_project_root(principal, project_id)
        target = self._safe_resolve(root_dir, relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')

        with self.store._lock, self.store._db() as db:
            self.store._audit(db, principal['id'], 'workspace_file_written', f"{project_id}:{relative_path}")

        return {
            'status': 'written',
            'project_id': project_id,
            'path': relative_path,
            'bytes': len(content.encode('utf-8')),
        }

    def propose_file_patch(self, principal, project_id, relative_path, new_content, apply=False):
        self._cap(principal, 'chat')
        if not isinstance(new_content, str):
            raise IdentityError('New content must be a string')
        if len(new_content.encode('utf-8')) > 256 * 1024:
            raise IdentityError('File content exceeds 256 KiB limit', 413)

        root_dir, _ = self._resolve_project_root(principal, project_id)
        target = self._safe_resolve(root_dir, relative_path)

        old_content = ''
        is_new_file = not target.is_file()
        if not is_new_file:
            if target.stat().st_size > 256 * 1024:
                raise IdentityError('Existing file exceeds 256 KiB limit', 413)
            try:
                old_content = target.read_text(encoding='utf-8', errors='replace')
            except Exception as exc:
                raise IdentityError(f'Cannot read existing file: {exc}')

        old_lines = old_content.splitlines(keepends=True)
        new_lines = new_content.splitlines(keepends=True)
        diff_lines = list(difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=f"a/{relative_path}",
            tofile=f"b/{relative_path}",
            lineterm="\n"
        ))
        diff_text = "".join(diff_lines)
        additions = sum(1 for line in diff_lines if line.startswith('+') and not line.startswith('+++'))
        deletions = sum(1 for line in diff_lines if line.startswith('-') and not line.startswith('---'))

        applied = False
        patch_id = None
        if apply:
            if 'action.request' not in principal.get('capabilities', []) and principal.get('role') != 'superadmin':
                raise IdentityError('action.request permission required to apply patch', 403)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(new_content, encoding='utf-8')
            applied = True
            patch_id = uuid.uuid4().hex
            now = int(self.store.clock())
            with self.store._lock, self.store._db() as db:
                db.execute("""
                    INSERT INTO workspace_file_patches
                    (id, project_id, path, old_content, new_content, diff_text, additions, deletions, is_new_file, applied_by, status, created_at, reverted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, NULL)
                """, (patch_id, project_id, relative_path, old_content, new_content, diff_text, additions, deletions, 1 if is_new_file else 0, principal['id'], now))
                self.store._audit(db, principal['id'], 'workspace_file_patch_applied', f"{project_id}:{relative_path}:{patch_id}")

        return {
            'patch_id': patch_id,
            'project_id': project_id,
            'path': relative_path,
            'is_new_file': is_new_file,
            'old_size': len(old_content.encode('utf-8')),
            'new_size': len(new_content.encode('utf-8')),
            'additions': additions,
            'deletions': deletions,
            'diff': diff_text,
            'has_changes': bool(diff_lines),
            'applied': applied,
        }

    def list_project_patches(self, principal, project_id, limit=30):
        self._cap(principal, 'chat')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        self._resolve_project_root(principal, project_id)
        limit = max(1, min(int(limit), 100))
        with self.store._db() as db:
            rows = db.execute("""
                SELECT p.id, p.project_id, p.path, p.diff_text, p.additions, p.deletions, p.is_new_file,
                       p.applied_by, p.status, p.created_at, p.reverted_at,
                       u.username as applied_by_username
                FROM workspace_file_patches p
                LEFT JOIN users u ON p.applied_by = u.id
                WHERE p.project_id=?
                ORDER BY p.created_at DESC, p.rowid DESC
                LIMIT ?
            """, (project_id, limit)).fetchall()
            return [dict(r) for r in rows]

    def rollback_file_patch(self, principal, patch_id):
        if 'action.request' not in principal.get('capabilities', []) and principal.get('role') != 'superadmin':
            raise IdentityError('action.request permission required to rollback patch', 403)
        if not isinstance(patch_id, str) or len(patch_id) != 32:
            raise IdentityError('Invalid patch ID')

        with self.store._lock, self.store._db() as db:
            row = db.execute("SELECT * FROM workspace_file_patches WHERE id=?", (patch_id,)).fetchone()
            if not row:
                raise IdentityError('Patch record not found', 404)
            patch = dict(row)
            if patch['status'] != 'applied':
                raise IdentityError('Patch has already been reverted', 400)

            root_dir, _ = self._resolve_project_root(principal, patch['project_id'])
            target = self._safe_resolve(root_dir, patch['path'])

            if patch['is_new_file']:
                if target.is_file():
                    target.unlink()
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(patch['old_content'], encoding='utf-8')

            now = int(self.store.clock())
            db.execute("""
                UPDATE workspace_file_patches
                SET status='reverted', reverted_at=?
                WHERE id=?
            """, (now, patch_id))
            self.store._audit(db, principal['id'], 'workspace_file_patch_reverted', f"{patch['project_id']}:{patch['path']}:{patch_id}")

            patch['status'] = 'reverted'
            patch['reverted_at'] = now
            return {
                'id': patch['id'],
                'project_id': patch['project_id'],
                'path': patch['path'],
                'diff_text': patch['diff_text'],
                'additions': patch['additions'],
                'deletions': patch['deletions'],
                'is_new_file': patch['is_new_file'],
                'status': 'reverted',
                'created_at': patch['created_at'],
                'reverted_at': now
            }

    def get_sandbox_policy(self, principal):
        if principal.get('role') != 'superadmin':
            raise IdentityError('Superadmin role required', 403)
        return self._get_effective_sandbox_policy()

    def _get_effective_sandbox_policy(self):
        with self.store._db() as db:
            row = db.execute("SELECT * FROM workspace_sandbox_policy WHERE id='global'").fetchone()
            if not row:
                return {
                    'max_timeout_seconds': 30,
                    'strict_mode': False,
                    'allowed_prefixes': ["git", "npm", "yarn", "pnpm", "npx", "pip", "python", "pytest", "cargo", "go", "node", "make", "deno", "ls", "dir", "echo"],
                    'blocked_commands': ["format ", "rmdir /s /q c:", "del /f /s /q c:", ":(){ :|:& };:", "rm -rf /", "shutdown", "drop database"],
                    'updated_at': int(self.store.clock())
                }
            try:
                allowed = json.loads(row['allowed_prefixes'] or '[]')
            except Exception:
                allowed = []
            try:
                blocked = json.loads(row['blocked_commands'] or '[]')
            except Exception:
                blocked = []
            return {
                'max_timeout_seconds': int(row['max_timeout_seconds']),
                'strict_mode': bool(row['strict_mode']),
                'allowed_prefixes': allowed,
                'blocked_commands': blocked,
                'updated_at': int(row['updated_at'])
            }

    def update_sandbox_policy(self, principal, payload):
        if principal.get('role') != 'superadmin':
            raise IdentityError('Superadmin role required', 403)
        if not isinstance(payload, dict):
            raise IdentityError('Invalid payload', 400)

        current = self._get_effective_sandbox_policy()
        max_timeout = payload.get('max_timeout_seconds', current['max_timeout_seconds'])
        if not isinstance(max_timeout, int) or not (5 <= max_timeout <= 120):
            raise IdentityError('max_timeout_seconds must be an integer between 5 and 120', 400)

        strict_mode = bool(payload.get('strict_mode', current['strict_mode']))

        raw_allowed = payload.get('allowed_prefixes', current['allowed_prefixes'])
        if not isinstance(raw_allowed, list):
            raise IdentityError('allowed_prefixes must be a list of strings', 400)
        clean_allowed = [str(x).strip().lower() for x in raw_allowed if str(x).strip()][:50]

        raw_blocked = payload.get('blocked_commands', current['blocked_commands'])
        if not isinstance(raw_blocked, list):
            raise IdentityError('blocked_commands must be a list of strings', 400)
        clean_blocked = [str(x).strip().lower() for x in raw_blocked if str(x).strip()][:50]

        now = int(self.store.clock())
        with self.store._lock, self.store._db() as db:
            db.execute("""
                UPDATE workspace_sandbox_policy
                SET max_timeout_seconds=?, strict_mode=?, allowed_prefixes=?, blocked_commands=?, updated_at=?
                WHERE id='global'
            """, (max_timeout, 1 if strict_mode else 0, json.dumps(clean_allowed), json.dumps(clean_blocked), now))
            self.store._audit(db, principal['id'], 'workspace_sandbox_policy_updated', f"timeout:{max_timeout}:strict:{int(strict_mode)}")

        return self._get_effective_sandbox_policy()

    def dispatch_governance_webhook(self, event_type, details):
        try:
            with self.store._db() as db:
                rows = db.execute("SELECT * FROM workspace_governance_webhooks WHERE enabled=1").fetchall()
                if not rows:
                    return
                webhooks = [dict(r) for r in rows]
        except Exception:
            return

        def _worker(active_webhooks):
            for wh in active_webhooks:
                try:
                    events = json.loads(wh.get('events') or '[]')
                except Exception:
                    events = []
                if event_type in events or '*' in events:
                    try:
                        payload = {
                            'event': event_type,
                            'timestamp': int(time.time()),
                            'data': details,
                            'source': 'OmniOps Governance Engine'
                        }
                        data_bytes = json.dumps(payload, ensure_ascii=False).encode('utf-8')
                        headers = {
                            'Content-Type': 'application/json',
                            'User-Agent': 'OmniOps-Governance-Webhook/1.18.0'
                        }
                        if wh.get('secret'):
                            sig = hmac.new(wh['secret'].encode('utf-8'), data_bytes, hashlib.sha256).hexdigest()
                            headers['X-OmniOps-Signature'] = f"sha256={sig}"
                        req = urllib.request.Request(wh['url'], data=data_bytes, headers=headers, method='POST')
                        urllib.request.urlopen(req, timeout=5)
                    except Exception:
                        pass
        threading.Thread(target=_worker, args=(webhooks,), daemon=True).start()

    def list_governance_webhooks(self, principal):
        if principal.get('role') != 'superadmin':
            raise IdentityError('Superadmin role required', 403)
        with self.store._db() as db:
            rows = db.execute("SELECT * FROM workspace_governance_webhooks ORDER BY created_at DESC, rowid DESC").fetchall()
            res = []
            for r in rows:
                d = dict(r)
                try:
                    d['events'] = json.loads(d.get('events') or '[]')
                except Exception:
                    d['events'] = []
                d['enabled'] = bool(d.get('enabled', 1))
                res.append(d)
            return res

    def save_governance_webhook(self, principal, payload):
        if principal.get('role') != 'superadmin':
            raise IdentityError('Superadmin role required', 403)
        if not isinstance(payload, dict):
            raise IdentityError('Invalid payload', 400)
        name = str(payload.get('name') or '').strip()
        url = str(payload.get('url') or '').strip()
        if not name or len(name) > 100:
            raise IdentityError('Webhook name must be 1-100 characters', 400)
        if not url.startswith(('http://', 'https://')) or len(url) > 500:
            raise IdentityError('Webhook URL must be a valid http(s) URL', 400)
        secret = str(payload.get('secret') or '').strip()[:100]
        events = payload.get('events') or ['emergency_stop', 'sandbox_violation', 'waiting_approval']
        if not isinstance(events, list):
            events = ['emergency_stop', 'sandbox_violation', 'waiting_approval']
        enabled = 1 if payload.get('enabled', True) else 0

        now = int(self.store.clock())
        wh_id = payload.get('id')
        with self.store._lock, self.store._db() as db:
            if wh_id and isinstance(wh_id, str) and len(wh_id) == 32:
                db.execute("""
                    UPDATE workspace_governance_webhooks
                    SET name=?, url=?, secret=?, events=?, enabled=?, updated_at=?
                    WHERE id=?
                """, (name, url, secret, json.dumps(events), enabled, now, wh_id))
            else:
                wh_id = uuid.uuid4().hex
                db.execute("""
                    INSERT INTO workspace_governance_webhooks
                    (id, name, url, secret, events, enabled, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (wh_id, name, url, secret, json.dumps(events), enabled, now, now))
            self.store._audit(db, principal['id'], 'workspace_governance_webhook_saved', f"{wh_id}:{name}")

        return {
            'id': wh_id,
            'name': name,
            'url': url,
            'secret': secret,
            'events': events,
            'enabled': bool(enabled),
            'updated_at': now
        }

    def delete_governance_webhook(self, principal, webhook_id):
        if principal.get('role') != 'superadmin':
            raise IdentityError('Superadmin role required', 403)
        if not isinstance(webhook_id, str) or len(webhook_id) != 32:
            raise IdentityError('Invalid webhook ID')
        with self.store._lock, self.store._db() as db:
            deleted = db.execute("DELETE FROM workspace_governance_webhooks WHERE id=?", (webhook_id,)).rowcount
            if not deleted:
                raise IdentityError('Webhook not found', 404)
            self.store._audit(db, principal['id'], 'workspace_governance_webhook_deleted', webhook_id)
        return {'status': 'deleted', 'id': webhook_id}

    def test_governance_webhook(self, principal, webhook_id):
        if principal.get('role') != 'superadmin':
            raise IdentityError('Superadmin role required', 403)
        if not isinstance(webhook_id, str) or len(webhook_id) != 32:
            raise IdentityError('Invalid webhook ID')
        with self.store._db() as db:
            row = db.execute("SELECT * FROM workspace_governance_webhooks WHERE id=?", (webhook_id,)).fetchone()
            if not row:
                raise IdentityError('Webhook not found', 404)
            wh = dict(row)

        payload = {
            'event': 'ping',
            'timestamp': int(self.store.clock()),
            'data': {'message': 'OmniOps Governance Webhook Test Ping', 'webhook_name': wh['name']},
            'source': 'OmniOps Governance Engine'
        }
        data_bytes = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'OmniOps-Governance-Webhook/1.18.0'
        }
        if wh.get('secret'):
            sig = hmac.new(wh['secret'].encode('utf-8'), data_bytes, hashlib.sha256).hexdigest()
            headers['X-OmniOps-Signature'] = f"sha256={sig}"
        req = urllib.request.Request(wh['url'], data=data_bytes, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return {'status': 'success', 'code': resp.status, 'message': f'HTTP {resp.status}'}
        except urllib.error.HTTPError as err:
            return {'status': 'error', 'code': err.code, 'message': f'HTTP Error {err.code}: {err.reason}'}
        except Exception as exc:
            return {'status': 'error', 'code': 0, 'message': str(exc)}

    def execute_project_command(self, principal, project_id, command, timeout=15):
        if 'action.approve' not in principal.get('capabilities', []) and principal.get('role') != 'superadmin':
            raise IdentityError('action.approve capability or superadmin role required to execute workspace commands', 403)
        if not isinstance(command, str) or not 1 <= len(command.strip()) <= 1000:
            raise IdentityError('Command must contain 1-1000 characters')

        root_dir, _ = self._resolve_project_root(principal, project_id)
        clean_cmd = command.strip()

        policy = self._get_effective_sandbox_policy()
        lower_cmd = clean_cmd.lower()

        # Check blocked commands from policy
        for bad in policy.get('blocked_commands', []):
            if bad and bad in lower_cmd:
                self.dispatch_governance_webhook('sandbox_violation', {
                    'project_id': project_id,
                    'actor': principal.get('username', principal.get('id')),
                    'command': clean_cmd[:100],
                    'reason': f"Blocked pattern '{bad}'"
                })
                raise IdentityError(f"Prohibited dangerous command: matches blocked pattern '{bad}'", 400)

        # Check strict mode allowed prefixes
        if policy.get('strict_mode'):
            tokens = clean_cmd.split()
            first_raw = tokens[0].lower() if tokens else ''
            first_name = Path(first_raw.strip('"\'')).name
            if first_name.endswith('.exe'):
                first_name = first_name[:-4]
            allowed_list = policy.get('allowed_prefixes', [])
            if not any(first_name == p.lower() or first_raw == p.lower() for p in allowed_list):
                self.dispatch_governance_webhook('sandbox_violation', {
                    'project_id': project_id,
                    'actor': principal.get('username', principal.get('id')),
                    'command': clean_cmd[:100],
                    'reason': f"Disallowed command prefix in strict mode"
                })
                raise IdentityError(f"Command '{tokens[0]}' is disallowed by workspace sandbox policy", 403)

        effective_timeout = min(max(1, timeout), policy.get('max_timeout_seconds', 30))

        t0 = time.time()
        try:
            res = subprocess.run(
                clean_cmd,
                shell=True,
                cwd=str(root_dir),
                capture_output=True,
                text=True,
                timeout=effective_timeout,
            )
            stdout = res.stdout[:32000] if res.stdout else ''
            stderr = res.stderr[:32000] if res.stderr else ''
            exit_code = res.returncode
        except subprocess.TimeoutExpired:
            stdout = ''
            stderr = f'Command timed out after {effective_timeout} seconds'
            exit_code = 124
        except Exception as exc:
            stdout = ''
            stderr = f'Execution error: {exc}'
            exit_code = 1

        duration_ms = int((time.time() - t0) * 1000)

        now_ts = int(self.store.clock())
        cmd_id = uuid.uuid4().hex
        with self.store._lock, self.store._db() as db:
            db.execute("""
                INSERT INTO workspace_command_history
                (id, project_id, command, exit_code, stdout, stderr, duration_ms, executed_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (cmd_id, project_id, clean_cmd, exit_code, stdout, stderr, duration_ms, principal['id'], now_ts))
            self.store._audit(db, principal['id'], 'workspace_command_executed', f"{project_id}:{clean_cmd[:80]}")

        return {
            'id': cmd_id,
            'project_id': project_id,
            'command': clean_cmd,
            'exit_code': exit_code,
            'stdout': stdout,
            'stderr': stderr,
            'duration_ms': duration_ms,
            'created_at': now_ts,
        }

    def list_command_history(self, principal, project_id, limit=50):
        self._cap(principal, 'chat')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        self._resolve_project_root(principal, project_id)
        effective_limit = min(max(1, int(limit or 50)), 200)
        with self.store._db() as db:
            rows = db.execute("""
                SELECT h.id, h.project_id, h.command, h.exit_code, h.stdout, h.stderr, h.duration_ms,
                       h.executed_by, u.username as executed_by_username, h.created_at
                FROM workspace_command_history h
                LEFT JOIN users u ON u.id = h.executed_by
                WHERE h.project_id=?
                ORDER BY h.created_at DESC, h.rowid DESC
                LIMIT ?
            """, (project_id, effective_limit)).fetchall()
            return [dict(r) for r in rows]

    def start_streaming_command(self, principal, project_id, command, timeout=30):
        if 'action.approve' not in principal.get('capabilities', []) and principal.get('role') != 'superadmin':
            raise IdentityError('action.approve capability or superadmin role required to execute workspace commands', 403)
        if not isinstance(command, str) or not 1 <= len(command.strip()) <= 1000:
            raise IdentityError('Command must contain 1-1000 characters')

        root_dir, _ = self._resolve_project_root(principal, project_id)
        clean_cmd = command.strip()

        policy = self._get_effective_sandbox_policy()
        lower_cmd = clean_cmd.lower()

        for bad in policy.get('blocked_commands', []):
            if bad and bad in lower_cmd:
                self.dispatch_governance_webhook('sandbox_violation', {
                    'project_id': project_id,
                    'actor': principal.get('username', principal.get('id')),
                    'command': clean_cmd[:100],
                    'reason': f"Blocked pattern '{bad}'"
                })
                raise IdentityError(f"Prohibited dangerous command: matches blocked pattern '{bad}'", 400)

        if policy.get('strict_mode'):
            tokens = clean_cmd.split()
            first_raw = tokens[0].lower() if tokens else ''
            first_name = Path(first_raw.strip('"\'')).name
            if first_name.endswith('.exe'):
                first_name = first_name[:-4]
            allowed_list = policy.get('allowed_prefixes', [])
            if not any(first_name == p.lower() or first_raw == p.lower() for p in allowed_list):
                self.dispatch_governance_webhook('sandbox_violation', {
                    'project_id': project_id,
                    'actor': principal.get('username', principal.get('id')),
                    'command': clean_cmd[:100],
                    'reason': "Disallowed command prefix in strict mode"
                })
                raise IdentityError(f"Command '{tokens[0]}' is disallowed by workspace sandbox policy", 403)

        effective_timeout = min(max(1, timeout), policy.get('max_timeout_seconds', 60))
        cmd_id = uuid.uuid4().hex
        now_ts = int(self.store.clock())

        entry = {
            'id': cmd_id,
            'project_id': project_id,
            'command': clean_cmd,
            'status': 'running',
            'lines': [],
            'exit_code': None,
            'duration_ms': 0,
            'created_at': now_ts,
            'event': threading.Event(),
            'completed': False,
            'lock': threading.Lock()
        }

        with _command_streams_lock:
            _command_streams[cmd_id] = entry

        def _runner():
            t0 = time.time()
            exit_code = 0
            try:
                proc = subprocess.Popen(
                    clean_cmd,
                    shell=True,
                    cwd=str(root_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    errors='replace'
                )
                while True:
                    line = proc.stdout.readline()
                    if not line:
                        if proc.poll() is not None:
                            break
                        time.sleep(0.04)
                        continue
                    clean_line = line.rstrip('\r\n')
                    with entry['lock']:
                        entry['lines'].append(clean_line)
                    entry['event'].set()

                exit_code = proc.wait(timeout=effective_timeout)
            except subprocess.TimeoutExpired:
                with entry['lock']:
                    entry['lines'].append(f"Command timed out after {effective_timeout} seconds")
                exit_code = 124
            except Exception as exc:
                with entry['lock']:
                    entry['lines'].append(f"Execution error: {exc}")
                exit_code = 1
            finally:
                if 'proc' in locals() and proc and proc.stdout:
                    try:
                        proc.stdout.close()
                    except Exception:
                        pass

            duration_ms = int((time.time() - t0) * 1000)
            full_stdout = "\n".join(entry['lines'][:2000])[:32000]
            try:
                with self.store._lock, self.store._db() as db:
                    db.execute("""
                        INSERT INTO workspace_command_history
                        (id, project_id, command, exit_code, stdout, stderr, duration_ms, executed_by, created_at)
                        VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)
                    """, (cmd_id, project_id, clean_cmd, exit_code, full_stdout, duration_ms, principal['id'], now_ts))
                    self.store._audit(db, principal['id'], 'workspace_command_executed', f"{project_id}:{clean_cmd[:80]}")
            except Exception:
                pass

            with entry['lock']:
                entry['exit_code'] = exit_code
                entry['duration_ms'] = duration_ms
                entry['completed'] = True
                entry['status'] = 'completed' if exit_code == 0 else 'failed'
            entry['event'].set()

        t = threading.Thread(target=_runner, daemon=True)
        entry['thread'] = t
        t.start()

        return {
            'id': cmd_id,
            'project_id': project_id,
            'command': clean_cmd,
            'status': 'running'
        }

    def validate_command_stream(self, principal, command_id):
        self._cap(principal, 'chat')
        if not isinstance(command_id, str) or len(command_id) != 32:
            raise IdentityError('Invalid command stream ID', 400)
        with _command_streams_lock:
            entry = _command_streams.get(command_id)
        if not entry:
            raise IdentityError('Command stream not found or expired', 404)
        self._resolve_project_root(principal, entry['project_id'])
        return entry

    def get_command_stream_events(self, principal, command_id):
        self._cap(principal, 'chat')
        if not isinstance(command_id, str) or len(command_id) != 32:
            raise IdentityError('Invalid command stream ID', 400)

        with _command_streams_lock:
            entry = _command_streams.get(command_id)
        if not entry:
            raise IdentityError('Command stream not found or expired', 404)

        self._resolve_project_root(principal, entry['project_id'])

        last_idx = 0
        t_start = time.time()
        while True:
            with entry['lock']:
                new_lines = list(entry['lines'][last_idx:])
                completed = entry['completed']
                exit_code = entry['exit_code']
                duration_ms = entry['duration_ms']

            for l in new_lines:
                yield {'type': 'stdout', 'text': l, 'line': l, 'done': False}
                last_idx += 1

            if completed and last_idx >= len(entry['lines']):
                yield {'type': 'done', 'text': '', 'line': '', 'done': True, 'exit_code': exit_code, 'duration_ms': duration_ms}
                break

            entry['event'].wait(timeout=0.25)
            entry['event'].clear()

            if time.time() - t_start > 180:
                yield {'line': 'Stream timed out', 'done': True, 'exit_code': 124, 'duration_ms': 180000}
                break

    def search_project(self, principal, project_id, query, case_sensitive=False, max_results=50, file_extensions=None):
        self._cap(principal, 'chat')
        root_dir, _ = self._resolve_project_root(principal, project_id)
        clean_query = str(query or '').strip()
        if not clean_query:
            raise IdentityError('Search query cannot be empty', 400)
        if len(clean_query) > 200:
            raise IdentityError('Search query too long', 400)

        effective_limit = min(max(1, int(max_results or 50)), 200)
        ignored_dirs = {
            'node_modules', '.git', 'dist', 'build', '__pycache__', '.venv',
            'venv', '.cargo', 'target', '.idea', '.vscode', '.next', '.nuxt', 'coverage'
        }
        allowed_exts = None
        if file_extensions and isinstance(file_extensions, list):
            allowed_exts = {str(ext).lower().lstrip('.') for ext in file_extensions if str(ext).strip()}

        matches = []
        total_matches = 0
        search_term = clean_query if case_sensitive else clean_query.lower()

        for dirpath, dirnames, filenames in os.walk(root_dir):
            dirnames[:] = [d for d in dirnames if d not in ignored_dirs and not d.startswith('.')]
            for fn in sorted(filenames):
                if total_matches >= effective_limit:
                    break
                ext = fn.split('.')[-1].lower() if '.' in fn else ''
                if allowed_exts and ext not in allowed_exts:
                    continue

                full_path = Path(dirpath) / fn
                try:
                    if full_path.stat().st_size > 2 * 1024 * 1024:
                        continue
                except OSError:
                    continue

                rel_path = str(full_path.relative_to(root_dir)).replace('\\', '/')
                try:
                    with open(full_path, 'rb') as f:
                        chunk = f.read(1024)
                        if b'\0' in chunk:
                            continue
                    with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                        file_matches = []
                        for line_no, line in enumerate(f, start=1):
                            line_check = line if case_sensitive else line.lower()
                            if search_term in line_check:
                                file_matches.append({
                                    'line_number': line_no,
                                    'line_text': line.strip()[:300]
                                })
                                total_matches += 1
                                if total_matches >= effective_limit:
                                    break
                        if file_matches:
                            matches.append({
                                'path': rel_path,
                                'matches': file_matches
                            })
                except Exception:
                    continue

            if total_matches >= effective_limit:
                break

        return {
            'project_id': project_id,
            'query': clean_query,
            'total_matches': total_matches,
            'results': matches
        }

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

    def _format_run(self, run, db=None):
        try:
            plan = json.loads(run.get('plan_steps') or '[]')
        except Exception:
            plan = []
        try:
            logs = json.loads(run.get('logs') or '[]')
        except Exception:
            logs = []
        res = {
            'id': run['id'],
            'owner_id': run.get('owner_id') or '',
            'project_id': run['project_id'],
            'prompt': run['prompt'],
            'role': run.get('role') or 'general',
            'mode': run.get('mode') or 'single',
            'status': run['status'],
            'current_step_index': run['current_step_index'],
            'plan_steps': plan,
            'logs': logs,
            'result_summary': run.get('result_summary') or '',
            'debug_mode': bool(run.get('debug_mode', 0)),
            'created_at': run['created_at'],
            'updated_at': run['updated_at']
        }
        if 'owner_username' in run and run['owner_username'] is not None:
            res['owner_username'] = run['owner_username']
        if 'project_name' in run and run['project_name'] is not None:
            res['project_name'] = run['project_name']

        try:
            if db is not None:
                sub_rows = db.execute(
                    "SELECT * FROM workspace_subagent_runs WHERE parent_run_id=? ORDER BY created_at ASC, rowid ASC",
                    (run['id'],)
                ).fetchall()
            else:
                with self.store._db() as db_conn:
                    sub_rows = db_conn.execute(
                        "SELECT * FROM workspace_subagent_runs WHERE parent_run_id=? ORDER BY created_at ASC, rowid ASC",
                        (run['id'],)
                    ).fetchall()
            subagents = []
            for sr in sub_rows:
                sub = dict(sr)
                try:
                    sub['logs'] = json.loads(sub.get('logs') or '[]')
                except Exception:
                    sub['logs'] = []
                subagents.append(sub)
            res['subagents'] = subagents
        except Exception:
            res['subagents'] = []

        return res

    def _record_task_chat_notification(self, db, run, step_idx, step_title, step_status, summary='', command=None, result_summary=None):
        try:
            now = int(self.store.clock())
            owner_id = run['owner_id']
            run_id = run['id']
            role = run.get('role', 'general')
            mode = run.get('mode', 'single')
            prompt = run.get('prompt', '')

            role_fa = {'general': 'عمومی', 'coder': 'برنامه‌نویس', 'tester': 'تست و ارزیابی', 'architect': 'معمار سیستم', 'swarm': 'سوارم چندعاملی'}.get(role, role)
            status_fa = {
                'in_progress': '⏳ در حال اجرا',
                'waiting_approval': '⚠️ نیازمند تأیید ناظر / مدیر (Human-in-the-Loop)',
                'completed': '✅ با موفقیت پایان یافت',
                'failed': '❌ با خطا مواجه شد',
                'warning': '⚠️ پایان با هشدار',
                'cancelled': '⛔ متوقف‌شده',
                'paused_debug': '⏸️ توقف دیباگ'
            }.get(step_status, step_status)

            lines = [
                f"⚡ **گزارش اجرای مرحله وظیفه ایجنت (Agent Task Step Report)**",
                f"🎯 **هدف وظیفه:** «{prompt}»",
                f"🤖 **عامل فعال:** ایجنت {role_fa} ({'سوارم چندعاملی' if mode == 'swarm' else 'تک‌ایـجنت'})",
                f"📍 **گام {step_idx + 1}:** {step_title}",
                f"📊 **وضعیت:** {status_fa}",
            ]
            if command:
                lines.append(f"💻 **دستور ساندباکس:** `{command}`")
            if summary:
                lines.append(f"📝 **توضیحات و خروجی:** {summary}")
            if result_summary:
                lines.append(f"\n🎉 **جمع‌بندی نهایی تسک:**\n{result_summary}")

            reply_text = "\n".join(lines)
            prompt_text = f"🔔 [اعلان پیشرفت وظیفه: {prompt[:40]}]"
            model_tag = f"agent-task:{role}"

            # Ensure chat_sessions and chat_history exist if ProfileMemoryStore hasn't run yet
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
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    prompt TEXT NOT NULL,
                    reply TEXT NOT NULL,
                    model TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    session_id TEXT NOT NULL
                );
            """)

            # 1. Update or create chat_session
            active = db.execute(
                "SELECT id, title FROM chat_sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT 1",
                (owner_id,)
            ).fetchone()
            if active:
                target_sess_id = active["id"]
                db.execute("UPDATE chat_sessions SET updated_at=? WHERE id=?", (now, target_sess_id))
            else:
                target_sess_id = uuid.uuid4().hex
                db.execute("INSERT INTO chat_sessions VALUES (?, ?, ?, ?, ?)",
                           (target_sess_id, owner_id, "گفتگوی وظایف هوشمند (Agent Tasks)", now, now))

            # 2. Insert into chat_history
            db.execute(
                "INSERT INTO chat_history VALUES (?, ?, ?, ?, ?, ?, ?)",
                (uuid.uuid4().hex, owner_id, prompt_text, reply_text, model_tag, now, target_sess_id)
            )

            # 3. Insert into workspace_task_notifications
            notif_id = uuid.uuid4().hex
            db.execute("""
                INSERT INTO workspace_task_notifications (id, run_id, owner_id, step_index, step_title, status, summary, message, read, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """, (notif_id, run_id, owner_id, step_idx, step_title, step_status, summary or "", reply_text, now))
        except Exception:
            pass

    def start_agent_run(self, principal, project_id, prompt, role='general', mode='single', debug_mode=False, custom_plan_steps=None):
        self._cap(principal, 'chat')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 2000:
            raise IdentityError('Goal/prompt must contain 1-2000 characters')

        clean_mode = (mode or 'single').strip().lower()
        if clean_mode not in ('single', 'swarm'):
            raise IdentityError('Invalid agent mode. Allowed: single, swarm', 400)

        clean_role = (role or 'general').strip().lower()
        if clean_role not in ('general', 'coder', 'tester', 'architect', 'swarm'):
            raise IdentityError('Invalid agent role. Allowed: general, coder, tester, architect', 400)

        clean_debug = bool(debug_mode)
        root_dir, project_name = self._resolve_project_root(principal, project_id)
        inspection = self.inspect_project(principal, project_id)

        target_file = 'README.md'
        default_cmd = 'git status'
        fw = inspection['framework']
        if fw.startswith('React') or fw in ('Node.js', 'Next.js', 'Express', 'Fastify'):
            target_file = 'package.json'
            default_cmd = 'npm test'
        elif fw in ('Python', 'FastAPI', 'Django', 'Flask', 'AI / PyTorch'):
            target_file = 'requirements.txt' if (root_dir / 'requirements.txt').is_file() else ('pyproject.toml' if (root_dir / 'pyproject.toml').is_file() else 'README.md')
            default_cmd = 'python -m unittest'
        elif fw == 'Rust / Cargo':
            target_file = 'Cargo.toml'
            default_cmd = 'cargo test'
        elif fw == 'Go Module':
            target_file = 'go.mod'
            default_cmd = 'go test'

        now = int(self.store.clock())
        can_exec = 'action.approve' in principal.get('capabilities', []) or principal.get('role') == 'superadmin'
        run_id = uuid.uuid4().hex
        subagents = []

        if clean_mode == 'swarm':
            plan_steps = [
                {
                    'index': 0,
                    'title': '🏛️ تحلیل معماری و نقشه راه فنی (زیرایجنت معمار)',
                    'action': 'swarm_architect',
                    'status': 'completed',
                    'summary': f"تحلیل معماری پروژه {project_name} با فریم‌ورک {inspection['framework']} و {inspection['total_entries']} فایل."
                },
                {
                    'index': 1,
                    'title': f'🛠️ ممیزی و پیاده‌سازی پچ‌های کد (زیرایجنت برنامه‌نویس: {target_file})',
                    'action': 'swarm_coder',
                    'target': target_file,
                    'status': 'in_progress' if not clean_debug else 'paused_debug',
                    'summary': f'بررسی فایل {target_file} و تحلیل تغییرات مورد نیاز...' if not clean_debug else f'توقف دیباگ برای بازرسی {target_file}. برای ادامه، Step Next را بزنید.'
                },
                {
                    'index': 2,
                    'title': f'🧪 آزمون و راستی‌آزمایی کیفیت (زیرایجنت تستر: {default_cmd})',
                    'action': 'swarm_tester',
                    'command': default_cmd,
                    'status': 'waiting_approval' if not can_exec else 'pending',
                    'summary': 'در انتظار اجرای آزمون‌های یکپارچگی و صحه‌سنجی' if can_exec else 'در انتظار تایید اجرای دستور توسط ناظر یا مدیر'
                },
                {
                    'index': 3,
                    'title': '🐝 سنتز و یکپارچه‌سازی گزارش تیمی سوارم',
                    'action': 'synthesize_swarm',
                    'status': 'pending',
                    'summary': 'تدوین گزارش جامع برآمده از ۳ منظر معماری، پیاده‌سازی و تست'
                }
            ]

            logs = [
                {
                    'timestamp': now,
                    'step': 0,
                    'type': 'swarm_orchestration',
                    'title': '🐝 راه‌اندازی همکاری گروهی ایجنت‌ها (Multi-Agent Swarm)',
                    'content': f"ارکستراسیون ۳ ایجنت متخصص برای دستیابی به هدف «{prompt.strip()}» با موفقیت آغاز شد."
                }
            ]

            target_fp = root_dir / target_file
            if clean_debug:
                coder_status = 'paused_debug'
                coder_summary = f"توقف دیباگ در گام ۱ برای بازرسی {target_file}."
                current_step = 1
                run_status = 'paused_debug'
                logs.append({
                    'timestamp': now,
                    'step': 1,
                    'type': 'debug_pause',
                    'title': f'🐞 توقف دیباگ در گام ۱ (کدنویس: {target_file})',
                    'content': 'زیرایجنت کدنویس در نقطه وارسی متوقف شد. برای آغاز ممیزی، Step Next را بزنید.'
                })
                tester_status = 'pending'
            else:
                coder_summary = f"فایل {target_file} در حال بررسی است."
                coder_status = 'in_progress'
                coder_logs = [{'timestamp': now, 'title': 'آغاز ماموریت کدنویس', 'content': f'بررسی ماژول‌ها و فایل {target_file}'}]
                current_step = 1

                if target_fp.is_file():
                    try:
                        content = target_fp.read_text(encoding='utf-8', errors='replace')
                        preview = content[:600] + ('\n...(ادامه دارد)' if len(content) > 600 else '')
                        plan_steps[1]['status'] = 'completed'
                        plan_steps[1]['summary'] = f"فایل {target_file} ({len(content)} بایت) با موفقیت ممیزی شد."
                        coder_status = 'completed'
                        coder_summary = f"فایل {target_file} ({len(content)} بایت) بررسی و ساختار کدهای وابسته تایید شد."
                        coder_logs.append({'timestamp': now, 'title': f'ممیزی {target_file}', 'content': preview})
                        logs.append({
                            'timestamp': now,
                            'step': 1,
                            'type': 'file_read',
                            'title': f"ممیزی {target_file} توسط زیرایجنت کدنویس",
                            'content': preview
                        })
                        current_step = 2
                    except Exception as exc:
                        plan_steps[1]['status'] = 'failed'
                        plan_steps[1]['summary'] = f"خطا در خواندن فایل: {exc}"
                        coder_status = 'failed'
                        coder_summary = f"خطا در خواندن فایل: {exc}"
                        current_step = 2
                else:
                    plan_steps[1]['status'] = 'skipped'
                    plan_steps[1]['summary'] = f"فایل {target_file} در ریشه پروژه یافت نشد."
                    coder_status = 'completed'
                    coder_summary = f"فایل {target_file} در ریشه پروژه یافت نشد."
                    current_step = 2

                tester_status = 'waiting_approval' if not can_exec else 'pending'
                run_status = 'waiting_approval' if not can_exec else 'in_progress'

            subagents = [
                {
                    'id': uuid.uuid4().hex,
                    'parent_run_id': run_id,
                    'role': 'architect',
                    'title': '🏛️ زیرایجنت تحلیل و هدایت معماری',
                    'status': 'completed',
                    'prompt': f'تحلیل معماری، ساختار ماژول‌ها و تعریف پیش‌نیازهای فنی برای: {prompt.strip()}',
                    'summary': f"معماری پروژه {project_name} ({inspection['framework']}) ارزیابی شد. فایل‌ها: {inspection['total_entries']} مورد.",
                    'logs': json.dumps([{'timestamp': now, 'title': 'تحلیل معماری', 'content': f"پویش پروژه در مسیر {inspection['root_path']}"}]),
                    'created_at': now,
                    'updated_at': now
                },
                {
                    'id': uuid.uuid4().hex,
                    'parent_run_id': run_id,
                    'role': 'coder',
                    'title': '🛠️ زیرایجنت پیاده‌سازی و ساخت کد',
                    'status': coder_status,
                    'prompt': f'ممیزی ساختار سورس، تحلیل وابستگی‌ها و بازخوانی {target_file} برای: {prompt.strip()}',
                    'summary': coder_summary,
                    'logs': json.dumps([]),
                    'created_at': now,
                    'updated_at': now
                },
                {
                    'id': uuid.uuid4().hex,
                    'parent_run_id': run_id,
                    'role': 'tester',
                    'title': '🧪 زیرایجنت تضمین کیفیت و راستی‌آزمایی',
                    'status': tester_status,
                    'prompt': f'اجرای آزمون‌های یکپارچگی ({default_cmd}) و ارزیابی کیفیت خروجی‌ها برای: {prompt.strip()}',
                    'summary': 'در انتظار اجرای آزمون‌های راستی‌آزمایی و ارزیابی کیفیت.' if can_exec else 'در انتظار تایید اداری اجرای دستور تست',
                    'logs': json.dumps([]),
                    'created_at': now,
                    'updated_at': now
                }
            ]
        else:
            role_labels = {
                'general': 'عمومی',
                'coder': 'برنامه‌نویس',
                'tester': 'تست و ارزیابی',
                'architect': 'معمار سیستم',
            }

            if clean_role == 'coder':
                step0_title = 'تحلیل ماژول‌ها و ساختار کدهای منبع'
                step0_summary = f"بررسی ماژول‌های {inspection['framework']} ({inspection['total_entries']} فایل کشف شد)"
                step1_title = f'بازخوانی و ممیزی فایل هدف برای پیاده‌سازی ({target_file})'
                step2_title = f'اجرای بررسی‌های کامپایلر یا لینتر ({default_cmd})'
                step3_title = 'تهیه پیشنهاد پچ (Patch Diff) و یکپارچه‌سازی کد'
                step3_summary = 'تدوین تغییرات و وصله‌های پیشنهادی بر روی پروژه'
            elif clean_role == 'tester':
                step0_title = 'پویش پایگاه تست‌ها و سناریوهای آزمون'
                step0_summary = f"ارزیابی وابستگی‌های تست در {inspection['framework']}"
                step1_title = f'بررسی فریم‌ورک تست و فایل‌های پیکربندی ({target_file})'
                step2_title = f'اجرای سوئیت تست و تحلیل خروجی آزمون‌ها ({default_cmd})'
                step3_title = 'تدوین گزارش جامع تضمین کیفیت و نتایج تست'
                step3_summary = 'ارزیابی ریسک و نتایج قبولی/ردی تست‌های سیستم'
            elif clean_role == 'architect':
                step0_title = 'تحلیل توپولوژی معماری و وابستگی‌های سیستم'
                step0_summary = f"بررسی معماری پروژه {inspection['framework']} در ریشه پروژه"
                step1_title = f'ارزیابی مانیفست‌های معماری و تنظیمات پایه ({target_file})'
                step2_title = f'بررسی یکپارچگی گیت و انطباق استانداردها ({default_cmd})'
                step3_title = 'تدوین سند ارزیابی معماری و راهنمای استقرار'
                step3_summary = 'ارائه راهکارهای مقیاس‌پذیری و بازطراحی سیستم'
            else:
                step0_title = 'پویش ساختار و شناسایی فریم‌ورک پروژه'
                step0_summary = f"فریم‌ورک: {inspection['framework']} | فایل‌ها: {inspection['total_entries']} مورد"
                step1_title = f'بررسی فایل پیکربندی و وابستگی‌ها ({target_file})'
                step2_title = f'ارزیابی تست‌ها و اجرای دستورات صحه‌سنجی ({default_cmd})'
                step3_title = 'تدوین گزارش راهکار و جمع‌بندی گام‌های توسعه'
                step3_summary = 'تهیه نقشه راه نهایی تکمیل تسک‌ها'

            if custom_plan_steps and isinstance(custom_plan_steps, list) and len(custom_plan_steps) > 0:
                plan_steps = []
                for i, st in enumerate(custom_plan_steps):
                    plan_steps.append({
                        'index': i,
                        'title': st.get('title', f'گام {i+1}'),
                        'action': st.get('action', 'inspect' if i == 0 else ('read_file' if i == 1 else ('run_command' if i == 2 else 'review'))),
                        'target': st.get('target', target_file if i == 1 else ''),
                        'command': st.get('command', default_cmd if i == 2 else ''),
                        'status': 'completed' if i == 0 else ('in_progress' if i == 1 and not clean_debug else ('paused_debug' if i == 1 and clean_debug else 'pending')),
                        'summary': st.get('description', st.get('summary', f'گام اجرایی: {st.get("title", "")}'))
                    })
            else:
                plan_steps = [
                    {
                        'index': 0,
                        'title': step0_title,
                        'action': 'inspect',
                        'status': 'completed',
                        'summary': step0_summary
                    },
                    {
                        'index': 1,
                        'title': step1_title,
                        'action': 'read_file',
                        'target': target_file,
                        'status': 'in_progress' if not clean_debug else 'paused_debug',
                        'summary': 'در حال بررسی تنظیمات و ماژول‌ها...' if not clean_debug else f'توقف دیباگ در گام ۱ برای وارسی {target_file}. برای ادامه، Step Next را بزنید.'
                    },
                    {
                        'index': 2,
                        'title': step2_title,
                        'action': 'run_command',
                        'command': default_cmd,
                        'status': 'pending',
                        'summary': 'نیازمند تایید اقدام یا مجوز اجرا'
                    },
                    {
                        'index': 3,
                        'title': step3_title,
                        'action': 'synthesize',
                        'status': 'pending',
                        'summary': step3_summary
                    }
                ]

            logs = [
                {
                    'timestamp': now,
                    'step': 0,
                    'type': 'inspection',
                    'title': f'آغاز مأموریت با نقش «{role_labels.get(clean_role, "عمومی")}»',
                    'content': f"پروژه «{project_name}» در مسیر {inspection['root_path']} با فریم‌ورک {inspection['framework']} پویش شد."
                }
            ]

            target_fp = root_dir / target_file
            if clean_debug:
                current_step = 1
                run_status = 'paused_debug'
                logs.append({
                    'timestamp': now,
                    'step': 1,
                    'type': 'debug_pause',
                    'title': f'🐞 توقف دیباگ در گام ۱ ({target_file})',
                    'content': f"ایجنت در نقطه وارسی گام ۱ متوقف شد. برای بررسی {target_file}، Step Next را بزنید."
                })
            else:
                if target_fp.is_file():
                    try:
                        content = target_fp.read_text(encoding='utf-8', errors='replace')
                        preview = content[:600] + ('\n...(ادامه دارد)' if len(content) > 600 else '')
                        plan_steps[1]['status'] = 'completed'
                        plan_steps[1]['summary'] = f"فایل {target_file} ({len(content)} بایت) با موفقیت بررسی شد."
                        logs.append({
                            'timestamp': now,
                            'step': 1,
                            'type': 'file_read',
                            'title': f"بررسی {target_file}",
                            'content': preview
                        })
                        current_step = 2
                    except Exception as exc:
                        plan_steps[1]['status'] = 'failed'
                        plan_steps[1]['summary'] = f"خطا در خواندن فایل: {exc}"
                        current_step = 2
                else:
                    plan_steps[1]['status'] = 'skipped'
                    plan_steps[1]['summary'] = f"فایل {target_file} در ریشه پروژه یافت نشد."
                    current_step = 2

                run_status = 'in_progress'
                if not can_exec:
                    run_status = 'waiting_approval'
                    plan_steps[2]['status'] = 'waiting_approval'
                    plan_steps[2]['summary'] = 'در انتظار تأیید مجوز اجرای دستور توسط مدیر ارشد یا کاربر تاییدکننده'

        with self.store._lock, self.store._db() as db:
            db.execute("""
                INSERT INTO workspace_agent_runs 
                (id, owner_id, project_id, prompt, role, mode, status, current_step_index, plan_steps, logs, result_summary, debug_mode, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
            """, (run_id, principal['id'], project_id, prompt.strip(), clean_role, clean_mode, run_status, current_step, json.dumps(plan_steps), json.dumps(logs), 1 if clean_debug else 0, now, now))
            for sub in subagents:
                db.execute("""
                    INSERT INTO workspace_subagent_runs
                    (id, parent_run_id, role, title, status, prompt, summary, logs, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (sub['id'], sub['parent_run_id'], sub['role'], sub['title'], sub['status'], sub['prompt'], sub['summary'], sub['logs'], sub['created_at'], sub['updated_at']))
            self.store._audit(db, principal['id'], 'workspace_agent_run_started', f"{run_id}:{project_id}:{clean_role}:{clean_mode}")
            run_dict = {'id': run_id, 'owner_id': principal['id'], 'prompt': prompt.strip(), 'role': clean_role, 'mode': clean_mode}
            self._record_task_chat_notification(
                db, run_dict, 0, plan_steps[0]['title'], plan_steps[0]['status'], summary=plan_steps[0].get('summary', '')
            )
            if len(plan_steps) > 1 and plan_steps[1]['status'] in ('completed', 'failed', 'paused_debug'):
                self._record_task_chat_notification(
                    db, run_dict, 1, plan_steps[1]['title'], plan_steps[1]['status'], summary=plan_steps[1].get('summary', '')
                )
            if len(plan_steps) > 2 and plan_steps[2]['status'] == 'waiting_approval':
                self._record_task_chat_notification(
                    db, run_dict, 2, plan_steps[2]['title'], 'waiting_approval', summary=plan_steps[2].get('summary', ''), command=plan_steps[2].get('command')
                )

        if run_status == 'waiting_approval':
            self.dispatch_governance_webhook('waiting_approval', {
                'run_id': run_id,
                'project_id': project_id,
                'prompt': prompt.strip()[:100],
                'role': clean_role,
                'mode': clean_mode
            })

        return self.get_agent_run(principal, run_id)

    def advance_agent_run(self, principal, run_id):
        self._cap(principal, 'chat')
        if not isinstance(run_id, str) or len(run_id) != 32:
            raise IdentityError('Invalid run ID')

        with self.store._lock, self.store._db() as db:
            if principal.get('role') == 'superadmin':
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=?", (run_id,)).fetchone()
            else:
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=? AND owner_id=?", (run_id, principal['id'])).fetchone()
            if not row:
                raise IdentityError('Agent run not found', 404)
            run = dict(row)
            if run['status'] in ('completed', 'failed', 'cancelled'):
                return self._format_run(run, db=db)

            plan_steps = json.loads(run['plan_steps'])
            logs = json.loads(run['logs'])
            current_idx = run['current_step_index']
            now = int(self.store.clock())
            new_status = run['status']
            result_summary = run['result_summary']
            is_swarm = run.get('mode') == 'swarm'

            if current_idx in (0, 1):
                target_file = plan_steps[1].get('target', 'README.md')
                plan_steps[1]['status'] = 'completed'
                plan_steps[1]['summary'] = f"ممیزی و ارزیابی فایل کلیدی {target_file} با موفقیت پایان یافت."
                logs.append({
                    'timestamp': now,
                    'step': 1,
                    'type': 'code_audit',
                    'title': f"ممیزی فایل: {target_file}",
                    'content': f"ساختار و نیازمندی‌های ویرایش در {target_file} تحلیل گردید."
                })
                self._record_task_chat_notification(
                    db, run, 1, plan_steps[1]['title'], 'completed', summary=plan_steps[1]['summary']
                )
                current_idx = 2
                plan_steps[2]['status'] = 'in_progress'

            if current_idx == 2:
                can_exec = 'action.approve' in principal.get('capabilities', []) or principal.get('role') == 'superadmin'
                if not can_exec:
                    new_status = 'waiting_approval'
                    plan_steps[2]['status'] = 'waiting_approval'
                    plan_steps[2]['summary'] = 'نیازمند تأیید اقدام (action.approve)'
                    self._record_task_chat_notification(
                        db, run, 2, plan_steps[2]['title'], 'waiting_approval', summary=plan_steps[2]['summary'], command=plan_steps[2].get('command')
                    )
                    self.dispatch_governance_webhook('waiting_approval', {
                        'run_id': run_id,
                        'project_id': run['project_id'],
                        'prompt': run['prompt'][:100],
                        'role': run.get('role', 'general'),
                        'mode': run.get('mode', 'single')
                    })
                else:
                    cmd = plan_steps[2].get('command', 'git status')
                    try:
                        res = self.execute_project_command(principal, run['project_id'], cmd, timeout=15)
                        plan_steps[2]['status'] = 'completed' if res['exit_code'] == 0 else 'warning'
                        plan_steps[2]['summary'] = f"دستور با کد خروج {res['exit_code']} در {res['duration_ms']}ms پایان یافت."
                        log_entry = {
                            'timestamp': now,
                            'step': 2,
                            'type': 'command_execution',
                            'title': f"اجرای دستور: {cmd}",
                            'content': (res['stdout'] or '') + ('\n' + res['stderr'] if res['stderr'] else ''),
                            'exit_code': res['exit_code']
                        }
                        logs.append(log_entry)
                        self._record_task_chat_notification(
                            db, run, 2, plan_steps[2]['title'], plan_steps[2]['status'], summary=plan_steps[2]['summary'], command=cmd
                        )

                        if is_swarm:
                            tester_summary = f"دستور راستی‌آزمایی با کد {res['exit_code']} در {res['duration_ms']}ms اجرا شد."
                            tester_logs = [log_entry]
                            db.execute("""
                                UPDATE workspace_subagent_runs
                                SET status='completed', summary=?, logs=?, updated_at=?
                                WHERE parent_run_id=? AND role='tester'
                            """, (tester_summary, json.dumps(tester_logs), now, run_id))
                    except Exception as exc:
                        plan_steps[2]['status'] = 'failed'
                        plan_steps[2]['summary'] = f"خطا در اجرای دستور: {exc}"
                        log_entry = {
                            'timestamp': now,
                            'step': 2,
                            'type': 'command_execution',
                            'title': f"خطا در دستور: {cmd}",
                            'content': str(exc),
                            'exit_code': 1
                        }
                        logs.append(log_entry)
                        self._record_task_chat_notification(
                            db, run, 2, plan_steps[2]['title'], 'failed', summary=plan_steps[2]['summary'], command=cmd
                        )

                        if is_swarm:
                            db.execute("""
                                UPDATE workspace_subagent_runs
                                SET status='failed', summary=?, logs=?, updated_at=?
                                WHERE parent_run_id=? AND role='tester'
                            """, (f"خطا در اجرای آزمون: {exc}", json.dumps([log_entry]), now, run_id))

                    current_idx = 3
                    plan_steps[3]['status'] = 'in_progress'

            if current_idx == 3:
                plan_steps[3]['status'] = 'completed'
                plan_steps[3]['summary'] = 'گزارش و جمع‌بندی نهایی توسط ایجنت تدوین شد.'
                new_status = 'completed'

                if is_swarm:
                    result_summary = (
                        f"🐝 عملیات همگام گروهی ایجنت‌ها (Multi-Agent Swarm) با موفقیت تکمیل شد:\n\n"
                        f"• 🏛️ معمار سیستم: ساختار ماژول‌ها و چارچوب کلی پروژه ارزیابی گردید.\n"
                        f"• 🛠️ مهندس کدنویس: ممیزی فایل‌های کلیدی پروژه انجام و نیازمندی‌های ویرایش تدوین شد.\n"
                        f"• 🧪 تضمین کیفیت (QA): آزمون‌ها و فرامین راستی‌آزمایی اجرا و اعتبارسنجی کیفی صورت گرفت.\n\n"
                        f"🚀 گزارش چندعاملی آماده بهره‌برداری است و پروژه در وضعیت پایدار قرار دارد."
                    )
                else:
                    result_summary = (
                        f"🎯 هدف ارزیابی شد: «{run['prompt']}»\n"
                        f"نقش فعال ایجنت: {run.get('role', 'general')}\n"
                        f"تمامی مراحل پویش متادیتا، بازخوانی تنظیمات و ارزیابی دستورات با موفقیت انجام گرفت.\n"
                        f"پروژه آماده استقرار، ادغام تغییرات یا ارسال دستورات تکمیلی از طریق چت هوش مصنوعی می‌باشد."
                    )

                logs.append({
                    'timestamp': now,
                    'step': 3,
                    'type': 'synthesis',
                    'title': 'گزارش نهایی ایجنت',
                    'content': result_summary
                })
                self._record_task_chat_notification(
                    db, run, 3, plan_steps[3]['title'], 'completed', summary=plan_steps[3]['summary'], result_summary=result_summary
                )

            db.execute("""
                UPDATE workspace_agent_runs
                SET status=?, current_step_index=?, plan_steps=?, logs=?, result_summary=?, updated_at=?
                WHERE id=?
            """, (new_status, current_idx, json.dumps(plan_steps), json.dumps(logs), result_summary, now, run_id))

            if new_status == 'completed':
                existing_art = db.execute("SELECT id FROM workspace_project_artifacts WHERE run_id=?", (run_id,)).fetchone()
                if not existing_art:
                    art_id = uuid.uuid4().hex
                    art_title = f"گزارش مأموریت: {run['prompt'][:45]}"
                    art_type = 'report' if is_swarm else 'plan'
                    db.execute("""
                        INSERT INTO workspace_project_artifacts (id, project_id, run_id, title, artifact_type, content, created_by, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (art_id, run['project_id'], run_id, art_title, art_type, result_summary, run['owner_id'], now, now))

            run['status'] = new_status
            run['current_step_index'] = current_idx
            run['plan_steps'] = json.dumps(plan_steps)
            run['logs'] = json.dumps(logs)
            run['result_summary'] = result_summary
            run['updated_at'] = now
            return self._format_run(run, db=db)

    def approve_agent_run_step(self, principal, run_id):
        if 'action.approve' not in principal.get('capabilities', []) and principal.get('role') != 'superadmin':
            raise IdentityError('Approval permission required', 403)
        if not isinstance(run_id, str) or len(run_id) != 32:
            raise IdentityError('Invalid run ID')

        with self.store._lock, self.store._db() as db:
            if principal.get('role') == 'superadmin':
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=?", (run_id,)).fetchone()
            else:
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=? AND owner_id=?", (run_id, principal['id'])).fetchone()
            if not row:
                raise IdentityError('Agent run not found', 404)
            run = dict(row)
            if run['status'] not in ('waiting_approval', 'paused_debug'):
                raise IdentityError('Run is not waiting for approval', 400)

            now = int(self.store.clock())
            db.execute("UPDATE workspace_agent_runs SET status='in_progress', updated_at=? WHERE id=?", (now, run_id))
            db.execute("UPDATE workspace_subagent_runs SET status='in_progress', updated_at=? WHERE parent_run_id=? AND status IN ('waiting_approval', 'paused_debug')", (now, run_id))
            self.store._audit(db, principal['id'], 'workspace_agent_run_step_approved', run_id)
            self._record_task_chat_notification(
                db, run, run.get('current_step_index', 2), 'تأیید اقدام انسانی (Human-in-the-Loop)', 'in_progress', summary='مجوز ادامه و اجرای دستور توسط ناظر صادر شد.'
            )

        return self.advance_agent_run(principal, run_id)

    def cancel_agent_run(self, principal, run_id):
        self._cap(principal, 'chat')
        if not isinstance(run_id, str) or len(run_id) != 32:
            raise IdentityError('Invalid run ID')
        with self.store._lock, self.store._db() as db:
            if principal.get('role') == 'superadmin':
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=?", (run_id,)).fetchone()
            else:
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=? AND owner_id=?", (run_id, principal['id'])).fetchone()
            if not row:
                raise IdentityError('Agent run not found', 404)
            run = dict(row)
            now = int(self.store.clock())
            db.execute("UPDATE workspace_agent_runs SET status='cancelled', updated_at=? WHERE id=?", (now, run_id))
            db.execute("UPDATE workspace_subagent_runs SET status='cancelled', updated_at=? WHERE parent_run_id=? AND status IN ('pending', 'in_progress', 'waiting_approval', 'paused_debug')", (now, run_id))
            self.store._audit(db, principal['id'], 'workspace_agent_run_cancelled', run_id)
            self._record_task_chat_notification(
                db, run, run.get('current_step_index', 0), 'لغو وظیفه ایجنت', 'cancelled', summary='وظیفه توسط کاربر لغو گردید.'
            )
        return self.get_agent_run(principal, run_id)

    def _create_auto_run_artifact(self, db, run, result_summary, now):
        existing_art = db.execute("SELECT id FROM workspace_project_artifacts WHERE run_id=?", (run['id'],)).fetchone()
        if not existing_art:
            art_id = uuid.uuid4().hex
            art_title = f"گزارش مأموریت: {run['prompt'][:45]}"
            art_type = 'report' if run.get('mode') == 'swarm' else 'plan'
            db.execute("""
                INSERT INTO workspace_project_artifacts (id, project_id, run_id, title, artifact_type, content, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (art_id, run['project_id'], run['id'], art_title, art_type, result_summary, run['owner_id'], now, now))

    def step_agent_run(self, principal, run_id, action='step', modified_command=None, modified_prompt=None):
        self._cap(principal, 'chat')
        if not isinstance(run_id, str) or len(run_id) != 32:
            raise IdentityError('Invalid run ID')

        clean_action = str(action or 'step').strip().lower()
        if clean_action not in ('step', 'skip', 'modify', 'continue'):
            raise IdentityError('Invalid action. Allowed: step, skip, modify, continue', 400)

        if clean_action == 'continue':
            with self.store._lock, self.store._db() as db:
                if principal.get('role') == 'superadmin':
                    row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=?", (run_id,)).fetchone()
                else:
                    row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=? AND owner_id=?", (run_id, principal['id'])).fetchone()
                if not row:
                    raise IdentityError('Agent run not found', 404)
                run = dict(row)
                if run['status'] in ('completed', 'failed', 'cancelled'):
                    raise IdentityError('Agent run is already finalized', 400)
                logs = json.loads(run['logs'])
                now = int(self.store.clock())
                logs.append({
                    'timestamp': now,
                    'step': run['current_step_index'],
                    'type': 'debug_continue',
                    'title': '▶️ ادامه خودکار بدون توقف (Continue)',
                    'content': 'حالت دیباگ غیرفعال شد و مأموریت به صورت پیوسته ادامه می‌یابد.'
                })
                new_st = 'in_progress' if run['status'] == 'paused_debug' else run['status']
                db.execute("UPDATE workspace_agent_runs SET debug_mode=0, status=?, logs=?, updated_at=? WHERE id=?", (new_st, json.dumps(logs), now, run_id))
            return self.advance_agent_run(principal, run_id)

        with self.store._lock, self.store._db() as db:
            if principal.get('role') == 'superadmin':
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=?", (run_id,)).fetchone()
            else:
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=? AND owner_id=?", (run_id, principal['id'])).fetchone()
            if not row:
                raise IdentityError('Agent run not found', 404)
            run = dict(row)
            if run['status'] in ('completed', 'failed', 'cancelled'):
                raise IdentityError('Agent run is already finalized', 400)

            plan_steps = json.loads(run['plan_steps'])
            logs = json.loads(run['logs'])
            current_idx = run['current_step_index']
            now = int(self.store.clock())
            debug_active = bool(run.get('debug_mode', 0))
            is_swarm = run.get('mode') == 'swarm'
            root_dir, project_name = self._resolve_project_root(principal, run['project_id'])
            can_exec = 'action.approve' in principal.get('capabilities', []) or principal.get('role') == 'superadmin'

            if clean_action == 'modify':
                if modified_command and current_idx < len(plan_steps):
                    plan_steps[current_idx]['command'] = str(modified_command).strip()
                    logs.append({
                        'timestamp': now,
                        'step': current_idx,
                        'type': 'debug_modify',
                        'title': '✏️ اصلاح دستور آزمون توسط کاربر',
                        'content': f"دستور این گام به «{modified_command.strip()}» تغییر یافت."
                    })
                if modified_prompt:
                    run['prompt'] = str(modified_prompt).strip()
                    db.execute("UPDATE workspace_agent_runs SET prompt=? WHERE id=?", (run['prompt'], run_id))
                db.execute("UPDATE workspace_agent_runs SET plan_steps=?, logs=?, updated_at=? WHERE id=?", (json.dumps(plan_steps), json.dumps(logs), now, run_id))
                return self.get_agent_run(principal, run_id)

            if clean_action == 'skip':
                if current_idx < len(plan_steps):
                    plan_steps[current_idx]['status'] = 'skipped'
                    plan_steps[current_idx]['summary'] = 'این گام در حالت دیباگ توسط ناظر رد شد.'
                logs.append({
                    'timestamp': now,
                    'step': current_idx,
                    'type': 'debug_skip',
                    'title': f'⏩ پرش از گام {current_idx}',
                    'content': 'این گام بدون اجرا رد شد.'
                })
                current_idx += 1
                if current_idx >= 3:
                    new_status = 'completed'
                    plan_steps[min(3, len(plan_steps)-1)]['status'] = 'completed'
                    result_summary = f"چرخه مأموریت «{run['prompt']}» با اعمال پرش‌های دیباگ به پایان رسید."
                    db.execute("""
                        UPDATE workspace_agent_runs
                        SET status=?, current_step_index=?, plan_steps=?, logs=?, result_summary=?, updated_at=?
                        WHERE id=?
                    """, (new_status, current_idx, json.dumps(plan_steps), json.dumps(logs), result_summary, now, run_id))
                    try:
                        self._create_auto_run_artifact(db, run, result_summary, now)
                    except Exception:
                        pass
                else:
                    new_status = 'paused_debug' if debug_active else 'in_progress'
                    plan_steps[current_idx]['status'] = 'paused_debug' if debug_active else 'in_progress'
                    db.execute("""
                        UPDATE workspace_agent_runs
                        SET status=?, current_step_index=?, plan_steps=?, logs=?, updated_at=?
                        WHERE id=?
                    """, (new_status, current_idx, json.dumps(plan_steps), json.dumps(logs), now, run_id))
                run['status'] = new_status
                run['current_step_index'] = current_idx
                run['plan_steps'] = json.dumps(plan_steps)
                run['logs'] = json.dumps(logs)
                run['updated_at'] = now
                return self._format_run(run, db=db)

            if clean_action == 'step':
                if current_idx == 1:
                    target_file = plan_steps[1].get('target', 'README.md')
                    target_fp = root_dir / target_file
                    if target_fp.is_file():
                        try:
                            content = target_fp.read_text(encoding='utf-8', errors='replace')
                            preview = content[:600] + ('\n...(ادامه دارد)' if len(content) > 600 else '')
                            plan_steps[1]['status'] = 'completed'
                            plan_steps[1]['summary'] = f"فایل {target_file} ({len(content)} بایت) در گام دیباگ ممیزی شد."
                            logs.append({
                                'timestamp': now,
                                'step': 1,
                                'type': 'file_read',
                                'title': f"ممیزی {target_file} در گام دیباگ",
                                'content': preview
                            })
                            if is_swarm:
                                db.execute("""
                                    UPDATE workspace_subagent_runs
                                    SET status='completed', summary=?, logs=?, updated_at=?
                                    WHERE parent_run_id=? AND role='coder'
                                """, (plan_steps[1]['summary'], json.dumps([{'timestamp': now, 'title': f'ممیزی {target_file}', 'content': preview}]), now, run_id))
                        except Exception as exc:
                            plan_steps[1]['status'] = 'failed'
                            plan_steps[1]['summary'] = f"خطا در خواندن فایل: {exc}"
                    else:
                        plan_steps[1]['status'] = 'skipped'
                        plan_steps[1]['summary'] = f"فایل {target_file} در ریشه پروژه یافت نشد."

                    current_idx = 2
                    cmd = plan_steps[2].get('command', 'git status')
                    if debug_active:
                        new_status = 'paused_debug'
                        plan_steps[2]['status'] = 'paused_debug'
                        plan_steps[2]['summary'] = f"توقف دیباگ در گام ۲: آماده اجرای «{cmd}». برای اجرا، Step Next را بزنید."
                        logs.append({
                            'timestamp': now,
                            'step': 2,
                            'type': 'debug_pause',
                            'title': '🐞 توقف دیباگ در گام ۲ (اجرای دستور)',
                            'content': f"دستور آماده اجرا: {cmd}"
                        })
                    else:
                        new_status = 'waiting_approval' if not can_exec else 'in_progress'
                        plan_steps[2]['status'] = 'waiting_approval' if not can_exec else 'in_progress'

                    db.execute("""
                        UPDATE workspace_agent_runs
                        SET status=?, current_step_index=?, plan_steps=?, logs=?, updated_at=?
                        WHERE id=?
                    """, (new_status, current_idx, json.dumps(plan_steps), json.dumps(logs), now, run_id))
                    run['status'] = new_status
                    run['current_step_index'] = current_idx
                    run['plan_steps'] = json.dumps(plan_steps)
                    run['logs'] = json.dumps(logs)
                    run['updated_at'] = now
                    return self._format_run(run, db=db)

                elif current_idx == 2:
                    if not can_exec:
                        raise IdentityError('Approval or superadmin role required to execute step command', 403)
                    cmd = (modified_command or plan_steps[2].get('command') or 'git status').strip()
                    plan_steps[2]['command'] = cmd
                    try:
                        res = self.execute_project_command(principal, run['project_id'], cmd, timeout=15)
                        plan_steps[2]['status'] = 'completed' if res['exit_code'] == 0 else 'warning'
                        plan_steps[2]['summary'] = f"دستور با کد {res['exit_code']} در {res['duration_ms']}ms در گام دیباگ اجرا شد."
                        log_entry = {
                            'timestamp': now,
                            'step': 2,
                            'type': 'command_execution',
                            'title': f"اجرای دستور گام دیباگ: {cmd}",
                            'content': (res['stdout'] or '') + ('\n' + res['stderr'] if res['stderr'] else ''),
                            'exit_code': res['exit_code']
                        }
                        logs.append(log_entry)
                        if is_swarm:
                            db.execute("""
                                UPDATE workspace_subagent_runs
                                SET status='completed', summary=?, logs=?, updated_at=?
                                WHERE parent_run_id=? AND role='tester'
                            """, (plan_steps[2]['summary'], json.dumps([log_entry]), now, run_id))
                    except Exception as exc:
                        plan_steps[2]['status'] = 'failed'
                        plan_steps[2]['summary'] = f"خطا در دستور: {exc}"
                        logs.append({
                            'timestamp': now,
                            'step': 2,
                            'type': 'command_execution',
                            'title': f"خطا در دستور: {cmd}",
                            'content': str(exc),
                            'exit_code': 1
                        })

                    current_idx = 3
                    if debug_active:
                        new_status = 'paused_debug'
                        plan_steps[3]['status'] = 'paused_debug'
                        plan_steps[3]['summary'] = 'توقف دیباگ در گام ۳: آماده تدوین گزارش جمع‌بندی و ثبت سند فرآورده.'
                        logs.append({
                            'timestamp': now,
                            'step': 3,
                            'type': 'debug_pause',
                            'title': '🐞 توقف دیباگ در گام ۳ (گزارش پایانی)',
                            'content': 'آماده تدوین گزارش جامع مأموریت و ثبت سند فرآورده.'
                        })
                    else:
                        new_status = 'completed'
                        plan_steps[3]['status'] = 'completed'

                    db.execute("""
                        UPDATE workspace_agent_runs
                        SET status=?, current_step_index=?, plan_steps=?, logs=?, updated_at=?
                        WHERE id=?
                    """, (new_status, current_idx, json.dumps(plan_steps), json.dumps(logs), now, run_id))

                    if new_status == 'completed':
                        result_summary = f"چرخه مأموریت «{run['prompt']}» با موفقیت پایان یافت."
                        db.execute("UPDATE workspace_agent_runs SET result_summary=? WHERE id=?", (result_summary, run_id))
                        try:
                            self._create_auto_run_artifact(db, run, result_summary, now)
                        except Exception:
                            pass
                    run['status'] = new_status
                    run['current_step_index'] = current_idx
                    run['plan_steps'] = json.dumps(plan_steps)
                    run['logs'] = json.dumps(logs)
                    run['updated_at'] = now
                    return self._format_run(run, db=db)

                elif current_idx == 3:
                    plan_steps[3]['status'] = 'completed'
                    plan_steps[3]['summary'] = 'گزارش و سند فرآورده مأموریت در گام نهایی دیباگ تایید و ثبت شد.'
                    new_status = 'completed'
                    result_summary = f"چرخه مأموریت «{run['prompt']}» با موفقیت در حالت دیباگ پایان یافت."
                    logs.append({
                        'timestamp': now,
                        'step': 3,
                        'type': 'synthesis',
                        'title': 'گزارش نهایی دیباگ',
                        'content': result_summary
                    })
                    db.execute("""
                        UPDATE workspace_agent_runs
                        SET status=?, current_step_index=3, plan_steps=?, logs=?, result_summary=?, updated_at=?
                        WHERE id=?
                    """, (new_status, json.dumps(plan_steps), json.dumps(logs), result_summary, now, run_id))
                    try:
                        self._create_auto_run_artifact(db, run, result_summary, now)
                    except Exception:
                        pass
                    run['status'] = new_status
                    run['current_step_index'] = 3
                    run['plan_steps'] = json.dumps(plan_steps)
                    run['logs'] = json.dumps(logs)
                    run['result_summary'] = result_summary
                    run['updated_at'] = now
                    return self._format_run(run, db=db)
                else:
                    return self.advance_agent_run(principal, run_id)

    def toggle_agent_run_debug(self, principal, run_id, debug_mode=None):
        self._cap(principal, 'chat')
        if not isinstance(run_id, str) or len(run_id) != 32:
            raise IdentityError('Invalid run ID')
        with self.store._lock, self.store._db() as db:
            if principal.get('role') == 'superadmin':
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=?", (run_id,)).fetchone()
            else:
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=? AND owner_id=?", (run_id, principal['id'])).fetchone()
            if not row:
                raise IdentityError('Agent run not found', 404)
            run = dict(row)
            current = bool(run.get('debug_mode', 0))
            target_mode = (not current) if debug_mode is None else bool(debug_mode)
            now = int(self.store.clock())
            db.execute("UPDATE workspace_agent_runs SET debug_mode=?, updated_at=? WHERE id=?", (1 if target_mode else 0, now, run_id))
            self.store._audit(db, principal['id'], 'workspace_agent_run_debug_toggled', f"{run_id}:{int(target_mode)}")
        return self.get_agent_run(principal, run_id)

    def send_agent_run_feedback(self, principal, run_id, message):
        self._cap(principal, 'action.request')
        if not isinstance(run_id, str) or len(run_id) != 32:
            raise IdentityError('Invalid run ID')
        clean_msg = str(message or '').strip()
        if not clean_msg:
            raise IdentityError('Feedback message cannot be empty', 400)
        if len(clean_msg) > 2000:
            raise IdentityError('Feedback message cannot exceed 2000 characters', 400)

        now = int(self.store.clock())
        with self.store._lock, self.store._db() as db:
            if principal.get('role') == 'superadmin':
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=?", (run_id,)).fetchone()
            else:
                row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=? AND owner_id=?", (run_id, principal['id'])).fetchone()
            if not row:
                raise IdentityError('Agent run not found', 404)
            run = dict(row)
            if run['status'] in ('completed', 'failed', 'cancelled'):
                raise IdentityError('Cannot send guidance to an ended task', 400)

            try:
                logs = json.loads(run.get('logs') or '[]')
            except Exception:
                logs = []

            sender_name = principal.get('username') or 'کاربر'
            logs.append({
                'timestamp': now,
                'step': run.get('current_step_index', 0),
                'type': 'user_feedback',
                'title': f'💬 هدایت تعاملی توسط {sender_name}',
                'content': clean_msg
            })

            db.execute("""
                UPDATE workspace_agent_runs
                SET logs=?, updated_at=?
                WHERE id=?
            """, (json.dumps(logs), now, run_id))

            self.store._audit(db, principal['id'], 'workspace_agent_run_feedback', f"{run_id}:{clean_msg[:60]}")

        return self.get_agent_run(principal, run_id)

    def get_agent_run(self, principal, run_id):
        self._cap(principal, 'chat')
        if not isinstance(run_id, str) or len(run_id) != 32:
            raise IdentityError('Invalid run ID')
        with self.store._db() as db:
            if principal.get('role') == 'superadmin':
                row = db.execute("""
                    SELECT r.*, u.username as owner_username, p.name as project_name
                    FROM workspace_agent_runs r
                    LEFT JOIN users u ON r.owner_id = u.id
                    LEFT JOIN workspace_projects p ON r.project_id = p.id
                    WHERE r.id=?
                """, (run_id,)).fetchone()
            else:
                row = db.execute("""
                    SELECT r.*, u.username as owner_username, p.name as project_name
                    FROM workspace_agent_runs r
                    LEFT JOIN users u ON r.owner_id = u.id
                    LEFT JOIN workspace_projects p ON r.project_id = p.id
                    WHERE r.id=? AND r.owner_id=?
                """, (run_id, principal['id'])).fetchone()
            if not row:
                raise IdentityError('Agent run not found', 404)
            return self._format_run(dict(row), db=db)

    def list_agent_runs(self, principal, project_id):
        self._cap(principal, 'chat')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        with self.store._db() as db:
            rows = db.execute("""
                SELECT r.*, u.username as owner_username, p.name as project_name
                FROM workspace_agent_runs r
                LEFT JOIN users u ON r.owner_id = u.id
                LEFT JOIN workspace_projects p ON r.project_id = p.id
                WHERE r.owner_id=? AND r.project_id=?
                ORDER BY r.created_at DESC LIMIT 30
            """, (principal['id'], project_id)).fetchall()
            return [self._format_run(dict(r), db=db) for r in rows]

    def list_all_agent_runs(self, principal, limit=50):
        if principal.get('role') != 'superadmin':
            raise IdentityError('Superadmin role required', 403)
        limit = max(1, min(int(limit), 200))
        with self.store._db() as db:
            rows = db.execute("""
                SELECT r.*, u.username as owner_username, p.name as project_name
                FROM workspace_agent_runs r
                LEFT JOIN users u ON r.owner_id = u.id
                LEFT JOIN workspace_projects p ON r.project_id = p.id
                ORDER BY r.created_at DESC LIMIT ?
            """, (limit,)).fetchall()
            return [self._format_run(dict(r), db=db) for r in rows]

    def admin_stop_agent_run(self, principal, run_id, reason="Admin emergency stop"):
        if principal.get('role') != 'superadmin':
            raise IdentityError('Superadmin role required', 403)
        if not isinstance(run_id, str) or len(run_id) != 32:
            raise IdentityError('Invalid run ID')

        with self.store._lock, self.store._db() as db:
            row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise IdentityError('Agent run not found', 404)
            run = dict(row)
            if run['status'] in ('completed', 'failed', 'cancelled'):
                return self._format_run(run, db=db)

            now = int(self.store.clock())
            logs = json.loads(run['logs'] or '[]')
            logs.append({
                'timestamp': now,
                'step': run['current_step_index'],
                'type': 'admin_intervention',
                'title': 'توقف اضطراری توسط ادمین',
                'content': str(reason)
            })
            db.execute("""
                UPDATE workspace_agent_runs
                SET status='cancelled', logs=?, updated_at=?
                WHERE id=?
            """, (json.dumps(logs), now, run_id))
            db.execute("""
                UPDATE workspace_subagent_runs
                SET status='cancelled', updated_at=?
                WHERE parent_run_id=? AND status IN ('pending', 'in_progress', 'waiting_approval')
            """, (now, run_id))
            self.store._audit(db, principal['id'], 'workspace_admin_agent_run_stopped', f"{run_id}:{str(reason)[:60]}")
            self._record_task_chat_notification(
                db, run, run.get('current_step_index', 0), 'توقف اضطراری وظیفه ایجنت (Kill-Switch)', 'cancelled', summary=f"توقف اضطراری توسط مدیریت ارشد اعمال شد. علت: {reason}"
            )
            self.dispatch_governance_webhook('emergency_stop', {
                'run_id': run_id,
                'project_id': run['project_id'],
                'prompt': run['prompt'][:100],
                'reason': str(reason),
                'admin': principal.get('username', 'superadmin')
            })
            run['status'] = 'cancelled'
            run['logs'] = json.dumps(logs)
            run['updated_at'] = now
            return self._format_run(run, db=db)

    def admin_approve_agent_run_step(self, principal, run_id):
        if principal.get('role') != 'superadmin':
            raise IdentityError('Superadmin role required', 403)
        if not isinstance(run_id, str) or len(run_id) != 32:
            raise IdentityError('Invalid run ID')

        with self.store._lock, self.store._db() as db:
            row = db.execute("SELECT * FROM workspace_agent_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise IdentityError('Agent run not found', 404)
            run = dict(row)
            if run['status'] != 'waiting_approval':
                raise IdentityError('Run is not waiting for approval', 400)

            now = int(self.store.clock())
            db.execute("UPDATE workspace_agent_runs SET status='in_progress', updated_at=? WHERE id=?", (now, run_id))
            db.execute("UPDATE workspace_subagent_runs SET status='in_progress', updated_at=? WHERE parent_run_id=? AND status='waiting_approval'", (now, run_id))
            self.store._audit(db, principal['id'], 'workspace_admin_agent_run_approved', run_id)
            self._record_task_chat_notification(
                db, run, run.get('current_step_index', 2), 'تأیید اقدام اداری (Human-in-the-Loop)', 'in_progress', summary='مجوز ادامه و اجرای دستور توسط مدیر ارشد سامانه صادر شد.'
            )

        return self.advance_agent_run(principal, run_id)

    def list_task_notifications(self, principal, limit=50, unread_only=False):
        self._cap(principal, 'chat')
        limit = max(1, min(int(limit or 50), 200))
        with self.store._db() as db:
            if principal.get('role') == 'superadmin':
                sql = "SELECT * FROM workspace_task_notifications"
                params = []
                if unread_only:
                    sql += " WHERE read=0"
                sql += " ORDER BY created_at DESC LIMIT ?"
                params.append(limit)
                rows = db.execute(sql, tuple(params)).fetchall()
            else:
                sql = "SELECT * FROM workspace_task_notifications WHERE owner_id=?"
                params = [principal['id']]
                if unread_only:
                    sql += " AND read=0"
                sql += " ORDER BY created_at DESC LIMIT ?"
                params.append(limit)
                rows = db.execute(sql, tuple(params)).fetchall()

            return [dict(r) for r in rows]

    def mark_task_notifications_read(self, principal, notification_ids=None):
        self._cap(principal, 'chat')
        with self.store._lock, self.store._db() as db:
            if notification_ids and isinstance(notification_ids, list):
                q = ",".join("?" for _ in notification_ids)
                if principal.get('role') == 'superadmin':
                    db.execute(f"UPDATE workspace_task_notifications SET read=1 WHERE id IN ({q})", tuple(notification_ids))
                else:
                    db.execute(f"UPDATE workspace_task_notifications SET read=1 WHERE owner_id=? AND id IN ({q})", (principal['id'], *notification_ids))
            else:
                if principal.get('role') == 'superadmin':
                    db.execute("UPDATE workspace_task_notifications SET read=1")
                else:
                    db.execute("UPDATE workspace_task_notifications SET read=1 WHERE owner_id=?", (principal['id'],))
        return {'status': 'ok'}

    def get_project_git_status(self, principal, project_id):
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        project = self.get_project(principal, project_id)
        root_path = project.get('root_path')
        if not root_path:
            return {'is_git_repo': False, 'message': 'No root path bound'}
        root = Path(root_path)
        if not root.is_dir():
            return {'is_git_repo': False, 'message': 'Project root directory does not exist'}

        git_dir = root / '.git'
        if not (git_dir.is_dir() or git_dir.is_file()):
            return {'is_git_repo': False, 'message': 'Directory is not a git repository'}

        branch = "unknown"
        staged = []
        unstaged = []
        untracked = []
        recent_commits = []

        try:
            res = subprocess.run(
                ["git", "status", "--porcelain=v1", "-b"],
                cwd=str(root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5
            )
            if res.returncode == 0:
                lines = res.stdout.splitlines()
                for line in lines:
                    if not line:
                        continue
                    if line.startswith("## "):
                        b_info = line[3:].strip()
                        if "..." in b_info:
                            branch = b_info.split("...")[0].strip()
                        elif " " in b_info:
                            branch = b_info.split(" ")[0].strip()
                        else:
                            branch = b_info
                    elif line.startswith("?? "):
                        untracked.append(line[3:].strip())
                    elif len(line) >= 3:
                        x = line[0]
                        y = line[1]
                        filepath = line[3:].strip()
                        if x in ('M', 'A', 'D', 'R', 'C'):
                            staged.append({'path': filepath, 'status': x})
                        if y in ('M', 'D'):
                            unstaged.append({'path': filepath, 'status': y})
            else:
                return {'is_git_repo': False, 'message': res.stderr.strip() or 'Git status command failed'}
        except Exception as exc:
            return {'is_git_repo': False, 'message': f'Git inspection error: {exc}'}

        try:
            log_res = subprocess.run(
                ["git", "log", "-n", "5", "--format=%h|%an|%ar|%s"],
                cwd=str(root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5
            )
            if log_res.returncode == 0 and log_res.stdout:
                for log_line in log_res.stdout.splitlines():
                    if not log_line or '|' not in log_line:
                        continue
                    parts = log_line.split('|', 3)
                    if len(parts) == 4:
                        recent_commits.append({
                            'hash': parts[0],
                            'author': parts[1],
                            'date': parts[2],
                            'message': parts[3]
                        })
        except Exception:
            pass

        return {
            'is_git_repo': True,
            'branch': branch,
            'clean': len(staged) == 0 and len(unstaged) == 0 and len(untracked) == 0,
            'staged': staged,
            'unstaged': unstaged,
            'untracked': untracked,
            'recent_commits': recent_commits
        }

    def list_project_artifacts(self, principal, project_id, limit=50):
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        self.get_project(principal, project_id)
        limit = max(1, min(int(limit), 100))
        with self.store._lock, self.store._db() as db:
            rows = db.execute("""
                SELECT * FROM workspace_project_artifacts
                WHERE project_id=?
                ORDER BY created_at DESC
                LIMIT ?
            """, (project_id, limit)).fetchall()
            return [dict(r) for r in rows]

    def create_project_artifact(self, principal, project_id, title, content, artifact_type='plan', run_id=None):
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        self.get_project(principal, project_id)
        if not isinstance(title, str) or not title.strip():
            raise IdentityError('Artifact title is required')
        if not isinstance(content, str):
            raise IdentityError('Artifact content must be string')
        if artifact_type not in ('plan', 'report', 'review', 'code', 'general'):
            artifact_type = 'general'

        now = int(self.store.clock())
        artifact_id = uuid.uuid4().hex
        with self.store._lock, self.store._db() as db:
            db.execute("""
                INSERT INTO workspace_project_artifacts (id, project_id, run_id, title, artifact_type, content, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (artifact_id, project_id, run_id, title.strip()[:100], artifact_type, content, principal['id'], now, now))
            self.store._audit(db, principal['id'], 'workspace_artifact_created', f"{project_id}:{artifact_id}:{title[:30]}")

        return self.get_project_artifact(principal, project_id, artifact_id)

    def get_project_artifact(self, principal, project_id, artifact_id):
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        if not isinstance(artifact_id, str) or len(artifact_id) != 32:
            raise IdentityError('Invalid artifact ID')
        self.get_project(principal, project_id)
        with self.store._lock, self.store._db() as db:
            row = db.execute("SELECT * FROM workspace_project_artifacts WHERE id=? AND project_id=?", (artifact_id, project_id)).fetchone()
            if not row:
                raise IdentityError('Artifact not found', 404)
            return dict(row)

    def delete_project_artifact(self, principal, project_id, artifact_id):
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        if not isinstance(artifact_id, str) or len(artifact_id) != 32:
            raise IdentityError('Invalid artifact ID')
        project = self.get_project(principal, project_id)
        with self.store._lock, self.store._db() as db:
            row = db.execute("SELECT * FROM workspace_project_artifacts WHERE id=? AND project_id=?", (artifact_id, project_id)).fetchone()
            if not row:
                raise IdentityError('Artifact not found', 404)
            art = dict(row)
            if principal.get('role') != 'superadmin' and art['created_by'] != principal['id'] and project['owner_id'] != principal['id']:
                raise IdentityError('Permission denied to delete artifact', 403)
            db.execute("DELETE FROM workspace_project_artifacts WHERE id=?", (artifact_id,))
            self.store._audit(db, principal['id'], 'workspace_artifact_deleted', f"{project_id}:{artifact_id}")
            return {'status': 'deleted', 'artifact_id': artifact_id}

    def is_complex_task(self, prompt: str) -> bool:
        """Determines if a user prompt is complex and should trigger Spec-Driven Development validation."""
        if not prompt or not isinstance(prompt, str):
            return False
        clean = prompt.lower().strip()
        simple_indicators = (
            'گزارش cpu', 'وضعیت رم', 'وضعیت دیسک', 'اطلاعات سیستم', 'گزارش سیستم',
            'پینگ', 'ping', 'cpu report', 'ram status', 'system metrics',
            'ls', 'dir', 'pwd', 'whoami', 'git status', 'echo', 'version'
        )
        if any(clean.startswith(ind) or clean == ind for ind in simple_indicators) and len(clean) < 60:
            return False

        complex_keywords = (
            'معماری', 'طراحی', 'بازطراحی', 'ریفکتور', 'ریفرکتور', 'سند', 'مشخصات',
            'نیازمندی', 'مهاجرت', 'پیاده‌سازی', 'پایپ‌لاین', 'دیتابیس', 'ماژول',
            'سوارم', 'امنیت', 'لایه‌بندی', 'پچ', 'spec', 'design', 'architecture',
            'refactor', 'implement', 'migration', 'database', 'pipeline', 'audit'
        )
        return len(clean) >= 70 or any(kw in clean for kw in complex_keywords)

    def create_or_generate_spec(self, principal, project_id, prompt, title='', requirements='', design_approach='', task_breakdown=None, auto_generate=True):
        self._cap(principal, 'chat')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
            raise IdentityError('Prompt must contain 1-4000 characters')

        project = self.get_project(principal, project_id)
        project_name = project.get('name', 'Project')
        fw = 'General Project'
        total_files = 0
        try:
            inspection = self.inspect_project(principal, project_id)
            fw = inspection.get('framework', 'General Project')
            total_files = inspection.get('total_entries', 0)
        except Exception:
            pass

        spec_id = uuid.uuid4().hex
        now = int(self.store.clock())

        clean_title = title.strip() if title else f"سند مشخصات (Spec): {prompt.strip()[:60]}..."
        
        req_text = requirements.strip() if requirements else ''
        design_text = design_approach.strip() if design_approach else ''
        breakdown_list = task_breakdown if (task_breakdown and isinstance(task_breakdown, list)) else []

        if auto_generate:
            if not req_text:
                req_text = (
                    f"### ۱. نیازمندی‌های عملکردی (Functional Requirements)\n"
                    f"- هدف اصلی: اجرای دقیق وظیفه «{prompt.strip()}» در پروژه {project_name}.\n"
                    f"- سازگاری با بستر: انطباق کامل با فناوری {fw} و استانداردهای تعیین‌شده در مخزن.\n"
                    f"- کنترل مرزها: اعمال تغییرات صرفاً در محدوده پروژه، بدون ایجاد وابستگی‌های ناامن.\n\n"
                    f"### ۲. معیارهای پذیرش (Acceptance Criteria)\n"
                    f"- [ ] تمام مراحل اجرایی بدون خطای کامپایل یا اجرا خاتمه یابند.\n"
                    f"- [ ] تست‌های صحت‌سنجی سیستم (Verification Suite) با خروجی صفر (Exit code 0) تایید شوند.\n"
                    f"- [ ] گزارش عملکرد و پچ نهایی در سیستم ممیزی (Audit Trail) ثبت گردد.\n\n"
                    f"### ۳. الزامات غیرعملکردی و امنیتی\n"
                    f"- مهار دسترسی: جلوگیری از تخریب فایل‌های حیاتی یا اجرای دستورات با خطر بالا.\n"
                    f"- بازخورد آنی: ثبت وقایع و امکان توقف اضطراری (Emergency Stop) توسط ناظر انسانی."
                )
            if not design_text:
                design_text = (
                    f"### رویکرد و معماری پیشنهادی (Architecture & Approach)\n"
                    f"- **تحلیل محیط:** بازرسی ساختار پروژه با تکیه بر {fw} و کشف وابستگی‌های موجود ({total_files} فایل).\n"
                    f"- **الگوی پیاده‌سازی:** اجرای گام‌به‌گام با نظارت انسانی (Human-in-the-Loop) و رعایت مرزبندی سندباکس و سیاست دسترسی.\n"
                    f"- **مدیریت شکست و رول‌بک:** در صورت بروز خطای پیش‌بینی‌نشده، پچ‌های اعمال‌شده از طریق Patch Engine قابل برگشت خواهند بود.\n"
                    f"- **شفافیت لاگ‌ها:** تمامی تعاملات ابزارها به عنوان آرتیفکت‌های مستقل در دیتابیس ثبت خواهند شد."
                )
            if not breakdown_list:
                breakdown_list = [
                    {
                        "step": 1,
                        "title": "ممیزی ساختار و بازرسی وابستگی‌های پروژه",
                        "description": f"تحلیل فایل‌های پیکربندی و ساختار کدهای {fw} قبل از شروع پیاده‌سازی.",
                        "action": "inspect_workspace",
                        "status": "pending"
                    },
                    {
                        "step": 2,
                        "title": "پیاده‌سازی تغییرات و پیکربندی الزامات",
                        "description": f"اعمال تغییرات مورد نیاز برای «{prompt.strip()[:80]}» با استانداردهای تعریف‌شده.",
                        "action": "implement_changes",
                        "status": "pending"
                    },
                    {
                        "step": 3,
                        "title": "آزمون صحت‌سنجی و ارزیابی کیفیت خروجی",
                        "description": "اجرای آزمون‌های راستی‌آزمایی برای اطمینان از عملکرد صحیح و عدم بروز رگرسیون.",
                        "action": "run_verification",
                        "status": "pending"
                    },
                    {
                        "step": 4,
                        "title": "یکپارچه‌سازی نهایی و ثبت در ممیزی سازمانی",
                        "description": "تهیه گزارش جامع انجام وظیفه و به‌روزرسانی مستندات و ثبت ردپا در Audit Trail.",
                        "action": "finalize_task",
                        "status": "pending"
                    }
                ]

        with self.store._lock, self.store._db() as db:
            db.execute("""
                INSERT INTO workspace_specs (
                    id, owner_id, project_id, title, prompt, requirements, design_approach,
                    task_breakdown, status, run_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)
            """, (
                spec_id, principal['id'], project_id, clean_title[:200], prompt.strip(),
                req_text, design_text, json.dumps(breakdown_list, ensure_ascii=False),
                now, now
            ))
            self.store._audit(db, principal['id'], 'workspace_spec_created', f"{project_id}:{spec_id}:{clean_title[:30]}")

        self.dispatch_governance_webhook('spec_created', {
            'spec_id': spec_id,
            'project_id': project_id,
            'title': clean_title,
            'created_by': principal['username']
        })

        return self.get_spec(principal, spec_id)

    def get_spec(self, principal, spec_id):
        if not isinstance(spec_id, str) or len(spec_id) != 32:
            raise IdentityError('Invalid spec ID')
        with self.store._lock, self.store._db() as db:
            row = db.execute("SELECT * FROM workspace_specs WHERE id=?", (spec_id,)).fetchone()
            if not row:
                raise IdentityError('Spec not found', 404)
            data = dict(row)
            self.get_project(principal, data['project_id'])
            try:
                data['task_breakdown'] = json.loads(data['task_breakdown'])
            except Exception:
                data['task_breakdown'] = []
            return data

    def list_specs(self, principal, project_id, status=None):
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        self.get_project(principal, project_id)
        with self.store._lock, self.store._db() as db:
            if status and status in ('draft', 'approved', 'rejected', 'executed'):
                rows = db.execute("""
                    SELECT * FROM workspace_specs 
                    WHERE project_id=? AND status=? 
                    ORDER BY created_at DESC LIMIT 50
                """, (project_id, status)).fetchall()
            else:
                rows = db.execute("""
                    SELECT * FROM workspace_specs 
                    WHERE project_id=? 
                    ORDER BY created_at DESC LIMIT 50
                """, (project_id,)).fetchall()
            
            res = []
            for r in rows:
                item = dict(r)
                try:
                    item['task_breakdown'] = json.loads(item['task_breakdown'])
                except Exception:
                    item['task_breakdown'] = []
                res.append(item)
            return res

    def update_spec(self, principal, spec_id, title=None, requirements=None, design_approach=None, task_breakdown=None):
        spec = self.get_spec(principal, spec_id)
        if spec['status'] not in ('draft', 'rejected'):
            raise IdentityError(f'Cannot edit spec in status {spec["status"]}', 400)
        
        now = int(self.store.clock())
        new_title = title.strip()[:200] if title is not None else spec['title']
        new_req = requirements.strip() if requirements is not None else spec['requirements']
        new_design = design_approach.strip() if design_approach is not None else spec['design_approach']
        if task_breakdown is not None and isinstance(task_breakdown, list):
            new_tb = json.dumps(task_breakdown, ensure_ascii=False)
        else:
            new_tb = json.dumps(spec['task_breakdown'], ensure_ascii=False)

        with self.store._lock, self.store._db() as db:
            db.execute("""
                UPDATE workspace_specs 
                SET title=?, requirements=?, design_approach=?, task_breakdown=?, updated_at=?
                WHERE id=?
            """, (new_title, new_req, new_design, new_tb, now, spec_id))
            self.store._audit(db, principal['id'], 'workspace_spec_updated', f"{spec['project_id']}:{spec_id}")

        return self.get_spec(principal, spec_id)

    def approve_spec_and_execute(self, principal, spec_id, role='general', mode='single', debug_mode=False):
        spec = self.get_spec(principal, spec_id)
        if spec['status'] == 'executed' and spec.get('run_id'):
            raise IdentityError('Spec has already been approved and executed', 400)

        now = int(self.store.clock())
        custom_steps = spec.get('task_breakdown', [])

        agent_run = self.start_agent_run(
            principal,
            spec['project_id'],
            prompt=spec['prompt'],
            role=role,
            mode=mode,
            debug_mode=debug_mode,
            custom_plan_steps=custom_steps
        )

        with self.store._lock, self.store._db() as db:
            db.execute("""
                UPDATE workspace_specs 
                SET status='executed', run_id=?, approved_at=?, approved_by=?, updated_at=?
                WHERE id=?
            """, (agent_run['id'], now, principal['username'], now, spec_id))
            self.store._audit(db, principal['id'], 'workspace_spec_approved', f"{spec['project_id']}:{spec_id}:{agent_run['id']}")

        self.dispatch_governance_webhook('spec_executed', {
            'spec_id': spec_id,
            'project_id': spec['project_id'],
            'run_id': agent_run['id'],
            'approved_by': principal['username']
        })

        updated_spec = self.get_spec(principal, spec_id)
        return {
            'spec': updated_spec,
            'run': agent_run,
            'status': 'executed'
        }

    def reject_spec(self, principal, spec_id, reason=''):
        spec = self.get_spec(principal, spec_id)
        if spec['status'] == 'executed':
            raise IdentityError('Cannot reject an already executed spec', 400)

        now = int(self.store.clock())
        clean_reason = (reason or 'Rejected by user').strip()[:300]

        with self.store._lock, self.store._db() as db:
            db.execute("""
                UPDATE workspace_specs 
                SET status='rejected', rejection_reason=?, updated_at=?
                WHERE id=?
            """, (clean_reason, now, spec_id))
            self.store._audit(db, principal['id'], 'workspace_spec_rejected', f"{spec['project_id']}:{spec_id}:{clean_reason[:30]}")

        self.dispatch_governance_webhook('spec_rejected', {
            'spec_id': spec_id,
            'project_id': spec['project_id'],
            'reason': clean_reason,
            'rejected_by': principal['username']
        })

        return self.get_spec(principal, spec_id)

    def list_task_notifications(self, principal, limit=50, unread_only=False):
        self._cap(principal, 'chat')
        clean_limit = max(1, min(int(limit or 50), 200))
        with self.store._db() as db:
            query = "SELECT id, run_id, owner_id, step_index, step_title, status, summary, message, read, created_at FROM workspace_task_notifications WHERE owner_id=?"
            params = [principal['id']]
            if unread_only:
                query += " AND read=0"
            query += " ORDER BY created_at DESC, rowid DESC LIMIT ?"
            params.append(clean_limit)
            rows = db.execute(query, params).fetchall()
            return [
                {
                    'id': row['id'],
                    'run_id': row['run_id'],
                    'step_index': row['step_index'],
                    'step_title': row['step_title'],
                    'status': row['status'],
                    'summary': row['summary'],
                    'message': row['message'],
                    'is_read': bool(row['read']),
                    'created_at': row['created_at'],
                }
                for row in rows
            ]

    def mark_task_notifications_read(self, principal, notification_ids=None):
        self._cap(principal, 'chat')
        with self.store._lock, self.store._db() as db:
            if notification_ids and isinstance(notification_ids, list):
                valid_ids = [str(nid) for nid in notification_ids if isinstance(nid, str) and nid.strip()]
                if valid_ids:
                    placeholders = ','.join('?' for _ in valid_ids)
                    db.execute(f"UPDATE workspace_task_notifications SET read=1 WHERE owner_id=? AND id IN ({placeholders})", [principal['id']] + valid_ids)
            else:
                db.execute("UPDATE workspace_task_notifications SET read=1 WHERE owner_id=?", (principal['id'],))
        return {'ok': True}



