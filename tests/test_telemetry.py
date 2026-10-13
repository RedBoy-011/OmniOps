"""Azmoon-haye vahed baraye telemetri-e sakht-afzar va salamat-e samaneh."""

import unittest
from unittest.mock import MagicMock, patch

from omniops import telemetry


class TestTelemetry(unittest.TestCase):
    def test_cpu_metrics(self):
        cores = telemetry._get_cpu_cores()
        self.assertGreaterEqual(cores, 1)

        pct = telemetry._get_cpu_percent()
        self.assertIsInstance(pct, float)
        self.assertGreaterEqual(pct, 0.0)
        self.assertLessEqual(pct, 100.0)

    def test_ram_info(self):
        info = telemetry.get_ram_info()
        self.assertIn("total_bytes", info)
        self.assertIn("used_bytes", info)
        self.assertIn("free_bytes", info)
        self.assertIn("percent", info)
        self.assertIn("total_gb", info)
        self.assertIn("used_gb", info)
        self.assertIn("free_gb", info)

        self.assertGreaterEqual(info["percent"], 0.0)
        self.assertLessEqual(info["percent"], 100.0)

    def test_disk_info(self):
        info = telemetry.get_disk_info()
        self.assertIn("total_bytes", info)
        self.assertIn("used_bytes", info)
        self.assertIn("free_bytes", info)
        self.assertIn("percent", info)

        self.assertGreater(info["total_bytes"], 0)
        self.assertGreaterEqual(info["percent"], 0.0)
        self.assertLessEqual(info["percent"], 100.0)

    def test_gpu_info_default_fallback(self):
        with patch("subprocess.run", side_effect=FileNotFoundError("nvidia-smi not found")):
            info = telemetry.get_gpu_info()
            self.assertFalse(info["available"])
            self.assertIsNone(info["vram_total_mb"])
            self.assertIsNone(info["vram_used_mb"])

    def test_gpu_info_parsed_successfully(self):
        fake_process = MagicMock()
        fake_process.returncode = 0
        fake_process.stdout = "NVIDIA GeForce RTX 4090, 24576, 6144, 18432, 54, 30\n"

        with patch("subprocess.run", return_value=fake_process):
            info = telemetry.get_gpu_info()
            self.assertTrue(info["available"])
            self.assertEqual(info["name"], "NVIDIA GeForce RTX 4090")
            self.assertEqual(info["vram_total_mb"], 24576)
            self.assertEqual(info["vram_used_mb"], 6144)
            self.assertEqual(info["vram_free_mb"], 18432)
            self.assertEqual(info["vram_percent"], 25.0)
            self.assertEqual(info["temperature_c"], 54)
            self.assertEqual(info["gpu_utilization_percent"], 30)

    def test_get_system_metrics_payload(self):
        metrics = telemetry.get_system_metrics(
            active_inferences=1,
            max_inferences=4,
            worker_nodes_count=2,
            active_sessions_count=5,
            ollama_status="up",
            ollama_model_count=3,
        )
        self.assertIn("server_time", metrics)
        self.assertIn("uptime_seconds", metrics)
        self.assertIn("cpu", metrics)
        self.assertIn("ram", metrics)
        self.assertIn("disk", metrics)
        self.assertIn("gpu", metrics)
        self.assertIn("runtime", metrics)

        self.assertEqual(metrics["runtime"]["active_inferences"], 1)
        self.assertEqual(metrics["runtime"]["max_inferences"], 4)
        self.assertEqual(metrics["runtime"]["worker_nodes_count"], 2)
        self.assertEqual(metrics["runtime"]["active_sessions_count"], 5)
        self.assertEqual(metrics["runtime"]["ollama_status"], "up")
        self.assertEqual(metrics["runtime"]["ollama_model_count"], 3)

    def test_is_diagnostic_query(self):
        self.assertTrue(telemetry.is_diagnostic_query("وضعیت سرور چطوره؟"))
        self.assertTrue(telemetry.is_diagnostic_query("میزان مصرف رم چقدره؟"))
        self.assertTrue(telemetry.is_diagnostic_query("دمای گرافیک چنده؟"))
        self.assertTrue(telemetry.is_diagnostic_query("@system لطفا خلاصه بگو"))
        self.assertTrue(telemetry.is_diagnostic_query("/status"))
        self.assertTrue(telemetry.is_diagnostic_query("how is server status?"))
        self.assertTrue(telemetry.is_diagnostic_query("چه مدل‌هایی روی سرور نصب شده؟"))

        self.assertFalse(telemetry.is_diagnostic_query("یک شعر درباره بهار بنویس"))
        self.assertFalse(telemetry.is_diagnostic_query("سلام، روز بخیر"))

    def test_format_system_context(self):
        context = telemetry.format_system_context(model_names=["llama3:latest", "qwen2.5-coder:7b"])
        self.assertIn("[اطلاعات وضعیت زنده و تله‌متری سرور OmniOps]", context)
        self.assertIn("پردازنده (CPU):", context)
        self.assertIn("حافظه موقت (RAM):", context)
        self.assertIn("فضای ذخیره‌سازی دیسک:", context)
        self.assertIn("llama3:latest", context)


if __name__ == "__main__":
    unittest.main()

