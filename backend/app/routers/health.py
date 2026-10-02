"""Health-check endpoint."""
from __future__ import annotations

from fastapi import APIRouter

from ..config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "name": settings.app_name,
        "version": settings.version,
        "llm_mode": "mock",
    }
