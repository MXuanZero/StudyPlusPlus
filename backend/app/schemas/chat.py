"""Pydantic schemas for chat sessions and streaming."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class ChatSessionCreate(BaseModel):
    """Body for ``POST /chat/sessions``. Both fields are optional."""

    title: str | None = Field(default=None, max_length=200)
    context: dict[str, Any] | None = None


class ChatQuote(BaseModel):
    """A passage selected from the courseware and quoted in a chat request."""

    id: str | None = Field(default=None, max_length=120)
    text: str = Field(min_length=1, max_length=5_000)
    source: str | None = Field(default=None, max_length=500)
    topic_id: str | None = Field(default=None, max_length=120)
    topic_title: str | None = Field(default=None, max_length=300)

    @field_validator("text")
    @classmethod
    def _text_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("引用内容不能为空")
        return value


class ChatStreamRequest(BaseModel):
    """Body for ``POST /chat/sessions/{id}/stream``."""

    content: str = Field(min_length=1, max_length=32_000)
    context: dict[str, Any] | None = None
    quotes: list[ChatQuote] = Field(default_factory=list, max_length=10)

    @field_validator("content")
    @classmethod
    def _content_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("消息内容不能为空")
        return value

    @field_validator("context")
    @classmethod
    def _context_must_be_object(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None and not isinstance(value, dict):
            raise ValueError("context 必须是 JSON 对象")
        return value


class ChatSessionResponse(BaseModel):
    """Session metadata returned to the frontend."""

    id: str
    title: str
    context: dict[str, Any] | None = None
    message_count: int = 0
    created_at: str
    updated_at: str


class ChatSessionsResponse(BaseModel):
    sessions: list[ChatSessionResponse]


class ChatMessageResponse(BaseModel):
    id: str
    session_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    created_at: str
    meta: dict[str, Any] | None = None


class ChatMessagesResponse(BaseModel):
    messages: list[ChatMessageResponse]


class DeleteSessionResponse(BaseModel):
    ok: bool = True
