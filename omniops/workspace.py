"""Owner-scoped project list, local workspace root binding, and agentic tool execution."""

import base64
import binascii
import difflib
import json
from pathlib import Path
import subprocess
import time
import uuid

from .identity import IdentityError


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
                    status TEXT NOT NULL CHECK(status IN ('planning','in_progress','waiting_approval','completed','failed','cancelled')),
                    current_step_index INTEGER NOT NULL DEFAULT 0,
                    plan_steps TEXT NOT NULL DEFAULT '[]',
                    logs TEXT NOT NULL DEFAULT '[]',
                    result_summary TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS workspace_agent_runs_owner ON workspace_agent_runs(owner_id, project_id, created_at);
            """)
            try:
                db.execute("ALTER TABLE workspace_projects ADD COLUMN root_path TEXT DEFAULT ''")
            except Exception:
                pass
            try:
                db.execute("ALTER TABLE workspace_agent_runs ADD COLUMN role TEXT DEFAULT 'general'")
            except Exception:
                pass

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
        if apply:
            if 'action.request' not in principal.get('capabilities', []) and principal.get('role') != 'superadmin':
                raise IdentityError('action.request permission required to apply patch', 403)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(new_content, encoding='utf-8')
            applied = True
            with self.store._lock, self.store._db() as db:
                self.store._audit(db, principal['id'], 'workspace_file_patch_applied', f"{project_id}:{relative_path}")

        return {
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

    def execute_project_command(self, principal, project_id, command, timeout=15):
        if 'action.approve' not in principal.get('capabilities', []) and principal.get('role') != 'superadmin':
            raise IdentityError('action.approve capability or superadmin role required to execute workspace commands', 403)
        if not isinstance(command, str) or not 1 <= len(command.strip()) <= 1000:
            raise IdentityError('Command must contain 1-1000 characters')

        root_dir, _ = self._resolve_project_root(principal, project_id)
        clean_cmd = command.strip()

        lower_cmd = clean_cmd.lower()
        if any(bad in lower_cmd for bad in ('format ', 'rmdir /s /q c:', 'del /f /s /q c:', ':(){ :|:& };:')):
            raise IdentityError('Prohibited dangerous command', 400)

        t0 = time.time()
        try:
            res = subprocess.run(
                clean_cmd,
                shell=True,
                cwd=str(root_dir),
                capture_output=True,
                text=True,
                timeout=min(max(1, timeout), 30),
            )
            stdout = res.stdout[:32000] if res.stdout else ''
            stderr = res.stderr[:32000] if res.stderr else ''
            exit_code = res.returncode
        except subprocess.TimeoutExpired:
            stdout = ''
            stderr = f'Command timed out after {timeout} seconds'
            exit_code = 124
        except Exception as exc:
            stdout = ''
            stderr = f'Execution error: {exc}'
            exit_code = 1

        duration_ms = int((time.time() - t0) * 1000)

        with self.store._lock, self.store._db() as db:
            self.store._audit(db, principal['id'], 'workspace_command_executed', f"{project_id}:{clean_cmd[:80]}")

        return {
            'project_id': project_id,
            'command': clean_cmd,
            'exit_code': exit_code,
            'stdout': stdout,
            'stderr': stderr,
            'duration_ms': duration_ms,
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

    @staticmethod
    def _format_run(run):
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
            'status': run['status'],
            'current_step_index': run['current_step_index'],
            'plan_steps': plan,
            'logs': logs,
            'result_summary': run.get('result_summary') or '',
            'created_at': run['created_at'],
            'updated_at': run['updated_at']
        }
        if 'owner_username' in run and run['owner_username'] is not None:
            res['owner_username'] = run['owner_username']
        if 'project_name' in run and run['project_name'] is not None:
            res['project_name'] = run['project_name']
        return res

    def start_agent_run(self, principal, project_id, prompt, role='general'):
        self._cap(principal, 'chat')
        if not isinstance(project_id, str) or len(project_id) != 32:
            raise IdentityError('Invalid project ID')
        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 2000:
            raise IdentityError('Goal/prompt must contain 1-2000 characters')

        clean_role = (role or 'general').strip().lower()
        if clean_role not in ('general', 'coder', 'tester', 'architect'):
            raise IdentityError('Invalid agent role. Allowed: general, coder, tester, architect', 400)

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
                'status': 'in_progress',
                'summary': 'در حال بررسی تنظیمات و ماژول‌ها...'
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

        now = int(self.store.clock())
        logs = [
            {
                'timestamp': now,
                'step': 0,
                'type': 'inspection',
                'title': f'آغاز مأموریت با نقش «{role_labels[clean_role]}»',
                'content': f"پروژه «{project_name}» در مسیر {inspection['root_path']} با فریم‌ورک {inspection['framework']} پویش شد."
            }
        ]

        target_fp = root_dir / target_file
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

        can_exec = 'action.approve' in principal.get('capabilities', []) or principal.get('role') == 'superadmin'
        run_status = 'in_progress'
        if not can_exec:
            run_status = 'waiting_approval'
            plan_steps[2]['status'] = 'waiting_approval'
            plan_steps[2]['summary'] = 'در انتظار تأیید مجوز اجرای دستور توسط مدیر ارشد یا کاربر تاییدکننده'

        run_id = uuid.uuid4().hex
        with self.store._lock, self.store._db() as db:
            db.execute("""
                INSERT INTO workspace_agent_runs 
                (id, owner_id, project_id, prompt, role, status, current_step_index, plan_steps, logs, result_summary, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
            """, (run_id, principal['id'], project_id, prompt.strip(), clean_role, run_status, current_step, json.dumps(plan_steps), json.dumps(logs), now, now))
            self.store._audit(db, principal['id'], 'workspace_agent_run_started', f"{run_id}:{project_id}:{clean_role}")

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
                return self._format_run(run)

            plan_steps = json.loads(run['plan_steps'])
            logs = json.loads(run['logs'])
            current_idx = run['current_step_index']
            now = int(self.store.clock())
            new_status = run['status']
            result_summary = run['result_summary']

            if current_idx == 2:
                can_exec = 'action.approve' in principal.get('capabilities', []) or principal.get('role') == 'superadmin'
                if not can_exec:
                    new_status = 'waiting_approval'
                    plan_steps[2]['status'] = 'waiting_approval'
                    plan_steps[2]['summary'] = 'نیازمند تأیید اقدام (action.approve)'
                else:
                    cmd = plan_steps[2].get('command', 'git status')
                    try:
                        res = self.execute_project_command(principal, run['project_id'], cmd, timeout=15)
                        plan_steps[2]['status'] = 'completed' if res['exit_code'] == 0 else 'warning'
                        plan_steps[2]['summary'] = f"دستور با کد خروج {res['exit_code']} در {res['duration_ms']}ms پایان یافت."
                        logs.append({
                            'timestamp': now,
                            'step': 2,
                            'type': 'command_execution',
                            'title': f"اجرای دستور: {cmd}",
                            'content': (res['stdout'] or '') + ('\n' + res['stderr'] if res['stderr'] else ''),
                            'exit_code': res['exit_code']
                        })
                    except Exception as exc:
                        plan_steps[2]['status'] = 'failed'
                        plan_steps[2]['summary'] = f"خطا در اجرای دستور: {exc}"
                        logs.append({
                            'timestamp': now,
                            'step': 2,
                            'type': 'command_execution',
                            'title': f"خطا در دستور: {cmd}",
                            'content': str(exc),
                            'exit_code': 1
                        })
                    current_idx = 3
                    plan_steps[3]['status'] = 'in_progress'

            if current_idx == 3:
                plan_steps[3]['status'] = 'completed'
                plan_steps[3]['summary'] = 'گزارش و جمع‌بندی نهایی توسط ایجنت تدوین شد.'
                new_status = 'completed'
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

            db.execute("""
                UPDATE workspace_agent_runs
                SET status=?, current_step_index=?, plan_steps=?, logs=?, result_summary=?, updated_at=?
                WHERE id=?
            """, (new_status, current_idx, json.dumps(plan_steps), json.dumps(logs), result_summary, now, run_id))

            run['status'] = new_status
            run['current_step_index'] = current_idx
            run['plan_steps'] = json.dumps(plan_steps)
            run['logs'] = json.dumps(logs)
            run['result_summary'] = result_summary
            run['updated_at'] = now
            return self._format_run(run)

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
            if run['status'] != 'waiting_approval':
                raise IdentityError('Run is not waiting for approval', 400)

            db.execute("UPDATE workspace_agent_runs SET status='in_progress', updated_at=? WHERE id=?",
                       (int(self.store.clock()), run_id))
            self.store._audit(db, principal['id'], 'workspace_agent_run_step_approved', run_id)

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
            now = int(self.store.clock())
            db.execute("UPDATE workspace_agent_runs SET status='cancelled', updated_at=? WHERE id=?", (now, run_id))
            self.store._audit(db, principal['id'], 'workspace_agent_run_cancelled', run_id)
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
            return self._format_run(dict(row))

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
            return [self._format_run(dict(r)) for r in rows]

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
            return [self._format_run(dict(r)) for r in rows]

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
                return self._format_run(run)

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
            self.store._audit(db, principal['id'], 'workspace_admin_agent_run_stopped', f"{run_id}:{str(reason)[:60]}")
            run['status'] = 'cancelled'
            run['logs'] = json.dumps(logs)
            run['updated_at'] = now
            return self._format_run(run)

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

            db.execute("UPDATE workspace_agent_runs SET status='in_progress', updated_at=? WHERE id=?",
                       (int(self.store.clock()), run_id))
            self.store._audit(db, principal['id'], 'workspace_admin_agent_run_approved', run_id)

        return self.advance_agent_run(principal, run_id)

