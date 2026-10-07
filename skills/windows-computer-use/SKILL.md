---
name: windows-computer-use
description: Direct control of Windows desktop environment via native Rust Win32 APIs with mandatory user approval gate.
version: 1.0.0
author: OmniOps Enterprise
required_capabilities: [action.request, tool.execute]
---

# Windows Computer-Use Skill

This skill grants the agent the ability to interact with the Windows Desktop through the local Tauri v2 Rust runtime.

## Core Rules & Guardrails
1. **MANDATORY APPROVAL GATE**: Any operation that performs mouse clicks, keystrokes, launches processes, or modifies system settings MUST explicitly specify the target parameters and request human operator approval before execution.
2. **Safe Coordinate Boundaries**: Screen coordinates must be bounded within active monitor dimensions reported by the Windows display driver.
3. **Audit Trail**: Every command (mouse move, click, keystroke, shell execution) is recorded with timestamp and operator ID.

## Available Actions
- `click(x: int, y: int, button: 'left' | 'right' | 'double')`: Simulates cursor movement and click.
- `type_text(text: str)`: Types text using virtual keyboard events.
- `press_key(key_combo: str)`: Executes shortcut combinations (e.g., 'Win+R', 'Ctrl+Shift+Esc').
- `capture_screen(bounding_box: Optional[Rect])`: Takes an isolated screenshot for visual inspection.
- `execute_win32_command(command: str)`: Runs safe PowerShell/CMD utility with approval.
