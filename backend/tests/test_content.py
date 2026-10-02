"""Tests for the curriculum tree, Markdown lessons and content APIs."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Keep the tests runnable both from the repository root and from backend/.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402  (path bootstrap must run first)
from app.services import content_loader  # noqa: E402

ALLOWED_WIDGET_TYPES = {
    "second_order_standard_form",
    "second_order_lab",
    "second_order_metrics_lab",
    "second_order_comparison_lab",
}


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


def _iter_topics(curriculum: dict):
    for book in curriculum["books"]:
        for chapter in book["chapters"]:
            for topic in chapter.get("topics", []):
                yield book, chapter, topic


def _ch05_topics(curriculum: dict) -> list[dict]:
    for book in curriculum["books"]:
        for chapter in book["chapters"]:
            if chapter["id"] == "ch05":
                return list(chapter["topics"])
    raise AssertionError("ch05 not found")


def test_curriculum_has_two_volumes_and_expected_chapters_available(client: TestClient):
    response = client.get("/api/v1/curriculum")
    assert response.status_code == 200
    data = response.json()
    assert len(data["books"]) == 2

    chapters = [chapter for book in data["books"] for chapter in book["chapters"]]
    available_chapters = [chapter for chapter in chapters if chapter["status"] == "available"]
    assert [chapter["id"] for chapter in available_chapters] == ["ch03", "ch04", "ch05", "ch06"]

    topics = [topic for chapter in chapters for topic in chapter["topics"]]
    available_topics = [topic for topic in topics if topic["status"] == "available"]
    assert [topic["id"] for topic in available_topics] == [
        "ch03-01",
        "ch03-02",
        "ch03-03",
        "ch03-04",
        "ch03-05",
        "ch04-01",
        "ch04-02",
        "ch04-03",
        "ch04-04",
        "ch05-01",
        "ch05-02",
        "ch05-03",
        "ch05-04",
        "ch05-05",
        "ch06-01",
        "ch06-02",
        "ch06-03",
        "ch06-04",
    ]
    available_ids = {topic["id"] for topic in available_topics}
    assert all(topic["status"] == "planned" for topic in topics if topic["id"] not in available_ids)


def test_curriculum_chapter_titles_follow_reference():
    curriculum = content_loader.get_curriculum()
    reference_dir = Path(__file__).resolve().parents[2] / "Reference"
    reference_text = "\n".join(
        path.read_text(encoding="utf-8") for path in reference_dir.glob("*.md")
    )
    for _book, chapter in content_loader._iter_chapters(curriculum):
        assert chapter["title"] in reference_text, chapter["title"]


def test_ch05_03_returns_body_widgets_and_navigation(client: TestClient):
    response = client.get("/api/v1/topics/ch05-03")
    assert response.status_code == 200
    topic = response.json()

    assert topic["id"] == "ch05-03"
    assert topic["chapter_id"] == "ch05"
    assert topic["title"] == "二阶系统的单位阶跃响应"
    assert topic["order"] == 3
    assert topic["summary"]
    assert topic["learning_objectives"]
    assert topic["prerequisites"] == ["ch05-01", "ch05-02"]

    assert topic["prev_topic"]["id"] == "ch05-02"
    assert topic["next_topic"]["id"] == "ch05-04"

    widget = topic["widgets"][0]
    assert widget["id"] == "second-order-step-lab"
    assert widget["type"] == "second_order_lab"
    assert widget["default_mode"] == "step"
    assert widget["type"] in ALLOWED_WIDGET_TYPES
    assert "[[widget:second-order-step-lab]]" in topic["body_markdown"]
    assert ":::details" in topic["body_markdown"]


def test_all_ch05_topics_have_body_and_widget_placeholder(client: TestClient):
    curriculum = content_loader.get_curriculum()
    for entry in _ch05_topics(curriculum):
        response = client.get(f"/api/v1/topics/{entry['id']}")
        assert response.status_code == 200, entry["id"]
        topic = response.json()
        assert topic["body_markdown"].strip(), entry["id"]
        assert topic["widgets"], entry["id"]
        for widget in topic["widgets"]:
            assert widget["type"] in ALLOWED_WIDGET_TYPES, widget
        for widget_id in entry["widgets"]:
            assert f"[[widget:{widget_id}]]" in topic["body_markdown"], (
                entry["id"],
                widget_id,
            )


def test_topic_navigation_edges(client: TestClient):
    first = client.get("/api/v1/topics/ch03-01").json()
    assert first["prev_topic"] is None
    assert first["next_topic"] == {"id": "ch03-02", "title": "3.2 相平面数学基础"}

    last = client.get("/api/v1/topics/ch06-04").json()
    assert last["prev_topic"] == {"id": "ch06-03", "title": "6.3 稳定性与状态空间方程"}
    assert last["next_topic"] is None

    ch04_first = client.get("/api/v1/topics/ch04-01").json()
    assert ch04_first["prev_topic"] == {"id": "ch03-05", "title": "3.5 本章要点总结"}
    ch05_first = client.get("/api/v1/topics/ch05-01").json()
    assert ch05_first["prev_topic"] == {"id": "ch04-04", "title": "4.4 本章要点总结"}
    ch05_last = client.get("/api/v1/topics/ch05-05").json()
    assert ch05_last["next_topic"] == {"id": "ch06-01", "title": "6.1 系统稳定性的定义"}


def test_planned_topic_returns_404(client: TestClient):
    curriculum = content_loader.get_curriculum()
    planned = next(
        topic
        for _book, _chapter, topic in _iter_topics(curriculum)
        if topic["status"] == "planned" and topic["id"].startswith("ch")
    )
    response = client.get(f"/api/v1/topics/{planned['id']}")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "TOPIC_NOT_AVAILABLE"


def test_unknown_topic_returns_404(client: TestClient):
    response = client.get("/api/v1/topics/not-a-topic")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "TOPIC_NOT_FOUND"


def test_loader_interface_helpers():
    curriculum = content_loader.get_curriculum()
    assert isinstance(curriculum, dict)
    assert content_loader.get_topic_ids_for_chapter("ch05") == [
        "ch05-01",
        "ch05-02",
        "ch05-03",
        "ch05-04",
        "ch05-05",
    ]
    assert content_loader.get_topic_ids_for_chapter("does-not-exist") == []
    assert content_loader.get_topic("ch05-03")["body_markdown"]
    assert content_loader.get_topic("ch01-01") is None
    assert content_loader.get_topic_entry("ch01-01")["status"] == "planned"


def test_markdown_uses_required_format_and_docs_formulas():
    content_dir = Path(__file__).resolve().parents[1] / "app" / "content" / "ch05"
    expected_snippets = {
        "05-01.md": [
            r"G(s)=\frac{\omega_n^2}{s^2+2\zeta\omega_n s+\omega_n^2}",
            r"\begin{bmatrix} 0 & 1 \\ -\omega_n^2 & -2\zeta\omega_n \end{bmatrix}",
        ],
        "05-02.md": [
            r"y(t)=e^{-\zeta\omega_n t}\left[y_0\cos(\omega_d t)+\frac{v_0+\zeta\omega_n y_0}{\omega_d}\sin(\omega_d t)\right]",
            r"y(t)=e^{-\omega_n t}\left[y_0+(v_0+\omega_n y_0)t\right]",
            r"y(t)=y_0\cos(\omega_n t)+\frac{v_0}{\omega_n}\sin(\omega_n t)",
        ],
        "05-03.md": [
            r"y(t)=1-\frac{e^{-\zeta\omega_n t}}{\sqrt{1-\zeta^2}}\sin\left(\omega_d t+\varphi\right),\quad \varphi=\arccos\zeta",
            r"y(t)=1-\cos(\omega_n t)",
            r"y(t)=1-(1+\omega_n t)e^{-\omega_n t}",
            r"y(t)=1-e^{-\zeta\omega_n t}\left[\cosh(\lambda t)+\frac{\zeta}{\sqrt{\zeta^2-1}}\sinh(\lambda t)\right]",
        ],
        "05-04.md": [
            r"t_p=\frac{\pi}{\omega_d}",
            r"M_p=e^{-\pi\zeta/\sqrt{1-\zeta^2}}\times 100\%",
            r"t_s(2\%)\approx\frac{4}{\zeta\omega_n}",
            r"t_s(5\%)\approx\frac{3}{\zeta\omega_n}",
        ],
        "05-05.md": [],
    }
    for filename, snippets in expected_snippets.items():
        text = (content_dir / filename).read_text(encoding="utf-8")
        assert text.startswith("---\n"), filename
        assert ":::details" in text, filename
        assert "[[widget:" in text, filename
        for snippet in snippets:
            assert snippet in text, (filename, snippet)
