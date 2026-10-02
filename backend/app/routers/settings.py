"""LLM settings endpoints (provider, Base URL, model, masked API key)."""
from __future__ import annotations

from fastapi import APIRouter

from ..schemas.settings import (
    LLMSettingsResponse,
    LLMSettingsUpdate,
    LLMTestResponse,
)
from ..services import llm

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/llm", response_model=LLMSettingsResponse)
def get_llm_settings() -> LLMSettingsResponse:
    """Return the effective LLM config with the API key masked."""

    config, key_source = llm.resolve_llm_settings()
    return LLMSettingsResponse(**llm.build_settings_response(config, key_source))


@router.put("/llm", response_model=LLMSettingsResponse)
def update_llm_settings(payload: LLMSettingsUpdate) -> LLMSettingsResponse:
    """Partially update LLM settings.

    An omitted or empty ``api_key`` preserves the currently stored key.
    """

    llm.save_llm_settings(payload)
    config, key_source = llm.resolve_llm_settings()
    return LLMSettingsResponse(**llm.build_settings_response(config, key_source))


@router.post("/llm/test", response_model=LLMTestResponse)
async def test_llm_settings() -> LLMTestResponse:
    """Send a minimal request using the saved configuration."""

    config = llm.resolve_llm_settings()[0]
    result = await llm.test_connection(config)
    return LLMTestResponse(**result)


@router.post("/llm/reset", response_model=LLMSettingsResponse)
def reset_llm_settings() -> LLMSettingsResponse:
    """Restore the default DeepSeek configuration and clear the stored key."""

    llm.reset_llm_settings()
    config, key_source = llm.resolve_llm_settings()
    return LLMSettingsResponse(**llm.build_settings_response(config, key_source))
