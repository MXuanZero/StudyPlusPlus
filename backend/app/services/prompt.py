"""System prompt loading and chapter-context injection for the AI tutor."""
from __future__ import annotations

import json
import sqlite3
from functools import lru_cache
from typing import Any

from ..config import settings
from ..db import get_connection, utc_now

FALLBACK_SYSTEM_PROMPT = (
    "你是 StudyPlusPlus 的控制理论助教，面向数学和物理基础薄弱的初学者。"
    "先给直觉和类比，再给结论；使用简体中文，分段清晰；"
    "结合当前章节和知识点回答，不声称引用教材原文。"
    "输出数学公式时优先使用 LaTeX：行内公式用 $...$，独立公式用 $$...$$。"
)

CONTEXT_HEADING = "## 当前学习上下文"
CONTEXT_GUARD = (
    "请围绕上面的学习上下文回答；如果用户问题与上下文无关，"
    "可以作答，但要先说明它不属于当前章节。"
)

SYSTEM_PROMPT_KEY = "tutor_system_prompt"
MAX_SYSTEM_PROMPT_CHARS = 20_000

# Keep context injection bounded so a malformed client payload cannot blow up
# the request size or prompt cost.
MAX_CONTEXT_CHARS = 4000


@lru_cache(maxsize=1)
def load_default_system_prompt() -> str:
    """Load the built-in ``prompts/tutor_system.md`` file.

    The file is cached because it is static for the lifetime of the process.
    A conservative fallback keeps the service usable if the file is removed.
    """

    prompt_path = settings.prompts_dir / "tutor_system.md"
    try:
        text = prompt_path.read_text(encoding="utf-8").strip()
    except OSError:
        return FALLBACK_SYSTEM_PROMPT
    return text or FALLBACK_SYSTEM_PROMPT


def get_stored_system_prompt() -> str | None:
    """Return the user-edited system prompt stored in ``app_settings``.

    Returns ``None`` when no custom prompt is saved, the database is not
    initialized yet, or the stored value is blank/invalid.
    """

    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT value_json FROM app_settings WHERE key = ?",
                (SYSTEM_PROMPT_KEY,),
            ).fetchone()
    except sqlite3.OperationalError:
        return None
    if row is None:
        return None
    try:
        value = json.loads(row["value_json"])
    except (TypeError, json.JSONDecodeError):
        return None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def is_system_prompt_custom() -> bool:
    """Whether the effective system prompt comes from user settings."""

    return get_stored_system_prompt() is not None


def load_tutor_system_prompt() -> str:
    """Return the effective tutor system prompt.

    Priority: user-edited prompt in SQLite > built-in prompt file.
    The current chapter context is appended later by :func:`build_system_prompt`.
    """

    return get_stored_system_prompt() or load_default_system_prompt()


def save_system_prompt(text: str) -> str:
    """Persist a custom system prompt and return the effective prompt."""

    cleaned = text.strip()
    if not cleaned:
        return reset_system_prompt()
    if len(cleaned) > MAX_SYSTEM_PROMPT_CHARS:
        cleaned = cleaned[:MAX_SYSTEM_PROMPT_CHARS]
    now = utc_now()
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO app_settings (key, value_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value_json = excluded.value_json,
              updated_at = excluded.updated_at
            """,
            (SYSTEM_PROMPT_KEY, json.dumps(cleaned, ensure_ascii=False), now),
        )
    return cleaned


def reset_system_prompt() -> str:
    """Delete the user-edited prompt and return the built-in default."""

    with get_connection() as conn:
        conn.execute(
            "DELETE FROM app_settings WHERE key = ?",
            (SYSTEM_PROMPT_KEY,),
        )
    return load_default_system_prompt()


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


def _extract_quotes(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Read persisted quote metadata from a history row.

    ``_fetch_history`` returns raw ``meta_json`` strings, but tests and future
    callers may pass an already-decoded ``meta`` dict; support both shapes.
    """

    raw = item.get("meta_json", item.get("meta"))
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, dict):
        return []
    quotes = raw.get("quotes")
    return quotes if isinstance(quotes, list) else []


def _format_quoted_user_content(content: str, quotes: list[dict[str, Any]]) -> str:
    """Prepend quoted course excerpts to the user message sent to the model."""

    lines: list[str] = []
    for quote in quotes[:10]:
        if not isinstance(quote, dict):
            continue
        text = str(quote.get("text") or "").strip()
        if not text:
            continue
        source = str(quote.get("source") or "").strip()
        line = f"> {text}"
        if source:
            line += f"\n> —— {source}"
        lines.append(line)

    if not lines:
        return content
    return (
        "用户引用了以下课程内容，请结合引用回答；"
        "如果引用与问题无关，请先指出这一点。\n\n"
        + "\n\n".join(lines)
        + f"\n\n我的问题：{content}"
    )


def build_messages(
    history: list[dict[str, Any]],
    context: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """Build the OpenAI-compatible message list.

    ``history`` should already contain the latest user message (the chat
    router persists it before streaming). System messages are skipped because
    the system prompt is generated server-side. Persisted quote metadata is
    injected ahead of the user's question so the tutor can ground its answer.
    """

    messages: list[dict[str, str]] = [
        {"role": "system", "content": build_system_prompt(context)}
    ]
    for item in history:
        role = item.get("role")
        content = item.get("content")
        if role == "user" and isinstance(content, str) and content:
            quotes = _extract_quotes(item)
            messages.append(
                {
                    "role": "user",
                    "content": _format_quoted_user_content(content, quotes)
                    if quotes
                    else content,
                }
            )
        elif role == "assistant" and isinstance(content, str) and content:
            messages.append({"role": "assistant", "content": content})
    return messages
