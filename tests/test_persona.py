"""Unit tests for OmniOps System Persona, Knowledge Grounding, and Persian Normalization."""
from __future__ import annotations

import os
import tempfile
import unittest

from omniops.persona import (
    DEFAULT_SYSTEM_PERSONA_TEMPLATE,
    PersonaManager,
    normalize_persian_text,
)


class TestPersianNormalizer(unittest.TestCase):
    def test_arabic_character_conversion(self) -> None:
        raw = "تست كد با يكي از سيستم‌ها"
        res = normalize_persian_text(raw)
        self.assertNotIn("ك", res)
        self.assertNotIn("ي", res)
        self.assertIn("ک", res)
        self.assertIn("ی", res)

    def test_zwnj_insertion(self) -> None:
        raw = "او می رود و کتاب ها را می خواند"
        res = normalize_persian_text(raw)
        self.assertIn("می\u200cرود", res)
        self.assertIn("کتاب\u200cها", res)

    def test_code_block_preservation(self) -> None:
        code_text = "متن فارسی قبل کد\n```python\ndef test():\n    return 'hello world'\n```\nمتن فارسی بعد کد"
        res = normalize_persian_text(code_text)
        self.assertIn("def test():\n    return 'hello world'", res)


class TestPersonaManager(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = os.path.join(self.temp_dir.name, "persona_test.json")
        self.manager = PersonaManager(config_path=self.config_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_default_template_contains_identity(self) -> None:
        config = self.manager.get_config()
        self.assertTrue(config.get("system_name"))
        self.assertIn("OmniOps AI", config.get("system_name", ""))
        self.assertIn("دستورالعمل بنیادین", config.get("template", ""))

    def test_render_system_prompt(self) -> None:
        rendered = self.manager.render_system_prompt()
        self.assertIn("OmniOps AI", rendered)
        self.assertIn("OmniOps-02", rendered)
        self.assertNotIn("{system_name}", rendered)

    def test_build_chat_messages(self) -> None:
        msgs = self.manager.build_chat_messages(prompt="سلام")
        self.assertEqual(len(msgs), 2)
        self.assertEqual(msgs[0]["role"], "system")
        self.assertIn("OmniOps AI", msgs[0]["content"])
        self.assertEqual(msgs[1]["role"], "user")
        self.assertEqual(msgs[1]["content"], "سلام")

    def test_update_and_reset_config(self) -> None:
        saved = self.manager.update_config(
            system_name="تست سامانه سفارشی",
            template="الگوی تست برای {system_name} با حداقل طول لازم برای تست اعتبارسنجی",
            normalize_persian=False,
            diacritics_assistance=False,
        )
        self.assertEqual(saved["system_name"], "تست سامانه سفارشی")
        rendered = self.manager.render_system_prompt()
        self.assertIn("الگوی تست برای تست سامانه سفارشی", rendered)

        # Reset
        reset = self.manager.reset_to_default()
        self.assertEqual(reset["system_name"], "OmniOps AI")
        self.assertIn("دستورالعمل بنیادین", reset["template"])


if __name__ == "__main__":
    unittest.main()
