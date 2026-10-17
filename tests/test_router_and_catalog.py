import unittest
from omniops.model_catalog import get_model_metadata, build_models_catalog, CATEGORIES
from omniops.router import JRVRouter


class TestRouterAndCatalog(unittest.TestCase):
    def test_catalog_categories_present(self):
        self.assertIn("coding", CATEGORIES)
        self.assertIn("reasoning", CATEGORIES)
        self.assertIn("fast_chat", CATEGORIES)
        self.assertIn("general", CATEGORIES)
        self.assertIn("vision", CATEGORIES)

    def test_model_metadata_lookup(self):
        # Local Ollama model
        qwen = get_model_metadata("ollama/qwen2.5-coder:7b")
        self.assertEqual(qwen["category"], "coding")
        self.assertIn("کدنویسی", qwen["category_label"])
        self.assertIn("label", qwen)
        self.assertIn("token_label", qwen)
        self.assertGreater(qwen["context_tokens"], 0)

        # Gemini cloud model
        gem = get_model_metadata("gemini/gemini-2.5-flash")
        self.assertEqual(gem["category"], "fast_chat")
        self.assertEqual(gem["context_tokens"], 1000000)

        # DeepSeek R1 reasoning
        r1 = get_model_metadata("ollama/deepseek-r1:14b")
        self.assertEqual(r1["category"], "reasoning")

    def test_router_intent_classification(self):
        router = JRVRouter()

        res = router.classify_intent("def quicksort(arr): return arr")
        self.assertEqual(res["intent"], "coding")

        res = router.classify_intent("لطفاً این فرمول دیفرانسیل و انتگرال را با استدلال گام‌به‌گام اثبات کن")
        self.assertEqual(res["intent"], "reasoning")

        res = router.classify_intent("سلام چطوری؟ امروز هوا چطوره؟")
        self.assertEqual(res["intent"], "fast_chat")

    def test_router_choose_model_prefers_local_coder(self):
        router = JRVRouter()
        available = ["gemini/gemini-2.5-flash", "ollama/qwen2.5-coder:7b", "ollama/llama3.1:8b"]
        chosen, reason, fallbacks = router.choose_model("بنویس یک اسکریپت پایتون برای دانلود فایل", available, allow_external=True)
        self.assertEqual(chosen, "ollama/qwen2.5-coder:7b")
        self.assertTrue("برنامه‌نویسی" in reason or "کدنویسی" in reason)
        self.assertIn("gemini/gemini-2.5-flash", fallbacks)

    def test_router_fallback_when_local_unavailable(self):
        router = JRVRouter()
        available = ["gemini/gemini-2.5-flash"]
        chosen, reason, fallbacks = router.choose_model("برنامه پایتون بنویس", available, allow_external=True)
        self.assertEqual(chosen, "gemini/gemini-2.5-flash")


if __name__ == "__main__":
    unittest.main()
