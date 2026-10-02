"""Ertebat-e vaghei ba Ollama-ye dakheli, bedoone bazgasht-e makhfi be cloud."""

import json
import ipaddress
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class OllamaError(RuntimeError):
    pass


@dataclass(frozen=True)
class LocalModel:
    name: str
    size_bytes: int | None


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, _req, _fp, _code, _msg, _headers, _newurl):
        return None


_INTERNAL_NETWORKS = tuple(
    ipaddress.ip_network(net) for net in ("127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "::1/128", "fc00::/7")
)


class OllamaClient:
    def __init__(self, base_url: str, timeout_seconds: float = 8.0, chat_timeout_seconds: float = 120.0):
        url = urlsplit(base_url)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password:
            raise ValueError("Ollama URL must be an HTTP(S) host without embedded credentials")
        try:
            address = ipaddress.ip_address(url.hostname)
            internal = any(address in network for network in _INTERNAL_NETWORKS)
        except ValueError:
            internal = url.hostname == "localhost"
        if not internal:
            raise ValueError("Ollama worker must use a local or private-network IP address")
        if url.path not in {"", "/"} or url.query or url.fragment:
            raise ValueError("Ollama URL must be an origin, without a path or query")
        if timeout_seconds <= 0 or chat_timeout_seconds <= 0:
            raise ValueError("Timeouts must be positive")
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.chat_timeout_seconds = chat_timeout_seconds
        # Worker-e dakheli nabayad proxy-ye khorooji-e host ra ers bebarad.
        self._opener = build_opener(ProxyHandler({}), _NoRedirect())

    def _json_request(self, path: str, payload: dict | None = None, timeout_seconds: float | None = None) -> dict:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            self.base_url + path,
            data=body,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            method="POST" if body is not None else "GET",
        )
        try:
            with self._opener.open(request, timeout=timeout_seconds or self.timeout_seconds) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
        except HTTPError as exc:
            exc.close()
            raise OllamaError(f"Ollama request failed: HTTP {exc.code}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise OllamaError(f"Ollama request failed: {exc}") from exc
        if len(raw) > 8 * 1024 * 1024:
            raise OllamaError("Ollama response exceeded 8 MiB")
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeDecodeError) as exc:
            raise OllamaError("Ollama returned invalid JSON") from exc
        if not isinstance(data, dict):
            raise OllamaError("Ollama response must be an object")
        return data

    def list_models(self) -> tuple[LocalModel, ...]:
        data = self._json_request("/api/tags")
        if not isinstance(data.get("models"), list):
            raise OllamaError("Ollama did not return a model list")
        models = []
        for item in data["models"]:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                raise OllamaError("Ollama returned an invalid model entry")
            size = item.get("size")
            models.append(LocalModel(item["name"], size if isinstance(size, int) else None))
        return tuple(models)

    def list_chat_models(self) -> tuple[LocalModel, ...]:
        result = []
        for model in self.list_models():
            try:
                metadata = self._json_request('/api/show', {'model': model.name})
            except OllamaError:
                continue
            capabilities = metadata.get('capabilities')
            if isinstance(capabilities, list) and 'completion' in capabilities:
                result.append(model)
        return tuple(result)

    def chat(self, model: str, messages: list[dict[str, str]]) -> str:
        if not model or not messages:
            raise ValueError("A model and at least one message are required")
        if any(
            not isinstance(message, dict)
            or message.get("role") not in {"system", "user", "assistant"}
            or not isinstance(message.get("content"), str)
            for message in messages
        ):
            raise ValueError("Messages must have a supported role and text content")
        response = self._json_request(
            "/api/chat", {"model": model, "messages": messages, "stream": False}, self.chat_timeout_seconds
        )
        message = response.get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            raise OllamaError("Ollama returned no assistant text")
        return message["content"]
