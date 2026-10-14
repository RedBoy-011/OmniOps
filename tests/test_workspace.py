import base64
import json
import tempfile
import unittest
from pathlib import Path

from omniops.identity import IdentityError, IdentityStore
from omniops.workspace import WorkspaceStore


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.identity = IdentityStore(Path(self.temp.name) / 'identity.db', b'k' * 32)
        self.identity.bootstrap_admin('workspace-admin', 'strong password admin 123', '09123450001')
        self.owner = self.identity.login('workspace-admin', 'strong password admin 123')['user']
        second = self.identity.register('workspace-member', 'strong password member 123', '09123450002')
        self.identity.decide(self.owner, second, True, ['chat', 'action.request'])
        self.member = self.identity.login('workspace-member', 'strong password member 123')['user']
        self.workspace = WorkspaceStore(self.identity)

    def test_projects_and_task_drafts_are_private(self):
        admin_project = self.workspace.create_project(self.owner, 'Admin project')
        project = self.workspace.create_project(self.member, 'Member project')
        self.assertEqual([item['id'] for item in self.workspace.list_projects(self.member)], [project['id']])
        with self.assertRaises(IdentityError):
            self.workspace.create_task(self.member, admin_project['id'], 'Read admin files')
        task = self.workspace.create_task(self.member, project['id'], 'Prepare a weekly report')
        self.assertEqual(self.workspace.list_tasks(self.owner), [])
        self.assertEqual(self.workspace.list_tasks(self.member)[0]['status'], 'draft')
        with self.assertRaises(IdentityError):
            self.workspace.cancel_task(self.owner, task['id'])
        self.workspace.cancel_task(self.member, task['id'])
        self.assertEqual(self.workspace.list_tasks(self.member)[0]['status'], 'cancelled')
        with self.assertRaises(IdentityError):
            self.workspace.cancel_task(self.member, task['id'])

    def test_capability_and_length_are_checked(self):
        project = self.workspace.create_project(self.member, 'Project')
        no_action = {'id': self.member['id'], 'capabilities': ['chat']}
        with self.assertRaises(IdentityError):
            self.workspace.create_task(no_action, project['id'], 'Forbidden')
        with self.assertRaises(IdentityError):
            self.workspace.create_task(self.member, project['id'], 'x' * 2001)

    def test_attachment_ownership_validation_and_deletion(self):
        project = self.workspace.create_project(self.member, 'Files')
        payload = base64.b64encode('سلام'.encode()).decode()
        item = self.workspace.add_attachment(self.member, project['id'], 'note.txt', 'text/plain', payload)
        self.assertEqual(self.workspace.list_attachments(self.member, project['id'])[0]['id'], item['id'])
        with self.assertRaises(IdentityError):
            self.workspace.list_attachments(self.owner, project['id'])
        with self.assertRaises(IdentityError):
            self.workspace.remove_attachment(self.owner, item['id'])
        with self.assertRaises(IdentityError):
            self.workspace.add_attachment(self.member, project['id'], 'fake.png', 'image/png', payload)
        with self.assertRaises(IdentityError):
            self.workspace.add_attachment(self.member, project['id'], 'bad.txt', 'text/plain', 'not-base64!')
        self.workspace.remove_attachment(self.member, item['id'])
        self.assertEqual(self.workspace.list_attachments(self.member, project['id']), [])

    def test_workspace_project_root_binding_and_inspection(self):
        proj_dir = Path(self.temp.name) / 'sample_project'
        proj_dir.mkdir(parents=True, exist_ok=True)
        (proj_dir / 'package.json').write_text('{"name": "test-app", "dependencies": {"react": "^18.0.0", "vite": "^5.0.0"}}', encoding='utf-8')
        (proj_dir / 'README.md').write_text('# Test Incomplete Project\nCreated with external AI assistance.\n\n## Tasks\n- [ ] Task 1', encoding='utf-8')
        (proj_dir / 'TODO.md').write_text('- [ ] Finish Auth\n- [ ] Write Unit Tests', encoding='utf-8')
        (proj_dir / 'src').mkdir(parents=True, exist_ok=True)
        (proj_dir / 'src' / 'index.js').write_text('console.log("hello");', encoding='utf-8')

        # Create project with root_path
        proj = self.workspace.create_project(self.member, 'My React App', str(proj_dir))
        self.assertEqual(proj['root_path'], str(proj_dir))

        # Inspect project
        info = self.workspace.inspect_project(self.member, proj['id'])
        self.assertEqual(info['project_type'], 'nodejs')
        self.assertIn('React', info['framework'])
        self.assertTrue(info['has_readme'])
        self.assertIn('Test Incomplete Project', info['readme_preview'])
        self.assertIn('Finish Auth', info['tasks_context'])
        self.assertGreaterEqual(info['total_entries'], 3)

        # List files
        files_info = self.workspace.list_project_files(self.member, proj['id'])
        names = [e['name'] for e in files_info['entries']]
        self.assertIn('package.json', names)
        self.assertIn('README.md', names)
        self.assertIn('src', names)

    def test_workspace_file_read_write_and_path_traversal(self):
        proj_dir = Path(self.temp.name) / 'fs_project'
        proj_dir.mkdir(parents=True, exist_ok=True)
        (proj_dir / 'hello.txt').write_text('سلام از فایل محلی', encoding='utf-8')

        proj = self.workspace.create_project(self.member, 'FS Project', str(proj_dir))

        # Read file
        res = self.workspace.read_project_file(self.member, proj['id'], 'hello.txt')
        self.assertEqual(res['content'], 'سلام از فایل محلی')
        self.assertEqual(res['lines'], 1)

        # Write new file
        write_res = self.workspace.write_project_file(self.member, proj['id'], 'sub/nested.py', 'print("created by agent")')
        self.assertEqual(write_res['status'], 'written')
        self.assertTrue((proj_dir / 'sub' / 'nested.py').is_file())

        # Path traversal prevention
        with self.assertRaises(IdentityError) as ctx:
            self.workspace.read_project_file(self.member, proj['id'], '../../outside.txt')
        self.assertEqual(ctx.exception.status, 403)

        with self.assertRaises(IdentityError) as ctx:
            self.workspace.write_project_file(self.member, proj['id'], '../bad.txt', 'danger')
        self.assertEqual(ctx.exception.status, 403)

    def test_workspace_command_execution_permissions_and_safety(self):
        proj_dir = Path(self.temp.name) / 'cmd_project'
        proj_dir.mkdir(parents=True, exist_ok=True)
        proj = self.workspace.create_project(self.member, 'Cmd Project', str(proj_dir))

        # Member without action.approve fails with 403
        with self.assertRaises(IdentityError) as ctx:
            self.workspace.execute_project_command(self.member, proj['id'], 'echo test')
        self.assertEqual(ctx.exception.status, 403)

        # Owner (superadmin) succeeds
        import sys
        admin_proj = self.workspace.create_project(self.owner, 'Admin Cmd Project', str(proj_dir))
        cmd_res = self.workspace.execute_project_command(self.owner, admin_proj['id'], f'"{sys.executable}" -c "print(10 + 20)"')
        self.assertEqual(cmd_res['exit_code'], 0, f"Command failed with stderr: {cmd_res.get('stderr')}")
        self.assertIn('30', cmd_res['stdout'])

        # Dangerous command rejected with 400
        with self.assertRaises(IdentityError) as ctx:
            self.workspace.execute_project_command(self.owner, admin_proj['id'], 'format c: /q')
        self.assertEqual(ctx.exception.status, 400)

    def test_workspace_agent_run_lifecycle_and_advance(self):
        proj_dir = Path(self.temp.name) / 'agentic_run_project'
        proj_dir.mkdir(parents=True, exist_ok=True)
        (proj_dir / 'package.json').write_text(json.dumps({'name': 'test-run', 'dependencies': {'react': '^19.0.0'}}), encoding='utf-8')
        (proj_dir / 'TODO.md').write_text('- [ ] Complete authentication flow\n- [ ] Fix navbar bug\n', encoding='utf-8')

        proj = self.workspace.create_project(self.member, 'Agentic Run Project', str(proj_dir))

        # Member starts agent run
        run = self.workspace.start_agent_run(self.member, proj['id'], 'بررسی و حل باگ‌های پروژه')
        self.assertEqual(run['project_id'], proj['id'])
        self.assertEqual(run['status'], 'waiting_approval')  # member lacks action.approve
        self.assertEqual(len(run['plan_steps']), 4)
        self.assertEqual(run['plan_steps'][0]['status'], 'completed')  # inspection done
        self.assertEqual(run['plan_steps'][1]['status'], 'completed')  # package.json read
        self.assertIn('React', run['plan_steps'][0]['summary'])

        # Member cannot approve without action.approve
        with self.assertRaises(IdentityError) as ctx:
            self.workspace.approve_agent_run_step(self.member, run['id'])
        self.assertEqual(ctx.exception.status, 403)

        # Cancel run
        cancelled = self.workspace.cancel_agent_run(self.member, run['id'])
        self.assertEqual(cancelled['status'], 'cancelled')

        # Superadmin starts run and advances to completion
        admin_proj = self.workspace.create_project(self.owner, 'Admin Agentic Project', str(proj_dir))
        admin_run = self.workspace.start_agent_run(self.owner, admin_proj['id'], 'بررسی پکیج‌ها و اجرای دستور')
        self.assertIn(admin_run['status'], ('in_progress', 'completed'))

        # Advance to completion
        completed_run = self.workspace.advance_agent_run(self.owner, admin_run['id'])
        self.assertEqual(completed_run['status'], 'completed')
        self.assertTrue(len(completed_run['result_summary']) > 0)
        self.assertEqual(completed_run['plan_steps'][3]['status'], 'completed')

        # List runs
        runs_list = self.workspace.list_agent_runs(self.owner, admin_proj['id'])
        self.assertEqual(len(runs_list), 1)
        self.assertEqual(runs_list[0]['id'], admin_run['id'])

