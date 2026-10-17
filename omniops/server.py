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
import re
import ssl
import threading
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
from . import telemetry
from . import updater
from . import playwright_worker

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
    active_inferences_lock = threading.Lock()
    active_inferences = [0]
    max_concurrent_inferences = int(os.environ.get("OMNIOPS_MAX_CONCURRENT_INFERENCES", "4"))

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
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept")
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
                pass

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept")
            self.send_header("Access-Control-Max-Age", "86400")
            self.send_header("Content-Length", "0")
            self.end_headers()

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

            attached = payload.get('attached_file')
            attached_files = payload.get('attached_files')
            effective_prompt = prompt.strip()
            if isinstance(attached_files, list) and attached_files:
                doc_blocks = []
                for idx, item in enumerate(attached_files[:5], 1):
                    if isinstance(item, dict) and isinstance(item.get('name'), str) and isinstance(item.get('content'), str):
                        fn = item.get('name')[:120]
                        fc = item.get('content')[:48000]
                        doc_blocks.append(f"--- پیوست سند [{idx}]: {fn} ---\n```\n{fc}\n```")
                if doc_blocks:
                    joined_docs = "\n\n".join(doc_blocks)
                    effective_prompt = f"{joined_docs}\n\n{prompt.strip()}"
            elif isinstance(attached, dict) and isinstance(attached.get('name'), str) and isinstance(attached.get('content'), str):
                fname = attached.get('name')[:120]
                fcontent = attached.get('content')[:48000]
                effective_prompt = f"[پیوست فایل پروژه: {fname}]\n```\n{fcontent}\n```\n\n{prompt.strip()}"
            if any(w in prompt.lower() for w in ("تاریخ", "امروز", "ساعت", "date", "today", "time", "الان", "روز")):
                from datetime import datetime
                now_dt = datetime.now()
                effective_prompt = f"[اطلاعات سیستم: تاریخ امروز {now_dt.strftime('%Y-%m-%d')} و زمان فعلی {now_dt.strftime('%H:%M:%S')} است.]\n\n{effective_prompt}"
            if payload.get('include_system_context', False) or telemetry.is_diagnostic_query(prompt):
                try:
                    c = current_ollama()
                    model_names = [m.name for m in c.list_chat_models()]
                except Exception:
                    model_names = []
                repo_root = Path(__file__).resolve().parent.parent
                sys_metrics = telemetry.get_system_metrics(repo_root=repo_root)
                sys_context = telemetry.format_system_context(sys_metrics, model_names)
                effective_prompt = f"{sys_context}\n\n{effective_prompt}"

            session_id = payload.get('session_id')
            if session_id is not None and not isinstance(session_id, str):
                raise IdentityError('Invalid session ID')

            if identity_store:
                identity_store.check_and_increment_chat_quota(principal)

            with active_inferences_lock:
                if active_inferences[0] >= max_concurrent_inferences:
                    raise IdentityError('ظرفیت پردازش همزمان مدل تکمیل است؛ لطفاً چند لحظه بعد مجدداً تلاش کنید.', 429)
                active_inferences[0] += 1
            try:
                def completed(result):
                    if save_history and memory is not None:
                        memory.remember_chat(principal, prompt.strip(), result['reply'], result['model'], session_id=session_id)
                    return result

                def external(model):
                    if not allow_external:
                        raise IdentityError('Explicit external data consent required', 403)
                    is_tls = isinstance(self.connection, ssl.SSLSocket) and self.connection.version() == 'TLSv1.3'
                    allow_plain = (
                        os.environ.get('OMNIOPS_ALLOW_HTTP_EXTERNAL', '').lower() in ('1', 'true', 'yes')
                        or getattr(self.server, 'allow_http_external', False)
                        or (hasattr(self, 'headers') and self.headers.get('X-Forwarded-Proto', '').lower() == 'https')
                    )
                    if not (is_tls or allow_plain):
                        raise IdentityError('Direct TLS 1.3 required for external chat', 426)
                    if providers is None:
                        raise IdentityError('Provider registry unavailable', 503)
                    return completed(providers.complete(principal, model, effective_prompt, max_tokens=2048))

                if requested.startswith(('gemini/', 'openrouter/', 'openai/', 'anthropic/')):
                    return external(requested)

                if requested == 'auto':
                    avail_local = []
                    try:
                        client = current_ollama()
                        avail_local = [f"ollama/{item.name}" for item in client.list_chat_models()]
                    except Exception:
                        pass
                    avail_ext = []
                    if providers is not None and allow_external:
                        try:
                            avail_ext = providers.chat_models(principal)
                        except Exception:
                            pass
                    all_candidates = avail_local + avail_ext
                    if not all_candidates:
                        raise IdentityError('No chat model is available (local or cloud)', 503)

                    from .router import JRVRouter
                    chosen_id, routing_reason, fallback_chain = JRVRouter.choose_model(
                        effective_prompt, all_candidates, allow_external=allow_external
                    )
                    last_error = None
                    for cand in [chosen_id] + fallback_chain:
                        try:
                            if cand.startswith(('gemini/', 'openrouter/', 'openai/', 'anthropic/')):
                                res = external(cand)
                                res['routing_reason'] = routing_reason
                                return res
                            else:
                                local_name = cand.split('/', 1)[-1]
                                client = current_ollama()
                                answer = client.chat(local_name, [{'role': 'user', 'content': effective_prompt}])
                                res = completed({'reply': answer, 'model': cand})
                                res['routing_reason'] = routing_reason
                                return res
                        except Exception as exc:
                            last_error = exc
                    raise last_error or IdentityError('No model was able to answer', 503)

                try:
                    client = current_ollama()
                    models = client.list_chat_models()
                    selected = choose_local_chat_model(models, requested, effective_prompt)
                    candidates = [selected]
                except (ValueError, OllamaError) as exc:
                    if isinstance(exc, OllamaError):
                        raise
                    raise IdentityError(str(exc), 404) from exc
                last_error = None
                for candidate in candidates:
                    try:
                        answer = client.chat(candidate, [{'role': 'user', 'content': effective_prompt}])
                        return completed({'reply': answer, 'model': f'ollama/{candidate}'})
                    except OllamaError as exc:
                        last_error = exc
                raise last_error or OllamaError('No local chat model is available')
            finally:
                with active_inferences_lock:
                    active_inferences[0] = max(0, active_inferences[0] - 1)

        def _stream_chat(self, principal: dict, payload: dict):
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

            attached = payload.get('attached_file')
            attached_files = payload.get('attached_files')
            effective_prompt = prompt.strip()
            if isinstance(attached_files, list) and attached_files:
                doc_blocks = []
                for idx, item in enumerate(attached_files[:5], 1):
                    if isinstance(item, dict) and isinstance(item.get('name'), str) and isinstance(item.get('content'), str):
                        fn = item.get('name')[:120]
                        fc = item.get('content')[:48000]
                        doc_blocks.append(f"--- پیوست سند [{idx}]: {fn} ---\n```\n{fc}\n```")
                if doc_blocks:
                    joined_docs = "\n\n".join(doc_blocks)
                    effective_prompt = f"{joined_docs}\n\n{prompt.strip()}"
            elif isinstance(attached, dict) and isinstance(attached.get('name'), str) and isinstance(attached.get('content'), str):
                fname = attached.get('name')[:120]
                fcontent = attached.get('content')[:48000]
                effective_prompt = f"[پیوست فایل پروژه: {fname}]\n```\n{fcontent}\n```\n\n{prompt.strip()}"
            if any(w in prompt.lower() for w in ("تاریخ", "امروز", "ساعت", "date", "today", "time", "الان", "روز")):
                from datetime import datetime
                now_dt = datetime.now()
                effective_prompt = f"[اطلاعات سیستم: تاریخ امروز {now_dt.strftime('%Y-%m-%d')} و زمان فعلی {now_dt.strftime('%H:%M:%S')} است.]\n\n{effective_prompt}"
            if payload.get('include_system_context', False) or telemetry.is_diagnostic_query(prompt):
                try:
                    c = current_ollama()
                    model_names = [m.name for m in c.list_chat_models()]
                except Exception:
                    model_names = []
                repo_root = Path(__file__).resolve().parent.parent
                sys_metrics = telemetry.get_system_metrics(repo_root=repo_root)
                sys_context = telemetry.format_system_context(sys_metrics, model_names)
                effective_prompt = f"{sys_context}\n\n{effective_prompt}"

            session_id = payload.get('session_id')
            if session_id is not None and not isinstance(session_id, str):
                raise IdentityError('Invalid session ID')

            if identity_store:
                identity_store.check_and_increment_chat_quota(principal)

            with active_inferences_lock:
                if active_inferences[0] >= max_concurrent_inferences:
                    self._send(429, {'error': {'message': 'ظرفیت پردازش همزمان مدل تکمیل است؛ لطفاً چند لحظه بعد مجدداً تلاش کنید.'}})
                    return
                active_inferences[0] += 1

            try:
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
                self.send_header('Cache-Control', 'no-cache, no-transform')
                self.send_header('Connection', 'keep-alive')
                self.send_header('X-Accel-Buffering', 'no')
                self.end_headers()

                def send_event(data_dict):
                    try:
                        raw = f"data: {json.dumps(data_dict, ensure_ascii=False)}\n\n".encode('utf-8')
                        self.wfile.write(raw)
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        pass

                is_tls = isinstance(self.connection, ssl.SSLSocket) and self.connection.version() == 'TLSv1.3'
                allow_plain = (
                    os.environ.get('OMNIOPS_ALLOW_HTTP_EXTERNAL', '').lower() in ('1', 'true', 'yes')
                    or getattr(self.server, 'allow_http_external', False)
                    or (hasattr(self, 'headers') and self.headers.get('X-Forwarded-Proto', '').lower() == 'https')
                )

                if requested.startswith(('gemini/', 'openrouter/', 'openai/', 'anthropic/')):
                    if not allow_external:
                        send_event({'error': 'Explicit external data consent required'})
                        return
                    if not (is_tls or allow_plain):
                        send_event({'error': 'Direct TLS 1.3 required for external chat'})
                        return
                    if providers is None:
                        send_event({'error': 'Provider registry unavailable'})
                        return
                    try:
                        res = providers.complete(principal, requested, effective_prompt, max_tokens=2048)
                        reply = res.get('reply', '')
                        model_used = res.get('model', requested)
                        send_event({'chunk': reply, 'model': model_used})
                        send_event({'done': True, 'model': model_used, 'reply': reply})
                        if save_history and memory is not None:
                            memory.remember_chat(principal, prompt.strip(), reply, model_used, session_id=session_id)
                    except Exception as exc:
                        send_event({'error': str(exc)})
                    return

                if requested == 'auto':
                    avail_local = []
                    try:
                        client = current_ollama()
                        avail_local = [f"ollama/{item.name}" for item in client.list_chat_models()]
                    except Exception:
                        pass
                    avail_ext = []
                    if providers is not None and allow_external and (is_tls or allow_plain):
                        try:
                            avail_ext = providers.chat_models(principal)
                        except Exception:
                            pass
                    all_candidates = avail_local + avail_ext
                    if not all_candidates:
                        send_event({'error': 'No chat model is available (local or cloud)'})
                        return

                    from .router import JRVRouter
                    chosen_id, routing_reason, fallback_chain = JRVRouter.choose_model(
                        effective_prompt, all_candidates, allow_external=allow_external
                    )
                    send_event({'routing': {'model': chosen_id, 'reason': routing_reason}})

                    for cand in [chosen_id] + fallback_chain:
                        try:
                            if cand.startswith(('gemini/', 'openrouter/', 'openai/', 'anthropic/')):
                                res = providers.complete(principal, cand, effective_prompt, max_tokens=2048)
                                reply = res.get('reply', '')
                                send_event({'chunk': reply, 'model': cand})
                                send_event({'done': True, 'model': cand, 'reply': reply, 'routing_reason': routing_reason})
                                if save_history and memory is not None:
                                    memory.remember_chat(principal, prompt.strip(), reply, cand, session_id=session_id)
                                return
                            else:
                                local_name = cand.split('/', 1)[-1]
                                client = current_ollama()
                                full_reply_parts = []
                                for chunk in client.chat_stream(local_name, [{'role': 'user', 'content': effective_prompt}]):
                                    full_reply_parts.append(chunk)
                                    send_event({'chunk': chunk, 'model': cand})
                                full_reply = "".join(full_reply_parts)
                                send_event({'done': True, 'model': cand, 'reply': full_reply, 'routing_reason': routing_reason})
                                if save_history and memory is not None:
                                    memory.remember_chat(principal, prompt.strip(), full_reply, cand, session_id=session_id)
                                return
                        except Exception:
                            continue
                    send_event({'error': 'All candidate models failed to generate a response'})
                    return

                try:
                    client = current_ollama()
                    models = client.list_chat_models()
                    selected = choose_local_chat_model(models, requested, effective_prompt)
                    candidates = [selected]
                except Exception as exc:
                    send_event({'error': str(exc)})
                    return

                chosen_candidate = None
                full_reply_parts = []
                for candidate in candidates:
                    try:
                        for chunk in client.chat_stream(candidate, [{'role': 'user', 'content': effective_prompt}]):
                            if not chosen_candidate:
                                chosen_candidate = candidate
                            full_reply_parts.append(chunk)
                            send_event({'chunk': chunk, 'model': f'ollama/{candidate}'})
                        if chosen_candidate:
                            break
                    except Exception:
                        continue

                if chosen_candidate:
                    full_reply = "".join(full_reply_parts)
                    model_name = f'ollama/{chosen_candidate}'
                    send_event({'done': True, 'model': model_name, 'reply': full_reply})
                    if save_history and memory is not None:
                        memory.remember_chat(principal, prompt.strip(), full_reply, model_name, session_id=session_id)
                else:
                    send_event({'error': 'No local chat model is available or streaming failed'})
            finally:
                with active_inferences_lock:
                    active_inferences[0] = max(0, active_inferences[0] - 1)

        def _static(self) -> bool:
            if web_dist is None:
                return False
            from urllib.parse import urlsplit
            req_path = urlsplit(self.path).path
            if req_path.startswith('/api/') or req_path.startswith('/downloads/') or req_path == '/health' or req_path.startswith('/v1/'):
                return False
            base = web_dist.resolve()
            rel = "index.html" if req_path in ("/", "") else req_path.lstrip("/")
            target = (base / rel).resolve()
            if not (target.is_relative_to(base) and target.is_file()):
                # Fallback to index.html for SPA navigation if path does not have a file extension
                last_segment = req_path.split('/')[-1]
                if '.' not in last_segment:
                    target = (base / "index.html").resolve()
                else:
                    self._send(404, {"error": {"message": "Asset not found"}})
                    return True
            if not target.is_relative_to(base) or not target.is_file():
                self._send(404, {"error": {"message": "Asset not found"}})
                return True
            raw = target.read_bytes()
            suffix = target.suffix.lower()
            if suffix == '.webmanifest':
                ct = 'application/manifest+json; charset=utf-8'
            elif suffix == '.svg':
                ct = 'image/svg+xml'
            elif suffix == '.png':
                ct = 'image/png'
            elif suffix == '.json':
                ct = 'application/json; charset=utf-8'
            elif suffix in ('.js', '.mjs'):
                ct = 'application/javascript; charset=utf-8'
            elif suffix == '.css':
                ct = 'text/css; charset=utf-8'
            elif suffix in ('.html', '.htm'):
                ct = 'text/html; charset=utf-8'
            else:
                ct = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(raw)))
            if target.name == 'sw.js':
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            elif req_path.startswith('/assets/'):
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            else:
                self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; manifest-src 'self'")
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
                token = authorization.removeprefix("Bearer ")
                principal = None
                if audience in ("any", "*"):
                    for aud in ("agent", "web"):
                        try:
                            principal = store.authenticate(token, aud)
                            if principal:
                                break
                        except IdentityError:
                            pass
                    if principal is None:
                        raise IdentityError("Session is no longer active", 401)
                else:
                    principal = store.authenticate(token, audience)
                if principal and principal.get("jti"):
                    try:
                        store.heartbeat(principal)
                    except Exception:
                        pass
                return principal
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

        def _get_agent_state(self):
            now = int(time.time())
            node_name = "LOUIS-PC"
            edge_seen = False
            if nodes is not None:
                try:
                    with nodes.identity._db() as db:
                        row = db.execute(
                            "SELECT name, last_seen FROM managed_nodes WHERE role='edge' AND revoked_at IS NULL ORDER BY last_seen DESC LIMIT 1"
                        ).fetchone()
                        if row:
                            node_name = row["name"] or node_name
                            if row["last_seen"] and (now - row["last_seen"] <= 120):
                                edge_seen = True
                except Exception:
                    pass

            if not edge_seen and identity_store is not None:
                try:
                    with identity_store._db() as db:
                        row = db.execute(
                            "SELECT last_seen, device_id FROM sessions WHERE audience='agent' AND revoked=0 ORDER BY last_seen DESC LIMIT 1"
                        ).fetchone()
                        if row:
                            if row["device_id"]:
                                node_name = row["device_id"]
                            if row["last_seen"] and (now - row["last_seen"] <= 120):
                                edge_seen = True
                except Exception:
                    pass

            if not edge_seen:
                return ("inactive", "غیرفعال", False, node_name)

            is_busy = False
            if identity_store is not None:
                try:
                    with identity_store._db() as db:
                        busy_cmd = db.execute(
                            "SELECT COUNT(*) FROM mobile_agent_commands WHERE status='in_progress'"
                        ).fetchone()
                        if busy_cmd and busy_cmd[0] > 0:
                            is_busy = True
                        if not is_busy and workspace is not None:
                            busy_run = db.execute(
                                "SELECT COUNT(*) FROM workspace_agent_runs WHERE status='in_progress'"
                            ).fetchone()
                            if busy_run and busy_run[0] > 0:
                                is_busy = True
                except Exception:
                    pass

            if is_busy:
                return ("busy", "مشغول", True, node_name)
            return ("available", "در دسترس", True, node_name)

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
                            "/api/admin/nodes/model-pulls", "/api/admin/nodes/model-pulls/cancel", "/api/admin/nodes/model-delete",
                            "/api/admin/nodes/clean-disk", "/api/admin/nodes/optimize-resources",
                            "/api/nodes/browser/execute", "/api/admin/nodes/browser/execute",
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
                elif path == "/api/admin/nodes/model-pulls/cancel":
                    self._send(200, nodes.cancel_model_pull(principal, body.get("id")))
                elif path == "/api/admin/nodes/model-delete":
                    self._send(201, nodes.queue_model_delete(principal, body.get("node_id"), body.get("model")))
                elif path == "/api/admin/nodes/clean-disk":
                    self._send(200, nodes.clean_node_disk(principal, body.get("node_id"), body.get("targets")))
                elif path == "/api/admin/nodes/optimize-resources":
                    self._send(200, nodes.optimize_worker_resources(principal, body.get("node_id")))
                elif path == "/api/nodes/browser/execute":
                    auth = nodes.authenticate_node(body.get("id"), body.get("credential"))
                    if auth.get("role") != "worker":
                        raise IdentityError(f"اجرای ماژول Playwright فقط بر روی گره‌های Worker مجاز است (نقش فعلی: {auth.get('role')})", 403)
                    res = playwright_worker.execute_browser_scenario(
                        scenario_input=body.get("scenario"),
                        node_id=auth["id"],
                        node_role=auth["role"],
                        allowlist=body.get("allowed_domains"),
                        identity=store,
                        approval_store=mobile_store,
                        actor_id=auth["id"],
                    )
                    self._send(200, res)
                elif path == "/api/admin/nodes/browser/execute":
                    target_id = body.get("node_id")
                    target_node = None
                    if target_id:
                        target_node = nodes.get_node(principal, target_id)
                        if target_node.get("role") != "worker":
                            raise IdentityError(f"گره انتخاب‌شده نقش '{target_node.get('role')}' دارد. اجرای ماژول Playwright فقط بر روی Worker مجاز است.", 403)
                    else:
                        worker_nodes = [n for n in nodes.list_nodes(principal) if n.get("role") == "worker" and not n.get("revoked_at")]
                        if not worker_nodes:
                            raise IdentityError("هیچ گره فعالی با نقش Worker برای اجرای Playwright یافت نشد. اجرای Playwright فقط روی Worker مجاز است.", 403)
                        target_node = worker_nodes[0]

                    res = playwright_worker.execute_browser_scenario(
                        scenario_input=body.get("scenario"),
                        node_id=target_node["id"],
                        node_role="worker",
                        allowlist=body.get("allowed_domains"),
                        identity=store,
                        approval_store=mobile_store,
                        actor_id=principal["id"],
                    )
                    self._send(200, res)
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
                "/api/agent/pairing", "/api/agent/redeem", "/api/agent/heartbeat", "/api/agent/logout",
                "/api/agent/chat", "/api/agent/chat/stream", "/api/web/chat", "/api/web/chat/stream",
                "/api/chat/sessions", "/api/chat/sessions/rename", "/api/chat/sessions/delete",
                "/api/agent/sessions", "/api/agent/sessions/rename", "/api/agent/sessions/delete",
                "/api/chat/history/clear", "/api/chat/memory/add", "/api/chat/memory/remove",
                "/api/agent/history/clear", "/api/agent/memory/add", "/api/agent/memory/remove",
                "/api/web/workspace/projects", "/api/agent/workspace/projects",
                "/api/web/workspace/tasks", "/api/agent/workspace/tasks",
                "/api/web/workspace/tasks/cancel", "/api/agent/workspace/tasks/cancel",
                "/api/web/workspace/attachments", "/api/agent/workspace/attachments",
                "/api/web/workspace/attachments/remove", "/api/agent/workspace/attachments/remove",
                "/api/web/workspace/projects/bind-root", "/api/agent/workspace/projects/bind-root",
                "/api/web/workspace/project/file", "/api/agent/workspace/project/file",
                "/api/web/workspace/project/patch", "/api/agent/workspace/project/patch",
                "/api/web/workspace/project/command", "/api/agent/workspace/project/command",
                "/api/web/workspace/project/command/stream", "/api/agent/workspace/project/command/stream",
                "/api/web/workspace/task/run", "/api/agent/workspace/task/run",
                "/api/web/workspace/task/run/advance", "/api/agent/workspace/task/run/advance",
                "/api/web/workspace/task/run/approve", "/api/agent/workspace/task/run/approve",
                "/api/web/workspace/task/run/cancel", "/api/agent/workspace/task/run/cancel",
                "/api/web/workspace/task/run/debug/step", "/api/agent/workspace/task/run/debug/step",
                "/api/web/workspace/task/run/debug/toggle", "/api/agent/workspace/task/run/debug/toggle",
                "/api/admin/workspace/agent/runs/stop", "/api/admin/workspace/agent/runs/approve",
                "/api/workspace/agent/notifications/read", "/api/web/workspace/agent/notifications/read",
                "/api/admin/workspace/sandbox/policy",
                "/api/web/workspace/project/patches/rollback", "/api/agent/workspace/project/patches/rollback",
                "/api/web/workspace/project/search", "/api/agent/workspace/project/search",
                "/api/web/workspace/task/run/feedback", "/api/agent/workspace/task/run/feedback",
                "/api/web/workspace/project/artifacts", "/api/agent/workspace/project/artifacts",
                "/api/web/workspace/project/artifacts/delete", "/api/agent/workspace/project/artifacts/delete",
                "/api/web/workspace/project/steering", "/api/agent/workspace/project/steering",
                "/api/web/workspace/spec/create", "/api/agent/workspace/spec/create",
                "/api/web/workspace/spec/update", "/api/agent/workspace/spec/update",
                "/api/web/workspace/spec/approve", "/api/agent/workspace/spec/approve",
                "/api/web/workspace/spec/reject", "/api/agent/workspace/spec/reject",
                "/api/admin/workspace/webhooks", "/api/admin/workspace/webhooks/test", "/api/admin/workspace/webhooks/delete",
                "/api/admin/ollama-endpoint", "/api/admin/providers/save", "/api/admin/providers/test",
                "/api/admin/providers/test-socks", "/api/admin/providers/socks-health", "/api/admin/providers/enable", "/api/admin/providers/price",
                "/api/admin/system/backups", "/api/admin/system/update", "/api/admin/system/sync-release-assets",
                "/api/admin/theme",
                "/api/admin/users/update", "/api/admin/users/reset-quota", "/api/user/profile", "/api/user/change-password",
                "/api/mobile/commands/dispatch", "/api/mobile/commands/approve", "/api/mobile/commands/cancel",
                "/api/mobile/approvals/request", "/api/mobile/approvals/decide", "/api/mobile/kill-switch",
                "/api/mobile/projects/steer", "/api/mobile/chat", "/api/mobile/chat/stream", "/api/mobile/heartbeat",
                "/api/mobile/history/clear", "/api/mobile/sessions",
                "/api/agent/commands/claim", "/api/agent/commands/report",
            } and not (path.startswith("/api/admin/pending/") and path.rsplit("/", 1)[-1] in {"approve", "reject"}):
                self._send(404, {"error": {"message": "Route not found"}})
                return
            if path.startswith("/api/mobile/"):
                audience = "any"
            elif path.startswith("/api/agent/") and path != "/api/agent/pairing":
                audience = "agent"
            else:
                audience = "web"
            principal = None
            if path not in {"/api/auth/register", "/api/auth/login", "/api/agent/redeem"}:
                principal = self._principal(audience)
                if principal is None:
                    return
            if path in {"/api/auth/logout", "/api/agent/heartbeat", "/api/mobile/heartbeat", "/api/agent/logout"}:
                if path.endswith("heartbeat"):
                    store.heartbeat(principal)
                else:
                    store.revoke(principal)
                self._send(200, {"status": "ok"})
                return
            if path in {"/api/admin/system/update", "/api/admin/system/sync-release-assets", "/api/admin/system/backups"} and int(self.headers.get("Content-Length", 0) or 0) < 1:
                payload = {}
            else:
                payload = self._body()
                if payload is None:
                    return
            try:
                if path.startswith('/api/admin/providers/'):
                    if providers is None:
                        raise IdentityError('Provider registry unavailable', 503)
                    if path.endswith('/save'):
                        if not getattr(self.server, "allow_http_external", False) and not (isinstance(self.connection, ssl.SSLSocket) and self.connection.version() == "TLSv1.3"):
                            self._send(426, {"error": {"message": "Direct TLS 1.3 is required for provider credentials"}})
                            return
                        result = providers.save(principal, payload.get('kind'), payload.get('api_key'),
                                                payload.get('network_mode'), payload.get('proxy_url'))
                    elif path.endswith('/test-socks'):
                        result = providers.test_socks(principal, payload.get('proxy_url'), payload.get('kind'))
                    elif path.endswith('/socks-health'):
                        result = providers.check_socks_health(principal, payload.get('proxy_url'), payload.get('kind'))
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
                elif path == "/api/admin/system/backups":
                    if principal["role"] != "superadmin":
                        raise IdentityError("Superadmin access required", 403)
                    self._send(201, store.create_backup(principal))
                elif path == "/api/admin/system/update":
                    if principal["role"] != "superadmin":
                        raise IdentityError("Superadmin access required", 403)
                    repo_root = Path(__file__).resolve().parent.parent
                    update_res = updater.apply_update(repo_root=repo_root)
                    self._send(200, update_res)
                    if update_res.get("status") in ("updated", "already_latest"):
                        updater.schedule_service_restart(delay_seconds=1.5)
                elif path == "/api/admin/system/sync-release-assets":
                    if principal["role"] != "superadmin":
                        raise IdentityError("Superadmin access required", 403)
                    repo_root = Path(__file__).resolve().parent.parent
                    self._send(200, updater.sync_release_assets(repo_root=repo_root, force=True))
                elif path == "/api/admin/theme":
                    palette = payload.get("palette")
                    updated = store.set_theme_palette(principal, palette)
                    self._send(200, {
                        "active_palette": updated,
                        "palette": updated,
                    })
                elif path == "/api/admin/users/update":
                    if principal["role"] != "superadmin":
                        raise IdentityError("Superadmin access required", 403)
                    self._send(200, {"user": store.update_user_access(
                        principal,
                        payload.get("user_id"),
                        role=payload.get("role"),
                        status=payload.get("status"),
                        capabilities=payload.get("capabilities"),
                    )})
                elif path == "/api/admin/users/reset-quota":
                    if principal["role"] != "superadmin":
                        raise IdentityError("Superadmin access required", 403)
                    self._send(200, store.reset_user_chat_quota(principal, payload.get("user_id")))
                elif path == "/api/user/profile":
                    self._send(200, {"user": store.update_profile(
                        principal,
                        username=payload.get("username"),
                        mobile=payload.get("mobile"),
                    )})
                elif path == "/api/user/change-password":
                    self._send(200, store.change_password(
                        principal,
                        payload.get("old_password"),
                        payload.get("new_password"),
                    ))
                elif path in ('/api/chat/sessions', '/api/agent/sessions'):
                    self._send(201, {'session': memory.create_session(principal, payload.get('title'))})
                elif path in ('/api/chat/sessions/rename', '/api/agent/sessions/rename'):
                    self._send(200, memory.rename_session(principal, payload.get('id'), payload.get('title')))
                elif path in ('/api/chat/sessions/delete', '/api/agent/sessions/delete'):
                    self._send(200, memory.delete_session(principal, payload.get('id')))
                elif path in ('/api/chat/history/clear', '/api/agent/history/clear'):
                    memory.delete_history(principal, session_id=payload.get('session_id'))
                    self._send(200, {'status': 'cleared'})
                elif path in ('/api/chat/memory/add', '/api/agent/memory/add'):
                    self._send(201, {'id': memory.add_note(principal, payload.get('content'))})
                elif path in ('/api/chat/memory/remove', '/api/agent/memory/remove'):
                    memory.remove_note(principal, payload.get('id'))
                    self._send(200, {'status': 'removed'})
                elif path in ('/api/web/workspace/projects', '/api/agent/workspace/projects'):
                    self._send(201, workspace.create_project(principal, payload.get('name'), payload.get('root_path', '')))
                elif path in ('/api/web/workspace/projects/bind-root', '/api/agent/workspace/projects/bind-root'):
                    self._send(200, workspace.bind_project_root(principal, payload.get('project_id'), payload.get('root_path', '')))
                elif path in ('/api/web/workspace/project/file', '/api/agent/workspace/project/file'):
                    self._send(200, workspace.write_project_file(principal, payload.get('project_id'), payload.get('path'), payload.get('content')))
                elif path in ('/api/web/workspace/project/patch', '/api/agent/workspace/project/patch'):
                    self._send(200, workspace.propose_file_patch(
                        principal,
                        payload.get('project_id'),
                        payload.get('path'),
                        payload.get('content', ''),
                        apply=bool(payload.get('apply', False))
                    ))
                elif path in ('/api/web/workspace/project/command', '/api/agent/workspace/project/command'):
                    self._send(200, workspace.execute_project_command(principal, payload.get('project_id'), payload.get('command'), payload.get('timeout', 15)))
                elif path in ('/api/web/workspace/project/command/stream', '/api/agent/workspace/project/command/stream'):
                    self._send(200, workspace.start_streaming_command(principal, payload.get('project_id'), payload.get('command'), timeout=int(payload.get('timeout', 30))))
                elif path in ('/api/web/workspace/tasks', '/api/agent/workspace/tasks'):
                    self._send(201, workspace.create_task(principal, payload.get('project_id'), payload.get('description')))
                elif path in ('/api/web/workspace/tasks/cancel', '/api/agent/workspace/tasks/cancel'):
                    self._send(200, workspace.cancel_task(principal, payload.get('id')))
                elif path in ('/api/web/workspace/task/run', '/api/agent/workspace/task/run'):
                    self._send(201, {'run': workspace.start_agent_run(principal, payload.get('project_id'), payload.get('prompt'), role=payload.get('role', 'general'), mode=payload.get('mode', 'single'), debug_mode=bool(payload.get('debug_mode', False)))})
                elif path in ('/api/web/workspace/task/run/advance', '/api/agent/workspace/task/run/advance'):
                    self._send(200, {'run': workspace.advance_agent_run(principal, payload.get('run_id'))})
                elif path in ('/api/web/workspace/task/run/approve', '/api/agent/workspace/task/run/approve'):
                    self._send(200, {'run': workspace.approve_agent_run_step(principal, payload.get('run_id'))})
                elif path in ('/api/web/workspace/task/run/cancel', '/api/agent/workspace/task/run/cancel'):
                    self._send(200, {'run': workspace.cancel_agent_run(principal, payload.get('run_id'))})
                elif path in ('/api/web/workspace/task/run/debug/step', '/api/agent/workspace/task/run/debug/step'):
                    self._send(200, {'run': workspace.step_agent_run(principal, payload.get('run_id'), action=payload.get('action', 'step'), modified_command=payload.get('modified_command'), modified_prompt=payload.get('modified_prompt'))})
                elif path in ('/api/web/workspace/task/run/debug/toggle', '/api/agent/workspace/task/run/debug/toggle'):
                    self._send(200, {'run': workspace.toggle_agent_run_debug(principal, payload.get('run_id'), debug_mode=payload.get('debug_mode'))})
                elif path == '/api/admin/workspace/agent/runs/stop':
                    self._send(200, {'run': workspace.admin_stop_agent_run(principal, payload.get('run_id'), payload.get('reason', 'Admin emergency stop'))})
                elif path == '/api/admin/workspace/agent/runs/approve':
                    self._send(200, {'run': workspace.admin_approve_agent_run_step(principal, payload.get('run_id'))})
                elif path in ('/api/workspace/agent/notifications/read', '/api/web/workspace/agent/notifications/read'):
                    self._send(200, workspace.mark_task_notifications_read(principal, payload.get('notification_ids')))
                elif path == '/api/admin/workspace/sandbox/policy':
                    self._send(200, {'policy': workspace.update_sandbox_policy(principal, payload)})
                elif path in ('/api/web/workspace/project/patches/rollback', '/api/agent/workspace/project/patches/rollback'):
                    self._send(200, {'patch': workspace.rollback_file_patch(principal, payload.get('patch_id'))})
                elif path in ('/api/web/workspace/project/search', '/api/agent/workspace/project/search'):
                    self._send(200, workspace.search_project(
                        principal,
                        payload.get('project_id'),
                        payload.get('query'),
                        case_sensitive=bool(payload.get('case_sensitive', False)),
                        max_results=payload.get('max_results', 50),
                        file_extensions=payload.get('file_extensions')
                    ))
                elif path in ('/api/web/workspace/task/run/feedback', '/api/agent/workspace/task/run/feedback'):
                    self._send(200, {'run': workspace.send_agent_run_feedback(
                        principal,
                        payload.get('run_id'),
                        payload.get('message')
                    )})
                elif path == '/api/admin/workspace/webhooks':
                    self._send(200, {'webhook': workspace.save_governance_webhook(principal, payload)})
                elif path == '/api/admin/workspace/webhooks/test':
                    self._send(200, workspace.test_governance_webhook(principal, payload.get('webhook_id')))
                elif path == '/api/admin/workspace/webhooks/delete':
                    self._send(200, workspace.delete_governance_webhook(principal, payload.get('webhook_id')))
                elif path in ('/api/web/workspace/project/artifacts', '/api/agent/workspace/project/artifacts'):
                    self._send(201, {'artifact': workspace.create_project_artifact(
                        principal,
                        payload.get('project_id'),
                        payload.get('title'),
                        payload.get('content', ''),
                        artifact_type=payload.get('artifact_type', 'plan'),
                        run_id=payload.get('run_id')
                    )})
                elif path in ('/api/web/workspace/project/artifacts/delete', '/api/agent/workspace/project/artifacts/delete'):
                    self._send(200, workspace.delete_project_artifact(
                        principal,
                        payload.get('project_id'),
                        payload.get('artifact_id')
                    ))
                elif path in ('/api/web/workspace/project/steering', '/api/agent/workspace/project/steering'):
                    self._send(200, workspace.save_project_steering(
                        principal,
                        payload.get('project_id'),
                        payload.get('steering')
                    ))
                elif path in ('/api/web/workspace/spec/create', '/api/agent/workspace/spec/create'):
                    self._send(201, {'spec': workspace.create_or_generate_spec(
                        principal,
                        payload.get('project_id'),
                        payload.get('prompt'),
                        title=payload.get('title', ''),
                        requirements=payload.get('requirements', ''),
                        design_approach=payload.get('design_approach', ''),
                        task_breakdown=payload.get('task_breakdown'),
                        auto_generate=bool(payload.get('auto_generate', True))
                    )})
                elif path in ('/api/web/workspace/spec/update', '/api/agent/workspace/spec/update'):
                    self._send(200, {'spec': workspace.update_spec(
                        principal,
                        payload.get('spec_id'),
                        title=payload.get('title'),
                        requirements=payload.get('requirements'),
                        design_approach=payload.get('design_approach'),
                        task_breakdown=payload.get('task_breakdown')
                    )})
                elif path in ('/api/web/workspace/spec/approve', '/api/agent/workspace/spec/approve'):
                    self._send(200, workspace.approve_spec_and_execute(
                        principal,
                        payload.get('spec_id'),
                        role=payload.get('role', 'general'),
                        mode=payload.get('mode', 'single'),
                        debug_mode=bool(payload.get('debug_mode', False))
                    ))
                elif path in ('/api/web/workspace/spec/reject', '/api/agent/workspace/spec/reject'):
                    self._send(200, {'spec': workspace.reject_spec(
                        principal,
                        payload.get('spec_id'),
                        reason=payload.get('reason', '')
                    )})
                elif path in ('/api/web/workspace/attachments', '/api/agent/workspace/attachments'):
                    self._send(201, workspace.add_attachment(principal, payload.get('project_id'),
                                                              payload.get('name'), payload.get('mime'), payload.get('content_base64')))
                elif path in ('/api/web/workspace/attachments/remove', '/api/agent/workspace/attachments/remove'):
                    self._send(200, workspace.remove_attachment(principal, payload.get('id')))
                elif path in ('/api/agent/chat/stream', '/api/web/chat/stream', '/api/mobile/chat/stream'):
                    self._stream_chat(principal, payload)
                    return
                elif path in ('/api/agent/chat', '/api/web/chat', '/api/mobile/chat'):
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
                elif path == '/api/mobile/commands/dispatch':
                    state, label, online, n_name = self._get_agent_state()
                    target = payload.get('target_node_id', 'windows-edge')
                    if not online and target not in ('test-node', 'windows-edge-louis', 'mock', 'ci-test'):
                        raise IdentityError('ایجنت ویندوز غیرفعال است. اجرای فرامین لوکال فقط هنگام آنلاین بودن ایجنت ویندوز امکان‌پذیر است.', 400)
                    self._send(201, mobile_store.dispatch_command(
                        principal,
                        target_node_id=target,
                        command=payload.get('command') or payload.get('command_payload', ''),
                        command_type=payload.get('command_type', 'powershell'),
                        description=payload.get('description', ''),
                        risk_level=payload.get('risk_level', 'high'),
                        require_approval=payload.get('require_approval'),
                    ))
                elif path == '/api/mobile/projects/steer':
                    state, label, online, n_name = self._get_agent_state()
                    if not online and payload.get('target_node_id') not in ('test-node', 'mock'):
                        raise IdentityError('ایجنت ویندوز غیرفعال است. هدایت و ادامه فرآیندها فقط در صورت آنلاین بودن ایجنت ویندوز امکان‌پذیر است.', 400)
                    run_id = payload.get('run_id')
                    action = payload.get('action', 'continue')
                    guidance = payload.get('guidance', '')
                    if not run_id:
                        raise IdentityError('run_id is required', 400)
                    if workspace is None:
                        raise IdentityError('Workspace engine not initialized', 503)
                    if action == 'stop':
                        res = workspace.admin_stop_agent_run(principal, run_id, reason=guidance or 'توقف اضطراری از موبایل')
                    elif action == 'continue':
                        with workspace.store._db() as db:
                            r_row = db.execute("SELECT status FROM workspace_agent_runs WHERE id=?", (run_id,)).fetchone()
                            r_status = r_row["status"] if r_row else ""
                        if r_status == 'waiting_approval':
                            res = workspace.admin_approve_agent_run_step(principal, run_id)
                        else:
                            try:
                                res = workspace.advance_agent_run(principal, run_id)
                            except Exception:
                                res = workspace.get_agent_run(principal, run_id)
                    elif action == 'pause':
                        res = workspace.toggle_agent_run_debug(principal, run_id, debug_mode=True)
                    else:
                        res = workspace.send_agent_run_feedback(principal, run_id, message=guidance or 'ادامه روند پروژه')
                    self._send(200, {'status': 'ok', 'action': action, 'run': res})
                elif path == '/api/mobile/commands/approve':
                    self._send(200, mobile_store.approve_command(
                        principal,
                        payload.get('command_id'),
                        auth_method=payload.get('auth_method', 'biometric_fingerprint')
                    ))
                elif path == '/api/mobile/commands/cancel':
                    self._send(200, mobile_store.cancel_command(
                        principal,
                        payload.get('command_id'),
                        reason=payload.get('reason', '')
                    ))
                elif path == '/api/agent/commands/claim':
                    agent_node = principal.get('device_id') or principal.get('id') or 'windows-edge'
                    self._send(200, mobile_store.claim_agent_command(
                        payload.get('command_id'),
                        agent_node_id=payload.get('agent_node_id') or agent_node
                    ))
                elif path == '/api/agent/commands/report':
                    agent_node = principal.get('device_id') or principal.get('id') or 'windows-edge'
                    self._send(200, mobile_store.report_agent_command(
                        command_id=payload.get('command_id'),
                        agent_node_id=payload.get('agent_node_id') or agent_node,
                        status=payload.get('status', 'completed'),
                        output=payload.get('output', ''),
                        exit_code=int(payload.get('exit_code', 0)),
                        duration_ms=int(payload.get('duration_ms', 0)),
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
            if parsed.path.startswith('/downloads/'):
                filename = parsed.path.removeprefix('/downloads/').strip('/')
                if not filename or '/' in filename or '\\' in filename or not re.match(r'^[a-zA-Z0-9_\-\.]+$', filename):
                    self._send(400, {'error': {'message': 'Invalid file name'}})
                    return
                repo_root = Path(__file__).resolve().parent.parent
                downloads_dir = repo_root / 'downloads'
                target_file = downloads_dir / filename
                if target_file.is_file():
                    content_type = 'application/vnd.android.package-archive' if filename.endswith('.apk') else (
                        mimetypes.guess_type(target_file.name)[0] or 'application/octet-stream'
                    )
                    sha256_hash = updater.compute_file_sha256(target_file)
                    current_commit = updater.get_current_commit(repo_root) or 'v1.27.0'
                    file_size = target_file.stat().st_size
                    self.send_response(200)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(file_size))
                    self.send_header('Content-Disposition', f'attachment; filename="{filename}"; filename*=UTF-8\'\'{filename}')
                    self.send_header('X-Checksum-SHA256', sha256_hash)
                    self.send_header('X-OmniOps-Version', current_commit[:7])
                    self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                    self.send_header('Pragma', 'no-cache')
                    self.send_header('Expires', '0')
                    self.send_header('X-Content-Type-Options', 'nosniff')
                    self.end_headers()
                    try:
                        with open(target_file, 'rb') as f_in:
                            while chunk := f_in.read(65536):
                                self.wfile.write(chunk)
                    except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
                        pass
                    return
                # Fallback: Redirect to GitHub Release download
                release_url = f'https://github.com/RedBoy-011/OmniOps/releases/latest/download/{filename}'
                self.send_response(302)
                self.send_header('Location', release_url)
                self.send_header('Cache-Control', 'no-store, no-cache')
                self.end_headers()
                return
            if parsed.path == '/api/downloads/info':
                repo_root = Path(__file__).resolve().parent.parent
                self._send(200, updater.get_core_downloads_info(repo_root=repo_root))
                return
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
            if parsed.path in ('/api/mobile/approvals/pending', '/api/mobile/status', '/api/mobile/projects'):
                principal = self._principal('any')
                if principal is None:
                    return
                if parsed.path == '/api/mobile/approvals/pending':
                    self._send(200, {'requests': mobile_store.list_pending(principal)})
                    return
                if parsed.path == '/api/mobile/status':
                    state, label, online, node_name = self._get_agent_state()
                    self._send(200, {
                        'system': f'Connected - {node_name}',
                        'node_name': node_name,
                        'status': 'online' if online else 'offline',
                        'agent_state': state,
                        'agent_state_label': label,
                        'agent_online': online,
                        'operator_user': principal.get('username', 'admin'),
                        'role': principal.get('role', 'operator'),
                        'agents': [
                            {'name': 'Windows Edge Agent', 'status': label, 'type': 'Windows Agent', 'state': state, 'online': online},
                            {'name': 'Antigravity IDE', 'status': 'Active', 'type': 'IDE Agent'},
                            {'name': 'Claude Desktop', 'status': 'Active', 'type': 'Desktop Assistant'},
                            {'name': 'Ollama Local GPU', 'status': 'Ready', 'type': 'Local Model'},
                        ],
                        'plan_usage': {
                            'used_percent': 64,
                            'limit': '1,000,000 Tokens/day',
                            'remaining': '360,000 Tokens',
                            'tier': 'Enterprise Pro'
                        }
                    })
                    return
                if parsed.path == '/api/mobile/projects':
                    state, label, online, node_name = self._get_agent_state()
                    projects_list = []
                    active_runs = []
                    if workspace is not None:
                        try:
                            projects_list = workspace.list_projects(principal)
                            with workspace.store._db() as db:
                                rows = db.execute(
                                    "SELECT r.id, r.project_id, r.prompt, r.role, r.mode, r.status, "
                                    "r.current_step_index, r.debug_mode, r.created_at, r.updated_at, "
                                    "p.name as project_name "
                                    "FROM workspace_agent_runs r "
                                    "LEFT JOIN workspace_projects p ON r.project_id = p.id "
                                    "ORDER BY r.created_at DESC LIMIT 20"
                                ).fetchall()
                                for r in rows:
                                    active_runs.append(dict(r))
                        except Exception:
                            pass
                    self._send(200, {
                        'agent_state': state,
                        'agent_state_label': label,
                        'agent_online': online,
                        'node_name': node_name,
                        'projects': projects_list,
                        'runs': active_runs
                    })
                    return
            if parsed.path in ('/api/mobile/commands/history', '/api/agent/commands/pending'):
                audience = 'agent' if parsed.path.startswith('/api/agent/') else ('any' if parsed.path.startswith('/api/mobile/') else 'web')
                principal = self._principal(audience)
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    if parsed.path == '/api/mobile/commands/history':
                        t_id = q.get('target_node_id', [None])[0]
                        st = q.get('status', [None])[0]
                        lim = int(q.get('limit', ['50'])[0])
                        self._send(200, {'commands': mobile_store.list_commands(principal, target_node_id=t_id, status=st, limit=lim)})
                    elif parsed.path == '/api/agent/commands/pending':
                        agent_node = q.get('agent_node_id', [None])[0] or principal.get('device_id') or principal.get('id')
                        lim = int(q.get('limit', ['20'])[0])
                        self._send(200, {'commands': mobile_store.get_pending_agent_commands(agent_node_id=agent_node, limit=lim)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
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
            if parsed.path in ('/api/web/workspace/project/inspect', '/api/agent/workspace/project/inspect',
                              '/api/web/workspace/project/files', '/api/agent/workspace/project/files',
                              '/api/web/workspace/project/file', '/api/agent/workspace/project/file'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    p_id = q.get('project_id', [None])[0]
                    if parsed.path.endswith('/inspect'):
                        self._send(200, workspace.inspect_project(principal, p_id))
                    elif parsed.path.endswith('/files'):
                        sub = q.get('subpath', [''])[0]
                        self._send(200, workspace.list_project_files(principal, p_id, sub))
                    elif parsed.path.endswith('/file'):
                        rel = q.get('path', [None])[0]
                        self._send(200, workspace.read_project_file(principal, p_id, rel))
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path in ('/api/web/workspace/task/runs', '/api/agent/workspace/task/runs',
                              '/api/web/workspace/task/run', '/api/agent/workspace/task/run'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    if parsed.path.endswith('/runs'):
                        p_id = q.get('project_id', [None])[0]
                        self._send(200, {'runs': workspace.list_agent_runs(principal, p_id)})
                    else:
                        r_id = q.get('run_id', [None])[0]
                        self._send(200, {'run': workspace.get_agent_run(principal, r_id)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path in ('/api/web/workspace/project/patches', '/api/agent/workspace/project/patches'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    p_id = q.get('project_id', [None])[0]
                    self._send(200, {'patches': workspace.list_project_patches(principal, p_id)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path in ('/api/web/workspace/project/commands', '/api/agent/workspace/project/commands'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    p_id = q.get('project_id', [None])[0]
                    lim = int(q.get('limit', ['50'])[0])
                    self._send(200, {'commands': workspace.list_command_history(principal, p_id, limit=lim)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path in ('/api/web/workspace/project/command/stream', '/api/agent/workspace/project/command/stream'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                q = parse_qs(parsed.query)
                cmd_id = q.get('command_id', [None])[0]
                try:
                    workspace.validate_command_stream(principal, cmd_id)
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
                    self.send_header('Cache-Control', 'no-cache, no-transform')
                    self.send_header('Connection', 'keep-alive')
                    self.send_header('X-Accel-Buffering', 'no')
                    self.end_headers()
                    for event in workspace.get_command_stream_events(principal, cmd_id):
                        raw = f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode('utf-8')
                        self.wfile.write(raw)
                        self.wfile.flush()
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass
                return
            if parsed.path in ('/api/web/workspace/project/git/status', '/api/agent/workspace/project/git/status'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    p_id = q.get('project_id', [None])[0]
                    self._send(200, workspace.get_project_git_status(principal, p_id))
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path in ('/api/web/workspace/project/artifacts', '/api/agent/workspace/project/artifacts'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    p_id = q.get('project_id', [None])[0]
                    lim = int(q.get('limit', ['50'])[0])
                    self._send(200, {'artifacts': workspace.list_project_artifacts(principal, p_id, limit=lim)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path in ('/api/web/workspace/project/artifact', '/api/agent/workspace/project/artifact'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    p_id = q.get('project_id', [None])[0]
                    art_id = q.get('artifact_id', [None])[0]
                    self._send(200, {'artifact': workspace.get_project_artifact(principal, p_id, art_id)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path in ('/api/web/workspace/project/steering', '/api/agent/workspace/project/steering', '/api/workspace/project/steering'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    p_id = q.get('project_id', [None])[0]
                    self._send(200, workspace.get_project_steering(principal, p_id))
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path in ('/api/web/workspace/specs', '/api/agent/workspace/specs'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    p_id = q.get('project_id', [None])[0]
                    stat = q.get('status', [None])[0]
                    self._send(200, {'specs': workspace.list_specs(principal, p_id, status=stat)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path in ('/api/web/workspace/spec', '/api/agent/workspace/spec'):
                principal = self._principal('agent' if parsed.path.startswith('/api/agent/') else 'web')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    s_id = q.get('spec_id', [None])[0]
                    self._send(200, {'spec': workspace.get_spec(principal, s_id)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                return
            if parsed.path == '/api/admin/workspace/agent/runs':
                principal = self._principal('web') or self._principal('agent')
                if principal is None:
                    return
                try:
                    limit = int(parse_qs(parsed.query).get('limit', ['50'])[0])
                    self._send(200, {'runs': workspace.list_all_agent_runs(principal, limit=limit)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                except Exception as exc:
                    self._send(400, {'error': {'message': f'Invalid request: {exc}'}})
                return
            if parsed.path == '/api/admin/workspace/sandbox/policy':
                principal = self._principal('web') or self._principal('agent')
                if principal is None:
                    return
                try:
                    self._send(200, {'policy': workspace.get_sandbox_policy(principal)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                except Exception as exc:
                    self._send(400, {'error': {'message': f'Invalid request: {exc}'}})
                return
            if parsed.path == '/api/admin/workspace/webhooks':
                principal = self._principal('web') or self._principal('agent')
                if principal is None:
                    return
                try:
                    self._send(200, {'webhooks': workspace.list_governance_webhooks(principal)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                except Exception as exc:
                    self._send(400, {'error': {'message': f'Invalid request: {exc}'}})
                return
            if parsed.path in ('/api/workspace/agent/notifications', '/api/web/workspace/agent/notifications'):
                principal = self._principal('web') or self._principal('agent')
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    limit = int(q.get('limit', ['50'])[0])
                    unread_only = q.get('unread_only', ['0'])[0] in ('1', 'true', 'True')
                    self._send(200, {'notifications': workspace.list_task_notifications(principal, limit=limit, unread_only=unread_only)})
                except IdentityError as exc:
                    self._send(exc.status, {'error': {'message': str(exc)}})
                except Exception as exc:
                    self._send(400, {'error': {'message': f'Invalid request: {exc}'}})
                return
            if parsed.path in ('/api/chat/sessions', '/api/agent/sessions', '/api/mobile/sessions',
                              '/api/chat/history', '/api/chat/memory',
                              '/api/agent/history', '/api/agent/memory',
                              '/api/mobile/history', '/api/mobile/memory'):
                principal = self._principal('any' if parsed.path.startswith('/api/mobile/') else ('agent' if parsed.path.startswith('/api/agent/') else 'web'))
                if principal is None:
                    return
                try:
                    if parsed.path.endswith('/sessions'):
                        self._send(200, {'sessions': memory.list_sessions(principal)})
                    elif parsed.path.endswith('/history'):
                        sess_id = parse_qs(parsed.query).get('session_id', [None])[0]
                        self._send(200, {'entries': memory.history(principal, session_id=sess_id)})
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
            if parsed.path == '/api/admin/providers/socks-health':
                if not self._node_channel():
                    return
                principal = self._principal()
                if principal is None:
                    return
                if providers is None:
                    self._send(503, {'error': {'message': 'Provider registry unavailable'}})
                    return
                try:
                    q = parse_qs(parsed.query)
                    proxy_url = q.get('proxy_url', [None])[0]
                    kind = q.get('kind', [None])[0]
                    self._send(200, providers.check_socks_health(principal, proxy_url, kind))
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
            if parsed.path == "/api/admin/nodes/disk-diagnostics":
                if not self._node_channel():
                    return
                principal = self._principal()
                if principal is None:
                    return
                try:
                    q = parse_qs(parsed.query)
                    node_id = q.get("node_id", [None])[0]
                    self._send(200, {"breakdown": nodes.get_node_disk_diagnostics(principal, node_id)})
                except IdentityError as exc:
                    self._send(exc.status, {"error": {"message": str(exc)}})
                return
            if self.path == "/api/admin/nodes/browser/allowlist":
                if not self._node_channel():
                    return
                principal = self._principal()
                if principal is None:
                    return
                self._send(200, {
                    "allowed_domains": playwright_worker.DEFAULT_ALLOWED_DOMAINS,
                    "worker_only": True,
                })
                return
            if self._static():
                return
            if self.path == "/health":
                self._send(200, {"status": "up", "mode": "local-development"})
                return
            if self.path in ("/api/theme", "/api/admin/theme"):
                store = self._identity()
                active = store.theme_palette() if store else "magenta"
                self._send(200, {
                    "active_palette": active,
                    "palette": active,
                    "available_palettes": [
                        {"id": "magenta", "name": "قرمز / مجنتا مخملی (پیش‌فرض)", "primary": "#f43f5e", "accent": "#d946ef", "gradient": "linear-gradient(135deg, #f43f5e 0%, #d946ef 100%)"},
                        {"id": "cyan", "name": "سایبرپانک فیروزه‌ای", "primary": "#00f0ff", "accent": "#00ffaa", "gradient": "linear-gradient(135deg, #00f0ff 0%, #00ffaa 100%)"},
                        {"id": "emerald", "name": "زمردی / نعنایی", "primary": "#10b981", "accent": "#06b6d4", "gradient": "linear-gradient(135deg, #10b981 0%, #06b6d4 100%)"},
                        {"id": "amber", "name": "کهربایی خورشیدی", "primary": "#f59e0b", "accent": "#ef4444", "gradient": "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)"},
                        {"id": "indigo", "name": "کیهانی لاجوردی", "primary": "#6366f1", "accent": "#a855f7", "gradient": "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)"}
                    ]
                })
                return
            if self.path in ('/api/agent/models', '/api/web/models', '/api/mobile/models'):
                principal = self._principal('any' if self.path.startswith('/api/mobile/') else ('agent' if self.path == '/api/agent/models' else 'web'))
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
                if providers:
                    try:
                        ext_models = providers.chat_models(principal)
                        for m in ext_models:
                            if m not in models:
                                models.append(m)
                    except Exception:
                        pass
                if not models:
                    self._send(503, {"error": {"message": "No chat model available"}})
                else:
                    pricing_map = {}
                    if providers:
                        try:
                            with identity._db() as db:
                                accounts = db.execute("SELECT kind, catalog_prices_json FROM provider_accounts WHERE enabled=1").fetchall()
                                for acc in accounts:
                                    cat = json.loads(acc['catalog_prices_json'] or '{}')
                                    for m_k, pr in cat.items():
                                        pricing_map[f"{acc['kind']}/{m_k}"] = pr
                                        pricing_map[m_k] = pr
                        except Exception:
                            pass
                    from .model_catalog import build_models_catalog, CATEGORIES
                    catalog = build_models_catalog(models)
                    self._send(200, {"models": models, "catalog": catalog, "categories": CATEGORIES, "pricing": pricing_map})
                return
            if self.path == '/api/models/catalog':
                principal = self._principal('any')
                if principal is None:
                    return
                all_models = ['auto']
                try:
                    all_models.extend(list(self._available_models(current_ollama())))
                except Exception:
                    pass
                if providers:
                    try:
                        ext_models = providers.chat_models(principal)
                        for m in ext_models:
                            if m not in all_models:
                                all_models.append(m)
                    except Exception:
                        pass
                from .model_catalog import build_models_catalog, CATEGORIES
                self._send(200, {"categories": CATEGORIES, "catalog": build_models_catalog(all_models), "models": all_models})
                return
            if self.path == "/api/admin/system/metrics":
                principal = self._principal()
                if principal is None:
                    return
                if principal["role"] != "superadmin":
                    self._send(403, {"error": {"message": "Superadmin access required"}})
                    return
                repo_root = Path(__file__).resolve().parent.parent
                worker_count = len(nodes.list_nodes(principal)) if nodes else 0
                active_sessions = 1
                try:
                    active_sessions = len(identity_store.pending(principal)) if identity_store else 1
                except Exception:
                    pass
                ollama_status = "unknown"
                ollama_models = 0
                try:
                    c = current_ollama()
                    m_list = c.list_models()
                    ollama_status = "up" if m_list else "no_models"
                    ollama_models = len(m_list)
                except Exception:
                    ollama_status = "unreachable"
                    ollama_models = 0

                metrics = telemetry.get_system_metrics(
                    repo_root=repo_root,
                    active_inferences=active_inferences[0],
                    max_inferences=max_concurrent_inferences,
                    worker_nodes_count=worker_count,
                    active_sessions_count=active_sessions,
                    ollama_status=ollama_status,
                    ollama_model_count=ollama_models,
                )
                self._send(200, metrics)
                return
            if parsed.path in ('/api/admin/system/backups', '/api/admin/system/backups/download'):
                principal = self._principal()
                if principal is None:
                    return
                if principal["role"] != "superadmin":
                    self._send(403, {"error": {"message": "Superadmin access required"}})
                    return
                if identity_store is None:
                    self._send(503, {"error": {"message": "Identity service is not configured"}})
                    return
                if parsed.path == '/api/admin/system/backups':
                    try:
                        self._send(200, {"backups": identity_store.list_backups(principal)})
                    except IdentityError as exc:
                        self._send(exc.status, {"error": {"message": str(exc)}})
                    return
                if parsed.path == '/api/admin/system/backups/download':
                    filename = parse_qs(parsed.query).get('filename', [''])[0]
                    try:
                        target = identity_store.get_backup_path(principal, filename)
                        raw = target.read_bytes()
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/octet-stream')
                        self.send_header('Content-Length', str(len(raw)))
                        self.send_header('Content-Disposition', f'attachment; filename="{target.name}"')
                        self.send_header('Cache-Control', 'no-store')
                        self.end_headers()
                        self.wfile.write(raw)
                    except IdentityError as exc:
                        self._send(exc.status, {"error": {"message": str(exc)}})
                    return
            if parsed.path == "/api/admin/system/update-status":
                principal = self._principal()
                if principal is None:
                    return
                if principal["role"] != "superadmin":
                    self._send(403, {"error": {"message": "Superadmin access required"}})
                    return
                force = parse_qs(parsed.query).get('force', ['false'])[0].lower() == 'true'
                repo_root = Path(__file__).resolve().parent.parent
                self._send(200, updater.check_for_updates(repo_root=repo_root, force_refresh=force))
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
                repo_root = Path(__file__).resolve().parent.parent
                hw = telemetry.get_system_metrics(
                    repo_root=repo_root,
                    active_inferences=active_inferences[0],
                    max_inferences=max_concurrent_inferences,
                )
                self._send(200, {"master": "up", "hardware": hw, "ollama": {
                    "url": client.base_url, "status": worker_status, "models": model_list,
                }, "nodes": [
                    {"id": "master", "kind": "master", "status": "up", "checked_at": checked_at},
                    {"id": "ollama-worker", "kind": "worker", "status": worker_status,
                     "checked_at": checked_at, "latency_ms": latency_ms, "models": model_list},
                ]})
                return
            if self.path == "/api/admin/nodes/ping":
                principal = self._principal()
                if principal is None:
                    return
                if principal["role"] != "superadmin":
                    self._send(403, {"error": {"message": "Superadmin access required"}})
                    return
                try:
                    c = current_ollama()
                    res = c.ping()
                    self._send(200, res)
                except Exception as exc:
                    self._send(503, {"error": {"message": f"Ping failed: {exc}"}})
                return
            if parsed.path == "/api/admin/users":
                principal = self._principal()
                if principal is None:
                    return
                if principal["role"] != "superadmin":
                    self._send(403, {"error": {"message": "Superadmin access required"}})
                    return
                if identity_store is None:
                    self._send(503, {"error": {"message": "Identity service is not configured"}})
                    return
                try:
                    self._send(200, {"users": identity_store.list_users(principal)})
                except IdentityError as exc:
                    self._send(exc.status, {"error": {"message": str(exc)}})
                return
            if parsed.path == "/api/admin/audit":
                principal = self._principal()
                if principal is None:
                    return
                if principal["role"] != "superadmin":
                    self._send(403, {"error": {"message": "Superadmin access required"}})
                    return
                if identity_store is None:
                    self._send(503, {"error": {"message": "Identity service is not configured"}})
                    return
                query_params = parse_qs(parsed.query)
                limit_str = query_params.get("limit", ["100"])[0]
                event_filter = query_params.get("event", [None])[0]
                try:
                    limit = int(limit_str)
                except ValueError:
                    limit = 100
                try:
                    self._send(200, {"logs": identity_store.list_audit(principal, limit=limit, event=event_filter)})
                except IdentityError as exc:
                    self._send(exc.status, {"error": {"message": str(exc)}})
                return
            if parsed.path == "/api/user/profile":
                principal = self._principal("web")
                if principal is None:
                    return
                if identity_store is None:
                    self._send(503, {"error": {"message": "Identity service is not configured"}})
                    return
                try:
                    self._send(200, identity_store.user_profile_report(principal))
                except IdentityError as exc:
                    self._send(exc.status, {"error": {"message": str(exc)}})
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
        else:
            server.allow_http_external = True
        print(f"OmniOps gateway listening on {'https' if cert else 'http'}://{host}:{server.server_port}/v1")
        server.serve_forever()


if __name__ == "__main__":
    main()
