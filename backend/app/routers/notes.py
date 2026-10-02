"""Notes CRUD endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..db import get_connection, utc_now
from ..schemas.notes import NoteCreate, NoteUpdate

router = APIRouter(tags=["notes"])


def _get_note_or_404(note_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "NOTE_NOT_FOUND", "message": f"未找到笔记：{note_id}"},
        )
    return dict(row)


@router.get("/notes")
def list_notes(topic_id: str | None = None) -> dict[str, Any]:
    with get_connection() as conn:
        if topic_id:
            rows = conn.execute(
                "SELECT * FROM notes WHERE topic_id = ? ORDER BY updated_at DESC",
                (topic_id,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM notes ORDER BY updated_at DESC").fetchall()
    return {"items": [dict(row) for row in rows]}


@router.post("/notes")
def create_note(payload: NoteCreate) -> dict[str, Any]:
    now = utc_now()
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO notes(topic_id, content, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (payload.topic_id, payload.content, now, now),
        )
        note_id = cursor.lastrowid
    return _get_note_or_404(int(note_id))


@router.put("/notes/{note_id}")
def update_note(note_id: int, payload: NoteUpdate) -> dict[str, Any]:
    _get_note_or_404(note_id)
    now = utc_now()
    with get_connection() as conn:
        conn.execute(
            "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
            (payload.content, now, note_id),
        )
    return _get_note_or_404(note_id)


@router.delete("/notes/{note_id}")
def delete_note(note_id: int) -> dict[str, Any]:
    _get_note_or_404(note_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    return {"deleted": True, "id": note_id}
