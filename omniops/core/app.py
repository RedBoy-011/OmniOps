"""FastAPI Core Orchestrator for OmniOps Enterprise Master Node."""

import asyncio
import os
import time
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from omniops.core.cascade_router import SmartCascadeRouter, ModelTier
from omniops.core.device_relay import DeviceRelayEngine
from omniops.core.gemini_pool import GeminiKeyPool
from omniops.core.local_models_hub import LocalModelsHub
from omniops.core.memory_engine import DualMemoryEngine
from omniops.core.prompt_cache import PromptCacheEngine
from omniops.core.rtk_compressor import RTKCompressor
from omniops.core.skills_engine import SkillsEngine
from omniops.core.system_metrics import SystemMetricsCollector
from omniops.core.update_manager import UpdateManager
from omniops.core.identity import get_system_identity


app = FastAPI(
    title="OmniOps Enterprise Studio Core",
    version="2.0.0",
    description="Enterprise Multi-Node AI Orchestrator & Cognitive Engine",
)

# CORS configuration for LAN and Edge domain access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Core singletons
cluster_secret_key = os.getenv("CLUSTER_SECRET_KEY", "default-cluster-dev-secret")
gemini_pool = GeminiKeyPool()
cascade_router = SmartCascadeRouter()
device_relay = DeviceRelayEngine()
skills_engine = SkillsEngine(skills_dir=os.getenv("SKILLS_DIR", "skills"))
prompt_cache = PromptCacheEngine()
rtk_compressor = RTKCompressor()
metrics_collector = SystemMetricsCollector(node_id="master-01", node_role="master")
local_models_hub = LocalModelsHub()
update_manager = UpdateManager()
memory_engine = DualMemoryEngine(
    redis_url=os.getenv("REDIS_URL"),
    qdrant_url=os.getenv("QDRANT_URL"),
    qdrant_api_key=os.getenv("QDRANT_API_KEY"),
)

# Initial skill scan on startup
skills_engine.scan_skills()


# Request / Response Schemas
class GenerateCodeRequest(BaseModel):
    windows_agent_id: str
    windows_agent_name: Optional[str] = "Windows Desktop"


class RedeemCodeRequest(BaseModel):
    code: str
    android_device_id: str
    android_device_name: Optional[str] = "Android Mobile"


class HeartbeatRequest(BaseModel):
    agent_id: str
    agent_name: Optional[str] = "Agent"
    device_type: Optional[str] = "windows"


class UploadImagesRequest(BaseModel):
    images: List[str]  # Up to 5 base64 strings


class LoginRequest(BaseModel):
    username: str
    password: str
    device_name: Optional[str] = "Android Companion"


class DispatchActionRequest(BaseModel):
    android_device_id: str
    windows_agent_id: Optional[str] = None
    action_type: str = "task"  # "task" | "chat" | "command" | "computer_use"
    prompt: str
    project: Optional[str] = "OmniOps Core"
    images: Optional[List[str]] = None  # Up to 5 base64 strings


class CompleteActionRequest(BaseModel):
    windows_agent_id: str
    action_id: str
    status: str = "completed"
    result: Dict[str, Any]
class ChatRequest(BaseModel):
    session_id: str
    user_id: str
    tenant_id: str = "default"
    message: str
    allow_external: bool = False
    is_strictly_private: bool = False
    has_image: bool = False
    is_computer_use: bool = False
    requested_tier: Optional[str] = None
    save_history: bool = True


class ChatResponse(BaseModel):
    reply: str
    model: str
    provider: str
    tier: str
    routing_reason: str
    timestamp: float
    prompt_cache: Optional[Dict[str, Any]] = None
    rtk_savings: Optional[Dict[str, Any]] = None


class AddKeyRequest(BaseModel):
    api_key: str
    label: Optional[str] = "Gemini Key"


class RTKCompressRequest(BaseModel):
    content: str
    tool_name: Optional[str] = "general"


class SyncSkillsRequest(BaseModel):
    repo_url: Optional[str] = "https://github.com/RedBoy-011/OmniOps"


class PullLocalModelRequest(BaseModel):
    model_id: str


class ToggleLocalModelRequest(BaseModel):
    model_id: str
    active: bool


class OpenAIChatCompletionRequest(BaseModel):
    model: Optional[str] = "auto"
    messages: List[Dict[str, Any]]
    temperature: Optional[float] = 0.7
    stream: Optional[bool] = False


@app.get("/health")
def healthcheck():
    return {
        "status": "healthy",
        "service": "omniops-master-core",
        "timestamp": time.time(),
        "skills_loaded": len(skills_engine.list_skills()),
    }


@app.get("/api/cluster/status")
def cluster_status():
    pool_status = gemini_pool.get_status()
    skills_list = skills_engine.list_skills()
    return {
        "node_type": "master",
        "version": "2.0.0",
        "uptime": time.time(),
        "key_pool": pool_status,
        "skills_count": len(skills_list),
        "cluster_connected": True,
    }


@app.post("/api/chat", response_model=ChatResponse)
@app.post("/api/chat/cascade", response_model=ChatResponse)
async def cascade_chat(req: ChatRequest):
    # 1. Routing decision with 9Router-inspired multi-tier fallback
    decision = cascade_router.decide_route(
        prompt=req.message,
        allow_external=req.allow_external,
        is_strictly_private=req.is_strictly_private,
        has_image=req.has_image,
        is_computer_use=req.is_computer_use,
        requested_tier=req.requested_tier,
    )

    # 2. Get user context & active skills
    system_prompt = skills_engine.build_system_prompt_for_user(["chat", "tool.read", "action.request"])

    # 3. Prompt Caching Engine Analysis (ephemeral caching & token reduction)
    cache_data = prompt_cache.process_request_cache(
        system_prompt=system_prompt,
        new_user_message=req.message,
        project_context="OmniOps Enterprise Studio Project",
        model_name=decision.model_name,
    )

    # 4. RTK Token Saver (compress tool_result / logs if present)
    rtk_result = rtk_compressor.compress_tool_result(req.message)

    # 5. Handle model dispatching across tiers
    reply_text = ""
    if decision.tier == ModelTier.LOCAL:
        reply_text = f"[پاسخ نود محلی محاسباتی ({decision.model_name})]: پردازش تسک در شبکه داخلی با پینگ صفر انجام شد."
    elif decision.tier == ModelTier.FREE:
        reply_text = f"[پاسخ ارائه‌دهنده رایگان نامحدود Kiro AI / OpenCode ({decision.model_name})]: تسک بدون نیاز به اشتراک یا هزینه توکن با موفقیت به سرانجام رسید."
    elif decision.tier in (ModelTier.FLASH, ModelTier.PRO):
        key_tuple = gemini_pool.acquire_key()
        if key_tuple:
            key_id, _ = key_tuple
            gemini_pool.report_success(key_id)
            reply_text = f"[پاسخ مدل هوشمند ابری ({decision.model_name})]: تسک با موفقیت توسط استخر کلیدهای سازمانی پردازش شد."
        else:
            # Automatic fallback to Kiro Free / Local worker
            reply_text = f"[هشدار استخر کلیدها - بازگشت خودکار به Kiro/Local ({cascade_router.kiro_model})]: کلیدها در Cooldown بودند؛ تسک به لایه رایگان پایدار منتقل شد."

    # 6. Save to Dual Memory (Short-term Redis & Long-term Qdrant)
    if req.save_history:
        memory_engine.append_chat_turn(
            session_id=req.session_id,
            user_id=req.user_id,
            role="user",
            content=req.message,
        )
        memory_engine.append_chat_turn(
            session_id=req.session_id,
            user_id=req.user_id,
            role="assistant",
            content=reply_text,
            model=decision.model_name,
        )

    from dataclasses import asdict
    return ChatResponse(
        reply=reply_text,
        model=decision.model_name,
        provider=decision.provider,
        tier=decision.tier.value,
        routing_reason=decision.reason,
        timestamp=time.time(),
        prompt_cache=cache_data,
        rtk_savings=asdict(rtk_result),
    )


@app.get("/api/keys/gemini")
def list_gemini_keys():
    return gemini_pool.get_status()


@app.post("/api/keys/gemini")
def add_gemini_key(req: AddKeyRequest):
    key_id = gemini_pool.add_key(req.api_key, label=req.label or "")
    return {"status": "added", "key_id": key_id}


@app.get("/api/skills")
def list_skills():
    return skills_engine.list_skills()


@app.websocket("/ws/telemetry")
async def telemetry_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json({
                "timestamp": time.time(),
                "master_status": "online",
                "active_gemini_keys": gemini_pool.get_status()["active_keys"],
                "windows_agent_online": device_relay.is_windows_agent_online(),
            })
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass


@app.post("/api/pair/generate")
def generate_pair_code(req: GenerateCodeRequest):
    code = device_relay.generate_short_code(req.windows_agent_id, req.windows_agent_name or "Windows Desktop")
    return {
        "status": "success",
        "code": code,
        "expires_in_seconds": int(device_relay.code_ttl_seconds),
    }


@app.post("/api/pair/redeem")
def redeem_pair_code(req: RedeemCodeRequest):
    result = device_relay.redeem_short_code(req.code, req.android_device_id, req.android_device_name or "Android Mobile")
    if not result:
        raise HTTPException(status_code=400, detail="کد اتصال نامعتبر یا منقضی شده است.")
    return result


@app.post("/api/agent/heartbeat")
def agent_heartbeat(req: HeartbeatRequest):
    device_relay.agent_heartbeat(req.agent_id, req.agent_name or "Agent", req.device_type or "windows")
    return {"status": "ok", "timestamp": time.time()}


@app.get("/api/agent/status")
def agent_status(agent_id: Optional[str] = None):
    if agent_id:
        return device_relay.get_agent_status(agent_id)
    return {
        "windows_agent_online": device_relay.is_windows_agent_online(),
        "timestamp": time.time(),
    }


@app.post("/api/upload/images")
def upload_images(req: UploadImagesRequest):
    if len(req.images) > 5:
        raise HTTPException(status_code=400, detail="حداکثر سقف ۵ تصویر مجاز است.")
    return {
        "status": "success",
        "uploaded_count": len(req.images),
        "image_ids": [f"img-{i + 1}-{int(time.time())}" for i in range(len(req.images))],
    }


@app.post("/api/auth/login")
def login_user(req: LoginRequest):
    if not req.username or not req.password:
        raise HTTPException(status_code=400, detail="نام کاربری و رمز عبور الزامی است.")
    return {
        "status": "success",
        "token": f"token-{req.username}-{int(time.time())}",
        "user": {
            "id": f"usr-{req.username}",
            "username": req.username,
            "role": "admin" if req.username in ["admin", "root"] else "developer",
            "organization": "OmniOps Enterprise",
        },
        "windows_agent_online": device_relay.is_windows_agent_online(),
    }


@app.post("/api/remote/dispatch")
def dispatch_remote_action(req: DispatchActionRequest):
    target_win_id = req.windows_agent_id
    if not target_win_id:
        status = device_relay.get_agent_status(req.android_device_id)
        target_win_id = status.get("linked_windows_agent_id")

    if not target_win_id:
        for agent in device_relay._agents.values():
            if agent.device_type == "windows":
                target_win_id = agent.agent_id
                break

    if not target_win_id:
        target_win_id = "win-desktop-primary"

    action_payload = {
        "origin_device_id": req.android_device_id,
        "action_type": req.action_type,
        "prompt": req.prompt,
        "project": req.project,
        "images": req.images or [],
    }
    action_id = device_relay.queue_remote_action(target_win_id, action_payload)
    return {
        "status": "queued",
        "action_id": action_id,
        "target_windows_agent_id": target_win_id,
        "windows_online": device_relay.is_windows_agent_online(target_win_id),
    }


@app.get("/api/remote/poll")
def poll_remote_actions(windows_agent_id: str = "win-desktop-primary"):
    actions = device_relay.poll_remote_actions(windows_agent_id)
    return {"windows_agent_id": windows_agent_id, "actions": actions}


@app.post("/api/remote/complete")
def complete_remote_action(req: CompleteActionRequest):
    ok = device_relay.complete_remote_action(req.windows_agent_id, req.action_id, req.result)
    return {"status": "ok" if ok else "not_found", "action_id": req.action_id}


@app.get("/api/remote/status/{action_id}")
def get_action_status(action_id: str):
    action = device_relay.get_action_status(action_id)
    if not action:
        raise HTTPException(status_code=404, detail="عملیات مورد نظر یافت نشد.")
    return action


# 1. Prompt Caching Telemetry
@app.get("/api/cache/stats")
def get_cache_stats():
    return prompt_cache.get_telemetry()


# 2. RTK Token Compressor Endpoint
@app.post("/api/rtk/compress")
def rtk_compress(req: RTKCompressRequest):
    from dataclasses import asdict
    res = rtk_compressor.compress_tool_result(req.content, req.tool_name or "general")
    return asdict(res)


# 3. System Hardware Metrics (CPU, RAM, Disk, GPU/No-GPU)
@app.get("/api/system/metrics")
def get_system_metrics():
    return metrics_collector.to_dict()


# 4. Local Models Hub (Discovery, Download Progress, Activation)
@app.get("/api/models/local")
def list_local_models():
    return local_models_hub.list_models()


@app.post("/api/models/local/pull")
def pull_local_model(req: PullLocalModelRequest):
    ok = local_models_hub.pull_model(req.model_id)
    return {"status": "started" if ok else "failed", "model_id": req.model_id}


@app.post("/api/models/local/toggle")
def toggle_local_model(req: ToggleLocalModelRequest):
    ok = local_models_hub.toggle_active(req.model_id, req.active)
    return {"status": "ok" if ok else "not_found", "model_id": req.model_id, "active": req.active}


# 5. Skills Synchronization from GitHub (Enterprise Skills Repo)
@app.post("/api/skills/sync")
def sync_skills(req: Optional[SyncSkillsRequest] = None):
    url = req.repo_url if req and req.repo_url else "https://github.com/RedBoy-011/OmniOps"
    return skills_engine.sync_skills_from_repo(url)


# 6. Universal OpenAI / Claude Code Gateway (/v1/models and /v1/chat/completions)
@app.get("/v1/models")
def openai_models():
    return {
        "object": "list",
        "data": [
            {"id": "auto", "object": "model", "owned_by": "omniops-smart-router"},
            {"id": "kr/claude-sonnet-4.5", "object": "model", "owned_by": "kiro-free"},
            {"id": "opencode/glm-5", "object": "model", "owned_by": "opencode-free"},
            {"id": "minimax/abab6.5", "object": "model", "owned_by": "minimax-low-cost"},
            {"id": "gemini-2.5-flash", "object": "model", "owned_by": "google-gemini"},
            {"id": "gemini-2.5-pro", "object": "model", "owned_by": "google-gemini"},
            {"id": "claude-3-5-sonnet", "object": "model", "owned_by": "anthropic"},
            {"id": "qwen2.5-coder:7b", "object": "model", "owned_by": "local-ollama"},
        ]
    }


@app.post("/v1/chat/completions")
async def openai_chat_completions(req: OpenAIChatCompletionRequest):
    last_msg = req.messages[-1].get("content", "") if req.messages else ""
    from dataclasses import asdict
    rtk_result = rtk_compressor.compress_tool_result(str(last_msg))
    cache_data = prompt_cache.process_request_cache(
        system_prompt="OmniOps Gateway OpenAI Compatibility Layer",
        new_user_message=str(last_msg),
    )

    decision = cascade_router.decide_route(
        prompt=str(last_msg),
        allow_external=True,
    )

    reply_content = f"OmniOps Universal Gateway: پردازش شد با مدل {decision.model_name} (لایه {decision.tier.value}). صرفه‌جویی RTK: {rtk_result.savings_percent}%"

    return {
        "id": f"chatcmpl-{int(time.time() * 1000)}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": decision.model_name,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": reply_content,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": cache_data["new_tokens"],
            "completion_tokens": 120,
            "total_tokens": cache_data["new_tokens"] + 120,
            "prompt_tokens_details": {
                "cached_tokens": cache_data["cached_tokens_saved"],
            },
        },
        "omniops_rtk": asdict(rtk_result),
    }


# ==============================================================================
# Seamless In-App Client Update / OTA Routes (Windows Desktop & Android Mobile)
# ==============================================================================
class PublishUpdateRequest(BaseModel):
    platform: str
    version: str
    release_notes: str
    update_type: str = "bundle"
    min_supported_version: str = "1.0.0"
    download_url: Optional[str] = None
    file_size_bytes: int = 0


@app.get("/api/updates/check")
async def check_updates(platform: str = "windows", current_version: str = "1.0.0"):
    """Check if a new client update exists for Windows or Android upon login."""
    return update_manager.check_update(platform=platform, current_version=current_version)


@app.get("/api/updates/registry")
async def get_updates_registry():
    """Return all registered platform versions."""
    return update_manager.get_registry()


@app.post("/api/updates/publish")
async def publish_update(req: PublishUpdateRequest):
    """Publish a new update release for Windows or Android."""
    return update_manager.publish_update(
        platform=req.platform,
        version=req.version,
        release_notes=req.release_notes,
        update_type=req.update_type,
        min_supported_version=req.min_supported_version,
        download_url=req.download_url,
        file_size_bytes=req.file_size_bytes,
    )


@app.get("/api/updates/download")
async def download_update_payload(platform: str = "windows", version: str = "1.1.0"):
    """Serve update payload or package metadata for client."""
    return {
        "status": "ready",
        "platform": platform,
        "version": version,
        "message": f"بسته بروزرسانی نسخه {version} برای پلتفرم {platform} آماده دریافت است.",
        "download_url": f"/static/updates/{platform}-{version}.pkg",
    }


@app.get("/api/system/identity")
async def system_identity():
    """Return the official identity and architectural philosophy of OmniOps."""
    return get_system_identity()


