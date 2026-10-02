"""Tests for progress and notes endpoints."""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from backend.app.main import app


def test_progress_upsert_and_list() -> None:
    topic_id = f"test-topic-{uuid.uuid4().hex[:8]}"
    with TestClient(app) as client:
        response = client.put(f"/api/v1/progress/{topic_id}", json={"status": "learning"})
        assert response.status_code == 200
        assert response.json()["status"] == "learning"

        response = client.put(f"/api/v1/progress/{topic_id}", json={"status": "completed"})
        assert response.status_code == 200
        assert response.json()["status"] == "completed"

        response = client.get("/api/v1/progress")
        assert response.status_code == 200
        items = response.json()["items"]
        assert any(item["topic_id"] == topic_id and item["status"] == "completed" for item in items)


def test_notes_crud() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/notes",
            json={"topic_id": "ch05-03", "content": "欠阻尼会产生超调。"},
        )
        assert response.status_code == 200
        note = response.json()
        note_id = note["id"]

        response = client.get("/api/v1/notes", params={"topic_id": "ch05-03"})
        assert response.status_code == 200
        assert any(item["id"] == note_id for item in response.json()["items"])

        response = client.put(f"/api/v1/notes/{note_id}", json={"content": "更新后的笔记。"})
        assert response.status_code == 200
        assert response.json()["content"] == "更新后的笔记。"

        response = client.delete(f"/api/v1/notes/{note_id}")
        assert response.status_code == 200
        assert response.json()["deleted"] is True
