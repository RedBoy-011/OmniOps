"""Private Master provider catalog with encrypted credentials and bounded outbound probes."""

import base64
import hashlib
import http.client
import ipaddress
import json
import re
import socket
import ssl
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

from .identity import IdentityError

PRIVATE_PROXY_NETS = tuple(ipaddress.ip_network(value) for value in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"))

ENDPOINTS = {
    'openai': ('api.openai.com', '/v1/models', 'Authorization'),
    'gemini': ('generativelanguage.googleapis.com', '/v1beta/models', 'x-goog-api-key'),
    'anthropic': ('api.anthropic.com', '/v1/models', 'x-api-key'),
    'openrouter': ('openrouter.ai', '/api/v1/models', 'Authorization'),
}
MAX_CATALOG_BYTES = 8 * 1024 * 1024


def _cipher(signing_key):
    from cryptography.fernet import Fernet
    derived = hashlib.sha256(b'OmniOps provider vault v1\0' + signing_key).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def _admin(principal):
    if principal.get('role') != 'superadmin' or 'provider.manage' not in principal.get('capabilities', []):
        raise IdentityError('Superadmin provider permission required', 403)


def _proxy(value, mode):
    if mode not in ('direct', 'socks'):
        raise IdentityError('Network mode must be direct or socks')
    if mode == 'direct':
        if value not in (None, ''):
            raise IdentityError('Direct mode cannot specify a proxy')
        return ''
    if not isinstance(value, str):
        raise IdentityError('SOCKS5h proxy address required')
    parsed = urlsplit(value)
    if parsed.scheme != 'socks5h' or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise IdentityError('Use socks5h://private-ip:port without credentials or path')
    try:
        address = ipaddress.IPv4Address(parsed.hostname)
        port = parsed.port
        if not any(address in network for network in PRIVATE_PROXY_NETS) or not port or not 1 <= port <= 65535:
            raise ValueError()
    except (ValueError, TypeError):
        raise IdentityError('SOCKS5h proxy must have a private IPv4 address and valid port')
    return f'socks5h://{address}:{port}'


def _read_exact(sock, count):
    data = bytearray()
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise OSError('SOCKS proxy closed the connection')
        data.extend(chunk)
    return bytes(data)


def _connect_proxy(url, host):
    parsed = urlsplit(url)
    sock = socket.create_connection((parsed.hostname, parsed.port), timeout=8)
    try:
        sock.settimeout(8)
        sock.sendall(b'\x05\x01\x00')
        if _read_exact(sock, 2) != b'\x05\x00':
            raise OSError('SOCKS5 authentication negotiation failed')
        host_bytes = host.encode('ascii')
        sock.sendall(b'\x05\x01\x00\x03' + bytes([len(host_bytes)]) + host_bytes + (443).to_bytes(2, 'big'))
        reply = _read_exact(sock, 4)
        if reply[:3] != b'\x05\x00\x00':
            raise OSError('SOCKS5 connection rejected')
        length = {1: 4, 4: 16}.get(reply[3])
        if reply[3] == 3:
            length = _read_exact(sock, 1)[0]
        if length is None:
            raise OSError('Invalid SOCKS5 reply')
        _read_exact(sock, length + 2)
        return sock
    except Exception:
        sock.close()
        raise


def _catalog_price_per_million(value):
    try:
        amount = Decimal(str(value)) * 1000000
        if amount.is_finite() and 0 <= amount <= 1000000:
            return str(amount.quantize(Decimal('0.000001')).normalize())
    except (InvalidOperation, ValueError):
        pass
    return None


def _provider_get(host, path, headers, mode, proxy_url, maximum):
    sock = _connect_proxy(proxy_url, host) if mode == 'socks' else socket.create_connection((host, 443), timeout=8)
    connection = http.client.HTTPSConnection(host, timeout=10)
    try:
        try:
            connection.sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
        except Exception:
            sock.close()
            raise
        connection.request('GET', path, headers=headers)
        response = connection.getresponse()
        if response.status != 200:
            raise IdentityError(f'Provider returned HTTP {response.status}', 502)
        raw = response.read(maximum + 1)
        if len(raw) > maximum:
            raise IdentityError('Provider response is too large', 502)
        return json.loads(raw)
    finally:
        connection.close()


def fetch_models(kind, api_key, mode, proxy_url, with_prices=False):
    host, path, auth_header = ENDPOINTS[kind]
    try:
        headers = {auth_header: ('Bearer ' if auth_header == 'Authorization' else '') + api_key,
                   'Accept': 'application/json'}
        if kind == 'anthropic':
            headers['anthropic-version'] = '2023-06-01'
        if kind == 'openrouter':
            # Etebar-e kelid ra az masir-e mostanad-e khod-e provider check kon.
            key_document = _provider_get(host, '/api/v1/key', headers, mode, proxy_url, 8192)
            if not isinstance(key_document, dict) or not isinstance(key_document.get('data'), dict):
                raise IdentityError('Provider key verification returned an invalid response', 502)
        document = _provider_get(host, path + ('?pageSize=1000' if kind == 'gemini' else ''),
                                 headers, mode, proxy_url, MAX_CATALOG_BYTES)
        items = document.get('models' if kind == 'gemini' else 'data', [])
        if not isinstance(items, list):
            raise ValueError('Invalid provider catalog')
        models = []
        catalog_prices = {}
        for item in items[:3000]:
            if isinstance(item, dict):
                name = item.get('name' if kind == 'gemini' else 'id')
                if isinstance(name, str) and len(name) <= 160:
                    name = name.removeprefix('models/') if kind == 'gemini' else name
                    models.append(name)
                    pricing = item.get('pricing')
                    if kind == 'openrouter' and isinstance(pricing, dict):
                        input_price = _catalog_price_per_million(pricing.get('prompt'))
                        output_price = _catalog_price_per_million(pricing.get('completion'))
                        if input_price is not None and output_price is not None:
                            catalog_prices[name] = {'input': input_price, 'output': output_price}
        return (models, catalog_prices) if with_prices else models
    except IdentityError:
        raise
    except (OSError, ValueError, TypeError, AttributeError, http.client.HTTPException) as exc:
        raise IdentityError('Provider connection failed; check credentials, proxy and network', 502) from exc


class ProviderRegistry:
    def __init__(self, identity):
        self.identity = identity
        with identity._lock, identity._db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS provider_accounts (
                    kind TEXT PRIMARY KEY, secret TEXT NOT NULL, network_mode TEXT NOT NULL,
                    proxy_url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
                    models_json TEXT NOT NULL DEFAULT '[]', tested_at INTEGER,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS provider_prices (
                    kind TEXT NOT NULL, model TEXT NOT NULL,
                    input_usd_per_million TEXT NOT NULL, output_usd_per_million TEXT NOT NULL,
                    PRIMARY KEY(kind, model)
                );
            ''')
            columns = {row[1] for row in db.execute('PRAGMA table_info(provider_accounts)')}
            if 'catalog_prices_json' not in columns:
                db.execute("ALTER TABLE provider_accounts ADD COLUMN catalog_prices_json TEXT NOT NULL DEFAULT '{}'")

    def list(self, principal):
        _admin(principal)
        with self.identity._db() as db:
            accounts = {row['kind']: row for row in db.execute('SELECT * FROM provider_accounts')}
            prices = {}
            for row in db.execute('SELECT * FROM provider_prices'):
                prices.setdefault(row['kind'], {})[row['model']] = {
                    'input': row['input_usd_per_million'], 'output': row['output_usd_per_million']}
        return [{'kind': kind, 'configured': kind in accounts,
                 'enabled': bool(accounts[kind]['enabled']) if kind in accounts else False,
                 'network_mode': accounts[kind]['network_mode'] if kind in accounts else 'direct',
                 'proxy_url': accounts[kind]['proxy_url'] if kind in accounts else '',
                 'models': json.loads(accounts[kind]['models_json']) if kind in accounts else [],
                 'tested_at': accounts[kind]['tested_at'] if kind in accounts else None,
                 'prices': prices.get(kind, {}),
                 'catalog_prices': json.loads(accounts[kind]['catalog_prices_json']) if kind in accounts else {}} for kind in ENDPOINTS]

    def save(self, principal, kind, key, mode, proxy_url):
        _admin(principal)
        if kind not in ENDPOINTS:
            raise IdentityError('Unsupported provider')
        proxy_url = _proxy(proxy_url, mode)
        if key is not None and (not isinstance(key, str) or not 8 <= len(key) <= 1024 or re.search(r'[^\x21-\x7e]', key)):
            raise IdentityError('Invalid API key')
        with self.identity._lock, self.identity._db() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT secret FROM provider_accounts WHERE kind=?', (kind,)).fetchone()
            if key is None and not existing:
                raise IdentityError('API key required for new provider')
            cipher = _cipher(self.identity.signing_key)
            secret = cipher.encrypt(key.encode()).decode() if key is not None else existing['secret']
            db.execute('''INSERT INTO provider_accounts (kind,secret,network_mode,proxy_url,updated_at)
                VALUES (?,?,?,?,?) ON CONFLICT(kind) DO UPDATE SET secret=excluded.secret,
                network_mode=excluded.network_mode,proxy_url=excluded.proxy_url,
                enabled=0,models_json='[]',catalog_prices_json='{}',tested_at=NULL,updated_at=excluded.updated_at''',
                (kind, secret, mode, proxy_url, int(self.identity.clock())))
            self.identity._audit(db, principal['id'], 'provider_configured', kind)
        return {'status': 'saved'}

    def test(self, principal, kind):
        _admin(principal)
        if kind not in ENDPOINTS:
            raise IdentityError('Unsupported provider')
        with self.identity._db() as db:
            row = db.execute('SELECT * FROM provider_accounts WHERE kind=?', (kind,)).fetchone()
        if row is None:
            raise IdentityError('Configure provider first', 404)
        from cryptography.fernet import InvalidToken
        try:
            key = _cipher(self.identity.signing_key).decrypt(row['secret'].encode()).decode()
        except (InvalidToken, UnicodeError) as exc:
            raise IdentityError('Provider key cannot be decrypted; enter a new API key', 409) from exc
        if kind == 'openrouter':
            models, catalog_prices = fetch_models(kind, key, row['network_mode'], row['proxy_url'], with_prices=True)
        else:
            models = fetch_models(kind, key, row['network_mode'], row['proxy_url'])
            catalog_prices = {}
        with self.identity._lock, self.identity._db() as db:
            updated = db.execute('''UPDATE provider_accounts SET models_json=?,catalog_prices_json=?,tested_at=?
                WHERE kind=? AND secret=? AND network_mode=? AND proxy_url=?''',
                (json.dumps(models), json.dumps(catalog_prices), int(self.identity.clock()), kind,
                 row['secret'], row['network_mode'], row['proxy_url']))
            if updated.rowcount != 1:
                raise IdentityError('Provider changed during test; retry', 409)
            self.identity._audit(db, principal['id'], 'provider_tested', kind)
        return {'models': models, 'network_mode': row['network_mode']}

    def enable(self, principal, kind, enabled):
        _admin(principal)
        if kind not in ENDPOINTS or type(enabled) is not bool:
            raise IdentityError('Invalid provider or enabled state')
        with self.identity._lock, self.identity._db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT tested_at FROM provider_accounts WHERE kind=?', (kind,)).fetchone()
            if row is None or (enabled and row['tested_at'] is None):
                raise IdentityError('Test provider before enabling', 409)
            db.execute('UPDATE provider_accounts SET enabled=? WHERE kind=?', (int(enabled), kind))
            self.identity._audit(db, principal['id'], 'provider_enabled' if enabled else 'provider_disabled', kind)
        return {'enabled': enabled}

    def price(self, principal, kind, model, input_price, output_price):
        _admin(principal)
        if kind not in ENDPOINTS or not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}', model):
            raise IdentityError('Invalid provider model')
        amounts = []
        for value in (input_price, output_price):
            try:
                decimal = Decimal(str(value)) if not isinstance(value, bool) else Decimal('NaN')
                if not decimal.is_finite() or not 0 <= decimal <= 1000000 or decimal.as_tuple().exponent < -6:
                    raise InvalidOperation()
            except (InvalidOperation, ValueError):
                raise IdentityError('Price must be 0 to 1,000,000 USD per million tokens, up to 6 decimals')
            amounts.append(str(decimal))
        with self.identity._lock, self.identity._db() as db:
            db.execute('BEGIN IMMEDIATE')
            account = db.execute('SELECT models_json FROM provider_accounts WHERE kind=?', (kind,)).fetchone()
            if account is None:
                raise IdentityError('Configure provider first', 404)
            if model not in json.loads(account['models_json']):
                raise IdentityError('Test the provider to discover this model first', 409)
            db.execute('''INSERT INTO provider_prices VALUES (?,?,?,?) ON CONFLICT(kind,model)
                DO UPDATE SET input_usd_per_million=excluded.input_usd_per_million,
                output_usd_per_million=excluded.output_usd_per_million''', (kind, model, *amounts))
            self.identity._audit(db, principal['id'], 'provider_price_changed', kind + ':' + model)
        return {'model': model, 'input': amounts[0], 'output': amounts[1]}
