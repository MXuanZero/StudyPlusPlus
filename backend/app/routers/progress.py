"""Learning-progress endpoints."""
from __future__ import annotations

import importlib
from typing import Any

from fastapi import APIRouter, HTTPException

from ..db import get_connection, utc_now
from ..schemas.progress import ProgressUpdate

router = APIRouter(tags=["progress"])

VALID_STATUSES = {"not_started", "learning", "completed"}


def _chapter_topic_ids(chapter_id: str) -> list[str]:
    """Best-effort lookup of topic ids belonging to a chapter.

    The content module is implemented in parallel; import lazily so this router
    remains importable while that work is in progress.
    """
    try:
        module = importlib.import_module("backend.app.services.content_loader")
        getter = getattr(module, "get_topic_ids_for_chapter")
        return [str(item) for item in getter(chapter_id)]
    except Exception:
        return []


@router.get("/progress")
def list_progress() -> dict[str, Any]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT topic_id, status, updated_at FROM progress ORDER BY updated_at DESC"
        ).fetchall()
    return {"items": [dict(row) for row in rows]}


@router.put("/progress/{topic_id}")
def update_progress(topic_id: str, payload: ProgressUpdate) -> dict[str, Any]:
    if payload.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_PROGRESS_STATUS", "message": "无效的学习进度状态"},
        )
    now = utc_now()
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO progress(topic_id, status, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(topic_id) DO UPDATE SET
              status = excluded.status,
              updated_at = excluded.updated_at
            """,
            (topic_id, payload.status, now),
        )
    return {"topic_id": topic_id, "status": payload.status, "updated_at": now}


@router.get("/progress/{chapter_id}")
def chapter_progress(chapter_id: str) -> dict[str, Any]:
    topic_ids = _chapter_topic_ids(chapter_id)
    if not topic_ids:
        raise HTTPException(
            status_code=404,
            detail={"code": "CHAPTER_NOT_FOUND", "message": f"未找到章节：{chapter_id}"},
        )
    placeholders = ",".join("?" for _ in topic_ids)
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT topic_id, status FROM progress WHERE topic_id IN ({placeholders})",
            topic_ids,
        ).fetchall()
    status_by_topic = {row["topic_id"]: row["status"] for row in rows}
    completed = sum(1 for tid in topic_ids if status_by_topic.get(tid) == "completed")
    total = len(topic_ids)
    return {
        "chapter_id": chapter_id,
        "total": total,
        "completed": completed,
        "percent": round(completed / total * 100, 1),
    }
