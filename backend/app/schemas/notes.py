"""Schemas for notes."""
from __future__ import annotations

from pydantic import BaseModel, Field


class NoteCreate(BaseModel):
    topic_id: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=20000)


class NoteUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
