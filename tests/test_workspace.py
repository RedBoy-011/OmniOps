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

    def test_workspace_file_patch_diff_and_apply(self):
        proj_dir = Path(self.temp.name) / 'patch_project'
        proj_dir.mkdir(parents=True, exist_ok=True)
        (proj_dir / 'config.py').write_text("DEBUG = False\nVERSION = '1.0'\n", encoding='utf-8')

        proj = self.workspace.create_project(self.member, 'Patch Project', str(proj_dir))

        # Propose patch to existing file without applying
        patch_res = self.workspace.propose_file_patch(
            self.member,
            proj['id'],
            'config.py',
            "DEBUG = True\nVERSION = '1.1'\nTIMEOUT = 30\n",
            apply=False
        )
        self.assertFalse(patch_res['is_new_file'])
        self.assertTrue(patch_res['has_changes'])
        self.assertFalse(patch_res['applied'])
        self.assertGreater(patch_res['additions'], 0)
        self.assertIn('+DEBUG = True', patch_res['diff'])
        self.assertIn('-DEBUG = False', patch_res['diff'])
        # Original file on disk should not be changed yet
        self.assertIn("DEBUG = False", (proj_dir / 'config.py').read_text(encoding='utf-8'))

        # Propose and apply patch
        applied_res = self.workspace.propose_file_patch(
            self.member,
            proj['id'],
            'config.py',
            "DEBUG = True\nVERSION = '1.1'\nTIMEOUT = 30\n",
            apply=True
        )
        self.assertTrue(applied_res['applied'])
        self.assertIn("TIMEOUT = 30", (proj_dir / 'config.py').read_text(encoding='utf-8'))

        # Propose patch for brand new file
        new_patch = self.workspace.propose_file_patch(
            self.member,
            proj['id'],
            'new_module.py',
            "def run():\n    return 42\n",
            apply=True
        )
        self.assertTrue(new_patch['is_new_file'])
        self.assertTrue(new_patch['applied'])
        self.assertTrue((proj_dir / 'new_module.py').is_file())

    def test_workspace_agent_roles_and_tailored_plans(self):
        proj_dir = Path(self.temp.name) / 'role_project'
        proj_dir.mkdir(parents=True, exist_ok=True)
        (proj_dir / 'requirements.txt').write_text("fastapi>=0.100.0\nuvicorn\npytest\n", encoding='utf-8')
        (proj_dir / 'main.py').write_text("from fastapi import FastAPI\napp = FastAPI()\n", encoding='utf-8')

        proj = self.workspace.create_project(self.member, 'Role Project', str(proj_dir))

        # Test invalid role
        with self.assertRaises(IdentityError) as ctx:
            self.workspace.start_agent_run(self.member, proj['id'], 'تست با نقش نامعتبر', role='superhacker')
        self.assertEqual(ctx.exception.status, 400)

        # Test coder role
        coder_run = self.workspace.start_agent_run(self.member, proj['id'], 'پیاده‌سازی ماژول جدید', role='coder')
        self.assertEqual(coder_run['role'], 'coder')
        self.assertIn('ماژول‌ها', coder_run['plan_steps'][0]['title'])
        self.assertIn('پچ', coder_run['plan_steps'][3]['title'])

        # Test tester role
        tester_run = self.workspace.start_agent_run(self.member, proj['id'], 'بررسی پوشش آزمون‌ها', role='tester')
        self.assertEqual(tester_run['role'], 'tester')
        self.assertIn('پایگاه تست‌ها', tester_run['plan_steps'][0]['title'])
        self.assertIn('تضمین کیفیت', tester_run['plan_steps'][3]['title'])

        # Test architect role
        arch_run = self.workspace.start_agent_run(self.member, proj['id'], 'بررسی ساختار کلان', role='architect')
        self.assertEqual(arch_run['role'], 'architect')
        self.assertIn('معماری', arch_run['plan_steps'][0]['title'])
        self.assertIn('سند ارزیابی معماری', arch_run['plan_steps'][3]['title'])

    def test_admin_agent_run_governance_and_emergency_stop(self):
        proj_dir = Path(self.temp.name) / 'gov_project'
        proj_dir.mkdir(parents=True, exist_ok=True)
        (proj_dir / 'package.json').write_text('{"name": "gov-app"}', encoding='utf-8')

        member_proj = self.workspace.create_project(self.member, 'Member Gov Project', str(proj_dir))
        member_run = self.workspace.start_agent_run(self.member, member_proj['id'], 'اجرای تسک طولانی', role='coder')

        # Regular member cannot access admin governance APIs
        with self.assertRaises(IdentityError) as ctx:
            self.workspace.list_all_agent_runs(self.member)
        self.assertEqual(ctx.exception.status, 403)

        with self.assertRaises(IdentityError) as ctx:
            self.workspace.admin_stop_agent_run(self.member, member_run['id'])
        self.assertEqual(ctx.exception.status, 403)

        with self.assertRaises(IdentityError) as ctx:
            self.workspace.admin_approve_agent_run_step(self.member, member_run['id'])
        self.assertEqual(ctx.exception.status, 403)

        # Superadmin lists all runs across the organization
        all_runs = self.workspace.list_all_agent_runs(self.owner, limit=50)
        self.assertGreaterEqual(len(all_runs), 1)
        found = next((r for r in all_runs if r['id'] == member_run['id']), None)
        self.assertIsNotNone(found)
        self.assertEqual(found['owner_username'], 'workspace-member')
        self.assertEqual(found['project_name'], 'Member Gov Project')

        # Superadmin approves the member's run step
        approved_run = self.workspace.admin_approve_agent_run_step(self.owner, member_run['id'])
        self.assertEqual(approved_run['status'], 'completed')

        # Superadmin emergency stop on another run
        second_run = self.workspace.start_agent_run(self.member, member_proj['id'], 'تسک دیگر برای توقف', role='general')
        stopped_run = self.workspace.admin_stop_agent_run(self.owner, second_run['id'], reason='توقف به دلیل مصرف بیش از حد منابع')
        self.assertEqual(stopped_run['status'], 'cancelled')
        last_log = stopped_run['logs'][-1]
        self.assertEqual(last_log['type'], 'admin_intervention')
        self.assertIn('توقف به دلیل مصرف', last_log['content'])


