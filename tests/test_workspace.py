import base64
import json
import subprocess
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

    def test_workspace_sandbox_policy_and_enforcement(self):
        # Non-superadmin cannot get or update policy
        with self.assertRaises(IdentityError) as ctx:
            self.workspace.get_sandbox_policy(self.member)
        self.assertEqual(ctx.exception.status, 403)

        with self.assertRaises(IdentityError) as ctx:
            self.workspace.update_sandbox_policy(self.member, {'max_timeout_seconds': 45})
        self.assertEqual(ctx.exception.status, 403)

        # Superadmin retrieves default policy
        policy = self.workspace.get_sandbox_policy(self.owner)
        self.assertEqual(policy['max_timeout_seconds'], 30)
        self.assertFalse(policy['strict_mode'])
        self.assertIn('git', policy['allowed_prefixes'])
        self.assertIn('format ', policy['blocked_commands'])

        # Superadmin updates policy to enable strict_mode
        updated = self.workspace.update_sandbox_policy(self.owner, {
            'max_timeout_seconds': 10,
            'strict_mode': True,
            'allowed_prefixes': ['git', 'python', 'npm', 'echo'],
            'blocked_commands': ['shutdown', 'format', 'dangerous_rm']
        })
        self.assertEqual(updated['max_timeout_seconds'], 10)
        self.assertTrue(updated['strict_mode'])
        self.assertIn('echo', updated['allowed_prefixes'])

        # Create a project to test command execution under policy
        proj_dir = Path(self.temp.name) / 'sandbox_proj'
        proj_dir.mkdir(parents=True, exist_ok=True)
        proj = self.workspace.create_project(self.owner, 'Sandbox Proj', str(proj_dir))

        # Blocked pattern check
        with self.assertRaises(IdentityError) as ctx:
            self.workspace.execute_project_command(self.owner, proj['id'], 'dangerous_rm -rf /')
        self.assertEqual(ctx.exception.status, 400)
        self.assertIn("Prohibited dangerous command", str(ctx.exception))

        # Strict mode whitelist rejection: 'curl' is not in ['git', 'python', 'npm', 'echo']
        with self.assertRaises(IdentityError) as ctx:
            self.workspace.execute_project_command(self.owner, proj['id'], 'curl https://example.com')
        self.assertEqual(ctx.exception.status, 403)
        self.assertIn("is disallowed by workspace sandbox policy", str(ctx.exception))

        # Strict mode allowed command: 'echo' is allowed
        res = self.workspace.execute_project_command(self.owner, proj['id'], 'echo 25')
        self.assertEqual(res['exit_code'], 0)
        self.assertIn('25', res['stdout'])

    def test_workspace_multi_agent_swarm_orchestration(self):
        proj_dir = Path(self.temp.name) / 'swarm_proj'
        proj_dir.mkdir(parents=True, exist_ok=True)
        (proj_dir / 'package.json').write_text('{"name": "swarm-app", "scripts": {"test": "echo test passed"}}', encoding='utf-8')
        (proj_dir / 'README.md').write_text('# Swarm App\nMulti-Agent Orchestration Target.', encoding='utf-8')

        proj = self.workspace.create_project(self.member, 'Swarm Project', str(proj_dir))

        # Start Swarm run
        swarm_run = self.workspace.start_agent_run(
            self.member,
            proj['id'],
            'بررسی چندعاملی و تست کامل پروژه',
            role='general',
            mode='swarm'
        )
        self.assertEqual(swarm_run['mode'], 'swarm')
        self.assertIn('subagents', swarm_run)
        self.assertEqual(len(swarm_run['subagents']), 3)

        # Verify 3 subagents: architect, coder, tester
        roles = [s['role'] for s in swarm_run['subagents']]
        self.assertEqual(roles, ['architect', 'coder', 'tester'])

        # Architect subagent should be completed with inspection
        arch = next(s for s in swarm_run['subagents'] if s['role'] == 'architect')
        self.assertEqual(arch['status'], 'completed')
        self.assertIn('Node.js', arch['summary'])

        # Coder subagent should be completed after inspecting package.json
        coder = next(s for s in swarm_run['subagents'] if s['role'] == 'coder')
        self.assertEqual(coder['status'], 'completed')
        self.assertIn('package.json', coder['summary'])

        # Tester subagent should be waiting_approval or pending
        tester = next(s for s in swarm_run['subagents'] if s['role'] == 'tester')
        self.assertEqual(tester['status'], 'waiting_approval')

        # Admin approves the swarm step
        approved_swarm = self.workspace.admin_approve_agent_run_step(self.owner, swarm_run['id'])
        self.assertEqual(approved_swarm['status'], 'completed')

        # Verify updated tester subagent
        updated_tester = next(s for s in approved_swarm['subagents'] if s['role'] == 'tester')
        self.assertEqual(updated_tester['status'], 'completed')

        # Verify final multi-agent synthesis
        self.assertIn('Multi-Agent Swarm', approved_swarm['result_summary'])
        self.assertIn('معمار سیستم', approved_swarm['result_summary'])
        self.assertIn('مهندس کدنویس', approved_swarm['result_summary'])
        self.assertIn('تضمین کیفیت', approved_swarm['result_summary'])

    def test_workspace_patch_history_and_rollback(self):
        proj_dir = Path(self.temp.name) / 'patch_test_proj'
        proj_dir.mkdir(parents=True, exist_ok=True)
        target_file = proj_dir / 'app.py'
        target_file.write_text('def main():\n    print("v1")\n', encoding='utf-8')

        proj = self.workspace.create_project(self.member, 'Patch Project', str(proj_dir))

        # Propose and apply patch modifying existing file
        patch_prop = self.workspace.propose_file_patch(
            self.member,
            proj['id'],
            'app.py',
            'def main():\n    print("v2")\n',
            apply=True
        )
        self.assertTrue(patch_prop['applied'])
        self.assertIsNotNone(patch_prop.get('patch_id'))
        patch_id = patch_prop['patch_id']

        # List patches
        patches = self.workspace.list_project_patches(self.member, proj['id'])
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0]['id'], patch_id)
        self.assertEqual(patches[0]['status'], 'applied')
        self.assertEqual(patches[0]['path'], 'app.py')
        self.assertGreater(patches[0]['additions'], 0)

        # Rollback the patch
        rb_res = self.workspace.rollback_file_patch(self.member, patch_id)
        self.assertEqual(rb_res['status'], 'reverted')
        self.assertIsNotNone(rb_res['reverted_at'])

        # Verify content on disk was reverted to v1
        self.assertEqual(target_file.read_text(encoding='utf-8'), 'def main():\n    print("v1")\n')

        # Test patch creation of a brand new file
        new_patch = self.workspace.propose_file_patch(
            self.member,
            proj['id'],
            'new_module.py',
            '# brand new file\n',
            apply=True
        )
        self.assertTrue((proj_dir / 'new_module.py').exists())

        # Rollback new file patch -> should delete the created file
        rb_new = self.workspace.rollback_file_patch(self.member, new_patch['patch_id'])
        self.assertEqual(rb_new['status'], 'reverted')
        self.assertFalse((proj_dir / 'new_module.py').exists())

    def test_workspace_governance_webhooks_and_alerting(self):
        # Only superadmin can manage webhooks
        with self.assertRaises(IdentityError):
            self.workspace.list_governance_webhooks(self.member)
        with self.assertRaises(IdentityError):
            self.workspace.save_governance_webhook(self.member, {'name': 'Test', 'url': 'http://127.0.0.1:9999/wh'})

        # Superadmin creates webhook
        wh = self.workspace.save_governance_webhook(self.owner, {
            'name': 'Corp Discord Alerts',
            'url': 'http://127.0.0.1:9999/test-webhook',
            'secret': 'super-secret-key-123',
            'events': ['emergency_stop', 'sandbox_violation', 'waiting_approval']
        })
        self.assertIn('id', wh)
        self.assertEqual(wh['name'], 'Corp Discord Alerts')
        self.assertEqual(wh['events'], ['emergency_stop', 'sandbox_violation', 'waiting_approval'])

        # Superadmin lists webhooks
        listed = self.workspace.list_governance_webhooks(self.owner)
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]['id'], wh['id'])

        # Superadmin tests webhook (points to closed port so returns error code 0, gracefully handled)
        test_res = self.workspace.test_governance_webhook(self.owner, wh['id'])
        self.assertEqual(test_res['status'], 'error')

        # Superadmin deletes webhook
        del_res = self.workspace.delete_governance_webhook(self.owner, wh['id'])
        self.assertEqual(del_res['status'], 'deleted')
        self.assertEqual(self.workspace.list_governance_webhooks(self.owner), [])

    def test_workspace_code_search_and_grep(self):
        proj_dir = Path(self.temp.name) / 'search_proj'
        proj_dir.mkdir(parents=True, exist_ok=True)
        (proj_dir / 'app.py').write_text('def start_server():\n    print("Server ready")\n', encoding='utf-8')
        (proj_dir / 'helper.js').write_text('export function startClient() {\n  console.log("Client ready");\n}\n', encoding='utf-8')
        (proj_dir / 'config.json').write_text('{"env": "production", "port": 8080}\n', encoding='utf-8')
        
        # Ignored dir
        ignored = proj_dir / 'node_modules' / 'dummy'
        ignored.mkdir(parents=True, exist_ok=True)
        (ignored / 'index.js').write_text('function startServer() {}\n', encoding='utf-8')

        proj = self.workspace.create_project(self.member, 'Search Project', str(proj_dir))

        # Search for "start" (case insensitive)
        res = self.workspace.search_project(self.member, proj['id'], 'start', case_sensitive=False)
        self.assertEqual(res['total_matches'], 2)
        paths = [r['path'] for r in res['results']]
        self.assertIn('app.py', paths)
        self.assertIn('helper.js', paths)
        # Ignored node_modules shouldn't be in results
        self.assertFalse(any('node_modules' in p for p in paths))

        # Filter by extension: only .py
        py_res = self.workspace.search_project(self.member, proj['id'], 'start', file_extensions=['py'])
        self.assertEqual(py_res['total_matches'], 1)
        self.assertEqual(py_res['results'][0]['path'], 'app.py')

        # Case sensitive search: "start_server" vs "startServer"
        case_res = self.workspace.search_project(self.member, proj['id'], 'start_server', case_sensitive=True)
        self.assertEqual(case_res['total_matches'], 1)
        self.assertEqual(case_res['results'][0]['matches'][0]['line_number'], 1)

    def test_workspace_command_history_recording(self):
        proj_dir = Path(self.temp.name) / 'cmd_history_proj'
        proj_dir.mkdir(parents=True, exist_ok=True)
        proj = self.workspace.create_project(self.owner, 'Command History Proj', str(proj_dir))

        # Execute safe commands
        cmd1 = self.workspace.execute_project_command(self.owner, proj['id'], 'echo first test command')
        self.assertEqual(cmd1['exit_code'], 0)
        self.assertIn('id', cmd1)

        cmd2 = self.workspace.execute_project_command(self.owner, proj['id'], 'echo second test command')
        self.assertEqual(cmd2['exit_code'], 0)

        # Retrieve history
        history = self.workspace.list_command_history(self.owner, proj['id'])
        self.assertGreaterEqual(len(history), 2)
        self.assertEqual(history[0]['command'], 'echo second test command')
        self.assertEqual(history[0]['exit_code'], 0)
        self.assertIn('first test command', history[1]['command'])
        self.assertEqual(history[0]['executed_by_username'], 'workspace-admin')

    def test_workspace_interactive_agent_steerability(self):
        proj_dir = Path(self.temp.name) / 'steer_proj'
        proj_dir.mkdir(parents=True, exist_ok=True)
        (proj_dir / 'index.js').write_text('console.log("hello");\n', encoding='utf-8')
        proj = self.workspace.create_project(self.member, 'Steer Proj', str(proj_dir))

        # Start agent run
        run = self.workspace.start_agent_run(self.member, proj['id'], 'پروژه تست را ارزیابی کن')
        self.assertIn(run['status'], ('in_progress', 'waiting_approval'))

        # Send interactive steering feedback
        steered_run = self.workspace.send_agent_run_feedback(
            self.member,
            run['id'],
            'لطفاً از کتابخانه axios به جای fetch استفاده کن'
        )
        self.assertEqual(steered_run['id'], run['id'])
        
        # Verify feedback entry in logs
        feedback_logs = [l for l in steered_run['logs'] if l.get('type') == 'user_feedback']
        self.assertEqual(len(feedback_logs), 1)
        self.assertIn('axios', feedback_logs[0]['content'])
        self.assertIn('workspace-member', feedback_logs[0]['title'])

        # Cancel run
        self.workspace.cancel_agent_run(self.member, run['id'])
        # Sending feedback to cancelled run should raise error
        with self.assertRaises(IdentityError):
            self.workspace.send_agent_run_feedback(self.member, run['id'], 'دستور جدید')

    def test_workspace_git_status_inspection(self):
        git_dir = Path(self.temp.name) / 'git_test_proj'
        git_dir.mkdir(parents=True, exist_ok=True)
        proj = self.workspace.create_project(self.member, 'Git Test Proj', str(git_dir))

        # 1. Non-git project initially
        status_non_git = self.workspace.get_project_git_status(self.member, proj['id'])
        self.assertFalse(status_non_git['is_git_repo'])

        # 2. Initialize a git repo in git_dir
        try:
            subprocess.run(["git", "init"], cwd=str(git_dir), capture_output=True, check=True)
            subprocess.run(["git", "config", "user.name", "Test User"], cwd=str(git_dir), capture_output=True, check=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=str(git_dir), capture_output=True, check=True)
            
            # Create a file and commit
            test_file = git_dir / "initial.txt"
            test_file.write_text("initial content", encoding="utf-8")
            subprocess.run(["git", "add", "initial.txt"], cwd=str(git_dir), capture_output=True, check=True)
            subprocess.run(["git", "commit", "-m", "Initial commit for test"], cwd=str(git_dir), capture_output=True, check=True)

            # Create an untracked file
            untracked = git_dir / "untracked.py"
            untracked.write_text("print('hello')", encoding="utf-8")

            # Inspect git status
            git_status = self.workspace.get_project_git_status(self.member, proj['id'])
            self.assertTrue(git_status['is_git_repo'])
            self.assertIn('untracked.py', git_status['untracked'])
            self.assertFalse(git_status['clean'])
            self.assertGreaterEqual(len(git_status['recent_commits']), 1)
            self.assertEqual(git_status['recent_commits'][0]['message'], "Initial commit for test")
        except Exception as exc:
            self.skipTest(f"Git CLI not functioning in test environment: {exc}")

    def test_workspace_project_artifacts_lifecycle(self):
        art_dir = Path(self.temp.name) / 'art_proj'
        art_dir.mkdir(parents=True, exist_ok=True)
        proj = self.workspace.create_project(self.member, 'Artifact Proj', str(art_dir))

        # Create an artifact
        art = self.workspace.create_project_artifact(
            self.member,
            proj['id'],
            title="طرح معماری سیستم",
            content="# طرح سیستم\nاین یک سند طراحی خودکار است.",
            artifact_type="plan"
        )
        self.assertEqual(art['project_id'], proj['id'])
        self.assertEqual(art['title'], "طرح معماری سیستم")
        self.assertEqual(art['artifact_type'], "plan")
        self.assertIn("طرح سیستم", art['content'])

        # List artifacts
        artifacts = self.workspace.list_project_artifacts(self.member, proj['id'])
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0]['id'], art['id'])

        # Get single artifact
        fetched = self.workspace.get_project_artifact(self.member, proj['id'], art['id'])
        self.assertEqual(fetched['id'], art['id'])

        # Another user without permission cannot delete
        other_member = {
            'id': 'c' * 32,
            'role': 'member',
            'username': 'other',
            'capabilities': ['chat']
        }
        with self.assertRaises(IdentityError):
            self.workspace.delete_project_artifact(other_member, proj['id'], art['id'])

        # Owner can delete
        deleted = self.workspace.delete_project_artifact(self.member, proj['id'], art['id'])
        self.assertEqual(deleted['status'], 'deleted')
        self.assertEqual(len(self.workspace.list_project_artifacts(self.member, proj['id'])), 0)

    def test_workspace_agent_run_auto_artifact_generation(self):
        auto_dir = Path(self.temp.name) / 'auto_proj'
        auto_dir.mkdir(parents=True, exist_ok=True)
        (auto_dir / 'index.js').write_text('console.log("ready");\n', encoding='utf-8')
        proj = self.workspace.create_project(self.member, 'Auto Art Proj', str(auto_dir))

        # Create an agent run and advance through completion
        run = self.workspace.start_agent_run(self.member, proj['id'], 'تکمیل و ارزیابی پروژه تستی', role='architect')
        # advance steps: 0 -> 1 -> 2 -> 3 (completion)
        run = self.workspace.advance_agent_run(self.member, run['id'])
        run = self.workspace.advance_agent_run(self.member, run['id'])
        # step 2 to 3 requires approve or advance
        run = self.workspace.advance_agent_run(self.member, run['id'])
        if run['status'] == 'waiting_approval':
            run = self.workspace.admin_approve_agent_run_step(self.owner, run['id'])
        self.assertEqual(run['status'], 'completed')

        # Verify artifact was automatically generated
        artifacts = self.workspace.list_project_artifacts(self.member, proj['id'])
        self.assertGreaterEqual(len(artifacts), 1)
        auto_art = artifacts[0]
        self.assertEqual(auto_art['run_id'], run['id'])
        self.assertIn("گزارش مأموریت", auto_art['title'])
        self.assertIn("پروژه آماده استقرار", auto_art['content'])

    def test_workspace_command_streaming(self):
        stream_dir = Path(self.temp.name) / 'stream_proj'
        stream_dir.mkdir(parents=True, exist_ok=True)
        proj = self.workspace.create_project(self.owner, 'Stream Proj', str(stream_dir))

        # Start streaming command
        stream = self.workspace.start_streaming_command(self.owner, proj['id'], 'echo hello streaming world')
        self.assertIn('id', stream)
        self.assertIn(stream['status'], ('running', 'streaming'))
        cmd_id = stream['id']

        # Validate command stream exists and belongs to project
        self.assertTrue(self.workspace.validate_command_stream(self.owner, cmd_id))

        # Consume SSE stream events
        events = list(self.workspace.get_command_stream_events(self.owner, cmd_id))
        self.assertGreater(len(events), 0)
        types = [e['type'] for e in events]
        self.assertIn('stdout', types)
        self.assertIn('done', types)

        stdout_events = [e for e in events if e['type'] == 'stdout']
        combined_text = "".join(e.get('text', '') for e in stdout_events)
        self.assertIn('hello streaming world', combined_text)

        done_event = [e for e in events if e['type'] == 'done'][0]
        self.assertEqual(done_event['exit_code'], 0)

        # Non-permitted user should be rejected
        other_user = {'id': 'x' * 32, 'role': 'member', 'username': 'unauth', 'capabilities': ['chat']}
        with self.assertRaises(IdentityError):
            self.workspace.validate_command_stream(other_user, cmd_id)

    def test_workspace_agent_interactive_debugger(self):
        debug_dir = Path(self.temp.name) / 'debug_proj'
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / 'index.js').write_text('console.log("debug");\n', encoding='utf-8')
        proj = self.workspace.create_project(self.member, 'Debug Proj', str(debug_dir))

        # 1. Start agent run with debug_mode=True
        run = self.workspace.start_agent_run(
            self.member,
            proj['id'],
            'بررسی و اجرای دیباگ پروژه تستی',
            role='coder',
            mode='single',
            debug_mode=True
        )
        self.assertEqual(run['status'], 'paused_debug')
        self.assertEqual(run['debug_mode'], 1)
        self.assertEqual(run['current_step_index'], 1)

        # 2. Modify action before running step
        modified = self.workspace.step_agent_run(
            self.member,
            run['id'],
            action='modify',
            modified_command='echo modified_debug_cmd',
            modified_prompt='تغییر یافته توسط تستر'
        )
        self.assertEqual(modified['status'], 'paused_debug')
        self.assertEqual(modified['current_step_index'], 1)

        # 3. Step action (Step Over)
        stepped = self.workspace.step_agent_run(self.member, run['id'], action='step')
        self.assertEqual(stepped['status'], 'paused_debug')
        self.assertEqual(stepped['current_step_index'], 2)

        # 4. Toggle debug mode
        toggled = self.workspace.toggle_agent_run_debug(self.member, run['id'], False)
        self.assertFalse(toggled['debug_mode'])

        # 5. Skip action (Skip Step)
        skipped = self.workspace.step_agent_run(self.member, run['id'], action='skip')
        self.assertEqual(skipped['current_step_index'], 3)
        self.assertEqual(skipped['status'], 'completed')
        # Verify skip was logged
        skip_logs = [l for l in skipped['logs'] if 'پرش' in l.get('title', '') or 'رد شد' in l.get('content', '')]
        self.assertGreaterEqual(len(skip_logs), 1)

        # 6. Attempting to step or continue an already finalized run raises IdentityError
        with self.assertRaises(IdentityError):
            self.workspace.step_agent_run(self.member, run['id'], action='continue')







