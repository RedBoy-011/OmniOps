"""Unit tests for OmniOps Enterprise Core components."""

import time
import unittest
from pathlib import Path

from omniops.core.cascade_router import ModelTier, SmartCascadeRouter
from omniops.core.gemini_pool import GeminiKeyPool, KeyStatus
from omniops.core.memory_engine import DualMemoryEngine
from omniops.core.skills_engine import SkillsEngine


class GeminiKeyPoolTests(unittest.TestCase):
    def test_add_and_mask_keys(self):
        pool = GeminiKeyPool()
        k1 = pool.add_key("AIzaSyB123456789abcdef", label="Primary Key")
        k2 = pool.add_key("AIzaSyB987654321fedcba", label="Backup Key")

        status = pool.get_status()
        self.assertEqual(status["total_keys"], 2)
        self.assertEqual(status["active_keys"], 2)
        self.assertEqual(status["keys"][0]["masked_key"], "AIza...cdef")

    def test_rotation_and_lru(self):
        pool = GeminiKeyPool()
        k1 = pool.add_key("AIza11111111111111")
        k2 = pool.add_key("AIza22222222222222")

        id1, key1 = pool.acquire_key()
        id2, key2 = pool.acquire_key()
        self.assertNotEqual(id1, id2)

        # After both are used, next acquire should cycle back to least recently used
        id3, _ = pool.acquire_key()
        self.assertEqual(id3, id1)

    def test_rate_limit_and_cooldown_recovery(self):
        pool = GeminiKeyPool(default_cooldown_seconds=0.1)
        k1 = pool.add_key("AIzaKeyOnlyOne")

        # Report 429
        pool.report_rate_limit(k1, cooldown_seconds=0.1)
        # Should be None while in cooldown
        self.assertIsNone(pool.acquire_key())

        # Sleep past cooldown
        time.sleep(0.15)
        # Should now recover
        acquired = pool.acquire_key()
        self.assertIsNotNone(acquired)
        self.assertEqual(acquired[0], k1)


class CascadeRouterTests(unittest.TestCase):
    def setUp(self):
        self.router = SmartCascadeRouter()

    def test_strict_private_enforces_local(self):
        decision = self.router.decide_route(
            prompt="Analyze this massive architecture code",
            allow_external=False,
            is_strictly_private=True,
        )
        self.assertEqual(decision.tier, ModelTier.LOCAL)
        self.assertFalse(decision.allow_external)
        self.assertIn("ollama", decision.model_name)

    def test_vision_routes_to_flash(self):
        decision = self.router.decide_route(
            prompt="What is visible in this screenshot?",
            allow_external=True,
            has_image=True,
        )
        self.assertEqual(decision.tier, ModelTier.FLASH)
        self.assertIn("flash", decision.model_name)

    def test_complex_code_routes_to_pro(self):
        decision = self.router.decide_route(
            prompt="Refactor this multithreading asyncio service architecture to eliminate memory leaks",
            allow_external=True,
        )
        self.assertEqual(decision.tier, ModelTier.PRO)
        self.assertIn("gemini-2.5-pro", decision.model_name)

    def test_lightweight_routes_to_local_when_external_allowed(self):
        decision = self.router.decide_route(
            prompt="سلام، چطوری؟",
            allow_external=True,
        )
        self.assertEqual(decision.tier, ModelTier.LOCAL)


class SkillsEngineTests(unittest.TestCase):
    def test_skills_engine_scan(self):
        engine = SkillsEngine(skills_dir=Path("skills"))
        count = engine.scan_skills()
        self.assertGreaterEqual(count, 1)

        skill = engine.get_skill("windows-computer-use")
        self.assertIsNotNone(skill)
        self.assertIn("action.request", skill.required_capabilities)

        # Prompt generation with authorization
        prompt = engine.build_system_prompt_for_user(["chat", "tool.read"])
        # windows-computer-use needs action.request, so should not be in prompt
        self.assertNotIn("windows-computer-use", prompt)
        # system-diagnostics needs chat and tool.read, so it should be included
        self.assertIn("system-diagnostics", prompt)


class DualMemoryEngineTests(unittest.TestCase):
    def setUp(self):
        self.memory = DualMemoryEngine()

    def test_short_term_chat_sliding_window(self):
        self.memory.append_chat_turn("s1", "u1", "user", "Hello", "ollama")
        self.memory.append_chat_turn("s1", "u1", "assistant", "Hi there!", "ollama")

        history = self.memory.get_chat_history("s1", "u1")
        self.assertEqual(len(history), 2)

        # Another user cannot read history of user u1
        other_history = self.memory.get_chat_history("s1", "u2")
        self.assertEqual(len(other_history), 0)

    def test_long_term_vector_memory_isolation(self):
        # User 1 stores code guidelines
        self.memory.store_long_term(
            user_id="user_1",
            tenant_id="tenant_alpha",
            content="Use Rust Tauri v2 for high performance Windows agent",
            category="architecture",
        )

        # User 2 searches for Tauri
        results_u2 = self.memory.search_long_term(user_id="user_2", query="Tauri agent")
        self.assertEqual(len(results_u2), 0)  # Isolated!

        # User 1 searches
        results_u1 = self.memory.search_long_term(user_id="user_1", query="Tauri agent")
        self.assertGreaterEqual(len(results_u1), 1)
        self.assertIn("Rust Tauri v2", results_u1[0].content)


class DeviceRelayEngineTests(unittest.TestCase):
    def setUp(self):
        from omniops.core.device_relay import DeviceRelayEngine
        self.relay = DeviceRelayEngine(code_ttl_seconds=2.0, heartbeat_timeout_seconds=1.0)

    def test_pairing_code_generation_and_redemption(self):
        code = self.relay.generate_short_code("win-desktop-01", "Workstation PC")
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isdigit())

        # Check online
        self.assertTrue(self.relay.is_windows_agent_online("win-desktop-01"))

        # Redeem from Android
        res = self.relay.redeem_short_code(code, "android-phone-01", "Pixel Phone")
        self.assertIsNotNone(res)
        self.assertEqual(res["status"], "paired")
        self.assertEqual(res["linked_windows_agent_id"], "win-desktop-01")

        # Status check from Android perspective
        status = self.relay.get_agent_status("android-phone-01")
        self.assertTrue(status["windows_agent_online"])

    def test_invalid_and_expired_pairing_code(self):
        res = self.relay.redeem_short_code("000000", "android-phone-02")
        self.assertIsNone(res)

        code = self.relay.generate_short_code("win-desktop-02", "Workstation PC")
        time.sleep(2.1)
        # Should be expired
        res_expired = self.relay.redeem_short_code(code, "android-phone-02")
        self.assertIsNone(res_expired)

    def test_remote_action_queue_and_complete(self):
        # Queue action from android for windows
        action_id = self.relay.queue_remote_action("win-desktop-03", {
            "type": "run_command",
            "cmd": "Get-Process",
            "project": "OmniOps",
        })
        self.assertTrue(action_id.startswith("act-"))

        # Poll from windows
        pending = self.relay.poll_remote_actions("win-desktop-03")
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["action_id"], action_id)
        self.assertEqual(pending[0]["status"], "in_progress")

        # Complete from windows
        ok = self.relay.complete_remote_action("win-desktop-03", action_id, {"exit_code": 0, "output": "Success"})
        self.assertTrue(ok)

        # Check action status
        action = self.relay.get_action_status(action_id)
        self.assertIsNotNone(action)
        self.assertEqual(action["status"], "completed")
        self.assertEqual(action["result"]["exit_code"], 0)


class PromptCacheTests(unittest.TestCase):
    def setUp(self):
        from omniops.core.prompt_cache import PromptCacheEngine
        self.engine = PromptCacheEngine(ttl_seconds=300.0, min_tokens_for_cache=50)

    def test_fingerprint_deterministic(self):
        fp1 = self.engine.compute_context_fingerprint("System instructions here", "Project context")
        fp2 = self.engine.compute_context_fingerprint("System instructions here", "Project context")
        self.assertEqual(fp1, fp2)

    def test_cache_hit_and_token_savings(self):
        system_prompt = "You are OmniOps Enterprise Architect. " * 30  # > 50 tokens
        # First request: Cache Miss (Populates cache)
        r1 = self.engine.process_request_cache(system_prompt, "Hello first time")
        self.assertFalse(r1["cache_hit"])
        self.assertEqual(r1["cached_tokens_saved"], 0)

        # Second request with same system prompt: Cache Hit!
        r2 = self.engine.process_request_cache(system_prompt, "Second question here")
        self.assertTrue(r2["cache_hit"])
        self.assertGreater(r2["cached_tokens_saved"], 50)
        self.assertGreater(r2["cost_saved_usd"], 0.0)
        self.assertEqual(r2["latency_boost_factor"], "2.5x")

        # Telemetry
        tele = self.engine.get_telemetry()
        self.assertEqual(tele["total_requests"], 2)
        self.assertEqual(tele["cache_hits"], 1)
        self.assertEqual(tele["hit_rate_percent"], 50.0)


class RTKCompressorTests(unittest.TestCase):
    def setUp(self):
        from omniops.core.rtk_compressor import RTKCompressor
        self.rtk = RTKCompressor()

    def test_compress_git_diff(self):
        raw_diff = (
            "diff --git a/app.py b/app.py\n"
            "index 1234567..89abcdef 100644\n"
            "--- a/app.py\n"
            "+++ b/app.py\n"
            "@@ -1,15 +1,15 @@\n"
            " line 1 unchanged\n"
            " line 2 unchanged\n"
            " line 3 unchanged\n"
            " line 4 unchanged\n"
            " line 5 unchanged\n"
            "-old line here\n"
            "+new line here\n"
            " line 6 unchanged\n"
            " line 7 unchanged\n"
            " line 8 unchanged\n"
        )
        res = self.rtk.compress_tool_result(raw_diff, "git_diff")
        self.assertGreater(res.saved_tokens, 0)
        self.assertIn("+new line here", res.compressed_text)
        self.assertIn("-old line here", res.compressed_text)
        self.assertNotIn("index 1234567", res.compressed_text)

    def test_compress_directory_listing(self):
        raw_ls = (
            "package.json\n"
            "node_modules/react/index.js\n"
            "node_modules/react/package.json\n"
            ".git/config\n"
            ".git/HEAD\n"
            "src/App.tsx\n"
        )
        res = self.rtk.compress_tool_result(raw_ls, "directory_listing")
        self.assertNotIn("node_modules/react", res.compressed_text)
        self.assertIn("package.json", res.compressed_text)
        self.assertIn("src/App.tsx", res.compressed_text)


class SystemMetricsTests(unittest.TestCase):
    def setUp(self):
        from omniops.core.system_metrics import SystemMetricsCollector
        self.collector = SystemMetricsCollector(node_id="master-test", node_role="master")

    def test_metrics_collection_and_no_gpu_graceful_handling(self):
        data = self.collector.to_dict()
        self.assertEqual(data["node_id"], "master-test")
        self.assertGreater(data["cpu_cores"], 0)
        self.assertGreater(data["ram_total_gb"], 0.0)
        self.assertGreater(data["disk_total_gb"], 0.0)
        # If no GPU is present, status message must explicitly state it
        if not data["has_gpu"]:
            self.assertIn("فاقد کارت گرافیک", data["gpu_status_message"])


class LocalModelsHubTests(unittest.TestCase):
    def setUp(self):
        from omniops.core.local_models_hub import LocalModelsHub
        self.hub = LocalModelsHub()

    def test_list_and_toggle(self):
        models = self.hub.list_models()
        self.assertGreaterEqual(len(models), 4)

        # Toggle model
        ok = self.hub.toggle_active("deepseek-r1:7b", True)
        self.assertTrue(ok)
        m = self.hub.get_model("deepseek-r1:7b")
        self.assertIsNotNone(m)
        self.assertTrue(m["active"])


class SkillsSyncTests(unittest.TestCase):
    def setUp(self):
        from omniops.core.skills_engine import SkillsEngine
        self.engine = SkillsEngine(skills_dir="skills")

    def test_skills_loaded_including_9router(self):
        count = self.engine.scan_skills()
        self.assertGreaterEqual(count, 8)
        # Check 9router skills
        s_chat = self.engine.get_skill("9router-chat")
        self.assertIsNotNone(s_chat)
        self.assertIn("گفت‌وگو", s_chat.description or s_chat.body_markdown)
        s_core = self.engine.get_skill("9router-core")
        self.assertIsNotNone(s_core)


class UpdateManagerTests(unittest.TestCase):
    def setUp(self):
        from omniops.core.update_manager import UpdateManager
        self.mgr = UpdateManager()

    def test_windows_update_detected_and_bundle_type(self):
        res = self.mgr.check_update("windows", "1.0.0")
        self.assertTrue(res["has_update"])
        self.assertEqual(res["latest_version"], "1.1.0")
        self.assertEqual(res["update_type"], "bundle")  # Zero-admin hot reload

    def test_windows_up_to_date(self):
        res = self.mgr.check_update("windows", "1.1.0")
        self.assertFalse(res["has_update"])

    def test_android_update_detected(self):
        res = self.mgr.check_update("android", "1.0.0")
        self.assertTrue(res["has_update"])
        self.assertEqual(res["latest_version"], "1.1.0")

    def test_publish_new_version(self):
        self.mgr.publish_update(
            platform="windows",
            version="1.2.0",
            release_notes="نسخه جدید با بهینه‌سازی بیشتر",
            update_type="bundle",
        )
        res = self.mgr.check_update("windows", "1.1.0")
        self.assertTrue(res["has_update"])
        self.assertEqual(res["latest_version"], "1.2.0")


if __name__ == "__main__":
    unittest.main()
