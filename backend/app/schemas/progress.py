"""Schemas for learning progress."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

ProgressStatus = Literal["not_started", "learning", "completed"]


class ProgressUpdate(BaseModel):
    status: ProgressStatus
