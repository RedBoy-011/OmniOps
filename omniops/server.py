"""API-ye azmayeshi-e local baraye avalin ghesmat-e darvazeye Ollama.

In server rooye loopback ya yek IPv4-e khosusi-e moshakhas goosh midahad.
Enteshar-e omoomi be server-e production va TLS niaz darad.
"""

import base64
import hashlib
import hmac
import ipaddress
import json
import mimetypes
import os
import ssl
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .identity import IdentityError, IdentityStore
from .ollama import OllamaClient, OllamaError
from .local_routing import choose_local_chat_model
from .nodes import NodeRegistry
from .providers import ProviderRegistry
from .profile_memory import ProfileMemory
from .workspace import WorkspaceStore
from .mobile_orchestrator import MobileApprovalStore

MAX_BODY_BYTES = 384 * 1024
LAN_NETWORKS = tuple(ipaddress.ip_network(network) for network in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"
))

def allowed_bind_host(host: str) -> bool:
    if host in {"127.0.0.1", "::1"}:
        return True
    try:
        address = ipaddress.IPv4Address(host)
    except ipaddress.AddressValueError:
        return False
    return any(address in network for network in LAN_NETWORKS)


def make_server(
    host: str, port: int, api_key: str, ollama_url: str,
    identity_store: IdentityStore | None = None,
    web_dist: Path | None = None,
) -> ThreadingHTTPServer:
    if not allowed_bind_host(host):
        raise ValueError("Development gateway binds only loopback or an explicit private LAN IPv4")
    if len(api_key) < 32:
        raise ValueError("Set a unique OMNIOPS_API_KEY of at least 32 characters")
    OllamaClient(ollama_url)
    nodes = NodeRegistry(identity_store) if identity_store else None
    providers = ProviderRegistry(identity_store) if identity_store else None
    memory = ProfileMemory(identity_store) if identity_store else None
    workspace = WorkspaceStore(identity_store) if identity_store else None
    mobile_store = MobileApprovalStore(identity_store) if identity_store else None

    def current_ollama() -> OllamaClient:
        endpoint = identity_store.ollama_endpoint() if identity_store else None
        return OllamaClient(endpoint or ollama_url)

    class Handler(BaseHTTPRequestHandler):
        server_version = "OmniOps-Dev/0.1"

        def _send(self, status: int, body: dict):
            encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(encoded)

        def _authorized(self) -> bool:
            actual = self.headers.get("Authorization", "")
            if hmac.compare_digest(actual, f"Bearer {api_key}"):
                return True
            self._send(401, {"error": {"message": "Valid API key required"}})
            return False

        def _available_models(self, client: OllamaClient) -> dict[str, str]:
            return {f"ollama/{entry.name}": entry.name for entry in client.list_chat_models()}

        def _answer_chat(self, principal: dict, payload: dict) -> dict:
            if 'chat' not in principal['capabilities']:
                raise IdentityError('Profile has no chat permission', 403)
            prompt = payload.get('message')
            if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 8000:
                raise IdentityError('Chat message must contain 1-8000 characters')
            requested = payload.get('model', 'auto')
            if not isinstance(requested, str):
                raise IdentityError('Invalid model ID')
            allow_external = payload.get('allow_external', False)
            if type(allow_external) is not bool:
                raise IdentityError('External consent must be a boolean')

            save_history = payload.get('save_history', False)
            if type(save_history) is not bool:
                raise IdentityError('History choice must be a boolean')

            def completed(result):
                if save_history and memory is not None:
                    memory.remember_chat(principal, prompt.strip(), result['reply'], result['model'])
                return result

            def external(model):
                if not allow_external:
                    raise IdentityError('Explicit external data consent required', 403)
                if not isinstance(self.connection, ssl.SSLSocket) or self.connection.version() != 'TLSv1.3':
                    raise IdentityError('Direct TLS 1.3 required for external chat', 426)
                if providers is None:
                    raise IdentityError('Provider registry unavailable', 503)
                return completed(providers.complete(principal, model, prompt.strip()))

            if requested.startswith(('gemini/', 'openrouter/')):
                return external(requested)
            try:
                client = current_ollama()
                models = client.list_chat_models()
                selected = choose_local_chat_model(models, requested, prompt.strip())
                candidates = [selected] if requested != 'auto' else [selected] + [
                    item.name for item in models if item.name != selected
                ]
            except (ValueError, OllamaError) as exc:
                if requested == 'auto' and allow_external and providers is not None:
                    candidate = providers.fallback_model(principal)
                    if candidate:
                        return external(candidate)
                if isinstance(exc, OllamaError):
                    raise
                raise IdentityError(str(exc), 404) from exc
            last_error = None
            for candidate in candidates:
                try:
                    answer = client.chat(candidate, [{'role': 'user', 'content': prompt.strip()}])
                    return completed({'reply': answer, 'model': f'ollama/{candidate}'})
                except OllamaError as exc:
                    last_error = exc
            if requested == 'auto' and allow_external and providers is not None:
                candidate = providers.fallback_model(principal)
                if candidate:
                    return external(candidate)
            raise last_error or OllamaError('No local chat model is available')

        def _static(self) -> bool:
            if web_dist is None or (self.path != "/" and not self.path.startswith("/assets/") and self.path != "/fonts/Vazirmatn-OFL.txt"):
                return False
            base = web_dist.resolve()
            target = base / ("index.html" if self.path == "/" else self.path.lstrip("/"))
            target = target.resolve()
            if not target.is_relative_to(base) or not target.is_file():
                self._send(404, {"error": {"message": "Asset not found"}})
                return True
            raw = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'")
            self.end_headers()
            self.wfile.write(raw)
            return True

        def _identity(self) -> IdentityStore | None:
            if identity_store is None:
                self._send(503, {"error": {"message": "Identity service is not configured"}})
            return identity_store

        def _principal(self, audience: str = "web") -> dict | None:
            store = self._identity()
            if store is None:
                return None
            authorization = self.headers.get("Authorization", "")
            try:
                if not authorization.startswith("Bearer "):
                    raise IdentityError("Bearer session required", 401)
                return store.authenticate(authorization.removeprefix("Bearer "), audience)
            except IdentityError as exc:
                self._send(exc.status, {"error": {"message": str(exc)}})
                return None

        def _body(self) -> dict | None:
            try:
                length = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                length = -1
            if length < 1 or length > MAX_BODY_BYTES:
                self._send(413, {"error": {"message": "Invalid or excessive request size"}})
                return None
            try:
                result = json.loads(self.rfile.read(length))
                if not isinstance(result, dict):
                    raise ValueError("body")
                return result
            except (UnicodeDecodeError, ValueError):
                self._send(400, {"error": {"message": "Invalid JSON object"}})
                return None

        def _node_channel(self) -> bool:
            # Hoviat-e TLS az socket gerefte mishavad, na az header-e proxy.
            if isinstance(self.connection, ssl.SSLSocket) and self.connection.version() == "TLSv1.3":
                return True
            self._send(426, {"error": {"message": "Direct TLS 1.3 is required for node identity"}})
            return False

        def _node_post(self):
            if not self._node_channel():
                return
            if nodes is None:
                self._send(503, {"error": {"message": "Node registry unavailable"}})
                return
            path = self.path
            if path not in {"/api/nodes/enroll", "/api/nodes/heartbeat", "/api/nodes/rotate",
                            "/api/admin/nodes/grants", "/api/admin/nodes/grants/revoke",
                            "/api/admin/nodes/revoke", "/api/admin/nodes/delete", "/api/admin/nodes/token",
                            "/api/admin/nodes/model-pulls", "/api/admin/nodes/model-delete",
                            "/api/nodes/model-pulls/claim", "/api/nodes/model-pulls/report"}:
                self._send(404, {"error": {"message": "Route not found"}})
                return
            principal = None
            if path.startswith("/api/admin/"):
                principal = self._principal()
                if principal is None:
                    return
            body = self._body()
            if body is None:
                return
            try:
                if path == "/api/nodes/enroll":
                    self._send(201, nodes.enroll(body.get("grant"), body.get("name"), body.get("role")))
                elif path == "/api/nodes/heartbeat":
                    self._send(200, nodes.heartbeat(body.get("id"), body.get("credential"), body.get("metrics")))
                elif path == "/api/nodes/rotate":
                    self._send(200, nodes.rotate(body.get("id"), body.get("credential"), body.get("next_credential")))
                elif path == "/api/admin/nodes/grants":
                    self._send(201, nodes.issue(principal, body.get("role")))
                elif path == "/api/admin/nodes/model-pulls":
                    self._send(201, nodes.queue_model_pull(principal, body.get("node_id"), body.get("model")))
                elif path == "/api/admin/nodes/model-delete":
                    self._send(201, nodes.queue_model_delete(principal, body.get("node_id"), body.get("model")))
                elif path == "/api/nodes/model-pulls/claim":
                    self._send(200, {"job": nodes.claim_model_pull(body.get("id"), body.get("credential"))})
                elif path == "/api/nodes/model-pulls/report":
                    self._send(200, nodes.report_model_pull(body.get("id"), body.get("credential"),
                        body.get("job_id"), body.get("status"), body.get("progress"), body.get("detail")))
                elif path == "/api/admin/nodes/grants/revoke":
                    nodes.cancel_grant(principal, body.get("id"))
                    self._send(200, {"status": "revoked"})
                elif path == "/api/admin/nodes/delete":
                    nodes.delete(principal, body.get("id"))
                    self._send(200, {"status": "deleted"})
                elif path == "/api/admin/nodes/token":
                    self._send(201, self._handle_node_token(nodes, principal, body))
                else:
                    nodes.revoke(principal, body.get("id"))
                    self._send(200, {"status": "revoked"})
            except IdentityError as exc:
                self._send(exc.status, {"error": {"message": str(exc)}})

        def _handle_node_token(self, nodes, principal, body):
            role = body.get("role", "worker")
            if role not in ("worker", "edge"):
                raise IdentityError("Invalid node role")
            issued = nodes.issue(principal, role)

            custom_url = body.get("master_url")
            if custom_url and isinstance(custom_url, str) and custom_url.strip():
                master_url = custom_url.strip().rstrip("/")
            else:
                master_url = os.environ.get("OMNIOPS_MASTER_URL")
                if not master_url:
                    host_header = self.headers.get("Host", "127.0.0.1:9443") if hasattr(self, "headers") and self.headers else "127.0.0.1:9443"
                    host_ip = host_header.split(":")[0]
                    tls_port = os.environ.get("OMNIOPS_TLS_PORT", "9443")
                    master_url = f"https://{host_ip}:{tls_port}"

            ca_path = os.environ.get("OMNIOPS_CA_PATH", "/etc/omniops/private-pki/ca.crt")
            ca_crt = ""
            ca_fingerprint = ""
            if os.path.exists(ca_path):
                try:
                    with open(ca_path, "r", encoding="utf-8") as f:
                        ca_crt = f.read()
                    der = ssl.PEM_cert_to_DER_cert(ca_crt)
                    ca_fingerprint = hashlib.sha256(der).hexdigest().lower()
                except Exception:
                    ca_crt = ""
                    ca_fingerprint = ""

            payload = {
                "version": 1,
                "role": role,
                "master_url": master_url,
                "grant": issued["grant"],
                "expires_at": issued["expires_at"],
                "ca_crt": ca_crt,
                "ca_fingerprint": ca_fingerprint
            }
            token_str = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
            join_token = f"omniops_{role}_{token_str}"
            script_name = "setup-worker.sh" if role == "worker" else "setup-edge.sh"
            command = f"curl -fsSL https://raw.githubusercontent.com/RedBoy-011/OmniOps/main/scripts/{script_name} | bash -s -- --token {join_token}"
            return {
                "id": issued["id"],
                "grant": issued["grant"],
                "role": role,
                "expires_at": issued["expires_at"],
                "master_url": master_url,
                "token": join_token,
                "command": command
            }

        def _identity_post(self):
            store = self._identity()
            if store is None:
                return
            path = self.path
            if path not in {
                "/api/auth/register", "/api/auth/login", "/api/auth/logout",
                "/api/agent/pairing", "/api/agent/redeem", "/api/agent/heartbeat", "/api/agent/logout", "/api/agent/chat", "/api/web/chat",
                "/api/chat/history/clear", "/api/chat/memory/add", "/api/chat/memory/remove",
                "/api/agent/history/clear", "/api/agent/memory/add", "/api/agent/memory/remove",
                "/api/web/workspace/projects", "/api/agent/workspace/projects",
                "/api/web/workspace/tasks", "/api/agent/workspace/tasks",
                "/api/web/workspace/tasks/cancel", "/api/agent/workspace/tasks/cancel",
                "/api/web/workspace/attachments", "/api/agent/workspace/attachments",
                "/api/web/workspace/attachments/remove", "/api/agent/workspace/attachments/remove",
                "/api/admin/ollama-endpoint", "/api/admin/providers/save", "/api/admin/providers/test",
                "/api/admin/providers/test-socks", "/api/admin/providers/enable", "/api/admin/providers/price",
            } and not (path.startswith("/api/admin/pending/") and path.rsplit("/", 1)[-1] in {"approve", "reject"}):
                self._send(404, {"error": {"message": "Route not found"}})
                return
            audience = "agent" if path.startswith("/api/agent/") and path != "/api/agent/pairing" else "web"
            principal = None
            if path not in {"/api/auth/register", "/api/auth/login", "/api/agent/redeem"}:
                principal = self._principal(audience)
                if principal is None:
                    return
            if path in {"/api/auth/logout", "/api/agent/heartbeat", "/api/agent/logout"}:
                if path.endswith("heartbeat"):
                    store.heartbeat(principal)
                else:
                    store.revoke(principal)
                self._send(200, {"status": "ok"})
                return
            payload = self._body()
            if payload is None:
                return
            try:
                if path.startswith('/api/admin/providers/'):
                    if not self._node_channel():
                        return
                    if providers is None:
                        raise IdentityError('Provider registry unavailable', 503)
                    if path.endswith('/save'):
                        result = providers.save(principal, payload.get('kind'), payload.get('api_key'),
                                                payload.get('network_mode'), payload.get('proxy_url'))
                    elif path.endswith('/test-socks'):
                        result = providers.test_socks(principal, payload.get('proxy_url'), payload.get('kind'))
                    elif path.endswith('/test'):
                        result = providers.test(principal, payload.get('kind'))
                    elif path.endswith('/enable'):
                        result = providers.enable(principal, payload.get('kind'), payload.get('enabled'))
                    else:
                        result = providers.price(principal, payload.get('kind'), payload.get('model'),
                                                 payload.get('input'), payload.get('output'))
                    self._send(200, result)
                elif path == "/api/auth/register":
                    store.register(payload.get("username"), payload.get("password"), payload.get("mobile"), self.client_address[0])
                    self._send(202, {"status": "pending", "message": "درخواست شما ثبت شد و در انتظار تأیید مدیر سیستم است."})
                elif path == "/api/auth/login":
                    self._send(200, store.login(payload.get("username"), payload.get("password"), self.client_address[0]))
                elif path == "/api/agent/pairing":
                    self._send(201, store.create_pairing(principal))
                elif path == "/api/agent/redeem":
                    self._send(200, store.redeem_pairing(
                        payload.get("code"), payload.get("device_id"), self.client_address[0]
                    ))
                elif path == "/api/admin/ollama-endpoint":
                    if principal["role"] != "superadmin" or "provider.manage" not in principal["capabilities"]:
                        raise IdentityError("Superadmin provider permission required", 403)
                    url = payload.get("url")
                    if not isinstance(url, str) or len(url) > 255:
                        raise IdentityError("Invalid worker URL")
                    try:
                        candidate = OllamaClient(url)
                    except ValueError as exc:
                        raise IdentityError(str(exc)) from exc
                    models = candidate.list_models()
                    store.set_ollama_endpoint(principal, candidate.base_url)
                    self._send(200, {"url": candidate.base_url, "status": "up", "models": [
                        {"id": f"ollama/{entry.name}", "size_bytes": entry.size_bytes} for entry in models
                    ]})
                elif path in ('/api/chat/history/clear', '/api/agent/history/clear'):
                    memory.delete_history(principal)
                    self._send(200, {'status': 'cleared'})
                elif path in ('/api/chat/memory/add', '/api/agent/memory/add'):
                    self._send(201, {'id': memory.add_note(principal, payload.get('content'))})
                elif path in ('/api/chat/memory/remove', '/api/agent/memory/remove'):
                    memory.remove_note(principal, payload.get('id'))
                    self._send(200, {'status': 'removed'})
                elif path in ('/api/web/workspace/projects', '/api/agent/workspace/projects'):
                    self._send(201, workspace.create_project(principal, payload.get('name')))
                elif path in ('/api/web/workspace/tasks', '/api/agent/workspace/tasks'):
                    self._send(201, workspace.create_task(principal, payload.get('project_id'), payload.get('description')))
                elif path in ('/api/web/workspace/tasks/cancel', '/api/agent/workspace/tasks/cancel'):
                    self._send(200, workspace.cancel_task(principal, payload.get('id')))
                elif path in ('/api/web/workspace/attachments', '/api/agent/workspace/attachments'):
                    self._send(201, workspace.add_attachment(principal, payload.get('project_id'),
                                                              payload.get('name'), payload.get('mime'), payload.get('content_base64')))
                elif path in ('/api/web/workspace/attachments/remove', '/api/agent/workspace/attachments/remove'):
                    self._send(200, workspace.remove_attachment(principal, payload.get('id')))
                elif path in ('/api/agent/chat', '/api/web/chat'):
                    self._send(200, self._answer_chat(principal, payload))
                elif path == '/api/mobile/approvals/request':
                    self._send(201, mobile_store.request_approval(
                        payload.get('node_id', 'pc-local'),
                        payload.get('command', ''),
                        payload.get('agent_name', 'Antigravity'),
                        payload.get('risk_level', 'high'),
                        payload.get('description', '')
                    ))
                elif path == '/api/mobile/approvals/decide':
                    self._send(200, mobile_store.decide(
                        principal,
                        payload.get('request_id'),
                        bool(payload.get('approved', False)),
                        payload.get('auth_method', 'biometric_fingerprint')
                    ))
                elif path == '/api/mobile/kill-switch':
                    self._send(200, mobile_store.emergency_kill_switch(
                        principal,
                        payload.get('node_id', 'all'),
                        payload.get('reason', 'Emergency mobile operator stop')
                    ))
                else:
                    pieces = path.split("/")
                    if len(pieces) != 6 or not pieces[4]:
                        raise IdentityError("Invalid approval route", 404)
                    store.decide(principal, pieces[4], pieces[5] == "approve", payload.get("capabilities"))
                    self._send(200, {"status": "active" if pieces[5] == "approve" else "rejected"})
            except IdentityError as exc:
                self._send(exc.status, {"error": {"message": str(exc)}})
            except OllamaError as exc:
                self._send(503, {"error": {"message": str(exc)}})

        def do_GET(self):
            from urllib.parse import parse_qs, urlsplit
            parsed = urlsplit(self.path)
            if parsed.path in ('/api/web/workspace/attachments', '/api/agent/workspace/attachments'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    ids = parse_qs(parsed.query).get('project_id', [])
                    self._send(200, {'attachments': workspace.list_attachments(principal, ids[0] if len(ids) == 1 else None)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path in ('/api/mobile/approvals/pending', '/api/mobile/status'):
                principal = self._principal('web') or self._principal('agent')
                if principal is None:
                    return
                if parsed.path == '/api/mobile/approvals/pending':
                    self._send(200, {'requests': mobile_store.list_pending(principal)})
                    return
                if parsed.path == '/api/mobile/status':
                    self._send(200, {
                        'system': 'Connected - LOUIS-PC',
                        'node_name': 'LOUIS-PC',
                        'status': 'online',
                        'agents': [
                            {'name': 'Antigravity', 'status': 'Ready', 'type': 'IDE Agent'},
                            {'name': 'Claude Desktop', 'status': 'Ready', 'type': 'Desktop Assistant'},
                            {'name': 'OmniOps Ollama', 'status': 'Ready', 'type': 'Local GPU'},
                        ],
                        'plan_usage': {
                            'used_percent': 64,
                            'limit': '1,000,000 Tokens/day',
                            'remaining': '360,000 Tokens',
                            'tier': 'Enterprise Pro'
                        }
                    })
                    return
            if parsed.path in ('/api/web/project/files', '/api/web/project/file'):
                principal = self._principal('web')
                if principal is None:
                    return
                if 'chat' not in principal.get('capabilities', []):
                    self._send(403, {'error': {'message': 'Chat permission required'}})
                    return
                repo_root = Path(__file__).resolve().parent.parent
                if parsed.path == '/api/web/project/files':
                    default_files = [
                        {'path': 'README.md', 'name': 'README.md', 'type': 'markdown', 'changes': '+14 -14', 'category': 'changed'},
                        {'path': 'CHANGELOG.md', 'name': 'CHANGELOG.md', 'type': 'markdown', 'changes': '+43 lines', 'category': 'docs'},
                        {'path': 'docs/PROJECT_RULES.fa.md', 'name': 'PROJECT_RULES.fa.md', 'type': 'markdown', 'changes': 'قوانین رسمی', 'category': 'docs'},
                        {'path': 'docs/MANUAL.fa.md', 'name': 'MANUAL.fa.md', 'type': 'markdown', 'changes': 'راهنمای کاربری', 'category': 'docs'},
                        {'path': 'scripts/update-ubuntu.sh', 'name': 'update-ubuntu.sh', 'type': 'shell', 'changes': 'آپدیت هوشمند', 'category': 'scripts'},
                        {'path': 'scripts/setup-worker.sh', 'name': 'setup-worker.sh', 'type': 'shell', 'changes': 'کشف Ollama', 'category': 'scripts'},
                        {'path': 'omniops/ollama_discovery.py', 'name': 'ollama_discovery.py', 'type': 'python', 'changes': 'هسته مدل', 'category': 'code'},
                        {'path': 'omniops/online_providers.py', 'name': 'online_providers.py', 'type': 'python', 'changes': 'چندکلید ابری', 'category': 'code'},
                        {'path': 'omniops/server.py', 'name': 'server.py', 'type': 'python', 'changes': 'هسته مرکزی', 'category': 'code'},
                    ]
                    for item in default_files:
                        fp = repo_root / item['path']
                        if fp.exists():
                            item['size'] = fp.stat().st_size
                    self._send(200, {'files': default_files})
                    return
                rel_path = parse_qs(parsed.query).get('path', ['README.md'])[0]
                try:
                    target = (repo_root / rel_path).resolve()
                    if not str(target).startswith(str(repo_root)):
                        self._send(403, {'error': {'message': 'Access outside repository forbidden'}})
                        return
                    if any(part.startswith('.') for part in target.parts) or target.suffix.lower() not in (
                        '.md', '.txt', '.py', '.sh', '.json', '.toml', '.rs', '.tsx', '.ts', '.css', '.html', '.yaml', '.yml'
                    ):
                        self._send(403, {'error': {'message': 'File type restricted'}})
                        return
                    if not target.is_file():
                        self._send(404, {'error': {'message': 'File not found'}})
                        return
                    content = target.read_text(encoding='utf-8', errors='replace')
                    diff_data = None
                    try:
                        import subprocess
                        proc = subprocess.run(['git', 'diff', 'HEAD~1', '--', rel_path], cwd=str(repo_root), capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=2)
                        if proc.returncode == 0 and proc.stdout.strip():
                            diff_data = {'diff_text': proc.stdout, 'added': 14, 'removed': 14}
                    except Exception:
                        pass
                    self._send(200, {
                        'path': rel_path,
                        'name': target.name,
                        'content': content,
                        'size': len(content.encode('utf-8')),
                        'lines': len(content.splitlines()),
                        'type': 'markdown' if target.suffix.lower() == '.md' else target.suffix.lstrip('.'),
                        'diff': diff_data,
                    })
                except Exception as exc:
                    self._send(500, {'error': {'message': str(exc)}})
                return
            if self.path in ('/api/web/workspace/projects', '/api/agent/workspace/projects',
                             '/api/web/workspace/tasks', '/api/agent/workspace/tasks'):
                principal = self._principal('agent' if self.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    if self.path.endswith('/projects'):
                        self._send(200, {'projects': workspace.list_projects(principal)})
                    else:
                        self._send(200, {'tasks': workspace.list_tasks(principal)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if self.path in ('/api/chat/history', '/api/chat/memory', '/api/agent/history', '/api/agent/memory'):
                principal = self._principal('agent' if self.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    if self.path.endswith('/history'):
                        self._send(200, {'entries': memory.history(principal)})
                    else:
                        self._send(200, {'notes': memory.notes(principal)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if self.path == '/api/admin/providers':
                if not self._node_channel():
                    return
                principal = self._principal()
                if principal is None:
                    return
                try:
                    self._send(200, {'providers': providers.list(principal)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if self.path == "/api/admin/nodes/model-pulls":
                if not self._node_channel():
                    return
                principal = self._principal()
                if principal is None:
                    return
                try:
                    self._send(200, {"jobs": nodes.list_model_pulls(principal)})
                except IdentityError as exc:
                    self._send(exc.status, {"error": {"message": str(exc)}})
                return
            if self.path == "/api/admin/nodes":
                if not self._node_channel():
                    return
                principal = self._principal()
                if principal is None:
                    return
                try:
                    self._send(200, {"nodes": nodes.list_nodes(principal)})
                except IdentityError as exc:
                    self._send(exc.status, {"error": {"message": str(exc)}})
                return
            if self._static():
                return
            if self.path == "/health":
                self._send(200, {"status": "up", "mode": "local-development"})
                return
            if self.path in ('/api/agent/models', '/api/web/models'):
                principal = self._principal('agent' if self.path == '/api/agent/models' else 'web')
                if principal is None:
                    return
                if "chat" not in principal["capabilities"]:
                    self._send(403, {"error": {"message": "Profile has no chat permission"}})
                    return
                try:
                    models = list(self._available_models(current_ollama()))
                except OllamaError as exc:
                    if self.path == '/api/agent/models':
                        self._send(503, {"error": {"message": str(exc)}})
                        return
                    models = []
                if self.path == '/api/web/models' and isinstance(self.connection, ssl.SSLSocket) and providers:
                    models.extend(providers.chat_models(principal))
                if not models:
                    self._send(503, {"error": {"message": "No chat model available"}})
                else:
                    self._send(200, {"models": models})
                return
            if self.path == "/api/admin/operations":
                principal = self._principal()
                if principal is None:
                    return
                if principal["role"] != "superadmin":
                    self._send(403, {"error": {"message": "Superadmin access required"}})
                    return
                client = current_ollama()
                checked_at = int(time.time())
                started = time.monotonic()
                try:
                    models = client.list_models()
                    model_list = [{"id": f"ollama/{entry.name}", "size_bytes": entry.size_bytes} for entry in models]
                    worker_status = "up" if model_list else "no_models"
                    latency_ms = round((time.monotonic() - started) * 1000)
                except OllamaError:
                    model_list = []
                    worker_status = "unreachable"
                    latency_ms = None
                self._send(200, {"master": "up", "ollama": {
                    "url": client.base_url, "status": worker_status, "models": model_list,
                }, "nodes": [
                    {"id": "master", "kind": "master", "status": "up", "checked_at": checked_at},
                    {"id": "ollama-worker", "kind": "worker", "status": worker_status,
                     "checked_at": checked_at, "latency_ms": latency_ms, "models": model_list},
                ]})
                return
            if self.path in {"/api/auth/me", "/api/admin/pending", "/api/admin/pending/count"}:
                principal = self._principal()
                if principal is None:
                    return
                if self.path == "/api/auth/me":
                    self._send(200, {"user": {k: v for k, v in principal.items() if k not in {"jti", "device_id"}}})
                    return
                try:
                    pending = identity_store.pending(principal)
                    self._send(200, {"count": len(pending)} if self.path.endswith("/count") else {"users": pending})
                except IdentityError as exc:
                    self._send(exc.status, {"error": {"message": str(exc)}})
                return
            if self.path != "/v1/models":
                self._send(404, {"error": {"message": "Route not found"}})
                return
            if not self._authorized():
                return
            try:
                models = self._available_models(current_ollama())
            except OllamaError as exc:
                self._send(503, {"error": {"message": str(exc)}})
                return
            self._send(
                200,
                {"object": "list", "data": [{"id": key, "object": "model", "owned_by": "ollama"} for key in models]},
            )

        def do_POST(self):
            if self.path.startswith("/api/nodes/") or self.path.startswith("/api/admin/nodes/"):
                self._node_post()
                return
            if self.path.startswith("/api/"):
                self._identity_post()
                return
            if self.path != "/v1/chat/completions":
                self._send(404, {"error": {"message": "Route not found"}})
                return
            if not self._authorized():
                return
            request = self._body()
            if request is None:
                return
            if request.get("stream", False) is not False:
                self._send(400, {"error": {"message": "Only non-streaming chat is supported in this slice"}})
                return
            model = request.get("model")
            if not isinstance(model, str):
                self._send(400, {"error": {"message": "Model ID required"}})
                return
            try:
                client = current_ollama()
                available = self._available_models(client)
                selected = available.get(model)
                if selected is None:
                    self._send(404, {"error": {"message": "Requested local model is not installed"}})
                    return
                content = client.chat(selected, request.get("messages"))
            except ValueError as exc:
                self._send(400, {"error": {"message": str(exc)}})
                return
            except OllamaError as exc:
                self._send(503, {"error": {"message": str(exc)}})
                return
            self._send(
                200,
                {
                    "id": f"chatcmpl-{uuid.uuid4().hex}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
                },
            )

    return ThreadingHTTPServer((host, port), Handler)


def main():
    api_key = os.environ.get("OMNIOPS_API_KEY", "")
    port = int(os.environ.get("OMNIOPS_PORT", "9000"))
    host = os.environ.get("OMNIOPS_BIND_HOST", "127.0.0.1")
    ollama_url = os.environ.get("OMNIOPS_OLLAMA_URL", "http://127.0.0.1:11434")
    signing_key = os.environ.get("OMNIOPS_SIGNING_KEY", "").encode()
    if len(signing_key) < 32:
        raise ValueError("Set a unique OMNIOPS_SIGNING_KEY of at least 32 characters")
    data_path = Path(os.environ.get("OMNIOPS_DB_PATH", "data/identity.db"))
    data_path.parent.mkdir(parents=True, exist_ok=True)
    identity = IdentityStore(data_path, signing_key)
    if not identity.has_active_admin():
        raise SystemExit("Hesab-e SuperAdmin sakhte nashodeh; aval python3 -m omniops.bootstrap ra ejra konid.")
    web_dist = Path(__file__).resolve().parents[1] / "web" / "app" / "dist"
    with make_server(host, port, api_key, ollama_url, identity, web_dist if web_dist.is_dir() else None) as server:
        cert = os.environ.get("OMNIOPS_TLS_CERT")
        key = os.environ.get("OMNIOPS_TLS_KEY")
        if bool(cert) != bool(key):
            raise ValueError("Set both OMNIOPS_TLS_CERT and OMNIOPS_TLS_KEY")
        if cert:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_3
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
        print(f"OmniOps gateway listening on {'https' if cert else 'http'}://{host}:{server.server_port}/v1")
        server.serve_forever()


if __name__ == "__main__":
    main()
