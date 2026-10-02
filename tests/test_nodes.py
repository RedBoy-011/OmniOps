import concurrent.futures
from contextlib import closing
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from omniops.identity import IdentityError, IdentityStore
from omniops.nodes import GRANT_TTL, NodeRegistry


class NodeRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = [1800000000]
        self.store = IdentityStore(Path(self.temp.name) / 'identity.db', b's' * 32, lambda: self.now[0])
        self.store.bootstrap_admin('admin', 'a sufficiently strong password', '09123456789')
        self.admin = self.store.authenticate(self.store.login('admin', 'a sufficiently strong password')['token'])
        self.nodes = NodeRegistry(self.store)

    def test_one_use_hash_rotation_revocation_and_telemetry(self):
        grant = self.nodes.issue(self.admin, 'worker')
        with closing(sqlite3.connect(self.store.path)) as db:
            self.assertNotIn(grant['grant'], repr(db.execute('SELECT * FROM node_grants').fetchall()))
        node = self.nodes.enroll(grant['grant'], 'worker-01')
        self.assertEqual(node['role'], 'worker')
        with closing(sqlite3.connect(self.store.path)) as db:
            self.assertNotIn(node['credential'], repr(db.execute('SELECT * FROM managed_nodes').fetchall()))
        with self.assertRaises(IdentityError):
            self.nodes.enroll(grant['grant'], 'worker-02')
        self.nodes.heartbeat(node['id'], node['credential'], {'cpu_percent': 25, 'models': ['qwen3:0.6b']})
        self.assertEqual(self.nodes.list_nodes(self.admin)[0]['metrics']['models'], ['qwen3:0.6b'])
        fresh = 'Z' * 43
        self.nodes.rotate(node['id'], node['credential'], fresh)
        with self.assertRaises(IdentityError):
            self.nodes.heartbeat(node['id'], node['credential'], {})
        self.nodes.revoke(self.admin, node['id'])
        with self.assertRaises(IdentityError):
            self.nodes.heartbeat(node['id'], fresh, {})

    def test_expiration_cancel_permissions_and_bad_metrics(self):
        canceled = self.nodes.issue(self.admin, 'edge')
        self.nodes.cancel_grant(self.admin, canceled['id'])
        with self.assertRaises(IdentityError):
            self.nodes.enroll(canceled['grant'], 'edge-01')
        expired = self.nodes.issue(self.admin, 'worker')
        self.now[0] += GRANT_TTL
        with self.assertRaises(IdentityError):
            self.nodes.enroll(expired['grant'], 'worker-01')
        with self.assertRaises(IdentityError):
            self.nodes.issue({'role': 'member', 'capabilities': ['profile.manage']}, 'worker')
        edge_grant = self.nodes.issue(self.admin, 'edge')['grant']
        with self.assertRaises(IdentityError):
            self.nodes.enroll(edge_grant, 'worker-01', 'worker')
        node = self.nodes.enroll(edge_grant, 'edge-01', 'edge')
        with self.assertRaises(IdentityError):
            self.nodes.heartbeat(node['id'], node['credential'], {'unknown': 1})
        self.now[0] = node['credential_expires_at']
        with self.assertRaises(IdentityError):
            self.nodes.heartbeat(node['id'], node['credential'], {})

    def test_local_root_grant_has_its_own_audit_actor(self):
        with patch('omniops.nodes.os.geteuid', return_value=1000, create=True):
            with self.assertRaises(IdentityError) as denied:
                self.nodes.issue_local_root('worker')
        self.assertEqual(denied.exception.status, 403)
        with patch('omniops.nodes.os.geteuid', return_value=0, create=True):
            grant = self.nodes.issue_local_root('worker')
        with closing(sqlite3.connect(self.store.path)) as db:
            row = db.execute('SELECT actor_id, event FROM audit WHERE subject_id=?', (grant['id'],)).fetchone()
            self.assertEqual(row, ('system:local-root', 'node_grant_issued_by_local_root'))
        self.assertEqual(self.nodes.enroll(grant['grant'], 'worker-01', 'worker')['role'], 'worker')

    def test_local_root_model_pull_is_audited(self):
        worker = self.nodes.enroll(self.nodes.issue(self.admin, 'worker')['grant'], 'worker-01')
        self.nodes.heartbeat(worker['id'], worker['credential'], {})
        with patch('omniops.nodes.os.geteuid', return_value=1000, create=True):
            with self.assertRaises(IdentityError):
                self.nodes.queue_model_pull_local_root(worker['id'], 'small:latest')
        with patch('omniops.nodes.os.geteuid', return_value=0, create=True):
            job = self.nodes.queue_model_pull_local_root(worker['id'], 'small:latest')
        with closing(sqlite3.connect(self.store.path)) as db:
            self.assertEqual(db.execute('select created_by from model_pulls where id=?', (job['id'],)).fetchone()[0], 'system:local-root')
            self.assertEqual(db.execute('select actor_id from audit where subject_id=?', (job['id'],)).fetchone()[0], 'system:local-root')

    def test_model_pull_is_authorized_and_reports_progress(self):
        grant = self.nodes.issue(self.admin, 'worker')['grant']
        worker = self.nodes.enroll(grant, 'worker-01')
        with self.assertRaises(IdentityError):
            self.nodes.queue_model_pull(self.admin, worker['id'], 'qwen3:0.6b')
        self.nodes.heartbeat(worker['id'], worker['credential'], {'models': []})
        for bad in ('../outside', 'model;touch file', 'bad model', ''):
            with self.assertRaises(IdentityError):
                self.nodes.queue_model_pull(self.admin, worker['id'], bad)
        with self.assertRaises(IdentityError):
            self.nodes.queue_model_pull({'role': 'member', 'capabilities': ['profile.manage']}, worker['id'], 'qwen3:0.6b')
        queued = self.nodes.queue_model_pull(self.admin, worker['id'], 'qwen3:0.6b')
        with self.assertRaises(IdentityError):
            self.nodes.queue_model_pull(self.admin, worker['id'], 'second:latest')
        with self.assertRaises(IdentityError):
            self.nodes.claim_model_pull(worker['id'], 'Z' * 43)
        job = self.nodes.claim_model_pull(worker['id'], worker['credential'])
        self.assertEqual(job['model'], 'qwen3:0.6b')
        self.assertIsNone(self.nodes.claim_model_pull(worker['id'], worker['credential']))
        with self.assertRaises(IdentityError):
            self.nodes.report_model_pull(worker['id'], worker['credential'], job['id'], 'running', 101, 'bad')
        self.nodes.report_model_pull(worker['id'], worker['credential'], job['id'], 'running', 42, 'در حال دریافت')
        self.assertEqual(self.nodes.list_model_pulls(self.admin)[0]['progress'], 42)
        self.nodes.report_model_pull(worker['id'], worker['credential'], job['id'], 'completed', 100, 'آماده')
        self.assertEqual(self.nodes.list_model_pulls(self.admin)[0]['status'], 'completed')
        self.assertEqual(self.nodes.queue_model_pull(self.admin, worker['id'], 'second:latest')['status'], 'queued')
        self.assertEqual(queued['id'], job['id'])

    def test_model_delete_queue_claim_and_audit(self):
        worker = self.nodes.enroll(self.nodes.issue(self.admin, 'worker')['grant'], 'worker-delete')
        self.nodes.heartbeat(worker['id'], worker['credential'], {'models': ['scratch:latest']})
        queued = self.nodes.queue_model_delete(self.admin, worker['id'], 'scratch:latest')
        with self.assertRaises(IdentityError):
            self.nodes.queue_model_pull(self.admin, worker['id'], 'another:latest')
        with patch('omniops.nodes.os.geteuid', return_value=1000, create=True):
            with self.assertRaises(IdentityError):
                self.nodes.queue_model_delete_local_root(worker['id'], 'scratch:latest')
        job = self.nodes.claim_model_pull(worker['id'], worker['credential'])
        self.assertEqual(job['action'], 'delete')
        self.assertEqual(job['id'], queued['id'])
        self.nodes.report_model_pull(worker['id'], worker['credential'], job['id'], 'completed', 100, 'deleted')
        self.assertEqual(self.nodes.list_model_pulls(self.admin)[0]['action'], 'delete')

    def test_delete_is_not_repeated_after_worker_disappears(self):
        worker = self.nodes.enroll(self.nodes.issue(self.admin, 'worker')['grant'], 'worker-delete')
        self.nodes.heartbeat(worker['id'], worker['credential'], {})
        self.nodes.queue_model_delete(self.admin, worker['id'], 'scratch:latest')
        self.nodes.claim_model_pull(worker['id'], worker['credential'])
        self.now[0] += 301
        self.assertIsNone(self.nodes.claim_model_pull(worker['id'], worker['credential']))
        self.assertEqual(self.nodes.list_model_pulls(self.admin)[0]['status'], 'failed')

    def test_model_pull_retries_after_worker_restart_and_rejects_edge(self):
        edge = self.nodes.enroll(self.nodes.issue(self.admin, 'edge')['grant'], 'edge-01')
        self.nodes.heartbeat(edge['id'], edge['credential'], {})
        with self.assertRaises(IdentityError):
            self.nodes.queue_model_pull(self.admin, edge['id'], 'qwen3:0.6b')
        with self.assertRaises(IdentityError):
            self.nodes.claim_model_pull(edge['id'], edge['credential'])
        worker = self.nodes.enroll(self.nodes.issue(self.admin, 'worker')['grant'], 'worker-01')
        self.nodes.heartbeat(worker['id'], worker['credential'], {})
        self.nodes.queue_model_pull(self.admin, worker['id'], 'qwen3:0.6b')
        old = self.nodes.claim_model_pull(worker['id'], worker['credential'])
        self.now[0] += 301
        self.assertEqual(self.nodes.claim_model_pull(worker['id'], worker['credential'])['id'], old['id'])
        self.nodes.revoke(self.admin, worker['id'])
        with self.assertRaises(IdentityError):
            self.nodes.report_model_pull(worker['id'], worker['credential'], old['id'], 'completed', 100, 'آماده')

    def test_parallel_redemption_creates_one_node(self):
        grant = self.nodes.issue(self.admin, 'worker')['grant']
        other = NodeRegistry(IdentityStore(self.store.path, b's' * 32, lambda: self.now[0]))
        def redeem(registry):
            try:
                return registry.enroll(grant, 'worker-01')
            except IdentityError:
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(redeem, (self.nodes, other)))
        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertEqual(len(self.nodes.list_nodes(self.admin)), 1)
