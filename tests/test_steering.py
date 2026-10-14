import tempfile
import unittest
from pathlib import Path

from omniops.identity import IdentityStore
from omniops.workspace import WorkspaceStore
from omniops.steering import (
    dump_steering_yaml,
    parse_steering_yaml,
    get_default_steering,
)


class SteeringTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.identity = IdentityStore(Path(self.temp.name) / 'identity.db', b'k' * 32)
        self.identity.bootstrap_admin('admin-user', 'password 123 admin', '09123450001')
        self.owner = self.identity.login('admin-user', 'password 123 admin')['user']

        self.workspace = WorkspaceStore(self.identity)
        self.proj_dir = Path(self.temp.name) / 'steering_proj'
        self.proj_dir.mkdir(parents=True, exist_ok=True)
        (self.proj_dir / 'app.py').write_text("print('hello')\n", encoding='utf-8')
        self.project = self.workspace.create_project(self.owner, 'Steering Project', str(self.proj_dir))

    def test_yaml_serialization_and_parsing(self):
        data = {
            "version": "1.0",
            "project_name": "Test Project",
            "project_rules": [
                "Rule 1: Always write tests",
                "Rule 2: Keep functions concise"
            ],
            "guidelines": {
                "visual_identity": {
                    "primary_color": "#00f0ff",
                    "direction": "rtl"
                },
                "allowed_tools": ["bash", "read_file"]
            }
        }
        yaml_str = dump_steering_yaml(data)
        self.assertIn("version: 1.0", yaml_str)
        self.assertIn('- "Rule 1: Always write tests"', yaml_str)
        self.assertIn('primary_color: "#00f0ff"', yaml_str)

        parsed = parse_steering_yaml(yaml_str)
        self.assertEqual(parsed.get("version"), "1.0")
        self.assertEqual(parsed.get("project_name"), "Test Project")
        self.assertEqual(len(parsed.get("project_rules", [])), 2)
        self.assertEqual(parsed.get("guidelines", {}).get("visual_identity", {}).get("direction"), "rtl")

    def test_get_default_steering(self):
        default = get_default_steering("My Demo")
        self.assertEqual(default["project_name"], "My Demo")
        self.assertIn("project_rules", default)
        self.assertGreaterEqual(len(default["project_rules"]), 3)
        self.assertEqual(default["guidelines"]["visual_identity"]["primary_color"], "#00f0ff")
        self.assertEqual(default["guidelines"]["visual_identity"]["direction"], "rtl")

    def test_workspace_get_and_save_project_steering(self):
        # 1. Initially no steering file exists; should return default with is_custom=False
        res = self.workspace.get_project_steering(self.owner, self.project['id'])
        self.assertFalse(res['is_custom'])
        self.assertEqual(res['path'], '.omniops/steering.yaml')
        self.assertIn('project_rules', res['steering'])

        # 2. Save custom steering rules
        custom_steering = {
            'version': '1.0',
            'project_rules': [
                'Rule Alpha: Do not mutate production tables',
                'Rule Beta: Require code review'
            ],
            'guidelines': {
                'allowed_tools': ['read_file', 'bash', 'playwright']
            }
        }
        save_res = self.workspace.save_project_steering(self.owner, self.project['id'], custom_steering)
        self.assertTrue(save_res['is_custom'])
        self.assertTrue((self.proj_dir / '.omniops' / 'steering.yaml').is_file())

        # Verify audit log
        with self.identity._db() as db:
            audit = db.execute(
                "SELECT * FROM audit WHERE event='project_steering_saved' AND actor_id=?",
                (self.owner['id'],)
            ).fetchone()
            self.assertIsNotNone(audit)
            self.assertIn('.omniops/steering.yaml', audit['subject_id'])

        # 3. Read back steering; should now be custom with saved rules
        fetch_res = self.workspace.get_project_steering(self.owner, self.project['id'])
        self.assertTrue(fetch_res['is_custom'])
        rules = fetch_res['steering'].get('project_rules', [])
        self.assertEqual(len(rules), 2)
        self.assertEqual(rules[0], 'Rule Alpha: Do not mutate production tables')

    def test_steering_rules_injected_in_agent_run(self):
        # Save custom rules
        custom_steering = {
            'version': '1.0',
            'project_rules': ['قانون ۱: رعایت معماری سه لایه مستر-ورکر-ایج']
        }
        self.workspace.save_project_steering(self.owner, self.project['id'], custom_steering)

        # Start agent run
        run = self.workspace.start_agent_run(self.owner, self.project['id'], 'توسعه ماژول جدید')
        self.assertTrue(run['id'])

        # Check logs of initial step to ensure steering rules are included
        inspection_log = run['logs'][0]
        self.assertIn('قوانین هدایت فعال', inspection_log['content'])
        self.assertIn('1 قانون', inspection_log['content'])


if __name__ == '__main__':
    unittest.main()
