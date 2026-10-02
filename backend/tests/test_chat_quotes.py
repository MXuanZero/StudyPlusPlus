"""Tests for quoted course excerpts sent to the AI tutor."""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.prompt import build_messages


def test_build_messages_injects_persisted_quotes() -> None:
    history = [
        {
            "role": "user",
            "content": "为什么这句话成立？",
            "meta_json": json.dumps(
                {
                    "quotes": [
                        {
                            "id": "q1",
                            "text": "欠阻尼系统的极点是一对共轭复数。",
                            "source": "第5章 / 二阶系统分析",
                        }
                    ]
                },
                ensure_ascii=False,
            ),
        }
    ]
    messages = build_messages(history, context={"chapter": "二阶系统分析"})
    assert messages[0]["role"] == "system"
    user_message = messages[-1]
    assert user_message["role"] == "user"
    assert "欠阻尼系统的极点是一对共轭复数" in user_message["content"]
    assert "第5章 / 二阶系统分析" in user_message["content"]
    assert "为什么这句话成立？" in user_message["content"]


def test_stream_persists_quotes_in_user_message_meta() -> None:
    with TestClient(app) as client:
        session = client.post("/api/v1/chat/sessions", json={"title": "引用测试"}).json()
        session_id = session["id"]
        try:
            response = client.post(
                f"/api/v1/chat/sessions/{session_id}/stream",
                json={
                    "content": "请解释这个结论",
                    "quotes": [
                        {
                            "id": "quote-1",
                            "text": "无阻尼系统会持续等幅振荡。",
                            "source": "第5章 / 二阶系统分析",
                            "topic_id": "ch05-03",
                            "topic_title": "单位阶跃响应",
                        }
                    ],
                },
            )
            assert response.status_code == 200
            assert "event: meta" in response.text
            assert "event: done" in response.text or "event: error" in response.text

            messages = client.get(
                f"/api/v1/chat/sessions/{session_id}/messages"
            ).json()["messages"]
            user_messages = [message for message in messages if message["role"] == "user"]
            assert len(user_messages) == 1
            quotes = user_messages[0]["meta"]["quotes"]
            assert quotes[0]["text"] == "无阻尼系统会持续等幅振荡。"
            assert quotes[0]["source"] == "第5章 / 二阶系统分析"
        finally:
            client.delete(f"/api/v1/chat/sessions/{session_id}")


def test_quote_validation_rejects_blank_text() -> None:
    with TestClient(app) as client:
        session = client.post("/api/v1/chat/sessions", json={}).json()
        session_id = session["id"]
        try:
            response = client.post(
                f"/api/v1/chat/sessions/{session_id}/stream",
                json={"content": "问题", "quotes": [{"text": "   "}]},
            )
            assert response.status_code == 422
            detail = response.json()["detail"]
            assert detail["code"] == "VALIDATION_ERROR"
        finally:
            client.delete(f"/api/v1/chat/sessions/{session_id}")
