"""Pydantic schemas for LLM settings endpoints."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class LLMSettings(BaseModel):
    """Validated LLM connection settings.

    ``api_key`` is accepted in requests but never serialized back to clients;
    see :class:`LLMSettingsResponse`.
    """

    provider: str = "deepseek"
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1, le=131072)

    @field_validator("provider", "base_url", "model", mode="before")
    @classmethod
    def _strip_strings(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("provider")
    @classmethod
    def _provider_required(cls, value: str) -> str:
        if not value:
            raise ValueError("provider 不能为空")
        return value


class LLMSettingsUpdate(BaseModel):
    """Partial settings update used by ``PUT /settings/llm``.

    Omitted fields keep their current value. An empty or omitted ``api_key``
    means "do not change the stored key"; call ``/settings/llm/reset`` to clear.
    """

    provider: str | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=131072)

    @field_validator("provider", "base_url", "model", mode="before")
    @classmethod
    def _strip_strings(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("provider")
    @classmethod
    def _provider_non_empty(cls, value: str | None) -> str | None:
        if value is not None and not value:
            raise ValueError("provider 不能为空")
        return value


class LLMSettingsResponse(BaseModel):
    """Sanitized LLM settings returned to the frontend."""

    provider: str
    base_url: str
    model: str
    temperature: float
    max_tokens: int
    has_api_key: bool
    api_key_masked: str
    key_source: Literal["database", "environment", "none"]
    mode: Literal["live", "mock"]
    effective_base_url: str


class LLMTestResponse(BaseModel):
    """Result of ``POST /settings/llm/test``.

    Connection failures are reported as ``ok=false`` with a classified code so
    the settings page can show a useful message without raising a 5xx.
    """

    ok: bool
    mode: Literal["live", "mock"]
    message: str
    provider: str
    model: str
    latency_ms: int | None = None
    code: str | None = None
