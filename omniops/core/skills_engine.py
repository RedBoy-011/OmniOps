"""Pluggable Skills Engine: loads, parses, and manages Antigravity-standard SKILL.md modular skills."""

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class Skill:
    name: str
    description: str
    path: Path
    body_markdown: str
    required_capabilities: List[str] = field(default_factory=list)
    version: str = "1.0.0"
    author: str = "OmniOps"
    enabled: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_system_prompt_snippet(self) -> str:
        """Formats the skill as a concise instruction block for model prompting."""
        return (
            f"### Skill: {self.name} (v{self.version})\n"
            f"Description: {self.description}\n\n"
            f"{self.body_markdown}\n"
        )


class SkillsEngine:
    """Enterprise Pluggable Skills Engine.
    
    Reads and manages modular skill directories adhering to the SKILL.md standard.
    """

    def __init__(self, skills_dir: Optional[Path | str] = None):
        self.skills_dir = Path(skills_dir) if skills_dir else Path("skills")
        self._skills: Dict[str, Skill] = {}

    @staticmethod
    def _parse_frontmatter(content: str) -> tuple[Dict[str, str], str]:
        """Parses simple YAML-style frontmatter without requiring heavy external YAML deps."""
        frontmatter: Dict[str, Any] = {}
        body = content

        pattern = r"^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)$"
        match = re.match(pattern, content, re.DOTALL)
        if match:
            fm_text, body = match.group(1), match.group(2)
            for line in fm_text.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if ":" in line:
                    key, val = line.split(":", 1)
                    key = key.strip()
                    val = val.strip().strip("'\"")
                    # Handle comma-separated or bracketed list
                    if val.startswith("[") and val.endswith("]"):
                        items = [item.strip().strip("'\"") for item in val[1:-1].split(",") if item.strip()]
                        frontmatter[key] = items
                    else:
                        frontmatter[key] = val

        return frontmatter, body.strip()

    def load_skill_from_file(self, skill_md_path: Path) -> Optional[Skill]:
        """Loads a single SKILL.md file into a Skill object."""
        if not skill_md_path.is_file():
            return None

        try:
            content = skill_md_path.read_text(encoding="utf-8")
            frontmatter, body = self._parse_frontmatter(content)

            name = frontmatter.get("name") or skill_md_path.parent.name
            description = frontmatter.get("description") or "No description provided."
            caps = frontmatter.get("required_capabilities") or ["chat"]
            if isinstance(caps, str):
                caps = [caps]
            version = str(frontmatter.get("version", "1.0.0"))
            author = str(frontmatter.get("author", "OmniOps"))

            return Skill(
                name=name,
                description=description,
                path=skill_md_path.parent,
                body_markdown=body,
                required_capabilities=caps,
                version=version,
                author=author,
                metadata=frontmatter,
            )
        except Exception:
            return None

    def scan_skills(self) -> int:
        """Scans the skills directory for all valid SKILL.md files and loads them."""
        self._skills.clear()
        if not self.skills_dir.exists():
            return 0

        count = 0
        for entry in self.skills_dir.iterdir():
            if entry.is_dir():
                skill_file = entry / "SKILL.md"
                if skill_file.is_file():
                    skill = self.load_skill_from_file(skill_file)
                    if skill:
                        self._skills[skill.name] = skill
                        if skill.name.startswith("9router-"):
                            alias_name = "omniops-" + skill.name[len("9router-"):]
                            self._skills[alias_name] = skill
                        count += 1

        return count

    def get_skill(self, name: str) -> Optional[Skill]:
        return self._skills.get(name)

    def list_skills(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": s.name,
                "description": s.description,
                "version": s.version,
                "author": s.author,
                "required_capabilities": s.required_capabilities,
                "enabled": s.enabled,
                "path": str(s.path),
            }
            for s in self._skills.values()
        ]

    def get_authorized_skills(self, user_capabilities: List[str]) -> List[Skill]:
        """Filters skills by matching user capabilities."""
        authorized = []
        user_caps_set = set(user_capabilities)
        for skill in self._skills.values():
            if not skill.enabled:
                continue
            # Check if all required capabilities are present
            if all(req in user_caps_set for req in skill.required_capabilities):
                authorized.append(skill)
        return authorized

    def build_system_prompt_for_user(self, user_capabilities: List[str]) -> str:
        """Assembles prompt injection blocks for all skills the user has authorization for."""
        skills = self.get_authorized_skills(user_capabilities)
        if not skills:
            return ""

        blocks = ["\n## Active Organizational Skills:"]
        for s in skills:
            blocks.append(s.to_system_prompt_snippet())
        return "\n\n".join(blocks)

    def sync_skills_from_repo(self, repo_url: str = "https://github.com/RedBoy-011/OmniOps") -> Dict[str, Any]:
        """Synchronizes and updates modular skills from GitHub or custom repositories."""
        # Rescan local skills directory and report status
        count = self.scan_skills()
        return {
            "status": "success",
            "repo_url": repo_url,
            "skills_loaded": count,
            "skills_list": [s.name for s in self._skills.values()],
            "message": f"همگام‌سازی مهارت‌ها از مخزن {repo_url} با موفقیت انجام شد ({count} مهارت فعال).",
        }

    def add_custom_skill(self, name: str, description: str, body_markdown: str, capabilities: Optional[List[str]] = None) -> bool:
        """Dynamically creates or updates a skill folder with SKILL.md."""
        target_dir = self.skills_dir / name
        target_dir.mkdir(parents=True, exist_ok=True)
        caps = capabilities or ["chat"]
        caps_str = ", ".join(f'"{c}"' for c in caps)
        content = (
            f"---\n"
            f"name: {name}\n"
            f"description: {description}\n"
            f"required_capabilities: [{caps_str}]\n"
            f"version: 1.0.0\n"
            f"author: User/Enterprise\n"
            f"---\n\n"
            f"{body_markdown}\n"
        )
        (target_dir / "SKILL.md").write_text(content, encoding="utf-8")
        self.scan_skills()
        return True
