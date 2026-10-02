"""Single-topic content endpoint."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..services.content_loader import get_topic, get_topic_entry

router = APIRouter(prefix="/topics", tags=["content"])


@router.get("/{topic_id}")
def read_topic(topic_id: str) -> dict:
    """Return the Markdown body, widgets and prev/next navigation for a topic."""
    entry = get_topic_entry(topic_id)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "TOPIC_NOT_FOUND", "message": f"未找到知识点：{topic_id}"},
        )
    if entry.get("status") != "available":
        raise HTTPException(
            status_code=404,
            detail={"code": "TOPIC_NOT_AVAILABLE", "message": f"知识点尚未开放：{topic_id}"},
        )

    topic = get_topic(topic_id)
    if topic is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "TOPIC_CONTENT_MISSING", "message": f"知识点内容文件缺失：{topic_id}"},
        )
    return topic
