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
