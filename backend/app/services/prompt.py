"""System prompt loading and chapter-context injection for the AI tutor."""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from ..config import settings

FALLBACK_SYSTEM_PROMPT = (
    "你是 StudyPlusPlus 的控制理论助教，面向数学和物理基础薄弱的初学者。"
    "先给直觉和类比，再给结论；使用简体中文，分段清晰；"
    "结合当前章节和知识点回答，不声称引用教材原文。"
)

CONTEXT_HEADING = "## 当前学习上下文"
CONTEXT_GUARD = (
    "请围绕上面的学习上下文回答；如果用户问题与上下文无关，"
    "可以作答，但要先说明它不属于当前章节。"
)

# Keep context injection bounded so a malformed client payload cannot blow up
# the request size or prompt cost.
MAX_CONTEXT_CHARS = 4000


@lru_cache(maxsize=1)
def load_tutor_system_prompt() -> str:
    """Load ``prompts/tutor_system.md``.

    The file is cached because it is static for the lifetime of the process.
    A conservative fallback keeps the service usable if the file is removed.
    """

    prompt_path = settings.prompts_dir / "tutor_system.md"
    try:
        text = prompt_path.read_text(encoding="utf-8").strip()
    except OSError:
        return FALLBACK_SYSTEM_PROMPT
    return text or FALLBACK_SYSTEM_PROMPT


def normalize_context(context: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize flat or nested chapter-context payloads.

    The frontend may send either the flat shape used by the chat panel
    (``book``/``chapter``/``topic``/...) or the nested
    ``{"current_page": {...}, "learning_path": [...]}`` shape from docs/02.
    """

    if not context:
        return {}
    normalized = dict(context)
    current_page = normalized.get("current_page")
    if isinstance(current_page, dict):
        for key in ("book", "chapter", "topic"):
            value = current_page.get(key)
            if value is not None and key not in normalized:
                normalized[key] = value
        objectives = current_page.get("learning_objectives")
        if objectives is not None and "learning_objectives" not in normalized:
            normalized["learning_objectives"] = objectives
    return normalized


def build_system_prompt(context: dict[str, Any] | None = None) -> str:
    """Combine the tutor template with the current chapter context."""

    base_prompt = load_tutor_system_prompt()
    normalized = normalize_context(context)

    if not normalized:
        context_block = (
            f"{CONTEXT_HEADING}\n"
            "用户当前尚未进入具体章节。请先给通用但通俗的解释，"
            "并在合适时提醒用户可以打开第 5 章学习具体内容。"
        )
    else:
        serialized = json.dumps(normalized, ensure_ascii=False, indent=2)
        if len(serialized) > MAX_CONTEXT_CHARS:
            serialized = serialized[:MAX_CONTEXT_CHARS] + "\n...（上下文已截断）"
        context_block = f"{CONTEXT_HEADING}\n```json\n{serialized}\n```"

    return f"{base_prompt}\n\n{context_block}\n\n{CONTEXT_GUARD}"


def build_messages(
    history: list[dict[str, Any]],
    context: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """Build the OpenAI-compatible message list.

    ``history`` should already contain the latest user message (the chat
    router persists it before streaming). System messages are skipped because
    the system prompt is generated server-side.
    """

    messages: list[dict[str, str]] = [
        {"role": "system", "content": build_system_prompt(context)}
    ]
    for item in history:
        role = item.get("role")
        content = item.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content:
            messages.append({"role": role, "content": content})
    return messages
