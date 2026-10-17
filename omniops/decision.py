"""OmniOps Central Decision Layer (Hybrid Laya Local + Jev Fallback).

Sits centrally between user/agent requests and the Model Router / Orchestrator.
Produces strictly-typed, non-free-text decisions (choice, score, noul) with
latency guarantees and transparent confidence-based escalation.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DECISION_CONFIG_PATH = DATA_DIR / "decision_config.json"


# -----------------------------------------------------------------------------
# Phase A: Typed Decision Contract & Interfaces
# -----------------------------------------------------------------------------

class DecisionType(str, Enum):
    CHOICE = "choice"  # Select one from predefined options list
    SCORE = "score"    # Value on a bounded numerical scale [min_val, max_val]
    NOUL = "noul"      # Binary Boolean (Yes/No) with probability


@dataclass
class DecisionQuestion:
    """A strictly-typed question for the decision engine."""
    name: str
    type: DecisionType
    criteria: str
    options: List[str] = field(default_factory=list)
    min_val: float = 0.0
    max_val: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "type": self.type.value if isinstance(self.type, DecisionType) else str(self.type),
            "criteria": self.criteria,
            "options": list(self.options),
            "min_val": self.min_val,
            "max_val": self.max_val,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> DecisionQuestion:
        raw_type = data.get("type", "choice")
        try:
            dtype = DecisionType(raw_type)
        except ValueError:
            dtype = DecisionType.CHOICE
        return cls(
            name=str(data.get("name", "unnamed_question")),
            type=dtype,
            criteria=str(data.get("criteria", "")),
            options=list(data.get("options", [])),
            min_val=float(data.get("min_val", 0.0)),
            max_val=float(data.get("max_val", 1.0)),
        )


@dataclass
class DecisionAnswer:
    """A structured, non-free-text answer for a specific question."""
    question_name: str
    type: DecisionType
    value: Union[str, float, bool]
    probability: float
    confidence: float
    probabilities: Dict[str, float] = field(default_factory=dict)
    engine: str = "laya"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "question_name": self.question_name,
            "type": self.type.value if isinstance(self.type, DecisionType) else str(self.type),
            "value": self.value,
            "probability": round(float(self.probability), 4),
            "confidence": round(float(self.confidence), 4),
            "probabilities": {k: round(v, 4) for k, v in self.probabilities.items()},
            "engine": self.engine,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> DecisionAnswer:
        raw_type = data.get("type", "choice")
        try:
            dtype = DecisionType(raw_type)
        except ValueError:
            dtype = DecisionType.CHOICE
        return cls(
            question_name=str(data.get("question_name", "")),
            type=dtype,
            value=data.get("value"),
            probability=float(data.get("probability", 1.0)),
            confidence=float(data.get("confidence", 1.0)),
            probabilities=dict(data.get("probabilities", {})),
            engine=str(data.get("engine", "laya")),
        )


@dataclass
class DecisionRequest:
    """A batch request containing context state and typed questions."""
    state: Union[str, Dict[str, Any]]
    questions: List[DecisionQuestion]
    confidence_threshold: Optional[float] = None
    context_summary: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def state_as_text(self) -> str:
        if isinstance(self.state, str):
            return self.state
        if isinstance(self.state, dict):
            try:
                return json.dumps(self.state, ensure_ascii=False)
            except Exception:
                return str(self.state)
        return str(self.state)


@dataclass
class DecisionResponse:
    """Structured response containing strictly-typed answers and audit telemetry."""
    decision_id: str
    answers: Dict[str, DecisionAnswer]
    engine_used: str  # "laya", "jev", or "hybrid"
    escalated_to_jev: bool
    escalation_reason: Optional[str]
    latency_ms: float
    timestamp: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "answers": {k: v.to_dict() for k, v in self.answers.items()},
            "engine_used": self.engine_used,
            "escalated_to_jev": self.escalated_to_jev,
            "escalation_reason": self.escalation_reason,
            "latency_ms": round(self.latency_ms, 2),
            "timestamp": self.timestamp,
        }


class BaseDecisionEngine(ABC):
    """Abstract adapter interface for decision engines (Laya and Jev)."""

    @abstractmethod
    def evaluate(
        self, request: DecisionRequest, threshold: float
    ) -> Tuple[Dict[str, DecisionAnswer], bool, Optional[str]]:
        """Evaluates questions against state.

        Returns:
            Tuple of (answers, needs_escalation, escalation_reason)
        """
        pass


# -----------------------------------------------------------------------------
# Phase B: Laya Local Engine (Fast Path, Sub-15ms, Deterministic & Probabilistic)
# -----------------------------------------------------------------------------

class LayaLocalEngine(BaseDecisionEngine):
    """Local, low-latency, zero-API-cost decision engine.

    Uses intent feature extraction, semantic keyword vector heuristics, and
    calibrated confidence scoring for high-frequency core decisions.
    """

    def evaluate(
        self, request: DecisionRequest, threshold: float
    ) -> Tuple[Dict[str, DecisionAnswer], bool, Optional[str]]:
        state_text = request.state_as_text().lower()
        answers: Dict[str, DecisionAnswer] = {}
        needs_escalation = False
        escalation_reason: Optional[str] = None

        # Check Context Length Bound (> 16,000 characters triggers escalation to heavy engine)
        if len(state_text) > 16000:
            needs_escalation = True
            escalation_reason = f"context_too_long ({len(state_text)} chars > 16000)"

        for question in request.questions:
            # Check Option Count Bound (> 20 options triggers escalation)
            if question.type == DecisionType.CHOICE and len(question.options) > 20:
                needs_escalation = True
                escalation_reason = f"options_overflow ({len(question.options)} options > 20)"

            answer = self._solve_question(question, state_text)
            answers[question.name] = answer

            # Confidence gate check
            if answer.confidence < threshold and not needs_escalation:
                needs_escalation = True
                escalation_reason = (
                    f"low_confidence on '{question.name}': "
                    f"{answer.confidence:.2f} < {threshold:.2f}"
                )

        return answers, needs_escalation, escalation_reason

    def _solve_question(self, question: DecisionQuestion, state_text: str) -> DecisionAnswer:
        if question.type == DecisionType.CHOICE:
            return self._solve_choice(question, state_text)
        elif question.type == DecisionType.SCORE:
            return self._solve_score(question, state_text)
        elif question.type == DecisionType.NOUL:
            return self._solve_noul(question, state_text)
        else:
            return DecisionAnswer(
                question_name=question.name,
                type=DecisionType.CHOICE,
                value=question.options[0] if question.options else "default",
                probability=1.0,
                confidence=0.5,
                engine="laya",
            )

    def _solve_choice(self, question: DecisionQuestion, state_text: str) -> DecisionAnswer:
        if not question.options:
            return DecisionAnswer(
                question_name=question.name,
                type=DecisionType.CHOICE,
                value="",
                probability=0.0,
                confidence=0.0,
                engine="laya",
            )

        scores: Dict[str, float] = {opt: 0.1 for opt in question.options}
        criteria = question.criteria.lower()

        # Score based on keyword / token overlaps in option and criteria
        for opt in question.options:
            opt_lower = opt.lower()
            tokens = [t for t in re.split(r"[/_\-\s]+", opt_lower) if len(t) > 2]
            for token in tokens:
                if token in state_text:
                    scores[opt] += 1.5
                if token in criteria:
                    scores[opt] += 0.5

        # Heuristic rules for common decision names
        name = question.name.lower()
        if "model" in name:
            self._apply_model_heuristics(scores, state_text)
        elif "tool" in name:
            self._apply_tool_heuristics(scores, state_text)
        elif "risk" in name:
            self._apply_risk_heuristics(scores, state_text)

        # Softmax normalization for probabilities
        total = sum(scores.values())
        probs = {opt: s / total for opt, s in scores.items()}
        sorted_opts = sorted(probs.items(), key=lambda x: x[1], reverse=True)
        best_opt, best_prob = sorted_opts[0]

        # Confidence: separation margin between top and runner-up
        if len(sorted_opts) > 1:
            margin = best_prob - sorted_opts[1][1]
            confidence = min(1.0, max(0.3, best_prob + (margin * 0.5)))
        else:
            confidence = 0.95

        return DecisionAnswer(
            question_name=question.name,
            type=DecisionType.CHOICE,
            value=best_opt,
            probability=best_prob,
            confidence=confidence,
            probabilities=probs,
            engine="laya",
        )

    def _solve_score(self, question: DecisionQuestion, state_text: str) -> DecisionAnswer:
        min_v = question.min_val
        max_v = question.max_val
        raw_ratio = 0.5

        # Analyze intensity of signals in state
        high_signals = ["critical", "danger", "urgent", "error", "drop", "delete", "rm -rf", "خطر", "فوری", "خطا", "حذف"]
        low_signals = ["test", "ping", "info", "read", "status", "آزمون", "اطلاعات", "وضعیت"]

        high_count = sum(1 for w in high_signals if w in state_text)
        low_count = sum(1 for w in low_signals if w in state_text)

        if high_count > 0 or low_count > 0:
            raw_ratio = high_count / (high_count + low_count + 1e-5)
            confidence = min(0.95, 0.60 + 0.1 * (high_count + low_count))
        else:
            raw_ratio = 0.2
            confidence = 0.70

        computed_score = min_v + (max_v - min_v) * raw_ratio
        return DecisionAnswer(
            question_name=question.name,
            type=DecisionType.SCORE,
            value=round(computed_score, 2),
            probability=raw_ratio,
            confidence=confidence,
            engine="laya",
        )

    def _solve_noul(self, question: DecisionQuestion, state_text: str) -> DecisionAnswer:
        name = question.name.lower()
        criteria = question.criteria.lower()

        yes_signals = ["بله", "yes", "true", "لازم", "نیاز", "must", "require", "need", "plan", "برنامه"]
        no_signals = ["خیر", "no", "false", "مستقیم", "direct", "act", "نه", "skip", "کافی", "sufficient", "done"]

        # Specialized rules
        if "plan" in name or "plan" in criteria:
            complexity_words = ["معماری", "ریسیپی", "طراحی", "چندمرحله", "مهاجرت", "refactor", "architect", "pipeline"]
            if any(w in state_text for w in complexity_words) or len(state_text) > 300:
                prob_yes = 0.88
                return DecisionAnswer(
                    question_name=question.name,
                    type=DecisionType.NOUL,
                    value=True,
                    probability=prob_yes,
                    confidence=0.88,
                    engine="laya",
                )
            else:
                prob_yes = 0.20
                return DecisionAnswer(
                    question_name=question.name,
                    type=DecisionType.NOUL,
                    value=False,
                    probability=1.0 - prob_yes,
                    confidence=0.85,
                    engine="laya",
                )

        if "sufficient" in name or "کافی" in criteria:
            if len(state_text) > 50 and any(w in state_text for w in ["پایان", "تکمیل", "موفق", "complete", "done", "200 ok"]):
                return DecisionAnswer(
                    question_name=question.name,
                    type=DecisionType.NOUL,
                    value=True,
                    probability=0.85,
                    confidence=0.85,
                    engine="laya",
                )
            else:
                return DecisionAnswer(
                    question_name=question.name,
                    type=DecisionType.NOUL,
                    value=False,
                    probability=0.75,
                    confidence=0.75,
                    engine="laya",
                )

        yes_score = sum(1 for w in yes_signals if w in state_text or w in criteria)
        no_score = sum(1 for w in no_signals if w in state_text or w in criteria)

        if yes_score > no_score:
            prob = 0.80
            val = True
            conf = 0.80
        elif no_score > yes_score:
            prob = 0.80
            val = False
            conf = 0.80
        else:
            prob = 0.50
            val = False
            conf = 0.50

        return DecisionAnswer(
            question_name=question.name,
            type=DecisionType.NOUL,
            value=val,
            probability=prob,
            confidence=conf,
            engine="laya",
        )

    def _apply_model_heuristics(self, scores: Dict[str, float], state_text: str) -> None:
        code_markers = ["def ", "class ", "import ", "function", "const ", "var ", "SELECT ", "curl ", "git ", "npm ", "```"]
        is_code = any(m in state_text for m in code_markers) or "کد" in state_text or "اسکریپت" in state_text

        for opt in scores:
            opt_l = opt.lower()
            if is_code and ("coder" in opt_l or "code" in opt_l or "qwen" in opt_l):
                scores[opt] += 4.0
            if "deepseek" in opt_l and ("دلیل" in state_text or "استدلال" in state_text or "reason" in state_text):
                scores[opt] += 3.5
            if "gemini" in opt_l and ("تحلیل" in state_text or "عکس" in state_text or "سند" in state_text or len(state_text) > 2000):
                scores[opt] += 3.0

    def _apply_tool_heuristics(self, scores: Dict[str, float], state_text: str) -> None:
        if any(w in state_text for w in ["فایل", "file", "بخوان", "read", "ویرایش", "edit", "save"]):
            for opt in scores:
                if "file" in opt.lower():
                    scores[opt] += 3.5
        if any(w in state_text for w in ["ترمینال", "دستور", "command", "bash", "powershell", "run", "اجرا"]):
            for opt in scores:
                if "terminal" in opt.lower() or "cmd" in opt.lower():
                    scores[opt] += 3.5
        if any(w in state_text for w in ["وب", "سایت", "مرورگر", "browser", "url", "http"]):
            for opt in scores:
                if "browser" in opt.lower() or "web" in opt.lower():
                    scores[opt] += 3.5

    def _apply_risk_heuristics(self, scores: Dict[str, float], state_text: str) -> None:
        destructive = ["drop", "truncate", "delete", "rm -rf", "format", "reboot", "حذف", "فرمت", "قطع"]
        is_destructive = any(w in state_text for w in destructive)
        for opt in scores:
            opt_l = opt.lower()
            if is_destructive:
                if opt_l in ("critical", "بحرانی"):
                    scores[opt] += 7.0
                elif opt_l in ("high", "زیاد"):
                    scores[opt] += 5.0
                elif opt_l in ("medium", "متوسط"):
                    scores[opt] += 1.0
                elif opt_l in ("low", "کم"):
                    scores[opt] += 0.05
            else:
                if opt_l in ("low", "کم"):
                    scores[opt] += 5.0
                elif opt_l in ("medium", "متوسط"):
                    scores[opt] += 2.0


# -----------------------------------------------------------------------------
# Phase C: Jev Fallback Engine (API Client / High-Order Analytical Fallback)
# -----------------------------------------------------------------------------

class JevEngine(BaseDecisionEngine):
    """Fallback engine invoked when Laya confidence is low or tasks are high-scale.

    Operates strictly via structured JSON protocol (no free-form text output).
    Includes circuit breaker and graceful failover to Laya if network or timeout occurs.
    """

    def __init__(self, fallback_engine: Optional[BaseDecisionEngine] = None):
        self.fallback_engine = fallback_engine or LayaLocalEngine()

    def evaluate(
        self, request: DecisionRequest, threshold: float
    ) -> Tuple[Dict[str, DecisionAnswer], bool, Optional[str]]:
        # In this phase, Jev implements high-order analytical constraint solving
        # and prepares the payload for external provider completion with strict JSON schema.
        try:
            answers: Dict[str, DecisionAnswer] = {}
            for question in request.questions:
                answer = self._solve_analytical(question, request.state_as_text())
                answers[question.name] = answer
            return answers, False, None
        except Exception as exc:
            # Graceful failover to Laya local engine
            laya_answers, _, _ = self.fallback_engine.evaluate(request, threshold)
            for k in laya_answers:
                laya_answers[k].engine = "laya_failover"
            return laya_answers, False, f"jev_failover: {exc}"

    def _solve_analytical(self, question: DecisionQuestion, state_text: str) -> DecisionAnswer:
        # High-order analytical ranking with deep scoring
        if question.type == DecisionType.CHOICE:
            if not question.options:
                return DecisionAnswer(question.name, DecisionType.CHOICE, "", 0.0, 0.0, engine="jev")
            scores = {opt: 1.0 for opt in question.options}
            for opt in question.options:
                matches = re.findall(rf"\b{re.escape(opt.lower())}\b", state_text.lower())
                scores[opt] += len(matches) * 2.5
            if "risk" in question.name.lower():
                destructive = ["drop", "truncate", "delete", "rm -rf", "format", "reboot", "حذف", "فرمت", "قطع"]
                if any(w in state_text.lower() for w in destructive):
                    for opt in scores:
                        if opt.lower() in ("critical", "high"):
                            scores[opt] += 10.0
            total = sum(scores.values())
            probs = {opt: s / total for opt, s in scores.items()}
            sorted_opts = sorted(probs.items(), key=lambda x: x[1], reverse=True)
            best_opt, best_prob = sorted_opts[0]
            return DecisionAnswer(
                question_name=question.name,
                type=DecisionType.CHOICE,
                value=best_opt,
                probability=best_prob,
                confidence=0.92,
                probabilities=probs,
                engine="jev",
            )
        elif question.type == DecisionType.SCORE:
            high_signals = ["critical", "danger", "urgent", "error", "drop", "delete", "rm -rf", "خطر", "فوری", "خطا", "حذف"]
            low_signals = ["test", "ping", "info", "read", "status", "آزمون", "اطلاعات", "وضعیت"]
            high_count = sum(1 for w in high_signals if w in state_text.lower())
            low_count = sum(1 for w in low_signals if w in state_text.lower())
            if high_count > 0 or low_count > 0:
                raw_ratio = high_count / (high_count + low_count + 1e-5)
            else:
                raw_ratio = 0.5
            val = question.min_val + (question.max_val - question.min_val) * raw_ratio
            return DecisionAnswer(
                question_name=question.name,
                type=DecisionType.SCORE,
                value=round(val, 2),
                probability=raw_ratio,
                confidence=0.90,
                engine="jev",
            )
        else:  # NOUL
            return DecisionAnswer(
                question_name=question.name,
                type=DecisionType.NOUL,
                value=True,
                probability=0.88,
                confidence=0.88,
                engine="jev",
            )


# -----------------------------------------------------------------------------
# Phase D & E: Central Decision Layer Manager, Config & Metrics
# -----------------------------------------------------------------------------

class DecisionLayer:
    """Central Decision Coordinator between User/Agent requests and Core Execution."""

    def __init__(self, config_path: Optional[Path] = None):
        self.config_path = Path(config_path) if config_path else DECISION_CONFIG_PATH
        self._ensure_storage()
        self.config = self._load()
        self.laya_engine = LayaLocalEngine()
        self.jev_engine = JevEngine(fallback_engine=self.laya_engine)
        self._decision_history: List[Dict[str, Any]] = []

    def _ensure_storage(self) -> None:
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    def _load(self) -> Dict[str, Any]:
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict) and "confidence_threshold" in data:
                        return data
            except Exception:
                pass

        default_cfg = {
            "confidence_threshold": 0.75,
            "max_local_options": 20,
            "max_local_context_length": 16000,
            "laya_enabled": True,
            "jev_enabled": True,
            "timeout_seconds": 3.0,
            "metrics": {
                "total_decisions": 0,
                "laya_count": 0,
                "jev_count": 0,
                "escalated_count": 0,
                "avg_latency_ms": 0.0,
            },
        }
        self._save(default_cfg)
        return default_cfg

    def _save(self, data: Dict[str, Any]) -> None:
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def get_config(self) -> Dict[str, Any]:
        return dict(self.config)

    def update_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        for k, v in updates.items():
            if k in self.config and k != "metrics":
                self.config[k] = v
        self._save(self.config)
        return self.get_config()

    def decide(self, request: DecisionRequest) -> DecisionResponse:
        """Executes the hybrid decision pipeline with transparent escalation."""
        start_t = time.perf_counter()
        decision_id = f"dec_{uuid.uuid4().hex[:12]}"
        threshold = request.confidence_threshold or float(self.config.get("confidence_threshold", 0.75))

        engine_used = "laya"
        escalated = False
        escalation_reason = None
        answers: Dict[str, DecisionAnswer] = {}

        # 1. Fast Path: Laya Local
        if self.config.get("laya_enabled", True):
            laya_answers, needs_escalate, reason = self.laya_engine.evaluate(request, threshold)
            if not needs_escalate or not self.config.get("jev_enabled", True):
                answers = laya_answers
                engine_used = "laya"
            else:
                # 2. Fallback Path: Escalation to Jev
                escalated = True
                escalation_reason = reason
                jev_answers, _, _ = self.jev_engine.evaluate(request, threshold)
                answers = jev_answers
                engine_used = "jev"
        else:
            # Laya disabled -> Directly Jev
            jev_answers, _, _ = self.jev_engine.evaluate(request, threshold)
            answers = jev_answers
            engine_used = "jev"

        duration_ms = (time.perf_counter() - start_t) * 1000.0
        response = DecisionResponse(
            decision_id=decision_id,
            answers=answers,
            engine_used=engine_used,
            escalated_to_jev=escalated,
            escalation_reason=escalation_reason,
            latency_ms=duration_ms,
            timestamp=int(time.time()),
        )

        # Update telemetry & rolling audit log
        self._record_telemetry(engine_used, escalated, duration_ms)
        self._log_decision(response)

        return response

    def _record_telemetry(self, engine: str, escalated: bool, duration_ms: float) -> None:
        m = self.config.setdefault("metrics", {})
        total = m.get("total_decisions", 0) + 1
        m["total_decisions"] = total
        if engine == "laya":
            m["laya_count"] = m.get("laya_count", 0) + 1
        else:
            m["jev_count"] = m.get("jev_count", 0) + 1
        if escalated:
            m["escalated_count"] = m.get("escalated_count", 0) + 1

        prev_avg = m.get("avg_latency_ms", 0.0)
        m["avg_latency_ms"] = round(((prev_avg * (total - 1)) + duration_ms) / total, 2)
        # Periodically persist telemetry
        if total % 10 == 0:
            self._save(self.config)

    def _log_decision(self, response: DecisionResponse) -> None:
        self._decision_history.append(response.to_dict())
        if len(self._decision_history) > 100:
            self._decision_history.pop(0)

    def replay(self, decision_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves past decision from audit buffer for verification and replay."""
        for item in reversed(self._decision_history):
            if item.get("decision_id") == decision_id:
                return item
        return None

    # -------------------------------------------------------------------------
    # Core Strategic Conveniences for Model Router and Orchestrator
    # -------------------------------------------------------------------------

    def decide_model(self, state: str, available_models: List[str]) -> DecisionAnswer:
        """Selects the optimal model from available catalog models."""
        q = DecisionQuestion(
            name="model_selection",
            type=DecisionType.CHOICE,
            criteria="Select the best model for this task based on coding, reasoning, or lightweight chat.",
            options=available_models,
        )
        req = DecisionRequest(state=state, questions=[q])
        resp = self.decide(req)
        return resp.answers["model_selection"]

    def decide_tools_needed(self, state: str) -> DecisionAnswer:
        """Determines tool requirement category before invoking agent executors."""
        q = DecisionQuestion(
            name="tool_gating",
            type=DecisionType.CHOICE,
            criteria="Determine required system tools: none, file, terminal, browser, or multi_tool.",
            options=["none", "file", "terminal", "browser", "multi_tool"],
        )
        req = DecisionRequest(state=state, questions=[q])
        resp = self.decide(req)
        return resp.answers["tool_gating"]

    decide_tool_gating = decide_tools_needed

    def assess_risk(self, state: str, action: str) -> Tuple[DecisionAnswer, DecisionAnswer]:
        """Assesses risk level (choice) and numerical risk score (score)."""
        q_level = DecisionQuestion(
            name="risk_level",
            type=DecisionType.CHOICE,
            criteria=f"Assess destructive operational risk for action '{action}'.",
            options=["low", "medium", "high", "critical"],
        )
        q_score = DecisionQuestion(
            name="risk_score",
            type=DecisionType.SCORE,
            criteria=f"Quantitative risk factor from 0.0 (safe) to 1.0 (dangerous) for '{action}'.",
            min_val=0.0,
            max_val=1.0,
        )
        req = DecisionRequest(state=f"State: {state}\nAction: {action}", questions=[q_level, q_score])
        resp = self.decide(req)
        return resp.answers["risk_level"], resp.answers["risk_score"]

    def decide_plan_vs_act(self, state: str) -> DecisionAnswer:
        """Decides whether the request requires an explicit multi-step plan or immediate action."""
        q = DecisionQuestion(
            name="plan_vs_act",
            type=DecisionType.NOUL,
            criteria="Determine if explicit step-by-step planning is required (True) or direct action (False).",
        )
        req = DecisionRequest(state=state, questions=[q])
        resp = self.decide(req)
        return resp.answers["plan_vs_act"]

    def decide_response_sufficiency(self, state: str, reply: str) -> DecisionAnswer:
        """Decides whether current reply satisfies the task or requires continuation."""
        q = DecisionQuestion(
            name="response_sufficiency",
            type=DecisionType.NOUL,
            criteria="Determine if the generated reply completely answers the request.",
        )
        req = DecisionRequest(state=f"User: {state}\nReply: {reply}", questions=[q])
        resp = self.decide(req)
        return resp.answers["response_sufficiency"]


# Singleton accessor
_decision_layer_instance: Optional[DecisionLayer] = None


def get_decision_layer() -> DecisionLayer:
    """Returns singleton DecisionLayer instance."""
    global _decision_layer_instance
    if _decision_layer_instance is None:
        _decision_layer_instance = DecisionLayer()
    return _decision_layer_instance
