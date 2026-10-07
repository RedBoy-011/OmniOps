"""RTK Token Saver (Real-Time Tool Output Compressor):
Inspired by 9Router RTK architecture, compresses tool_result outputs (git diff, grep, ls, build logs)
by 20% to 40% before passing them to LLM context, preventing quota exhaustion and token waste.
"""

import re
from dataclasses import dataclass
from typing import Any, Dict, Tuple


@dataclass
class RTKCompressionResult:
    original_tokens: int
    compressed_tokens: int
    saved_tokens: int
    savings_percent: float
    tool_type: str
    compressed_text: str


class RTKCompressor:
    """Intelligent compression engine for AI tool outputs and terminal logs."""

    ANSI_ESCAPE_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
    DIFF_HUNK_RE = re.compile(r"^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@")

    def _estimate_tokens(self, text: str) -> int:
        return max(1, int(len(text) / 3.6))

    def strip_ansi(self, text: str) -> str:
        """Removes all ANSI terminal color and formatting escape codes."""
        return self.ANSI_ESCAPE_RE.sub("", text)

    def compress_git_diff(self, diff_text: str, max_context_lines: int = 2) -> str:
        """Compresses git diff by stripping verbose index headers and pruning excessive context lines."""
        lines = self.strip_ansi(diff_text).splitlines()
        compressed_lines = []
        consecutive_context = 0

        for line in lines:
            # Skip noise metadata lines
            if line.startswith("index ") or line.startswith("old mode ") or line.startswith("new mode "):
                continue

            if line.startswith("diff --git ") or line.startswith("--- ") or line.startswith("+++ "):
                compressed_lines.append(line)
                consecutive_context = 0
                continue

            if line.startswith("@@"):
                compressed_lines.append(line)
                consecutive_context = 0
                continue

            # Modified lines (+ or -) are critical and always kept
            if line.startswith("+") or line.startswith("-"):
                compressed_lines.append(line)
                consecutive_context = 0
            else:
                # Context line (leading space)
                if consecutive_context < max_context_lines:
                    compressed_lines.append(line)
                    consecutive_context += 1
                elif consecutive_context == max_context_lines:
                    compressed_lines.append("  ...")
                    consecutive_context += 1

        return "\n".join(compressed_lines)

    def compress_git_log(self, log_text: str) -> str:
        """Compresses verbose git log outputs into single-line semantic entries."""
        cleaned = self.strip_ansi(log_text)
        # If already oneline format, return cleaned
        lines = cleaned.splitlines()
        compressed = []
        current_commit = ""
        current_author = ""
        current_msg = ""

        for line in lines:
            line_str = line.strip()
            if line_str.startswith("commit "):
                if current_commit:
                    compressed.append(f"{current_commit[:8]} | {current_author} | {current_msg}")
                current_commit = line_str.replace("commit ", "")
                current_author = ""
                current_msg = ""
            elif line_str.startswith("Author:"):
                current_author = line_str.replace("Author:", "").strip().split("<")[0].strip()
            elif line_str.startswith("Date:"):
                continue
            elif line_str and not line.startswith("    "):
                continue
            elif line_str and line.startswith("    "):
                if not current_msg:
                    current_msg = line_str

        if current_commit:
            compressed.append(f"{current_commit[:8]} | {current_author} | {current_msg}")

        return "\n".join(compressed) if compressed else cleaned

    def compress_directory_listing(self, ls_text: str) -> str:
        """Filters noisy build artifacts (node_modules, .git, venv, target) from directory trees."""
        lines = self.strip_ansi(ls_text).splitlines()
        ignored_patterns = (
            "node_modules",
            ".git",
            ".cache",
            "venv",
            ".venv",
            "__pycache__",
            "target/debug",
            "target/release",
            "dist/",
            "build/",
            ".next",
        )
        compressed = []
        suppressed_count = 0

        for line in lines:
            if any(ign in line for ign in ignored_patterns):
                suppressed_count += 1
                continue
            compressed.append(line)

        if suppressed_count > 0:
            compressed.append(f"... [{suppressed_count} items pruned by RTK Token Saver (dependencies/cache)]")

        return "\n".join(compressed)

    def compress_grep_output(self, grep_text: str, max_line_length: int = 180) -> str:
        """Truncates huge single-line matches and strips redundant prefixes."""
        lines = self.strip_ansi(grep_text).splitlines()
        compressed = []

        for line in lines:
            if len(line) > max_line_length:
                compressed.append(line[:max_line_length] + " ... [RTK truncated]")
            else:
                compressed.append(line)

        return "\n".join(compressed)

    def compress_general_log(self, log_text: str, max_repeated_lines: int = 3) -> str:
        """Deduplicates repetitive progress bars, repeated exceptions, or excessive whitespace."""
        cleaned = self.strip_ansi(log_text)
        lines = cleaned.splitlines()
        compressed = []
        last_line = None
        repeat_count = 0

        for line in lines:
            stripped = line.rstrip()
            # Collapse progress bar noise
            if stripped.startswith("[=") or stripped.startswith("==>") or "%" in stripped and ("[" in stripped and "]" in stripped):
                continue

            if stripped == last_line:
                repeat_count += 1
                if repeat_count < max_repeated_lines:
                    compressed.append(stripped)
                elif repeat_count == max_repeated_lines:
                    compressed.append("  [... repeating lines collapsed by RTK ...]")
            else:
                last_line = stripped
                repeat_count = 0
                compressed.append(stripped)

        return "\n".join(compressed)

    def compress_tool_result(self, raw_output: str, tool_name: str = "general") -> RTKCompressionResult:
        """Main dispatcher for compressing any tool_result content."""
        if not raw_output or len(raw_output) < 80:
            orig_t = self._estimate_tokens(raw_output)
            return RTKCompressionResult(
                original_tokens=orig_t,
                compressed_tokens=orig_t,
                saved_tokens=0,
                savings_percent=0.0,
                tool_type=tool_name,
                compressed_text=raw_output,
            )

        orig_t = self._estimate_tokens(raw_output)
        lower_name = tool_name.lower()

        if "diff" in lower_name or "git" in lower_name and "diff" in raw_output[:300]:
            compressed = self.compress_git_diff(raw_output)
            tool_detected = "git_diff"
        elif "log" in lower_name and ("commit " in raw_output[:200] or "Author:" in raw_output[:200]):
            compressed = self.compress_git_log(raw_output)
            tool_detected = "git_log"
        elif "ls" in lower_name or "dir" in lower_name or "find" in lower_name:
            compressed = self.compress_directory_listing(raw_output)
            tool_detected = "directory_listing"
        elif "grep" in lower_name or "search" in lower_name:
            compressed = self.compress_grep_output(raw_output)
            tool_detected = "grep_search"
        else:
            compressed = self.compress_general_log(raw_output)
            tool_detected = "general_log"

        comp_t = self._estimate_tokens(compressed)
        saved_t = max(0, orig_t - comp_t)
        pct = round((saved_t / orig_t * 100.0), 1) if orig_t > 0 else 0.0

        return RTKCompressionResult(
            original_tokens=orig_t,
            compressed_tokens=comp_t,
            saved_tokens=saved_t,
            savings_percent=pct,
            tool_type=tool_detected,
            compressed_text=compressed,
        )
