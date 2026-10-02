"""Small non-root Linux node client: verified TLS, private Master, read-only heartbeat."""

import argparse
import getpass
import ipaddress
import json
import os
import secrets
import ssl
import stat
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener

LAN_NETWORKS = tuple(ipaddress.ip_network(network) for network in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"
))
MAX_RESPONSE = 64 * 1024


def validate_master_url(url):
    if not isinstance(url, str):
        raise ValueError('Master URL must be HTTPS and use an explicit private address')
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.username or parts.password or parts.path not in ('', '/') or parts.query or parts.fragment:
        raise ValueError('Master URL must be an HTTPS origin without credentials or paths')
    try:
        address = ipaddress.ip_address(parts.hostname or '')
        if not (address.is_loopback or (isinstance(address, ipaddress.IPv4Address) and
                                       any(address in network for network in LAN_NETWORKS))):
            raise ValueError('Master must be a private IPv4 or loopback address')
        if parts.port is not None and not 1 <= parts.port <= 65535:
            raise ValueError('Invalid Master port')
    except (ValueError, ipaddress.AddressValueError) as exc:
        raise ValueError('Master URL needs a private IP and valid port') from exc
    return url.rstrip('/')


class NodeClient:
    def __init__(self, master_url, ca_file=None):
        self.master_url = validate_master_url(master_url)
        self.context = ssl.create_default_context(cafile=ca_file)
        self.context.minimum_version = ssl.TLSVersion.TLSv1_3
        self.opener = build_opener(ProxyHandler({}), HTTPSHandler(context=self.context))

    def request(self, path, body, token=None):
        data = json.dumps(body).encode('utf-8')
        headers = {'Content-Type': 'application/json'}
        if token is not None:
            headers['Authorization'] = 'Bearer ' + token
        req = Request(self.master_url + path, data=data, headers=headers, method='POST')
        with self.opener.open(req, timeout=10) as response:
            raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ValueError('Master response too large')
            return json.loads(raw)

    def enroll(self, grant, name, role='worker'):
        return self.request('/api/nodes/enroll', {'grant': grant, 'name': name, 'role': role})

    def heartbeat(self, state, metrics):
        return self.request('/api/nodes/heartbeat', {
            'id': state['id'], 'credential': state['credential'], 'metrics': metrics,
        })

    def rotate(self, state, next_credential):
        return self.request('/api/nodes/rotate', {
            'id': state['id'], 'credential': state['credential'],
            'next_credential': next_credential,
        })


def save_identity(path, state):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Identity path must not be a symlink')
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.node-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as file:
            os.fchmod(file.fileno(), 0o600)
            json.dump(state, file)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_identity(path):
    path = Path(path)
    if path.is_symlink() or not stat.S_ISREG(path.stat().st_mode) or stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise ValueError('Identity file must be a regular 0600 file, not a symlink')
    state = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(state, dict) or not all(isinstance(state.get(key), str) for key in ('id', 'credential', 'master_url')):
        raise ValueError('Invalid node identity')
    validate_master_url(state['master_url'])
    return state


def local_ollama_url():
    raw = os.environ.get('OMNIOPS_LOCAL_OLLAMA_URL', 'http://127.0.0.1:11434')
    parts = urlsplit(raw)
    if parts.scheme != 'http' or parts.username or parts.password or parts.path not in ('', '/') or parts.query or parts.fragment:
        raise ValueError('Ollama telemetry requires a local private HTTP origin')
    try:
        address = ipaddress.IPv4Address(parts.hostname or '')
        if not (address.is_loopback or any(address in network for network in LAN_NETWORKS)):
            raise ValueError('Ollama telemetry must stay on a private address')
        if parts.port is None or not 1 <= parts.port <= 65535:
            raise ValueError('Ollama telemetry requires a port')
    except (ValueError, ipaddress.AddressValueError) as exc:
        raise ValueError('Ollama telemetry requires a local private IPv4 origin') from exc
    return raw.rstrip('/')


def local_metrics():
    def cpu_sample():
        with open('/proc/stat', encoding='ascii') as file:
            fields = [int(value) for value in file.readline().split()[1:]]
        return sum(fields), fields[3] + fields[4]
    total1, idle1 = cpu_sample()
    time.sleep(0.2)
    total2, idle2 = cpu_sample()
    cpu = 100 * (1 - (idle2 - idle1) / max(total2 - total1, 1))
    with open('/proc/meminfo', encoding='ascii') as file:
        memory = {key.rstrip(':'): int(value.split()[0]) for key, value in
                  (line.split(':', 1) for line in file if ':' in line)}
    ram = 100 * (1 - memory['MemAvailable'] / memory['MemTotal'])
    disk = os.statvfs('/')
    disk_percent = 100 * (1 - disk.f_bavail / disk.f_blocks) if disk.f_blocks else 0
    metrics = {'version': 'node-client-0.1', 'cpu_percent': round(max(0, min(cpu, 100)), 1),
               'ram_percent': round(max(0, min(ram, 100)), 1),
               'disk_percent': round(max(0, min(disk_percent, 100)), 1)}
    try:
        with build_opener(ProxyHandler({})).open(local_ollama_url() + '/api/tags', timeout=2) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) <= 1024 * 1024:
            entries = json.loads(raw).get('models', [])
            if isinstance(entries, list):
                metrics['models'] = [item['name'] for item in entries[:100]
                                     if isinstance(item, dict) and isinstance(item.get('name'), str)
                                     and len(item['name']) <= 128]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return metrics


def heartbeat_once(client, state, path, metrics):
    # Ghabl az charkhesh, kelid-e jadid ro rooye disk negah midarim ta crash ghabel-e bazyaabi bashe.
    if 'next_credential' not in state and state['credential_expires_at'] - time.time() < 7 * 86400:
        state['next_credential'] = secrets.token_urlsafe(32)
        save_identity(path, state)
    if 'next_credential' in state:
        candidate = {**state, 'credential': state['next_credential']}
        try:
            result = client.heartbeat(candidate, metrics)
        except HTTPError as exc:
            code = exc.code
            exc.close()
            if code != 401:
                raise
            client.rotate(state, state['next_credential'])
            result = client.heartbeat(candidate, metrics)
        state['credential'] = state.pop('next_credential')
        state['credential_expires_at'] = result['credential_expires_at']
        save_identity(path, state)
        return result
    return client.heartbeat(state, metrics)


def main():
    parser = argparse.ArgumentParser(description='OmniOps private node enrollment and read-only heartbeat')
    parser.add_argument('--state', default='/var/lib/omniops/node-identity.json')
    parser.add_argument('--ca-file', help='Trusted Master CA certificate, if not in the system trust store')
    actions = parser.add_subparsers(dest='action', required=True)
    enroll = actions.add_parser('enroll')
    enroll.add_argument('--master', required=True)
    enroll.add_argument('--name', required=True)
    enroll.add_argument('--role', choices=('worker', 'edge'), default='worker')
    actions.add_parser('heartbeat')
    actions.add_parser('run')
    args = parser.parse_args()
    if args.action == 'enroll':
        client = NodeClient(args.master, args.ca_file)
        grant = getpass.getpass('One-time node grant: ')
        if Path(args.state).exists() or Path(args.state).is_symlink():
            raise ValueError('Node identity already exists; revoke or recover it before re-enrollment')
        state = client.enroll(grant, args.name, args.role)
        state['master_url'] = client.master_url
        save_identity(args.state, state)
        print('Node enrolled:', state['id'], 'role:', state['role'])
        return
    state = load_identity(args.state)
    client = NodeClient(state['master_url'], args.ca_file)
    while True:
        result = heartbeat_once(client, state, args.state, local_metrics())
        print('Heartbeat accepted at', result['checked_at'], flush=True)
        if args.action == 'heartbeat':
            return
        time.sleep(30)


if __name__ == '__main__':
    main()
