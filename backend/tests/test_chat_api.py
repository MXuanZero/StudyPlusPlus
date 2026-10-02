"""Tests for chat session CRUD and SSE streaming (Mock + MockTransport)."""
from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings as app_settings
from backend.app.db import init_db
from backend.app.main import app
from backend.app.schemas.settings import LLMSettingsUpdate
from backend.app.services import llm


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(app_settings, "db_path", db_path)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    init_db()
    return db_path


@pytest.fixture
def client(temp_db):
    with TestClient(app) as test_client:
        yield test_client


def parse_sse(text: str) -> list[tuple[str, dict[str, Any]]]:
    """Parse a complete SSE response into ``(event, data)`` tuples."""

    events: list[tuple[str, dict[str, Any]]] = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event: str | None = None
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:") :].strip())
        if event is None:
            continue
        raw = "\n".join(data_lines) if data_lines else "{}"
        events.append((event, json.loads(raw)))
    return events


def create_session(client: TestClient, **kwargs: Any) -> str:
    response = client.post("/api/v1/chat/sessions", json=kwargs)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_session_crud_roundtrip(client):
    response = client.get("/api/v1/chat/sessions")
    assert response.status_code == 200
    assert response.json() == {"sessions": []}

    session_id = create_session(
        client, title="二阶系统答疑", context={"chapter": "ch05"}
    )
    sessions = client.get("/api/v1/chat/sessions").json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["id"] == session_id
    assert sessions[0]["title"] == "二阶系统答疑"
    assert sessions[0]["context"] == {"chapter": "ch05"}
    assert sessions[0]["message_count"] == 0

    messages = client.get(f"/api/v1/chat/sessions/{session_id}/messages")
    assert messages.status_code == 200
    assert messages.json() == {"messages": []}

    deleted = client.delete(f"/api/v1/chat/sessions/{session_id}")
    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True}
    assert client.get(f"/api/v1/chat/sessions/{session_id}/messages").status_code == 404


def test_stream_unknown_session_returns_404(client):
    response = client.post(
        "/api/v1/chat/sessions/sess_missing/stream",
        json={"content": "hello"},
    )
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["code"] == "SESSION_NOT_FOUND"


def test_mock_stream_sse_format_and_persistence(client):
    session_id = create_session(
        client,
        title="Mock 测试",
        context={"book": "控制之美（卷 1）", "chapter": "ch05"},
    )
    response = client.post(
        f"/api/v1/chat/sessions/{session_id}/stream",
        json={"content": "什么是二阶系统？"},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")

    events = parse_sse(response.text)
    event_types = [event for event, _ in events]
    assert event_types[0] == "meta"
    assert "delta" in event_types
    assert event_types[-1] == "done"
    assert "error" not in event_types

    meta = events[0][1]
    assert meta["mode"] == "mock"
    assert meta["message_id"].startswith("msg_")

    combined = "".join(data["content"] for event, data in events if event == "delta")
    assert "Mock" in combined
    assert "API Key" in combined

    # Persisted history: user then assistant.
    messages = client.get(
        f"/api/v1/chat/sessions/{session_id}/messages"
    ).json()["messages"]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "什么是二阶系统？"
    assert messages[1]["content"] == combined
    assert messages[1]["id"].startswith("msg_")

    # Session list reports the message count and keeps its context.
    sessions = client.get("/api/v1/chat/sessions").json()["sessions"]
    assert sessions[0]["message_count"] == 2
    assert sessions[0]["context"] == {"book": "控制之美（卷 1）", "chapter": "ch05"}


def test_stream_context_in_request_updates_session(client):
    session_id = create_session(client, title="上下文")
    response = client.post(
        f"/api/v1/chat/sessions/{session_id}/stream",
        json={
            "content": "阶跃响应是什么？",
            "context": {
                "book": "控制之美（卷 1）",
                "chapter": "ch05",
                "topic": "ch05-03",
                "learning_objectives": ["理解阶跃"],
                "learning_path": ["第5章"],
            },
        },
    )
    assert response.status_code == 200
    session = client.get("/api/v1/chat/sessions").json()["sessions"][0]
    assert session["context"]["topic"] == "ch05-03"
    assert session["context"]["learning_objectives"] == ["理解阶跃"]


def test_live_stream_with_mock_transport(client, monkeypatch):
    secret = "sk-live-123456"
    llm.save_llm_settings(
        LLMSettingsUpdate(
            provider="custom",
            base_url="https://llm.example.com",
            model="test-model",
            api_key=secret,
        )
    )

    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization", "")
        captured["payload"] = json.loads(request.content)
        chunks = [
            'data: {"choices":[{"delta":{"content":"二"}}]}',
            'data: {"choices":[{"delta":{"content":"阶"}}]}',
            'data: {"choices":[{"delta":{"content":"系统"}}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}',
            "data: [DONE]",
        ]
        return httpx.Response(
            200,
            text="\n\n".join(chunks) + "\n\n",
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(
        llm,
        "_build_async_client",
        lambda timeout: httpx.AsyncClient(
            transport=httpx.MockTransport(handler), timeout=timeout
        ),
    )

    session_id = create_session(client, title="Live 测试", context={"chapter": "ch05"})
    response = client.post(
        f"/api/v1/chat/sessions/{session_id}/stream",
        json={"content": "解释一下"},
    )
    assert response.status_code == 200, response.text

    events = parse_sse(response.text)
    assert [event for event, _ in events] == ["meta", "delta", "delta", "delta", "done"]
    assert events[0][1]["mode"] == "live"
    assert "".join(data["content"] for event, data in events if event == "delta") == "二阶系统"
    assert events[-1][1]["usage"] == {
        "prompt_tokens": 10,
        "completion_tokens": 3,
        "total_tokens": 13,
    }

    # Request went to the normalized URL with the Bearer key and injected context.
    assert captured["url"] == "https://llm.example.com/v1/chat/completions"
    assert captured["auth"] == f"Bearer {secret}"
    messages = captured["payload"]["messages"]
    assert messages[0]["role"] == "system"
    assert "当前学习上下文" in messages[0]["content"]
    assert "ch05" in messages[0]["content"]
    assert messages[-1] == {"role": "user", "content": "解释一下"}
    assert captured["payload"]["stream"] is True

    # Assistant reply is persisted.
    persisted = client.get(
        f"/api/v1/chat/sessions/{session_id}/messages"
    ).json()["messages"]
    assert persisted[-1]["role"] == "assistant"
    assert persisted[-1]["content"] == "二阶系统"


def test_stream_upstream_http_error_hides_api_key(client, monkeypatch):
    secret = "sk-super-secret-987654"
    llm.save_llm_settings(
        LLMSettingsUpdate(
            provider="custom",
            base_url="https://llm.example.com",
            model="test-model",
            api_key=secret,
        )
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={"error": {"message": f"Invalid API key: {secret}"}},
        )

    monkeypatch.setattr(
        llm,
        "_build_async_client",
        lambda timeout: httpx.AsyncClient(
            transport=httpx.MockTransport(handler), timeout=timeout
        ),
    )

    session_id = create_session(client)
    response = client.post(
        f"/api/v1/chat/sessions/{session_id}/stream",
        json={"content": "hi"},
    )
    assert response.status_code == 200
    events = parse_sse(response.text)
    assert events[0][0] == "meta"
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "LLM_AUTH_ERROR"
    assert secret not in response.text
    assert secret not in json.dumps(events, ensure_ascii=False)


def test_stream_timeout_emits_classified_error(client, monkeypatch):
    secret = "sk-timeout-123456"
    llm.save_llm_settings(
        LLMSettingsUpdate(
            provider="custom",
            base_url="https://llm.example.com",
            api_key=secret,
        )
    )

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("read timed out", request=request)

    monkeypatch.setattr(
        llm,
        "_build_async_client",
        lambda timeout: httpx.AsyncClient(
            transport=httpx.MockTransport(handler), timeout=timeout
        ),
    )

    session_id = create_session(client)
    response = client.post(
        f"/api/v1/chat/sessions/{session_id}/stream",
        json={"content": "hi"},
    )
    assert response.status_code == 200
    events = parse_sse(response.text)
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "LLM_TIMEOUT"
    assert secret not in response.text
