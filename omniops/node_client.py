"""Small non-root Linux node client: verified TLS, private Master, telemetry and model pulls."""

import argparse
import getpass
import ipaddress
import json
import os
import secrets
import shutil
import ssl
import stat
import sys
import tempfile
import threading
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

    def claim_model_pull(self, state):
        return self.request('/api/nodes/model-pulls/claim', {
            'id': state['id'], 'credential': state['credential'],
        })['job']

    def report_model_pull(self, state, job, status, progress=None, detail=''):
        return self.request('/api/nodes/model-pulls/report', {
            'id': state['id'], 'credential': state['credential'], 'job_id': job['id'],
            'status': status, 'progress': progress, 'detail': detail,
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


def get_local_disk_metrics():
    try:
        root_path = os.path.abspath(os.sep)
        usage = shutil.disk_usage(root_path)
        total_gb = round(usage.total / (1024**3), 2)
        used_gb = round(usage.used / (1024**3), 2)
        free_gb = round(usage.free / (1024**3), 2)
        disk_pct = round((usage.used / usage.total) * 100.0, 1) if usage.total > 0 else 0.0
    except Exception:
        total_gb = 0.0
        used_gb = 0.0
        free_gb = 0.0
        disk_pct = 0.0
    return total_gb, used_gb, free_gb, disk_pct


def diagnose_worker_disk(clean: bool = False) -> dict:
    """Diagnoses worker disk space to identify large volume sources:
    - Incomplete models (interrupted/partial Ollama model downloads)
    - Failed models (corrupt or unreferenced models from failed pulls)
    - Temp files (temporary files in /tmp, node temp credentials, and scratch caches)
    """
    incomplete_items = []
    failed_items = []
    temp_items = []
    freed_bytes = 0

    ollama_candidates = []
    if os.environ.get("OLLAMA_MODELS"):
        ollama_candidates.append(Path(os.environ["OLLAMA_MODELS"]))
    ollama_candidates.extend([
        Path.home() / ".ollama" / "models",
        Path("/usr/share/ollama/.ollama/models"),
    ])

    manifest_digests = set()
    for model_dir in ollama_candidates:
        if not model_dir.is_dir():
            continue
        manifests_dir = model_dir / "manifests"
        if manifests_dir.is_dir():
            try:
                for mf in manifests_dir.rglob("*"):
                    if mf.is_file():
                        try:
                            content = json.loads(mf.read_text(encoding="utf-8", errors="ignore"))
                            for layer in content.get("layers", []):
                                digest = layer.get("digest", "")
                                if digest.startswith("sha256:"):
                                    manifest_digests.add(digest[7:])
                            config_digest = content.get("config", {}).get("digest", "")
                            if config_digest.startswith("sha256:"):
                                manifest_digests.add(config_digest[7:])
                        except Exception:
                            st = mf.stat()
                            failed_items.append({
                                "model": mf.name,
                                "path": str(mf),
                                "size_bytes": st.st_size,
                                "size_mb": round(st.st_size / (1024**2), 2),
                                "size_gb": round(st.st_size / (1024**3), 2),
                                "reason": "مانیفست ناقص یا فایل خراب شده"
                            })
            except Exception:
                pass

        blobs_dir = model_dir / "blobs"
        if blobs_dir.is_dir():
            try:
                for entry in blobs_dir.iterdir():
                    if not entry.is_file():
                        continue
                    name = entry.name
                    try:
                        st = entry.stat()
                    except OSError:
                        continue

                    if any(name.endswith(ext) or ext in name for ext in ("-partial", ".partial", ".tmp", ".download", ".part")):
                        incomplete_items.append({
                            "name": name,
                            "path": str(entry),
                            "size_bytes": st.st_size,
                            "size_mb": round(st.st_size / (1024**2), 2),
                            "size_gb": round(st.st_size / (1024**3), 2),
                            "reason": "دانلود ناتمام قطع‌شده در حین دریافت لایه"
                        })
                        if clean:
                            try:
                                entry.unlink()
                                freed_bytes += st.st_size
                            except OSError:
                                pass
                    elif manifest_digests and name.startswith("sha256-"):
                        raw_hash = name[7:]
                        if raw_hash not in manifest_digests:
                            incomplete_items.append({
                                "name": name,
                                "path": str(entry),
                                "size_bytes": st.st_size,
                                "size_mb": round(st.st_size / (1024**2), 2),
                                "size_gb": round(st.st_size / (1024**3), 2),
                                "reason": "لایه بدون مانیفست ناشی از قطع دانلود مدل"
                            })
                            if clean:
                                try:
                                    entry.unlink()
                                    freed_bytes += st.st_size
                                except OSError:
                                    pass
            except Exception:
                pass

    temp_dirs = [Path(tempfile.gettempdir())]
    try:
        current_dir = Path.cwd()
        if current_dir != temp_dirs[0]:
            temp_dirs.append(current_dir)
    except Exception:
        pass

    for tdir in temp_dirs:
        if not tdir.is_dir():
            continue
        try:
            for item in tdir.iterdir():
                if not item.is_file():
                    continue
                name = item.name
                if any(name.startswith(pfx) for pfx in (".node-", "omniops-", "tmp", "ollama-")) or \
                   any(name.endswith(sfx) for sfx in (".tmp", ".temp", ".part")):
                    try:
                        st = item.stat()
                        temp_items.append({
                            "name": name,
                            "path": str(item),
                            "size_bytes": st.st_size,
                            "size_mb": round(st.st_size / (1024**2), 2),
                            "size_gb": round(st.st_size / (1024**3), 2),
                            "reason": "فایل موقت فرآیند Worker"
                        })
                        if clean and name.startswith((".node-", "omniops-")):
                            try:
                                item.unlink()
                                freed_bytes += st.st_size
                            except OSError:
                                pass
                    except OSError:
                        pass
        except Exception:
            pass

    inc_bytes = sum(item["size_bytes"] for item in incomplete_items)
    fail_bytes = sum(item["size_bytes"] for item in failed_items)
    tmp_bytes = sum(item["size_bytes"] for item in temp_items)
    total_wasted = inc_bytes + fail_bytes + tmp_bytes

    diagnostics = []
    if inc_bytes > 0:
        diagnostics.append(f"مدل‌ها و لایه‌های ناقص: {len(incomplete_items)} مورد ({round(inc_bytes / (1024**3), 2)} گیگابایت)")
    if fail_bytes > 0:
        diagnostics.append(f"مدل‌های ناموفق و خراب: {len(failed_items)} مورد ({round(fail_bytes / (1024**3), 2)} گیگابایت)")
    if tmp_bytes > 0:
        diagnostics.append(f"فایل‌های موقت سیستم (Temp): {len(temp_items)} فایل ({round(tmp_bytes / (1024**2), 2)} مگابایت)")
    if not diagnostics:
        diagnostics.append("دیسک در وضعیت بهینه است و فایل زائد یا ناقص شناسایی نشد.")

    return {
        "total_wasted_bytes": total_wasted,
        "total_wasted_gb": round(total_wasted / (1024**3), 2),
        "freed_bytes": freed_bytes,
        "freed_gb": round(freed_bytes / (1024**3), 2),
        "incomplete_models": {
            "count": len(incomplete_items),
            "size_bytes": inc_bytes,
            "size_gb": round(inc_bytes / (1024**3), 2),
            "size_mb": round(inc_bytes / (1024**2), 2),
            "items": incomplete_items[:20]
        },
        "failed_models": {
            "count": len(failed_items),
            "size_bytes": fail_bytes,
            "size_gb": round(fail_bytes / (1024**3), 2),
            "size_mb": round(fail_bytes / (1024**2), 2),
            "items": failed_items[:20]
        },
        "temp_files": {
            "count": len(temp_items),
            "size_bytes": tmp_bytes,
            "size_gb": round(tmp_bytes / (1024**3), 2),
            "size_mb": round(tmp_bytes / (1024**2), 2),
            "items": temp_items[:20]
        },
        "diagnostics": diagnostics
    }


def local_metrics():
    def cpu_sample():
        with open('/proc/stat', encoding='ascii') as file:
            fields = [int(value) for value in file.readline().split()[1:]]
        return sum(fields), fields[3] + fields[4]

    try:
        total1, idle1 = cpu_sample()
        time.sleep(0.2)
        total2, idle2 = cpu_sample()
        cpu = 100 * (1 - (idle2 - idle1) / max(total2 - total1, 1))
    except (OSError, IndexError, ValueError):
        cpu = 0.0

    try:
        with open('/proc/meminfo', encoding='ascii') as file:
            memory = {key.rstrip(':'): int(value.split()[0]) for key, value in
                      (line.split(':', 1) for line in file if ':' in line)}
        ram = 100 * (1 - memory['MemAvailable'] / memory['MemTotal'])
    except (OSError, KeyError, ZeroDivisionError, ValueError):
        ram = 0.0

    total_gb, used_gb, free_gb, disk_percent = get_local_disk_metrics()
    breakdown = diagnose_worker_disk()

    metrics = {
        'version': 'node-client-0.1',
        'cpu_percent': round(max(0, min(cpu, 100)), 1),
        'ram_percent': round(max(0, min(ram, 100)), 1),
        'disk_percent': round(max(0, min(disk_percent, 100)), 1),
        'disk_total_gb': total_gb,
        'disk_used_gb': used_gb,
        'disk_free_gb': free_gb,
        'disk_breakdown': breakdown,
    }
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


def pull_model(client, state_path, job):
    model = job['model']
    progress = None
    last_report = 0
    try:
        endpoint = local_ollama_url() + '/api/pull'
        request = Request(endpoint, data=json.dumps({'model': model, 'stream': True}).encode('utf-8'),
                          headers={'Content-Type': 'application/json'}, method='POST')
        with build_opener(ProxyHandler({})).open(request, timeout=120) as response:
            while True:
                line = response.readline(8193)
                if not line:
                    break
                if len(line) > 8192:
                    raise ValueError('Ollama progress message too long')
                event = json.loads(line)
                if 'error' in event:
                    raise ValueError('Ollama download failed: ' + str(event['error'])[:100])
                total = event.get('total')
                completed = event.get('completed')
                if type(total) is int and total > 0 and type(completed) is int:
                    progress = min(99, max(0, int(100 * completed / total)))
                detail = str(event.get('status', 'در حال دریافت'))[:160]
                if time.monotonic() - last_report >= 2:
                    client.report_model_pull(load_identity(state_path), job, 'running', progress, detail)
                    last_report = time.monotonic()
                if event.get('status') == 'success':
                    client.report_model_pull(load_identity(state_path), job, 'completed', 100, 'مدل آماده است')
                    return
        raise ValueError('Ollama download ended without success')
    except (OSError, ValueError, HTTPError) as exc:
        try:
            client.report_model_pull(load_identity(state_path), job, 'failed', progress,
                                     'دریافت مدل ناموفق بود: ' + str(exc)[:130])
        except (OSError, ValueError, HTTPError):
            pass


def delete_model(client, state_path, job):
    try:
        opener = build_opener(ProxyHandler({}))
        origin = local_ollama_url()
        tags = Request(origin + '/api/tags', method='GET')
        with opener.open(tags, timeout=15) as response:
            installed = json.loads(response.read(MAX_RESPONSE + 1)).get('models', [])
        if not any(item.get('name') == job['model'] for item in installed if isinstance(item, dict)):
            raise ValueError('Model is no longer installed on this Worker')
        request = Request(origin + '/api/delete', data=json.dumps({'model': job['model']}).encode('utf-8'),
                          headers={'Content-Type': 'application/json'}, method='DELETE')
        with opener.open(request, timeout=120) as response:
            response.read(MAX_RESPONSE + 1)
        client.report_model_pull(load_identity(state_path), job, 'completed', 100, 'Model deleted')
    except (OSError, ValueError, HTTPError) as exc:
        try:
            client.report_model_pull(load_identity(state_path), job, 'failed', None, 'Model deletion failed: ' + str(exc)[:130])
        except (OSError, ValueError, HTTPError):
            pass


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
    parser = argparse.ArgumentParser(description='OmniOps private node enrollment, heartbeat and model downloads')
    parser.add_argument('--state', default='/var/lib/omniops/node-identity.json')
    parser.add_argument('--ca-file', help='Trusted Master CA certificate, if not in the system trust store')
    actions = parser.add_subparsers(dest='action', required=True)
    enroll = actions.add_parser('enroll')
    enroll.add_argument('--master', required=True)
    enroll.add_argument('--name', required=True)
    enroll.add_argument('--role', choices=('worker', 'edge'), default='worker')
    enroll.add_argument('--grant-stdin', action='store_true', help='Read grant from an already-open private file descriptor')
    actions.add_parser('heartbeat')
    actions.add_parser('run')
    args = parser.parse_args()
    if args.action == 'enroll':
        client = NodeClient(args.master, args.ca_file)
        grant = sys.stdin.readline().strip() if args.grant_stdin else getpass.getpass('One-time node grant: ')
        if Path(args.state).exists() or Path(args.state).is_symlink():
            raise ValueError('Node identity already exists; revoke or recover it before re-enrollment')
        state = client.enroll(grant, args.name, args.role)
        state['master_url'] = client.master_url
        save_identity(args.state, state)
        print('Node enrolled:', state['id'], 'role:', state['role'])
        return
    state = load_identity(args.state)
    client = NodeClient(state['master_url'], args.ca_file)
    pull_thread = None
    while True:
        result = heartbeat_once(client, state, args.state, local_metrics())
        print('Heartbeat accepted at', result['checked_at'], flush=True)
        if args.action == 'heartbeat':
            return
        if state.get('role') == 'worker' and (pull_thread is None or not pull_thread.is_alive()):
            job = client.claim_model_pull(state)
            if job:
                pull_thread = threading.Thread(target=delete_model if job.get('action') == 'delete' else pull_model, args=(client, args.state, job), daemon=True)
                pull_thread.start()
        time.sleep(30)


if __name__ == '__main__':
    main()
