"""Tests for editable tutor system prompt settings."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings as app_settings
from backend.app.db import init_db
from backend.app.main import app
from backend.app.services import prompt


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app_settings, "db_path", tmp_path / "prompt-test.db")
    init_db()
    with TestClient(app) as test_client:
        yield test_client


def test_prompt_settings_default_custom_and_reset(client: TestClient) -> None:
    default_prompt = prompt.load_default_system_prompt()

    response = client.get("/api/v1/settings/prompt")
    assert response.status_code == 200
    body = response.json()
    assert body["system_prompt"] == default_prompt
    assert body["default_system_prompt"] == default_prompt
    assert body["is_custom"] is False

    custom_prompt = "你是 StudyPlusPlus 的测试助教。请使用非常简洁的中文回答。"
    response = client.put(
        "/api/v1/settings/prompt",
        json={"system_prompt": custom_prompt},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["system_prompt"] == custom_prompt
    assert body["is_custom"] is True

    messages = prompt.build_messages(
        [{"role": "user", "content": "什么是超调量？"}],
        context={"chapter": "二阶系统"},
    )
    assert custom_prompt in messages[0]["content"]
    assert "当前学习上下文" in messages[0]["content"]

    response = client.post("/api/v1/settings/prompt/reset")
    assert response.status_code == 200
    body = response.json()
    assert body["system_prompt"] == default_prompt
    assert body["is_custom"] is False


def test_prompt_settings_rejects_blank(client: TestClient) -> None:
    response = client.put(
        "/api/v1/settings/prompt",
        json={"system_prompt": "   "},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "VALIDATION_ERROR"
