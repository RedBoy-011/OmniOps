"""Entekhab-e model ba ghavanin-e roshan, bedoone ertebat-e shabake."""

from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlsplit


class ProviderKind(str, Enum):
    LOCAL = "local"
    EXTERNAL = "external"


class NetworkMode(str, Enum):
    INTERNAL = "internal"
    DIRECT = "direct"
    SOCKS = "socks"


@dataclass(frozen=True)
class Provider:
    provider_id: str
    kind: ProviderKind
    network_mode: NetworkMode
    enabled: bool = True
    healthy: bool = True
    socks_url: str | None = None


@dataclass(frozen=True)
class Model:
    model_id: str
    provider_id: str
    capabilities: frozenset[str]
    quality: int
    latency_ms: int
    cost_per_million: float
    enabled: bool = True
    healthy: bool = True


@dataclass(frozen=True)
class RoutingRequest:
    required_capabilities: frozenset[str] = frozenset({"text"})
    local_only: bool = True
    allow_external: bool = False
    require_socks_for_external: bool = False
    prefer_local: bool = True


class NoEligibleModel(ValueError):
    pass


def _valid_socks_url(url: str | None) -> bool:
    if not url:
        return False
    parsed = urlsplit(url)
    try:
        return parsed.scheme == "socks5h" and bool(parsed.hostname) and bool(parsed.port)
    except ValueError:
        return False


def _provider_eligible(provider: Provider, request: RoutingRequest) -> bool:
    if not provider.enabled or not provider.healthy:
        return False
    if provider.kind is ProviderKind.LOCAL:
        return provider.network_mode is NetworkMode.INTERNAL
    if request.local_only or not request.allow_external:
        return False
    if provider.network_mode is NetworkMode.SOCKS:
        return _valid_socks_url(provider.socks_url)
    return provider.network_mode is NetworkMode.DIRECT and not request.require_socks_for_external


def choose_model(
    providers: tuple[Provider, ...], models: tuple[Model, ...], request: RoutingRequest
) -> Model:
    """Az modelhaye mojaz va salem entekhab mikonad; dar gheyr-e in soorat khata midahad."""
    provider_index = {provider.provider_id: provider for provider in providers}
    eligible: list[tuple[int, Model]] = []
    for model in models:
        provider = provider_index.get(model.provider_id)
        if (
            provider is None
            or not model.enabled
            or not model.healthy
            or not request.required_capabilities.issubset(model.capabilities)
            or not _provider_eligible(provider, request)
        ):
            continue
        local_bonus = 30 if request.prefer_local and provider.kind is ProviderKind.LOCAL else 0
        score = model.quality * 10 + local_bonus - model.latency_ms // 100 - int(
            model.cost_per_million * 2
        )
        eligible.append((score, model))
    if not eligible:
        raise NoEligibleModel("No healthy model satisfies the data and network policy")
    eligible.sort(key=lambda item: (-item[0], item[1].model_id))
    return eligible[0][1]
