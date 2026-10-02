"""Course curriculum endpoint."""
from __future__ import annotations

from fastapi import APIRouter

from ..services.content_loader import get_curriculum

router = APIRouter(prefix="/curriculum", tags=["curriculum"])


@router.get("")
def read_curriculum() -> dict:
    """Return the complete two-volume curriculum tree."""
    return get_curriculum()
