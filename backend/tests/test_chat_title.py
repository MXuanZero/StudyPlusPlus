"""Tests for automatic chat session titles."""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.config import settings as app_settings
from backend.app.db import init_db
from backend.app.main import app
from backend.app.services import llm
import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app_settings, "db_path", tmp_path / "title-test.db")
    init_db()
    with TestClient(app) as test_client:
        yield test_client


def test_first_message_generates_session_title(client: TestClient, monkeypatch) -> None:
    async def fake_summarize_title(user_message: str, config=None, client=None):
        return "二阶系统简介"

    monkeypatch.setattr(llm, "summarize_title", fake_summarize_title)

    session = client.post("/api/v1/chat/sessions", json={}).json()
    session_id = session["id"]

    response = client.post(
        f"/api/v1/chat/sessions/{session_id}/stream",
        json={"content": "请介绍一下二阶系统的主要参数"},
    )
    assert response.status_code == 200

    sessions = client.get("/api/v1/chat/sessions").json()["sessions"]
    target = next(item for item in sessions if item["id"] == session_id)
    assert target["title"] == "二阶系统简介"


def test_mock_mode_falls_back_to_truncated_question(client: TestClient) -> None:
    session = client.post("/api/v1/chat/sessions", json={}).json()
    session_id = session["id"]
    question = "请解释一下为什么欠阻尼系统会产生超调现象"
    response = client.post(
        f"/api/v1/chat/sessions/{session_id}/stream",
        json={"content": question},
    )
    assert response.status_code == 200

    sessions = client.get("/api/v1/chat/sessions").json()["sessions"]
    target = next(item for item in sessions if item["id"] == session_id)
    assert target["title"]
    assert target["title"] != "新会话"
    assert target["title"].startswith("请解释一下为什么欠阻尼系统")
