import tempfile
import unittest
from pathlib import Path

from omniops.identity import IdentityStore
from omniops.workspace import WorkspaceStore


class TaskNotificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.identity = IdentityStore(Path(self.temp.name) / 'identity.db', b'k' * 32)
        self.identity.bootstrap_admin('admin-user', 'password 123 admin', '09123450001')
        self.owner = self.identity.login('admin-user', 'password 123 admin')['user']

        second = self.identity.register('member-user', 'password 123 member', '09123450002')
        self.identity.decide(self.owner, second, True, ['chat', 'action.request'])
        self.member = self.identity.login('member-user', 'password 123 member')['user']

        self.workspace = WorkspaceStore(self.identity)
        self.proj_dir = Path(self.temp.name) / 'notif_project'
        self.proj_dir.mkdir(parents=True, exist_ok=True)
        (self.proj_dir / 'requirements.txt').write_text("fastapi>=0.100.0\nuvicorn\npytest\n", encoding='utf-8')
        (self.proj_dir / 'main.py').write_text("from fastapi import FastAPI\napp = FastAPI()\n", encoding='utf-8')
        self.project = self.workspace.create_project(self.member, 'Notification Project', str(self.proj_dir))

    def test_task_notifications_lifecycle_and_chat_sync(self):
        # 1. Start agent run by member (lacks action.approve, so reaches waiting_approval)
        prompt = 'بهینه‌سازی معماری پایپ‌لاین سیستم'
        run = self.workspace.start_agent_run(self.member, self.project['id'], prompt, role='architect')
        self.assertTrue(run['id'])
        self.assertEqual(run['status'], 'waiting_approval')

        # Check notifications were created
        notifs = self.workspace.list_task_notifications(self.member, limit=10)
        self.assertGreaterEqual(len(notifs), 1)
        latest_notif = notifs[0]
        self.assertEqual(latest_notif['run_id'], run['id'])
        self.assertEqual(latest_notif['status'], 'waiting_approval')
        self.assertIn('گزارش اجرای مرحله وظیفه ایجنت', latest_notif['message'])
        self.assertFalse(latest_notif['is_read'])

        # Check that chat history session was updated for member
        with self.identity._db() as db:
            chat_rows = db.execute("SELECT * FROM chat_history WHERE user_id=?", (self.member['id'],)).fetchall()
            self.assertGreaterEqual(len(chat_rows), 1)
            self.assertIn('گزارش اجرای مرحله وظیفه ایجنت', chat_rows[-1]['reply'])
            self.assertIn(prompt[:20], chat_rows[-1]['prompt'])
            self.assertEqual(chat_rows[-1]['model'], 'agent-task:architect')

        # 2. Admin approves the waiting step (Human-in-the-Loop)
        approved_run = self.workspace.admin_approve_agent_run_step(self.owner, run['id'])
        self.assertEqual(approved_run['status'], 'completed')

        # Check that completion notification was recorded
        notifs_after_approve = self.workspace.list_task_notifications(self.member, limit=10)
        self.assertGreater(len(notifs_after_approve), len(notifs))
        self.assertEqual(notifs_after_approve[0]['status'], 'completed')
        self.assertIn('با موفقیت پایان یافت', notifs_after_approve[0]['message'])

        # 3. Mark notifications as read
        unread_before = self.workspace.list_task_notifications(self.member, unread_only=True)
        self.assertGreater(len(unread_before), 0)

        mark_res = self.workspace.mark_task_notifications_read(self.member)
        self.assertTrue(mark_res['ok'])

        unread_after = self.workspace.list_task_notifications(self.member, unread_only=True)
        self.assertEqual(len(unread_after), 0)


if __name__ == '__main__':
    unittest.main()
