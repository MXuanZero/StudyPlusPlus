"""Tests for LLM provider configuration, masking and settings API."""
from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings as app_settings
from backend.app.db import init_db
from backend.app.main import app
from backend.app.schemas.settings import LLMSettingsUpdate
from backend.app.services import llm, prompt


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """Isolate every test in a throwaway SQLite database and no ambient key."""

    db_path = tmp_path / "test.db"
    monkeypatch.setattr(app_settings, "db_path", db_path)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    init_db()
    return db_path


@pytest.fixture
def client(temp_db):
    with TestClient(app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# Pure helpers: presets, URL normalization, masking
# ---------------------------------------------------------------------------


def test_provider_presets_are_not_deepseek_only():
    assert set(llm.PROVIDER_PRESETS) >= {"deepseek", "openai", "ollama", "custom"}
    assert llm.PROVIDER_PRESETS["openai"]["model"] == "gpt-4o-mini"
    assert llm.PROVIDER_PRESETS["ollama"]["base_url"].endswith("/v1")
    assert llm.PROVIDER_PRESETS["custom"]["base_url"] == ""


def test_normalize_base_url_rules():
    assert llm.normalize_base_url("https://api.deepseek.com") == (
        "https://api.deepseek.com/v1"
    )
    assert llm.normalize_base_url("https://api.deepseek.com/") == (
        "https://api.deepseek.com/v1"
    )
    assert llm.normalize_base_url("https://api.openai.com/v1") == (
        "https://api.openai.com/v1"
    )
    assert llm.normalize_base_url("https://api.openai.com/v1/") == (
        "https://api.openai.com/v1"
    )
    # Idempotent when the user pasted the full endpoint.
    assert llm.normalize_base_url(
        "https://api.deepseek.com/v1/chat/completions"
    ) == "https://api.deepseek.com/v1"
    assert llm.normalize_base_url(
        "https://api.deepseek.com/chat/completions"
    ) == "https://api.deepseek.com/v1"
    assert llm.normalize_base_url("http://localhost:11434") == (
        "http://localhost:11434/v1"
    )
    assert llm.normalize_base_url("") == ""
    assert (
        llm.chat_completions_url("https://api.deepseek.com")
        == "https://api.deepseek.com/v1/chat/completions"
    )


def test_mask_api_key_never_returns_full_key():
    assert llm.mask_api_key("") == ""
    assert llm.mask_api_key("ab") == "**"
    masked = llm.mask_api_key("sk-1234567890abcdef")
    assert masked == "****cdef"
    assert "1234567890" not in masked


def test_sanitize_error_message_redacts_secrets():
    message = "invalid key sk-abcdef123456 for request"
    cleaned = llm.sanitize_error_message(message, "sk-abcdef123456")
    assert "sk-abcdef123456" not in cleaned
    assert "abcdef123456" not in cleaned
    assert cleaned == "invalid key *** for request"


def test_prompt_injects_chapter_context():
    system_prompt = prompt.build_system_prompt(
        {"chapter": "ch05", "topic": "ch05-03", "learning_path": ["第5章"]}
    )
    assert "控制理论助教" in system_prompt
    assert "当前学习上下文" in system_prompt
    assert "ch05-03" in system_prompt

    # Nested docs/02 shape also works.
    nested = prompt.normalize_context(
        {"current_page": {"book": "控制之美", "topic": "二阶系统"}}
    )
    assert nested["book"] == "控制之美"
    assert nested["topic"] == "二阶系统"


# ---------------------------------------------------------------------------
# API key resolution priority
# ---------------------------------------------------------------------------


def test_api_key_priority_database_over_environment(temp_db, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "sk-env-123456")
    config, source = llm.resolve_llm_settings()
    assert source == "environment"
    assert config.api_key == "sk-env-123456"

    llm.save_llm_settings(
        LLMSettingsUpdate(provider="deepseek", api_key="sk-db-789012")
    )
    config, source = llm.resolve_llm_settings()
    assert source == "database"
    assert config.api_key == "sk-db-789012"


def test_api_key_falls_back_to_mock_when_missing(temp_db, monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    config, source = llm.resolve_llm_settings()
    assert source == "none"
    assert config.api_key == ""
    assert llm.is_mock_mode() is True


def test_empty_api_key_update_preserves_stored_key(temp_db):
    llm.save_llm_settings(LLMSettingsUpdate(api_key="sk-keep-123456"))
    llm.save_llm_settings(LLMSettingsUpdate(model="deepseek-reasoner", api_key=""))
    config = llm.get_stored_llm_settings()
    assert config.api_key == "sk-keep-123456"
    assert config.model == "deepseek-reasoner"


def test_switching_provider_fills_non_deepseek_preset(temp_db):
    llm.save_llm_settings(LLMSettingsUpdate(provider="openai"))
    config = llm.get_stored_llm_settings()
    assert config.provider == "openai"
    assert config.base_url == "https://api.openai.com/v1"
    assert config.model == "gpt-4o-mini"

    llm.save_llm_settings(LLMSettingsUpdate(provider="ollama"))
    config = llm.get_stored_llm_settings()
    assert config.base_url == "http://localhost:11434/v1"
    assert config.model == "qwen2.5:7b"


def test_reset_restores_defaults_and_clears_key(temp_db):
    llm.save_llm_settings(
        LLMSettingsUpdate(
            provider="custom",
            base_url="https://example.com/v1",
            model="my-model",
            api_key="sk-reset-123456",
        )
    )
    llm.reset_llm_settings()
    config, source = llm.resolve_llm_settings()
    assert source == "none"
    assert config.provider == "deepseek"
    assert config.base_url == "https://api.deepseek.com"
    assert config.model == "deepseek-chat"
    assert config.api_key == ""


# ---------------------------------------------------------------------------
# Settings REST API
# ---------------------------------------------------------------------------


def test_get_settings_returns_mock_config_without_key(client):
    response = client.get("/api/v1/settings/llm")
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "deepseek"
    assert body["model"] == "deepseek-chat"
    assert body["has_api_key"] is False
    assert body["api_key_masked"] == ""
    assert body["key_source"] == "none"
    assert body["mode"] == "mock"
    assert "api_key" not in body


def test_put_settings_masks_key_and_empty_key_preserves_it(client):
    secret = "sk-1234567890abcdef"
    response = client.put(
        "/api/v1/settings/llm",
        json={
            "provider": "custom",
            "base_url": "https://example.com",
            "model": "my-model",
            "api_key": secret,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_api_key"] is True
    assert body["api_key_masked"] == "****cdef"
    assert secret not in response.text
    assert "api_key" not in body

    # Empty api_key means "keep the stored key".
    response = client.put(
        "/api/v1/settings/llm",
        json={"model": "new-model", "api_key": ""},
    )
    body = response.json()
    assert body["model"] == "new-model"
    assert body["has_api_key"] is True
    assert body["api_key_masked"] == "****cdef"

    fetched = client.get("/api/v1/settings/llm").json()
    assert fetched["has_api_key"] is True
    assert fetched["api_key_masked"] == "****cdef"
    assert fetched["base_url"] == "https://example.com"


def test_settings_env_fallback_is_masked(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "sk-env-abcdef1234")
    response = client.get("/api/v1/settings/llm")
    body = response.json()
    assert body["has_api_key"] is True
    assert body["key_source"] == "environment"
    assert body["mode"] == "live"
    assert body["api_key_masked"].endswith("1234")
    assert "sk-env-abcdef1234" not in response.text


def test_reset_endpoint_restores_defaults(client):
    client.put(
        "/api/v1/settings/llm",
        json={"provider": "openai", "api_key": "sk-openai-123456"},
    )
    response = client.post("/api/v1/settings/llm/reset")
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "deepseek"
    assert body["has_api_key"] is False
    assert body["mode"] == "mock"


def test_test_endpoint_mock_mode(client):
    response = client.post("/api/v1/settings/llm/test")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["mode"] == "mock"


def test_test_endpoint_live_uses_saved_config(client, monkeypatch):
    secret = "sk-test-123456"
    llm.save_llm_settings(
        LLMSettingsUpdate(
            provider="custom",
            base_url="https://llm.example.com",
            model="test-model",
            api_key=secret,
        )
    )

    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization", "")
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "pong"}}]},
        )

    monkeypatch.setattr(
        llm,
        "_build_async_client",
        lambda timeout: httpx.AsyncClient(
            transport=httpx.MockTransport(handler), timeout=timeout
        ),
    )

    response = client.post("/api/v1/settings/llm/test")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["mode"] == "live"
    assert captured["url"] == "https://llm.example.com/v1/chat/completions"
    assert captured["auth"] == f"Bearer {secret}"
    assert secret not in response.text
