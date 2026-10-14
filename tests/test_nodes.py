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

    def test_cancel_and_dismiss_model_pull(self):
        worker = self.nodes.enroll(self.nodes.issue(self.admin, 'worker')['grant'], 'worker-cancel')
        self.nodes.heartbeat(worker['id'], worker['credential'], {})
        queued = self.nodes.queue_model_pull(self.admin, worker['id'], 'llama3.2:1b')
        self.assertEqual(len(self.nodes.list_model_pulls(self.admin)), 1)
        res = self.nodes.cancel_model_pull(self.admin, queued['id'])
        self.assertEqual(res['status'], 'ok')
        self.assertEqual(len(self.nodes.list_model_pulls(self.admin)), 0)
        with self.assertRaises(IdentityError):
            self.nodes.cancel_model_pull(self.admin, 12345)

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

    def test_delete_node(self):
        worker = self.nodes.enroll(self.nodes.issue(self.admin, 'worker')['grant'], 'worker-to-delete')
        self.assertEqual(len(self.nodes.list_nodes(self.admin)), 1)
        self.nodes.delete(self.admin, worker['id'])
        self.assertEqual(len(self.nodes.list_nodes(self.admin)), 0)
        with self.assertRaises(IdentityError):
            self.nodes.delete(self.admin, worker['id'])

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

    def test_worker_disk_metrics_breakdown_and_cleanup(self):
        grant = self.nodes.issue(self.admin, 'worker')['grant']
        worker = self.nodes.enroll(grant, 'worker-disk-test')

        # Negative disk value should fail
        with self.assertRaises(IdentityError):
            self.nodes.heartbeat(worker['id'], worker['credential'], {'disk_total_gb': -10})

        # Non-dict disk_breakdown should fail
        with self.assertRaises(IdentityError):
            self.nodes.heartbeat(worker['id'], worker['credential'], {'disk_breakdown': "bad"})

        # Valid metrics with total, used, free and breakdown
        sample_metrics = {
            'cpu_percent': 24.5,
            'ram_percent': 60.2,
            'disk_percent': 78.4,
            'disk_total_gb': 500.0,
            'disk_used_gb': 392.0,
            'disk_free_gb': 108.0,
            'disk_breakdown': {
                'total_wasted_bytes': 15000000000,
                'total_wasted_gb': 13.97,
                'incomplete_models': {
                    'count': 2,
                    'size_bytes': 8000000000,
                    'size_gb': 7.45,
                    'size_mb': 7629.39,
                    'items': [{'name': 'sha256-part1', 'path': '/tmp/part1', 'size_bytes': 4000000000, 'size_mb': 3814.7, 'size_gb': 3.72, 'reason': 'ناقص'}]
                },
                'failed_models': {
                    'count': 1,
                    'size_bytes': 6000000000,
                    'size_gb': 5.59,
                    'size_mb': 5722.05,
                    'items': [{'name': 'deepseek-r1:14b', 'path': 'job:1', 'size_bytes': 6000000000, 'size_mb': 5722.05, 'size_gb': 5.59, 'reason': 'خطا'}]
                },
                'temp_files': {
                    'count': 5,
                    'size_bytes': 1000000000,
                    'size_gb': 0.93,
                    'size_mb': 953.67,
                    'items': [{'name': '.node-temp.tmp', 'path': '/tmp/node', 'size_bytes': 200000000, 'size_mb': 190.73, 'size_gb': 0.19, 'reason': 'موقت'}]
                },
                'diagnostics': ['مدل‌ها و لایه‌های ناقص: ۲ مورد']
            }
        }
        res = self.nodes.heartbeat(worker['id'], worker['credential'], sample_metrics)
        self.assertEqual(res['status'], 'ok')

        # Verify list_nodes returns metrics with total, used, free and breakdown
        listed = self.nodes.list_nodes(self.admin)
        self.assertEqual(len(listed), 1)
        w_node = listed[0]
        self.assertEqual(w_node['metrics']['disk_total_gb'], 500.0)
        self.assertEqual(w_node['metrics']['disk_used_gb'], 392.0)
        self.assertEqual(w_node['metrics']['disk_free_gb'], 108.0)
        self.assertEqual(w_node['metrics']['disk_breakdown']['incomplete_models']['count'], 2)
        self.assertEqual(w_node['metrics']['disk_breakdown']['failed_models']['count'], 1)
        self.assertEqual(w_node['metrics']['disk_breakdown']['temp_files']['count'], 5)

        # Diagnostics retrieval
        diag = self.nodes.get_node_disk_diagnostics(self.admin, worker['id'])
        self.assertIn('incomplete_models', diag)
        self.assertIn('failed_models', diag)
        self.assertIn('temp_files', diag)

        # Cleanup execution
        clean_res = self.nodes.clean_node_disk(self.admin, worker['id'])
        self.assertEqual(clean_res['status'], 'ok')
        self.assertIn('freed_gb', clean_res)

    def test_optimize_worker_resources_and_audit(self):
        grant = self.nodes.issue(self.admin, 'worker')['grant']
        worker = self.nodes.enroll(grant, 'worker-optimize-test')

        # Setup healthy models and sample metrics
        healthy_models = ['qwen2.5:7b', 'deepseek-r1:7b']
        sample_metrics = {
            'cpu_percent': 15.0,
            'ram_percent': 45.0,
            'disk_percent': 85.0,
            'disk_total_gb': 1000.0,
            'disk_used_gb': 850.0,
            'disk_free_gb': 150.0,
            'models': healthy_models,
            'disk_breakdown': {
                'total_wasted_bytes': 20000000000,
                'total_wasted_gb': 18.63,
                'incomplete_models': {'count': 3, 'size_bytes': 15000000000, 'size_gb': 13.97, 'size_mb': 14305.11, 'items': []},
                'failed_models': {'count': 1, 'size_bytes': 3000000000, 'size_gb': 2.79, 'size_mb': 2861.02, 'items': []},
                'temp_files': {'count': 8, 'size_bytes': 2000000000, 'size_gb': 1.86, 'size_mb': 1907.35, 'items': []},
                'diagnostics': ['مدل‌ها و لایه‌های ناقص: ۳ مورد']
            }
        }
        self.nodes.heartbeat(worker['id'], worker['credential'], sample_metrics)

        # Create a failed model pull in database
        pull_job = self.nodes.queue_model_pull(self.admin, worker['id'], 'llama3.1:8b')
        self.nodes.claim_model_pull(worker['id'], worker['credential'])
        self.nodes.report_model_pull(worker['id'], worker['credential'], pull_job['id'], 'failed', None, 'Download timed out')

        # Non-admin cannot optimize
        with self.assertRaises(IdentityError):
            self.nodes.optimize_worker_resources({'role': 'member', 'capabilities': []}, worker['id'])

        # Execute optimization
        report = self.nodes.optimize_worker_resources(self.admin, worker['id'])

        # Verify report structure
        self.assertEqual(report['status'], 'ok')
        self.assertEqual(report['node_id'], worker['id'])
        self.assertEqual(report['node_name'], 'worker-optimize-test')
        self.assertIn('before', report)
        self.assertIn('after', report)
        self.assertIn('actions_taken', report)
        self.assertIn('healthy_models', report)
        self.assertEqual(report['audit_event'], 'worker_resources_optimized')

        # Verify before values
        self.assertEqual(report['before']['disk_total_gb'], 1000.0)
        self.assertEqual(report['before']['disk_used_gb'], 850.0)
        self.assertEqual(report['before']['failed_count'], 1)

        # Verify after values - wasted space minimized
        self.assertEqual(report['after']['wasted_gb'], 0.0)

        # Verify healthy models were completely preserved and not damaged
        self.assertEqual(report['healthy_models']['count'], 2)
        self.assertEqual(report['healthy_models']['models'], healthy_models)
        self.assertEqual(report['healthy_models']['status'], 'دست‌نخورده و کاملاً سالم')

        # Verify failed pull was cleared from DB
        with closing(sqlite3.connect(self.store.path)) as db:
            failed_in_db = db.execute("SELECT COUNT(*) FROM model_pulls WHERE node_id=? AND status='failed'", (worker['id'],)).fetchone()[0]
            self.assertEqual(failed_in_db, 0)

            # Verify audit trail record
            audit_row = db.execute("SELECT actor_id, event, subject_id FROM audit WHERE event='worker_resources_optimized' AND subject_id=?", (worker['id'],)).fetchone()
            self.assertIsNotNone(audit_row)
            self.assertEqual(audit_row[0], self.admin['id'])
            self.assertEqual(audit_row[1], 'worker_resources_optimized')
            self.assertEqual(audit_row[2], worker['id'])
