import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from omniops.node_client import heartbeat_once, load_identity, save_identity, validate_master_url


class NodeClientTests(unittest.TestCase):
    def test_master_must_be_private_verified_https_origin(self):
        self.assertEqual(validate_master_url('https://172.19.30.100:9000/'), 'https://172.19.30.100:9000')
        for url in ('http://172.19.30.100:9000', 'https://8.8.8.8',
                    'https://user:pass@172.19.30.100:9000', 'https://172.19.30.100:9000/path',
                    'https://example.com'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_master_url(url)

    @unittest.skipIf(os.name == 'nt', 'POSIX file permissions are verified on CI Linux')
    def test_identity_file_is_private_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'id.json'
            state = {'id': 'a', 'credential': 'secret', 'master_url': 'https://127.0.0.1:9000'}
            save_identity(path, state)
            self.assertEqual(load_identity(path), state)
            os.chmod(path, 0o644)
            with self.assertRaises(ValueError):
                load_identity(path)
            link = Path(folder) / 'link.json'
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                save_identity(link, state)

    def test_rotation_recovers_before_or_after_server_accepts(self):
        class FakeClient:
            new_active = False
            def heartbeat(self, state, metrics):
                if state['credential'] != 'old' and not self.new_active:
                    raise HTTPError(None, 401, 'invalid', None, None)
                return {'checked_at': 1, 'credential_expires_at': 9999999999}
            def rotate(self, state, new):
                self.new_active = True
                return {'credential_expires_at': 9999999999}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'id.json'
            state = {'id': 'node', 'credential': 'old', 'credential_expires_at': 1,
                     'master_url': 'https://127.0.0.1:9000'}
            client = FakeClient()
            heartbeat_once(client, state, path, {})
            self.assertEqual(json.loads(path.read_text())['credential'], state['credential'])
            self.assertNotEqual(state['credential'], 'old')
            client.new_active = True
            state = {'id': 'node', 'credential': 'old', 'next_credential': 'next',
                     'credential_expires_at': 1, 'master_url': 'https://127.0.0.1:9000'}
            save_identity(path, state)
            heartbeat_once(client, state, path, {})
            self.assertEqual(json.loads(path.read_text())['credential'], 'next')
