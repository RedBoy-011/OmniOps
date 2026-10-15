"""Tests for OmniOps Unified Design Tokens (Phase 1)."""

import json
from pathlib import Path
import unittest

REPO_ROOT = Path(__file__).resolve().parent.parent


class DesignTokensTests(unittest.TestCase):
    def test_shared_tokens_json_valid_and_has_magenta_default(self):
        token_path = REPO_ROOT / "design-system" / "tokens.json"
        self.assertTrue(token_path.is_file(), f"tokens.json not found at {token_path}")

        with open(token_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertEqual(data.get("defaultPalette"), "magenta")
        palettes = data.get("palettes", {})
        self.assertIn("magenta", palettes)
        self.assertIn("cyan", palettes)
        self.assertIn("emerald", palettes)
        self.assertIn("amber", palettes)
        self.assertIn("indigo", palettes)

        magenta = palettes["magenta"]
        self.assertEqual(magenta["primary"].lower(), "#f43f5e")
        self.assertEqual(magenta["bgApp"].lower(), "#100b15")

    def test_web_and_edge_css_tokens_contain_magenta(self):
        web_css = REPO_ROOT / "web" / "app" / "src" / "design-system" / "tokens.css"
        edge_css = REPO_ROOT / "agent" / "windows-edge" / "src" / "design-system" / "tokens.css"
        mobile_css = REPO_ROOT / "mobile" / "android" / "app" / "src" / "main" / "assets" / "style.css"

        for path in (web_css, edge_css, mobile_css):
            self.assertTrue(path.is_file(), f"CSS file missing: {path}")
            content = path.read_text(encoding="utf-8")
            self.assertIn("#f43f5e", content)
            self.assertIn("magenta", content)

    def test_ts_tokens_export_palettes(self):
        web_ts = REPO_ROOT / "web" / "app" / "src" / "design-system" / "tokens.ts"
        edge_ts = REPO_ROOT / "agent" / "windows-edge" / "src" / "design-system" / "tokens.ts"

        for path in (web_ts, edge_ts):
            self.assertTrue(path.is_file(), f"TS file missing: {path}")
            content = path.read_text(encoding="utf-8")
            self.assertIn("DEFAULT_PALETTE", content)
            self.assertIn('"magenta"', content)
            self.assertIn("applyThemePalette", content)


if __name__ == "__main__":
    unittest.main()
