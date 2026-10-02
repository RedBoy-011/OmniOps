"""HTTPS path uses the TLS socket and a verified Master certificate."""

import json
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener

from omniops.identity import IdentityStore
from omniops.node_client import NodeClient, save_identity, load_identity
from omniops.server import make_server


@unittest.skipUnless(shutil.which('openssl'), 'OpenSSL is required to create a temporary TLS test certificate')
class NodeTlsTests(unittest.TestCase):
    def test_verified_tls_allows_issue_enroll_heartbeat_and_revoke(self):
        with tempfile.TemporaryDirectory() as directory:
            certificate = Path(directory) / 'cert.pem'
            key = Path(directory) / 'key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                            '-days', '1', '-subj', '/CN=localhost',
                            '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
                            '-keyout', str(key), '-out', str(certificate)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            identity = IdentityStore(Path(directory) / 'identity.db', b't' * 32)
            identity.bootstrap_admin('tls-admin', 'a sufficiently strong password', '09123456789')
            server = make_server('127.0.0.1', 0, 'a-test-api-key-at-least-32-characters',
                                 'http://127.0.0.1:11434', identity)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_3
            context.load_cert_chain(certificate, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                client = ssl.create_default_context(cafile=str(certificate))
                opener = build_opener(ProxyHandler({}), HTTPSHandler(context=client))
                root = f'https://localhost:{server.server_port}'
                def send(path, body=None, token=None):
                    headers = {'Content-Type': 'application/json'}
                    if token:
                        headers['Authorization'] = 'Bearer ' + token
                    request = Request(root + path, data=json.dumps(body).encode() if body is not None else None,
                                      headers=headers, method='POST' if body is not None else 'GET')
                    with opener.open(request, timeout=5) as response:
                        return response.status, json.load(response)
                token = send('/api/auth/login', {'username': 'tls-admin',
                             'password': 'a sufficiently strong password'})[1]['token']
                grant = send('/api/admin/nodes/grants', {'role': 'worker'}, token)[1]
                client_node = NodeClient(root, str(certificate))
                node = client_node.enroll(grant['grant'], 'worker-01')
                node['master_url'] = root
                state_path = Path(directory) / 'node.json'
                save_identity(state_path, node)
                node = load_identity(state_path)
                self.assertEqual(node['role'], 'worker')
                self.assertEqual(client_node.heartbeat(node, {'cpu_percent': 12})['status'], 'ok')
                self.assertEqual(send('/api/admin/nodes', token=token)[1]['nodes'][0]['id'], node['id'])
                self.assertEqual(send('/api/admin/nodes/revoke', {'id': node['id']}, token)[0], 200)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
