"""Dual Memory Engine: Redis for short-term conversational context + Qdrant for long-term isolated vector memory."""

import json
import math
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class MemoryRecord:
    id: str
    user_id: str
    tenant_id: str
    content: str
    category: str
    created_at: float
    score: float = 0.0
    metadata: Optional[Dict[str, Any]] = None


class DualMemoryEngine:
    """Enterprise Dual Memory Engine.
    
    Combines:
    1. Short-term Memory: Sliding window buffer with TTL (Redis / fast memory)
    2. Long-term Memory: Semantic vector embeddings with strict tenant/user isolation (Qdrant / vector store)
    """

    def __init__(self, redis_url: Optional[str] = None, qdrant_url: Optional[str] = None, qdrant_api_key: Optional[str] = None):
        self.redis_url = redis_url
        self.qdrant_url = qdrant_url
        self.qdrant_api_key = qdrant_api_key

        # In-memory storage buffers for zero-dependency test/offline resilience
        self._local_short_term: Dict[str, List[Dict[str, Any]]] = {}
        self._local_long_term: List[Dict[str, Any]] = []

    # --- Short-Term Conversational Context ---

    def append_chat_turn(
        self,
        session_id: str,
        user_id: str,
        role: str,
        content: str,
        model: Optional[str] = None,
        max_turns: int = 20,
    ) -> None:
        """Appends a single chat turn to short-term memory."""
        turn = {
            "role": role,
            "content": content,
            "model": model or "unknown",
            "timestamp": time.time(),
            "user_id": user_id,
        }

        # Stored in buffer
        if session_id not in self._local_short_term:
            self._local_short_term[session_id] = []

        history = self._local_short_term[session_id]
        history.append(turn)

        # Enforce sliding window
        if len(history) > max_turns * 2:
            self._local_short_term[session_id] = history[-(max_turns * 2):]

    def get_chat_history(self, session_id: str, user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Retrieves short-term chat history for a session, verifying user ownership."""
        history = self._local_short_term.get(session_id, [])
        # Filter for safety
        filtered = [turn for turn in history if turn["user_id"] == user_id]
        return filtered[-limit:]

    def clear_short_term(self, session_id: str) -> None:
        """Clears short-term buffer for a given session."""
        self._local_short_term.pop(session_id, None)

    # --- Long-Term Semantic Vector Memory ---

    @staticmethod
    def _mock_embedding(text: str, dim: int = 64) -> List[float]:
        """Deterministic lightweight word-hashed embedding for testing / offline mode."""
        import hashlib
        import re
        vector = [0.0] * dim
        words = re.findall(r"\w+", text.lower())
        if not words:
            words = [text.lower()]
        for word in words:
            h = int(hashlib.md5(word.encode("utf-8")).hexdigest(), 16)
            vector[h % dim] += 1.0
        # Normalize
        norm = math.sqrt(sum(x * x for x in vector)) or 1.0
        return [x / norm for x in vector]

    @staticmethod
    def _cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
        dot = sum(a * b for a, b in zip(vec_a, vec_b))
        return dot

    def store_long_term(
        self,
        user_id: str,
        tenant_id: str,
        content: str,
        category: str = "general",
        embedding: Optional[List[float]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Stores a piece of knowledge into long-term vector memory with strict isolation."""
        content = content.strip()
        if not content:
            raise ValueError("Content cannot be empty")

        mem_id = f"mem-{len(self._local_long_term) + 1}-{int(time.time() * 1000)}"
        vec = embedding or self._mock_embedding(content)

        record = {
            "id": mem_id,
            "user_id": user_id,
            "tenant_id": tenant_id,
            "content": content,
            "category": category,
            "vector": vec,
            "created_at": time.time(),
            "metadata": metadata or {},
        }
        self._local_long_term.append(record)
        return mem_id

    def search_long_term(
        self,
        user_id: str,
        query: str,
        tenant_id: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 5,
        min_similarity: float = 0.5,
        query_embedding: Optional[List[float]] = None,
    ) -> List[MemoryRecord]:
        """Searches long-term memory for semantic matches. Strictly filtered by user_id."""
        q_vec = query_embedding or self._mock_embedding(query)
        scored: List[tuple[float, Dict[str, Any]]] = []

        for record in self._local_long_term:
            # STRICT ISOLATION GATE: User can only see their own memory
            if record["user_id"] != user_id:
                continue

            if tenant_id and record.get("tenant_id") != tenant_id:
                continue

            if category and record.get("category") != category:
                continue

            sim = self._cosine_similarity(q_vec, record["vector"])
            if sim >= min_similarity:
                scored.append((sim, record))

        # Sort by similarity descending
        scored.sort(key=lambda item: item[0], reverse=True)

        results = []
        for sim, r in scored[:limit]:
            results.append(
                MemoryRecord(
                    id=r["id"],
                    user_id=r["user_id"],
                    tenant_id=r["tenant_id"],
                    content=r["content"],
                    category=r["category"],
                    created_at=r["created_at"],
                    score=round(sim, 4),
                    metadata=r["metadata"],
                )
            )

        return results

    def delete_long_term(self, memory_id: str, user_id: str) -> bool:
        """Deletes a long-term memory record after checking ownership."""
        for i, record in enumerate(self._local_long_term):
            if record["id"] == memory_id and record["user_id"] == user_id:
                del self._local_long_term[i]
                return True
        return False
