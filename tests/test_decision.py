"""Unit tests for OmniOps Central Decision Layer (Hybrid Laya + Jev)."""
from __future__ import annotations

import os
import tempfile
import unittest

from omniops.decision import (
    DecisionAnswer,
    DecisionLayer,
    DecisionQuestion,
    DecisionRequest,
    DecisionType,
    LayaLocalEngine,
    JevEngine,
)


class TestDecisionContracts(unittest.TestCase):
    def test_question_serialization(self) -> None:
        q = DecisionQuestion(
            name="test_choice",
            type=DecisionType.CHOICE,
            criteria="Select test option",
            options=["opt_a", "opt_b"],
        )
        d = q.to_dict()
        self.assertEqual(d["name"], "test_choice")
        self.assertEqual(d["type"], "choice")
        self.assertEqual(d["options"], ["opt_a", "opt_b"])

        q_rev = DecisionQuestion.from_dict(d)
        self.assertEqual(q_rev.name, q.name)
        self.assertEqual(q_rev.type, DecisionType.CHOICE)

    def test_answer_typed_values(self) -> None:
        # Choice answer
        ans_c = DecisionAnswer(
            question_name="q_choice",
            type=DecisionType.CHOICE,
            value="opt_a",
            probability=0.85,
            confidence=0.90,
            engine="laya",
        )
        self.assertIsInstance(ans_c.value, str)

        # Score answer
        ans_s = DecisionAnswer(
            question_name="q_score",
            type=DecisionType.SCORE,
            value=0.75,
            probability=0.75,
            confidence=0.88,
            engine="laya",
        )
        self.assertIsInstance(ans_s.value, float)

        # Noul answer
        ans_n = DecisionAnswer(
            question_name="q_noul",
            type=DecisionType.NOUL,
            value=True,
            probability=0.82,
            confidence=0.85,
            engine="laya",
        )
        self.assertIsInstance(ans_n.value, bool)


class TestLayaLocalEngine(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = LayaLocalEngine()

    def test_model_selection_coding_intent(self) -> None:
        q = DecisionQuestion(
            name="model_selection",
            type=DecisionType.CHOICE,
            criteria="Choose model for python code",
            options=["qwen2.5-coder:7b", "llama3.3:70b", "deepseek-r1:8b"],
        )
        req = DecisionRequest(
            state="def fibonacci(n):\n    if n <= 1: return n\n    return fibonacci(n-1) + fibonacci(n-2)",
            questions=[q],
        )
        answers, needs_escalate, _ = self.engine.evaluate(req, threshold=0.70)
        ans = answers["model_selection"]
        self.assertEqual(ans.value, "qwen2.5-coder:7b")
        self.assertGreaterEqual(ans.confidence, 0.70)
        self.assertFalse(needs_escalate)

    def test_destructive_risk_assessment(self) -> None:
        q_choice = DecisionQuestion(
            name="risk_level",
            type=DecisionType.CHOICE,
            criteria="Assess risk",
            options=["low", "medium", "high", "critical"],
        )
        req = DecisionRequest(state="rm -rf /var/log/* && DROP TABLE users;", questions=[q_choice])
        answers, _, _ = self.engine.evaluate(req, threshold=0.60)
        self.assertIn(answers["risk_level"].value, ("high", "critical"))

    def test_plan_vs_act_noul(self) -> None:
        # Complex architectural task requires plan
        q_plan = DecisionQuestion(
            name="plan_vs_act",
            type=DecisionType.NOUL,
            criteria="Need plan",
        )
        req = DecisionRequest(
            state="طراحی معماری مجدد سیستم خط لوله انتقال داده و مهاجرت دیتابیس به همراه ریفکتور سرویس‌های زیرساخت",
            questions=[q_plan],
        )
        answers, _, _ = self.engine.evaluate(req, threshold=0.70)
        self.assertTrue(answers["plan_vs_act"].value)

    def test_overflow_escalation_triggers(self) -> None:
        # Context too long (> 16000 chars)
        q = DecisionQuestion(name="q1", type=DecisionType.NOUL, criteria="test")
        req_long = DecisionRequest(state="x" * 17000, questions=[q])
        _, needs_escalate, reason = self.engine.evaluate(req_long, threshold=0.75)
        self.assertTrue(needs_escalate)
        self.assertIn("context_too_long", reason or "")

        # Options overflow (> 20 options)
        q_many = DecisionQuestion(
            name="q_many",
            type=DecisionType.CHOICE,
            criteria="test",
            options=[f"opt_{i}" for i in range(25)],
        )
        req_many = DecisionRequest(state="test prompt", questions=[q_many])
        _, needs_escalate_opts, reason_opts = self.engine.evaluate(req_many, threshold=0.75)
        self.assertTrue(needs_escalate_opts)
        self.assertIn("options_overflow", reason_opts or "")


class TestDecisionLayer(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = os.path.join(self.temp_dir.name, "decision_test.json")
        self.layer = DecisionLayer(config_path=self.config_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_hybrid_decision_flow(self) -> None:
        # Normal task uses Laya
        ans_model = self.layer.decide_model(
            state="کد پایتون برای مرتب‌سازی سریع آرایه‌ها",
            available_models=["qwen2.5-coder:7b", "llama3.3:70b"],
        )
        self.assertEqual(ans_model.value, "qwen2.5-coder:7b")
        self.assertEqual(ans_model.engine, "laya")

    def test_tool_gating_decision(self) -> None:
        ans_tool = self.layer.decide_tool_gating("لطفاً فایل config.json را بخوان و ویرایش کن")
        self.assertEqual(ans_tool.value, "file")

    def test_risk_assessment_helpers(self) -> None:
        lvl, score = self.layer.assess_risk("پایگاه داده اصلی سازمان", "DROP DATABASE production;")
        self.assertIn(lvl.value, ("high", "critical"))
        self.assertGreater(score.value, 0.5)

    def test_audit_logging_and_replay(self) -> None:
        q = DecisionQuestion(
            name="ping_test",
            type=DecisionType.NOUL,
            criteria="Is simple ping?",
        )
        resp = self.layer.decide(DecisionRequest(state="ping 127.0.0.1", questions=[q]))
        self.assertTrue(resp.decision_id)

        # Replay past decision
        replayed = self.layer.replay(resp.decision_id)
        self.assertIsNotNone(replayed)
        self.assertEqual(replayed["decision_id"], resp.decision_id)


if __name__ == "__main__":
    unittest.main()
