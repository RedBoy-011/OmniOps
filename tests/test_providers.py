import json
import socket
import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from omniops.identity import IdentityError, IdentityStore
from omniops.providers import ProviderRegistry, _proxy, _connect_proxy, fetch_models, _provider_post, _catalog_price_per_million
from omniops.server import make_server
from urllib.request import Request, urlopen
from urllib.error import HTTPError


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = IdentityStore(Path(self.temp.name) / 'db.sqlite', b'v' * 32)
        self.store.bootstrap_admin('admin', 'a sufficiently strong password', '09123456789')
        self.admin = self.store.authenticate(self.store.login('admin', 'a sufficiently strong password')['token'])
        self.providers = ProviderRegistry(self.store)

    def test_secret_never_returned_and_test_enables_provider(self):
        self.providers.save(self.admin, 'gemini', 'secret-example-key', 'socks', 'socks5h://172.16.20.250:7890')
        raw = Path(self.store.path).read_bytes()
        self.assertNotIn(b'secret-example-key', raw)
        with patch('omniops.providers.fetch_models', return_value=['gemini-example']) as fetch:
            self.assertEqual(self.providers.test(self.admin, 'gemini')['models'], ['gemini-example'])
            fetch.assert_called_once_with('gemini', 'secret-example-key', 'socks', 'socks5h://172.16.20.250:7890')
        self.providers.enable(self.admin, 'gemini', True)
        self.providers.price(self.admin, 'gemini', 'gemini-example', '0.25', '1.75')
        response = self.providers.list(self.admin)
        self.assertNotIn('secret-example-key', json.dumps(response))
        self.assertTrue(next(p for p in response if p['kind'] == 'gemini')['enabled'])
        self.assertEqual(next(p for p in response if p['kind'] == 'gemini')['prices']['gemini-example']['input'], '0.25')
        self.providers.save(self.admin, 'gemini', None, 'direct', '')
        self.assertFalse(next(p for p in self.providers.list(self.admin) if p['kind'] == 'gemini')['enabled'])

    def test_openrouter_catalog_prices_are_opt_in_and_not_credentials(self):
        self.providers.save(self.admin, 'openrouter', 'example-openrouter-key', 'direct', '')
        catalog = {'openai/gpt-example': {'input': '0.3', 'output': '1.2'}}
        with patch('omniops.providers.fetch_models', return_value=(['openai/gpt-example'], catalog)) as fetch:
            result = self.providers.test(self.admin, 'openrouter')
            fetch.assert_called_once_with('openrouter', 'example-openrouter-key', 'direct', '', with_prices=True)
        self.assertEqual(result['models'], ['openai/gpt-example'])
        listed = next(p for p in self.providers.list(self.admin) if p['kind'] == 'openrouter')
        self.assertEqual(listed['catalog_prices'], catalog)
        self.assertEqual(listed['prices'], {})
        self.assertEqual(_catalog_price_per_million('0.0000003'), '0.3')
        self.assertIsNone(_catalog_price_per_million('NaN'))
        self.providers.price(self.admin, 'openrouter', 'openai/gpt-example', '0.3', '1.2')
        self.assertEqual(next(p for p in self.providers.list(self.admin) if p['kind'] == 'openrouter')['prices']['openai/gpt-example']['output'], '1.2')

    def test_catalog_test_does_not_reenable_reconfigured_route(self):
        self.providers.save(self.admin, 'openrouter', 'example-openrouter-key', 'direct', '')
        def switched_route(*args, **kwargs):
            self.providers.save(self.admin, 'openrouter', None, 'socks', 'socks5h://172.16.20.250:7890')
            return ['openai/gpt-example'], {}
        with patch('omniops.providers.fetch_models', side_effect=switched_route):
            with self.assertRaisesRegex(IdentityError, 'changed during test'):
                self.providers.test(self.admin, 'openrouter')
        account = next(p for p in self.providers.list(self.admin) if p['kind'] == 'openrouter')
        self.assertIsNone(account['tested_at'])
        self.assertFalse(account['enabled'])

    def test_openrouter_verifies_key_before_fetching_public_catalog(self):
        from unittest.mock import Mock
        class FakeResponse:
            def __init__(self, status, body):
                self.status, self.body = status, body
            def read(self, length):
                return self.body[:length]
        connection = Mock()
        connection.getresponse.side_effect = [FakeResponse(401, b'{}')]
        with patch('omniops.providers.socket.create_connection'), \
             patch('omniops.providers.ssl.create_default_context'), \
             patch('omniops.providers.http.client.HTTPSConnection', return_value=connection):
            with self.assertRaisesRegex(IdentityError, 'Provider returned HTTP 401'):
                fetch_models('openrouter', 'invalid-openrouter-key', 'direct', '')
        self.assertEqual(connection.request.call_count, 1)
        self.assertEqual(connection.request.call_args.args[:2], ('GET', '/api/v1/key'))

        connection.reset_mock()
        connection.getresponse.side_effect = [FakeResponse(200, b'{"data": {"limit": 100}}'),
            FakeResponse(200, b'{"data": [{"id":"example/model","pricing":{"prompt":"0.000001","completion":"0.000002"}}]}')]
        with patch('omniops.providers.socket.create_connection'), \
             patch('omniops.providers.ssl.create_default_context'), \
             patch('omniops.providers.http.client.HTTPSConnection', return_value=connection):
            models, prices = fetch_models('openrouter', 'example-openrouter-key', 'direct', '', with_prices=True)
        self.assertEqual(models, ['example/model'])
        self.assertEqual(prices['example/model'], {'input': '1', 'output': '2'})
        self.assertEqual([call.args[1] for call in connection.request.call_args_list],
                         ['/api/v1/key', '/api/v1/models'])

    def test_external_chat_uses_verified_model_saved_socks_route_and_permission(self):
        self.providers.save(self.admin, 'gemini', 'example-gemini-key', 'socks', 'socks5h://172.19.30.99:17890')
        with patch('omniops.providers.fetch_models', return_value=['gemini-example']):
            self.providers.test(self.admin, 'gemini')
        self.providers.enable(self.admin, 'gemini', True)
        member = {'id': 'test-member', 'role': 'member', 'capabilities': ['chat']}
        with self.assertRaisesRegex(IdentityError, 'external provider permission'):
            self.providers.complete(member, 'gemini/gemini-example', 'test')
        member['capabilities'].append('provider.use')
        with patch('omniops.providers._provider_post', return_value={
            'candidates': [{'content': {'parts': [{'text': 'ok'}]}}]}) as send:
            result = self.providers.complete(member, 'gemini/gemini-example', 'test')
        self.assertEqual(result, {'reply': 'ok', 'model': 'gemini/gemini-example'})
        self.assertEqual(send.call_args.args[:5],
                         ('generativelanguage.googleapis.com', '/v1beta/models/gemini-example:generateContent',
                          'example-gemini-key', 'socks', 'socks5h://172.19.30.99:17890'))
        self.assertEqual(send.call_args.args[5]['generationConfig']['maxOutputTokens'], 256)
        with self.assertRaisesRegex(IdentityError, 'not enabled and verified'):
            self.providers.complete(member, 'gemini/other-model', 'test')
        self.providers.enable(self.admin, 'gemini', False)
        with self.assertRaises(IdentityError):
            self.providers.complete(member, 'gemini/gemini-example', 'test')

    def test_fallback_prefers_current_gemini_flash_lite(self):
        self.providers.save(self.admin, 'gemini', 'example-gemini-key', 'direct', '')
        with patch('omniops.providers.fetch_models', return_value=[
            'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite']):
            self.providers.test(self.admin, 'gemini')
        self.providers.enable(self.admin, 'gemini', True)
        self.assertEqual(self.providers.fallback_model(self.admin), 'gemini/gemini-3.5-flash-lite')

    def test_external_chat_rejected_from_plain_http_even_with_consent(self):
        self.providers.save(self.admin, 'gemini', 'example-gemini-key', 'socks', 'socks5h://172.19.30.99:17890')
        with patch('omniops.providers.fetch_models', return_value=['gemini-example']):
            self.providers.test(self.admin, 'gemini')
        self.providers.enable(self.admin, 'gemini', True)
        server = make_server('127.0.0.1', 0, 'a-test-api-key-at-least-32-characters',
                             'http://127.0.0.1:11434', self.store)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            token = self.store.login('admin', 'a sufficiently strong password')['token']
            request = Request(f'http://127.0.0.1:{server.server_port}/api/web/chat',
                              data=json.dumps({'message': 'hello', 'model': 'gemini/gemini-example',
                                               'allow_external': True}).encode(),
                              headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
                              method='POST')
            with patch('omniops.providers._provider_post') as outbound:
                with self.assertRaises(HTTPError) as failed:
                    urlopen(request, timeout=3)
                self.assertEqual(failed.exception.code, 426)
                failed.exception.close()
                outbound.assert_not_called()
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)

    def test_price_and_network_validation(self):
        self.providers.save(self.admin, 'openai', 'example-openai-key', 'direct', '')
        for price in ('NaN', '-1', '1.2345678', 'Infinity'):
            with self.assertRaises(IdentityError):
                self.providers.price(self.admin, 'openai', 'some-model', price, '0')
        for proxy in ('socks5://127.0.0.1:1080', 'socks5h://example.com:1080',
                      'socks5h://127.0.0.1:1080/path', 'socks5h://127.0.0.1:1080@evil.com'):
            with self.assertRaises(IdentityError):
                _proxy(proxy, 'socks')
        with self.assertRaises(IdentityError):
            self.providers.enable(self.admin, 'openai', True)
        with self.assertRaises(IdentityError):
            self.providers.save({'id': 'not-admin', 'role': 'member', 'capabilities': []},
                                'gemini', 'secret-key', 'direct', '')

    def test_socks5h_sends_target_hostname_to_proxy(self):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        captured = []
        def accept():
            conn, _ = listener.accept()
            with conn:
                captured.append(conn.recv(3))
                conn.sendall(b'\x05\x00')
                captured.append(conn.recv(4))
                count = conn.recv(1)[0]
                captured.append(conn.recv(count))
                captured.append(conn.recv(2))
                conn.sendall(b'\x05\x00\x00\x01' + b'\x00' * 4 + b'\x01\xbb')
        thread = threading.Thread(target=accept, daemon=True)
        thread.start()
        try:
            connection = _connect_proxy(f'socks5h://127.0.0.1:{listener.getsockname()[1]}', 'api.openai.com')
            connection.close()
            thread.join(timeout=2)
            self.assertEqual(captured, [b'\x05\x01\x00', b'\x05\x01\x00\x03',
                                        b'api.openai.com', b'\x01\xbb'])
        finally:
            listener.close()

    def test_provider_secrets_rejected_on_plain_http(self):
        server = make_server('127.0.0.1', 0, 'a-test-api-key-at-least-32-characters',
                             'http://127.0.0.1:11434', self.store)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            token = self.store.login('admin', 'a sufficiently strong password')['token']
            request = Request(f'http://127.0.0.1:{server.server_port}/api/admin/providers/save',
                              data=json.dumps({'kind': 'gemini', 'api_key': 'example-gemini-key',
                                               'network_mode': 'direct', 'proxy_url': ''}).encode(),
                              headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
                              method='POST')
            with self.assertRaises(HTTPError) as failed:
                urlopen(request, timeout=3)
            self.assertEqual(failed.exception.code, 426)
            failed.exception.close()
            self.assertFalse(next(p for p in self.providers.list(self.admin) if p['kind'] == 'gemini')['configured'])
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)

    def test_failed_socks_chat_never_falls_back_to_direct(self):
        with patch('omniops.providers._connect_proxy', side_effect=OSError('unavailable')), \
             patch('omniops.providers.socket.create_connection') as direct:
            with self.assertRaises(IdentityError):
                _provider_post('generativelanguage.googleapis.com', '/v1beta/models/example:generateContent',
                               'example-key', 'socks', 'socks5h://172.19.30.99:17890',
                               {'contents': [{'parts': [{'text': 'hello'}]}]})
            direct.assert_not_called()

    def test_failed_socks_connection_never_falls_back_to_direct(self):
        with patch('omniops.providers._connect_proxy', side_effect=OSError('unavailable')), \
             patch('omniops.providers.socket.create_connection') as direct:
            with self.assertRaises(IdentityError):
                fetch_models('openai', 'secret-example-key', 'socks', 'socks5h://127.0.0.1:1')
            direct.assert_not_called()
