"""API-ye azmayeshi-e local baraye avalin ghesmat-e darvazeye Ollama.

In server rooye loopback ya yek IPv4-e khosusi-e moshakhas goosh midahad.
Enteshar-e omoomi be server-e production va TLS niaz darad.
"""

import hmac
import ipaddress
import json
import mimetypes
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .identity import IdentityError, IdentityStore
from .ollama import OllamaClient, OllamaError

MAX_BODY_BYTES = 64 * 1024
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
    ollama = OllamaClient(ollama_url)

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

        def _available_models(self) -> dict[str, str]:
            return {f"ollama/{entry.name}": entry.name for entry in ollama.list_models()}

        def _static(self) -> bool:
            if web_dist is None or (self.path != "/" and not self.path.startswith("/assets/")):
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

        def _identity_post(self):
            store = self._identity()
            if store is None:
                return
            path = self.path
            if path not in {
                "/api/auth/register", "/api/auth/login", "/api/auth/logout",
                "/api/agent/pairing", "/api/agent/redeem", "/api/agent/heartbeat", "/api/agent/logout", "/api/agent/chat",
            } and not (path.startswith("/api/admin/pending/") and path.rsplit("/", 1)[-1] in {"approve", "reject"}):
                self._send(404, {"error": {"message": "Route not found"}})
                return
            audience = "agent" if path in {"/api/agent/heartbeat", "/api/agent/logout", "/api/agent/chat"} else "web"
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
                if path == "/api/auth/register":
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
                elif path == "/api/agent/chat":
                    if "chat" not in principal["capabilities"]:
                        raise IdentityError("Profile has no chat permission", 403)
                    prompt = payload.get("message")
                    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 8000:
                        raise IdentityError("Chat message must contain 1–8000 characters")
                    available = self._available_models()
                    if not available:
                        raise OllamaError("No local model is installed")
                    requested = payload.get("model", "auto")
                    if not isinstance(requested, str):
                        raise IdentityError("Invalid model ID")
                    if requested == "auto":
                        requested = next(iter(available))
                    model = available.get(requested)
                    if model is None:
                        raise IdentityError("Requested local model is not installed", 404)
                    answer = ollama.chat(model, [{"role": "user", "content": prompt.strip()}])
                    self._send(200, {"reply": answer, "model": f"ollama/{model}"})
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
            if self._static():
                return
            if self.path == "/health":
                self._send(200, {"status": "up", "mode": "local-development"})
                return
            if self.path == "/api/agent/models":
                principal = self._principal("agent")
                if principal is None:
                    return
                if "chat" not in principal["capabilities"]:
                    self._send(403, {"error": {"message": "Profile has no chat permission"}})
                    return
                try:
                    models = self._available_models()
                    self._send(200, {"models": list(models)})
                except OllamaError as exc:
                    self._send(503, {"error": {"message": str(exc)}})
                return
            if self.path == "/api/admin/operations":
                principal = self._principal()
                if principal is None:
                    return
                if principal["role"] != "superadmin":
                    self._send(403, {"error": {"message": "Superadmin access required"}})
                    return
                try:
                    models = ollama.list_models()
                    self._send(200, {"master": "up", "ollama": {"status": "up", "models": [
                        {"id": f"ollama/{entry.name}", "size_bytes": entry.size_bytes} for entry in models
                    ]}})
                except OllamaError:
                    self._send(200, {"master": "up", "ollama": {"status": "unreachable", "models": []}})
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
                models = self._available_models()
            except OllamaError as exc:
                self._send(503, {"error": {"message": str(exc)}})
                return
            self._send(
                200,
                {"object": "list", "data": [{"id": key, "object": "model", "owned_by": "ollama"} for key in models]},
            )

        def do_POST(self):
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
                available = self._available_models()
                selected = available.get(model)
                if selected is None:
                    self._send(404, {"error": {"message": "Requested local model is not installed"}})
                    return
                content = ollama.chat(selected, request.get("messages"))
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
        print(f"OmniOps development gateway listening on http://{host}:{server.server_port}/v1")
        server.serve_forever()


if __name__ == "__main__":
    main()
