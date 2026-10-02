"""Chat session CRUD and Server-Sent Events streaming endpoints."""
from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..db import get_connection, utc_now
from ..schemas.chat import (
    ChatMessageResponse,
    ChatMessagesResponse,
    ChatSessionCreate,
    ChatSessionResponse,
    ChatSessionsResponse,
    ChatStreamRequest,
    DeleteSessionResponse,
)
from ..services import llm, prompt

router = APIRouter(prefix="/chat", tags=["chat"])

SESSION_ID_PREFIX = "sess_"
MESSAGE_ID_PREFIX = "msg_"
DEFAULT_SESSION_TITLE = "新对话"
HISTORY_LIMIT = 40


def _new_id(prefix: str) -> str:
    return f"{prefix}{uuid4().hex[:12]}"


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _load_json(raw: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _row_to_session(row: Any) -> ChatSessionResponse:
    keys = row.keys()
    return ChatSessionResponse(
        id=row["id"],
        title=row["title"],
        context=_load_json(row["context_json"]),
        message_count=int(row["message_count"]) if "message_count" in keys else 0,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_message(row: Any) -> ChatMessageResponse:
    meta = _load_json(row["meta_json"])
    message_id = None
    if meta and isinstance(meta.get("message_id"), str):
        message_id = meta["message_id"]
    return ChatMessageResponse(
        id=message_id or str(row["id"]),
        session_id=row["session_id"],
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
        meta=meta,
    )


def _get_session_row(session_id: str):
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM chat_sessions WHERE id = ?", (session_id,)
        ).fetchone()


def _require_session(session_id: str):
    row = _get_session_row(session_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "SESSION_NOT_FOUND", "message": "会话不存在"},
        )
    return row


def _fetch_history(session_id: str, limit: int = HISTORY_LIMIT) -> list[dict[str, Any]]:
    """Return the most recent messages in chronological order."""

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, session_id, role, content, meta_json, created_at
            FROM chat_messages
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


def _insert_message(
    session_id: str,
    role: str,
    content: str,
    meta: dict[str, Any] | None = None,
) -> int:
    now = utc_now()
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO chat_messages (session_id, role, content, meta_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                session_id,
                role,
                content,
                json.dumps(meta, ensure_ascii=False) if meta else None,
                now,
            ),
        )
        message_id = int(cursor.lastrowid)
    return message_id


def _update_assistant_message(
    message_id: int,
    content: str,
    meta: dict[str, Any],
) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE chat_messages SET content = ?, meta_json = ? WHERE id = ?",
            (content, json.dumps(meta, ensure_ascii=False), message_id),
        )


def _delete_message(message_row_id: int) -> None:
    """Remove a message row that should not appear in history."""
    with get_connection() as conn:
        conn.execute("DELETE FROM chat_messages WHERE id = ?", (message_row_id,))


def _touch_session(session_id: str, context: dict[str, Any] | None) -> None:
    now = utc_now()
    with get_connection() as conn:
        if context is None:
            conn.execute(
                "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
                (now, session_id),
            )
        else:
            conn.execute(
                "UPDATE chat_sessions SET context_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(context, ensure_ascii=False), now, session_id),
            )


# ---------------------------------------------------------------------------
# Session CRUD
# ---------------------------------------------------------------------------


@router.get("/sessions", response_model=ChatSessionsResponse)
def list_sessions() -> ChatSessionsResponse:
    """List all chat sessions, most recently updated first."""

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT s.*,
                   (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id)
                     AS message_count
            FROM chat_sessions s
            ORDER BY s.updated_at DESC, s.id DESC
            """
        ).fetchall()
    return ChatSessionsResponse(sessions=[_row_to_session(row) for row in rows])


@router.post("/sessions", response_model=ChatSessionResponse, status_code=201)
def create_session(payload: ChatSessionCreate | None = None) -> ChatSessionResponse:
    """Create a chat session with an optional page context."""

    payload = payload or ChatSessionCreate()
    title = (payload.title or "").strip() or DEFAULT_SESSION_TITLE
    session_id = _new_id(SESSION_ID_PREFIX)
    now = utc_now()
    context_json = (
        json.dumps(payload.context, ensure_ascii=False)
        if payload.context is not None
        else None
    )
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO chat_sessions (id, title, context_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, title, context_json, now, now),
        )
    return ChatSessionResponse(
        id=session_id,
        title=title,
        context=payload.context,
        message_count=0,
        created_at=now,
        updated_at=now,
    )


@router.delete("/sessions/{session_id}", response_model=DeleteSessionResponse)
def delete_session(session_id: str) -> DeleteSessionResponse:
    """Delete a session and, via ON DELETE CASCADE, its messages."""

    _require_session(session_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
    return DeleteSessionResponse(ok=True)


@router.get("/sessions/{session_id}/messages", response_model=ChatMessagesResponse)
def list_messages(session_id: str) -> ChatMessagesResponse:
    """Return persisted messages in chronological order."""

    _require_session(session_id)
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, session_id, role, content, meta_json, created_at
            FROM chat_messages
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()
    return ChatMessagesResponse(messages=[_row_to_message(row) for row in rows])


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


@router.post("/sessions/{session_id}/stream")
async def stream_message(session_id: str, payload: ChatStreamRequest) -> StreamingResponse:
    """Persist the user message and stream the assistant reply as SSE.

    Event order is always ``meta -> delta* -> done`` or
    ``meta -> delta* -> error``. The helper inserts an assistant row before
    streaming so ``meta.message_id`` is also the id returned by the history
    endpoint.
    """

    session = _require_session(session_id)
    user_content = payload.content.strip()

    # Context precedence: request context (and update the session) > stored.
    if payload.context is not None:
        context = payload.context
        _touch_session(session_id, context)
    else:
        context = _load_json(session["context_json"])
        _touch_session(session_id, None)

    user_meta = None
    if payload.quotes:
        user_meta = {
            "quotes": [
                quote.model_dump(exclude_none=True) for quote in payload.quotes
            ]
        }
    _insert_message(session_id, "user", user_content, user_meta)
    history = _fetch_history(session_id)

    config, key_source = llm.resolve_llm_settings()
    mode = "live" if config.api_key else "mock"

    assistant_meta = {"message_id": _new_id(MESSAGE_ID_PREFIX), "mode": mode}
    assistant_row_id = _insert_message(session_id, "assistant", "", assistant_meta)
    messages = prompt.build_messages(history, context=context)

    async def event_stream():
        content_parts: list[str] = []
        usage: dict[str, Any] = {}
        error_event: llm.StreamEvent | None = None
        finish_reason: str | None = None

        yield _sse(
            "meta",
            {
                "message_id": assistant_meta["message_id"],
                "mode": mode,
                "created_at": utc_now(),
            },
        )
        try:
            async for event in llm.stream_chat(messages, config):
                if event.type == "delta" and event.content:
                    content_parts.append(event.content)
                    yield _sse("delta", {"content": event.content})
                elif event.type == "done":
                    usage = event.usage or {}
                    finish_reason = event.finish_reason
                    break
                elif event.type == "error":
                    error_event = event
                    yield _sse(
                        "error",
                        {"code": event.code or "LLM_ERROR", "message": event.message or "调用大模型失败。"},
                    )
                    break
        finally:
            final_content = "".join(content_parts)
            final_meta = dict(assistant_meta)
            if usage:
                final_meta["usage"] = usage
            if finish_reason:
                final_meta["finish_reason"] = finish_reason
            if error_event:
                final_meta["error_code"] = error_event.code
            if error_event is not None and not final_content:
                # Do not leave an empty assistant bubble in history when the
                # upstream call fails before producing any text.
                _delete_message(assistant_row_id)
            else:
                # Persist even partial output so the user can retry / reload.
                _update_assistant_message(assistant_row_id, final_content, final_meta)

        if error_event is not None:
            return
        yield _sse(
            "done",
            {
                "message_id": assistant_meta["message_id"],
                "usage": usage,
            },
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
