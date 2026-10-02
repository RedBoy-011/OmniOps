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
