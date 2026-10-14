"""Azmoon-haye vahed baraye motor-e Spec-Driven Development va Agent Workflow Gates."""

import json
import tempfile
import unittest
from pathlib import Path

from omniops.identity import IdentityError, IdentityStore
from omniops.workspace import WorkspaceStore


class SpecDrivenTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.identity = IdentityStore(Path(self.temp.name) / 'identity.db', b's' * 32)
        self.identity.bootstrap_admin('spec-admin', 'strong admin password 123', '09121110001')
        self.admin = self.identity.login('spec-admin', 'strong admin password 123')['user']
        member_id = self.identity.register('spec-dev', 'strong dev password 123', '09121110002')
        self.identity.decide(self.admin, member_id, True, ['chat', 'action.request', 'action.approve'])
        self.dev = self.identity.login('spec-dev', 'strong dev password 123')['user']
        self.proj_dir = Path(self.temp.name) / 'project'
        self.proj_dir.mkdir(parents=True, exist_ok=True)
        self.workspace = WorkspaceStore(self.identity)
        self.project = self.workspace.create_project(self.dev, 'Spec Driven Test Project', str(self.proj_dir))

    def test_is_complex_task_detection(self):
        # Simple tasks should skip Spec gate
        self.assertFalse(self.workspace.is_complex_task('گزارش cpu'))
        self.assertFalse(self.workspace.is_complex_task('ping 127.0.0.1'))
        self.assertFalse(self.workspace.is_complex_task('git status'))
        self.assertFalse(self.workspace.is_complex_task('وضعیت رم'))

        # Complex tasks must trigger Spec gate
        self.assertTrue(self.workspace.is_complex_task('بازطراحی معماری پایگاه داده و مهاجرت جداول احراز هویت'))
        self.assertTrue(self.workspace.is_complex_task('Refactor authentication pipeline and implement security audit logging'))
        self.assertTrue(self.workspace.is_complex_task('پیاده‌سازی ماژول جدید Browser Automation به همراه تست‌های یکپارچگی و تعریف متغیرهای محیطی سیستم'))

    def test_spec_generation_and_structure(self):
        prompt = "بازطراحی لایه دسترسی داده‌ها و پیاده‌سازی کش توزیع‌شده با Redis"
        spec = self.workspace.create_or_generate_spec(self.dev, self.project['id'], prompt)
        
        self.assertEqual(spec['status'], 'draft')
        self.assertEqual(spec['project_id'], self.project['id'])
        self.assertIn("نیازمندی‌های عملکردی", spec['requirements'])
        self.assertIn("معیارهای پذیرش", spec['requirements'])
        self.assertIn("رویکرد و معماری", spec['design_approach'])
        self.assertIsInstance(spec['task_breakdown'], list)
        self.assertGreaterEqual(len(spec['task_breakdown']), 3)

        # Verify audit log
        audit_rows = self.identity.list_audit(self.admin, limit=10)
        events = [a['event'] for a in audit_rows]
        self.assertIn('workspace_spec_created', events)

    def test_spec_update_by_user(self):
        prompt = "طراحی پایپ‌لاین مهاجرت داده‌ها"
        spec = self.workspace.create_or_generate_spec(self.dev, self.project['id'], prompt)
        
        updated = self.workspace.update_spec(
            self.dev,
            spec['id'],
            title="سند نهایی بازبینی‌شده",
            requirements="### نیازمندی‌های ویرایش‌شده توسط کاربر\n- تست با لود ۱۰۰۰ ریکوئست بر ثانیه",
            design_approach="### رویکرد اصلاح‌شده\n- استفاده از معماری بدون وقفه",
            task_breakdown=[
                {"step": 1, "title": "مرحله اول سفارشی", "description": "بررسی منابع", "status": "pending"},
                {"step": 2, "title": "مرحله دوم سفارشی", "description": "اعمال مهاجرت", "status": "pending"}
            ]
        )

        self.assertEqual(updated['title'], "سند نهایی بازبینی‌شده")
        self.assertIn("نیازمندی‌های ویرایش‌شده", updated['requirements'])
        self.assertEqual(len(updated['task_breakdown']), 2)
        self.assertEqual(updated['task_breakdown'][0]['title'], "مرحله اول سفارشی")

    def test_spec_approval_and_execution_flow(self):
        prompt = "پیاده‌سازی تست‌های امنیتی و بررسی آسیب‌پذیری‌ها"
        spec = self.workspace.create_or_generate_spec(self.dev, self.project['id'], prompt)
        
        result = self.workspace.approve_spec_and_execute(self.dev, spec['id'], role='coder')
        self.assertEqual(result['status'], 'executed')
        self.assertIsNotNone(result['spec']['run_id'])
        self.assertEqual(result['spec']['approved_by'], self.dev['username'])
        self.assertIsNotNone(result['spec']['approved_at'])

        # Verify linked agent run was spawned and pre-populated
        run = result['run']
        self.assertEqual(run['id'], result['spec']['run_id'])
        self.assertEqual(run['project_id'], self.project['id'])
        self.assertGreaterEqual(len(run['plan_steps']), 3)

        # Cannot re-execute or edit an executed spec
        with self.assertRaises(IdentityError):
            self.workspace.approve_spec_and_execute(self.dev, spec['id'])
        with self.assertRaises(IdentityError):
            self.workspace.update_spec(self.dev, spec['id'], title="تغییر ناممکن")

    def test_spec_rejection_flow(self):
        prompt = "حذف جداول قدیمی از دیتابیس بدون بکاپ"
        spec = self.workspace.create_or_generate_spec(self.dev, self.project['id'], prompt)
        
        rejected = self.workspace.reject_spec(self.dev, spec['id'], reason="ریسک بالای از دست رفتن داده‌ها بدون نسخه پشتیبان")
        self.assertEqual(rejected['status'], 'rejected')
        self.assertIn("ریسک بالای از دست رفتن", rejected['rejection_reason'])

        # Check audit trail
        audit_rows = self.identity.list_audit(self.admin, limit=10)
        events = [a['event'] for a in audit_rows]
        self.assertIn('workspace_spec_rejected', events)


if __name__ == '__main__':
    unittest.main()
