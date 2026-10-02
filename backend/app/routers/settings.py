"""LLM settings endpoints (provider, Base URL, model, masked API key)."""
from __future__ import annotations

from fastapi import APIRouter

from ..schemas.settings import (
    LLMSettingsResponse,
    LLMSettingsUpdate,
    LLMTestResponse,
    SystemPromptSettingsResponse,
    SystemPromptUpdate,
)
from ..services import llm, prompt

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

@router.get("/prompt", response_model=SystemPromptSettingsResponse)
def get_system_prompt_settings() -> SystemPromptSettingsResponse:
    """Return the effective system prompt plus the built-in default."""

    return SystemPromptSettingsResponse(
        system_prompt=prompt.load_tutor_system_prompt(),
        default_system_prompt=prompt.load_default_system_prompt(),
        is_custom=prompt.is_system_prompt_custom(),
    )


@router.put("/prompt", response_model=SystemPromptSettingsResponse)
def update_system_prompt_settings(
    payload: SystemPromptUpdate,
) -> SystemPromptSettingsResponse:
    """Save a custom system prompt and apply it to subsequent conversations."""

    system_prompt = prompt.save_system_prompt(payload.system_prompt)
    return SystemPromptSettingsResponse(
        system_prompt=system_prompt,
        default_system_prompt=prompt.load_default_system_prompt(),
        is_custom=prompt.is_system_prompt_custom(),
    )


@router.post("/prompt/reset", response_model=SystemPromptSettingsResponse)
def reset_system_prompt_settings() -> SystemPromptSettingsResponse:
    """Delete the custom prompt and restore the built-in default."""

    system_prompt = prompt.reset_system_prompt()
    return SystemPromptSettingsResponse(
        system_prompt=system_prompt,
        default_system_prompt=prompt.load_default_system_prompt(),
        is_custom=False,
    )
