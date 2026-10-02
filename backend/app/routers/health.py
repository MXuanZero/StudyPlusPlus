"""Health-check endpoint."""
from __future__ import annotations

from fastapi import APIRouter

from ..config import settings
from ..services import llm

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    """Return service health plus the effective LLM mode.

    The mode reflects the same precedence as the chat service:
    stored settings > ``LLM_API_KEY`` > mock.
    """
    try:
        config, key_source = llm.resolve_llm_settings()
        llm_mode = "live" if config.api_key else "mock"
    except Exception:
        llm_mode = "mock"
        key_source = "none"

    return {
        "status": "ok",
        "name": settings.app_name,
        "version": settings.version,
        "llm_mode": llm_mode,
        "llm_provider": config.provider if "config" in locals() else None,
        "llm_key_source": key_source,
    }
