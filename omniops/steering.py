"""OmniOps Project Steering Files Engine.

Discovers, parses, and persists project steering rules (.omniops/steering.yaml),
ensuring agents strictly adhere to project-level design, architecture, and safety policies.
"""

import json
from pathlib import Path
from typing import Any, Dict, List


DEFAULT_STEERING_RULES = [
    "معماری سه‌لایه Master-Worker-Edge و اصل نظارت انسانی (Human-in-the-Loop) همواره رعایت شود.",
    "هویت بصری یکپارچه (طیف فیروزه‌ای/زمردی #00f0ff و #00ffaa، فونت وزیرمتن و چیدمان راست‌به‌چپ RTL) حفظ گردد.",
    "فرامین سیستمی و تغییرات تخریبی در سندباکس محدود شده و پیش از اجرا نیازمند تأیید صریح کاربر است.",
    "کدنویسی به صورت تمیز، ماژولار و با حفظ کامل کامنت‌ها و توابع موجود انجام پذیرد.",
    "تمامی رویدادها، تغییرات فایل و گام‌های اجرایی در لاگ نظارتی سازمان (Audit Trail) ثبت شوند.",
]


def get_default_steering(project_name: str = "") -> Dict[str, Any]:
    return {
        "version": "1.0",
        "project_name": project_name or "OmniOps Project",
        "project_rules": list(DEFAULT_STEERING_RULES),
        "guidelines": {
            "visual_identity": {
                "primary_color": "#00f0ff",
                "secondary_color": "#00ffaa",
                "font_family": "Vazirmatn",
                "direction": "rtl",
            },
            "architecture": {
                "model": "Master-Worker-Edge",
                "human_in_the_loop": True,
                "sandbox_isolation": True,
            },
            "allowed_tools": [
                "git",
                "npm",
                "python",
                "pytest",
                "cargo",
                "go",
                "node",
            ],
        },
    }


def dump_steering_yaml(data: Dict[str, Any]) -> str:
    """Serializes steering data into clean, readable YAML without external dependencies."""
    lines = [
        "# ========================================================",
        "# OmniOps Project Steering Rules & Autonomous Agent Policy",
        "# ========================================================",
        f"version: {data.get('version', '1.0')}",
        f"project_name: {data.get('project_name', 'OmniOps Project')}",
        "",
        "project_rules:",
    ]

    rules = data.get("project_rules") or []
    for r in rules:
        clean_r = str(r).replace("\n", " ").strip()
        lines.append(f"  - \"{clean_r}\"")

    lines.append("")
    lines.append("guidelines:")

    guidelines = data.get("guidelines") or {}
    for section, sec_val in guidelines.items():
        if isinstance(sec_val, dict):
            lines.append(f"  {section}:")
            for k, v in sec_val.items():
                if isinstance(v, list):
                    lines.append(f"    {k}:")
                    for item in v:
                        lines.append(f"      - \"{item}\"")
                elif isinstance(v, bool):
                    lines.append(f"    {k}: {'true' if v else 'false'}")
                else:
                    lines.append(f"    {k}: \"{v}\"")
        elif isinstance(sec_val, list):
            lines.append(f"  {section}:")
            for item in sec_val:
                lines.append(f"    - \"{item}\"")
        elif isinstance(sec_val, bool):
            lines.append(f"  {section}: {'true' if sec_val else 'false'}")
        else:
            lines.append(f"  {section}: \"{sec_val}\"")

    return "\n".join(lines) + "\n"


def parse_steering_yaml(content: str) -> Dict[str, Any]:
    """Lightweight parser for steering YAML and JSON files."""
    text = content.strip()
    if not text:
        return get_default_steering()

    if text.startswith("{"):
        try:
            return json.loads(text)
        except Exception:
            pass

    res: Dict[str, Any] = {
        "version": "1.0",
        "project_name": "",
        "project_rules": [],
        "guidelines": {},
    }

    lines = text.splitlines()
    current_key = None
    current_sub_key = None

    for raw_line in lines:
        line = raw_line.split("#")[0].rstrip()
        if not line.strip():
            continue

        indent = len(line) - len(line.lstrip())
        stripped = line.strip()

        if indent == 0 and ":" in stripped:
            k, v = stripped.split(":", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            current_key = k
            current_sub_key = None
            if v:
                res[k] = v
            elif k == "project_rules":
                res["project_rules"] = []
            elif k == "guidelines":
                res["guidelines"] = {}
        elif indent == 2 and current_key == "project_rules" and stripped.startswith("-"):
            rule_text = stripped[1:].strip().strip('"').strip("'")
            if rule_text:
                res["project_rules"].append(rule_text)
        elif indent == 2 and current_key == "guidelines" and ":" in stripped:
            sub_k, sub_v = stripped.split(":", 1)
            sub_k = sub_k.strip()
            sub_v = sub_v.strip().strip('"').strip("'")
            current_sub_key = sub_k
            if sub_v:
                if sub_v.lower() == "true":
                    res["guidelines"][sub_k] = True
                elif sub_v.lower() == "false":
                    res["guidelines"][sub_k] = False
                else:
                    res["guidelines"][sub_k] = sub_v
            else:
                res["guidelines"][sub_k] = {}
        elif indent == 4 and current_key == "guidelines" and current_sub_key:
            target_sub = res["guidelines"].get(current_sub_key)
            if stripped.startswith("-"):
                if not isinstance(target_sub, list):
                    res["guidelines"][current_sub_key] = []
                    target_sub = res["guidelines"][current_sub_key]
                val = stripped[1:].strip().strip('"').strip("'")
                target_sub.append(val)
            elif ":" in stripped:
                if not isinstance(target_sub, dict):
                    res["guidelines"][current_sub_key] = {}
                    target_sub = res["guidelines"][current_sub_key]
                leaf_k, leaf_v = stripped.split(":", 1)
                leaf_k = leaf_k.strip()
                leaf_v = leaf_v.strip().strip('"').strip("'")
                if leaf_v.lower() == "true":
                    target_sub[leaf_k] = True
                elif leaf_v.lower() == "false":
                    target_sub[leaf_k] = False
                else:
                    target_sub[leaf_k] = leaf_v

    if not res.get("project_rules"):
        res["project_rules"] = list(DEFAULT_STEERING_RULES)

    return res
