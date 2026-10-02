"""Independent MVP acceptance tests for StudyPlusPlus (T10).

These tests deliberately re-derive the key numbers with analytic formulas from
``docs/03_二阶系统分析模块详细设计.md`` instead of reusing the production
helpers, so a coincidental implementation bug cannot validate itself.

All tests use an isolated temporary SQLite database and never require a real
LLM API key (no outbound network calls are made).
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings as app_settings
from backend.app.db import init_db
from backend.app.main import app

ROOT = Path(__file__).resolve().parents[2]

SIMULATE = "/api/v1/compute/second-order/simulate"
COMPARE = "/api/v1/compute/second-order/compare"
PRESETS = "/api/v1/compute/second-order/presets"

# ---------------------------------------------------------------------------
# Fixtures and small helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A client backed by a throwaway SQLite file, with no API key configured."""

    monkeypatch.setattr(app_settings, "db_path", tmp_path / "acceptance.db")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    init_db()
    with TestClient(app) as test_client:
        yield test_client


def simulate(client: TestClient, **payload: Any) -> dict[str, Any]:
    response = client.post(SIMULATE, json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def parse_sse(text: str) -> list[tuple[str, dict[str, Any]]]:
    """Parse an SSE body into ordered ``(event, data)`` pairs."""

    events: list[tuple[str, dict[str, Any]]] = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event: str | None = None
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:") :].strip())
        if event is None:
            continue
        events.append((event, json.loads("\n".join(data_lines) or "{}")))
    return events


def analytic_underdamped_step(t: np.ndarray, zeta: float, wn: float) -> np.ndarray:
    """Unit-step response for ``0 < zeta < 1`` (docs/03 section 2.3)."""

    wd = wn * math.sqrt(1.0 - zeta * zeta)
    phi = math.acos(zeta)
    return 1.0 - np.exp(-zeta * wn * t) / math.sqrt(1.0 - zeta * zeta) * np.sin(wd * t + phi)


def analytic_impulse(t: np.ndarray, zeta: float, wn: float) -> np.ndarray:
    """Unit-impulse response for ``0 < zeta < 1``.

    Derived independently from ``wn^2 / (s^2 + 2*zeta*wn*s + wn^2)``:
    ``h(t) = wn^2 / wd * exp(-zeta*wn*t) * sin(wd*t)``.
    """

    wd = wn * math.sqrt(1.0 - zeta * zeta)
    return wn * wn / wd * np.exp(-zeta * wn * t) * np.sin(wd * t)


# ---------------------------------------------------------------------------
# TC-C01 .. TC-C06: independent numerical checks
# ---------------------------------------------------------------------------


def test_tc_c01_undamped_step(client: TestClient) -> None:
    data = simulate(client, zeta=0.0, omega_n=1.0, input_type="step", t_end=20.0, n_points=2001)
    assert data["classification"] == "undamped"

    real_parts = [pole["real"] for pole in data["poles"]]
    imag_parts = sorted(pole["imag"] for pole in data["poles"])
    assert real_parts == pytest.approx([0.0, 0.0], abs=1e-12)
    assert imag_parts == pytest.approx([-1.0, 1.0], abs=1e-12)

    t = np.asarray(data["t"], dtype=float)
    y = np.asarray(data["y"], dtype=float)
    np.testing.assert_allclose(y, 1.0 - np.cos(t), rtol=1e-3, atol=1e-3)

    metrics = data["metrics"]
    assert metrics is not None
    # Independent expectations: peak of 1-cos(t) is 2 at t=pi -> 100% overshoot.
    assert metrics["peak_time"] == pytest.approx(math.pi, abs=0.05)
    assert metrics["peak_value"] == pytest.approx(2.0, abs=0.01)
    assert metrics["overshoot_pct"] == pytest.approx(100.0, abs=0.1)
    assert data["analytical_metrics"] is None
    # An undamped system never settles, so the "increase t_end" hint is wrong.
    diagnostics = " ".join(data["diagnostics"])
    assert "无阻尼" in diagnostics or "等幅" in diagnostics
    assert "增大 t_end" not in diagnostics


def test_tc_c02_critically_damped_step(client: TestClient) -> None:
    data = simulate(client, zeta=1.0, omega_n=1.0, input_type="step", t_end=20.0, n_points=1001)
    assert data["classification"] == "critically_damped"

    t = np.asarray(data["t"], dtype=float)
    y = np.asarray(data["y"], dtype=float)
    np.testing.assert_allclose(y, 1.0 - (1.0 + t) * np.exp(-t), rtol=1e-3, atol=1e-3)
    assert np.min(np.diff(y)) > -1e-8  # monotonic, no overshoot
    assert data["metrics"]["peak_time"] is None
    assert data["metrics"]["overshoot_pct"] == pytest.approx(0.0, abs=1e-9)
    assert data["analytical_metrics"] is None


def test_tc_c03_underdamped_step_zeta_half(client: TestClient) -> None:
    zeta, wn = 0.5, 1.0
    data = simulate(client, zeta=zeta, omega_n=wn, input_type="step", t_end=20.0, n_points=2001)
    assert data["classification"] == "underdamped"

    poles = sorted((pole["real"], abs(pole["imag"])) for pole in data["poles"])
    assert [item[0] for item in poles] == pytest.approx([-0.5, -0.5], abs=1e-9)
    assert [item[1] for item in poles] == pytest.approx(
        [math.sqrt(3) / 2, math.sqrt(3) / 2], abs=1e-9
    )

    t = np.asarray(data["t"], dtype=float)
    y = np.asarray(data["y"], dtype=float)
    np.testing.assert_allclose(y, analytic_underdamped_step(t, zeta, wn), rtol=1e-3, atol=1e-3)

    wd = wn * math.sqrt(1.0 - zeta * zeta)
    expected_tp = math.pi / wd
    expected_mp = math.exp(-math.pi * zeta / math.sqrt(1.0 - zeta * zeta)) * 100.0
    expected_ts2 = 4.0 / (zeta * wn)
    expected_ts5 = 3.0 / (zeta * wn)

    metrics = data["metrics"]
    analytical = data["analytical_metrics"]
    assert metrics is not None and analytical is not None
    assert metrics["peak_time"] == pytest.approx(expected_tp, abs=0.05)
    assert metrics["overshoot_pct"] == pytest.approx(expected_mp, abs=0.2)
    # Definition-level difference is allowed; docs/03 requires a 10% window.
    assert metrics["settling_time_2pct"] == pytest.approx(expected_ts2, rel=0.10)
    assert metrics["settling_time_5pct"] is not None and metrics["settling_time_5pct"] <= expected_ts5 + 1.0
    assert analytical["peak_time"] == pytest.approx(expected_tp)
    assert analytical["overshoot_pct"] == pytest.approx(expected_mp)
    assert analytical["settling_time_2pct"] == pytest.approx(expected_ts2)
    assert analytical["settling_time_5pct"] == pytest.approx(expected_ts5)


def test_tc_c04_underdamped_zeta_0707(client: TestClient) -> None:
    zeta, wn = 0.707, 1.0
    data = simulate(client, zeta=zeta, omega_n=wn, input_type="step", t_end=20.0, n_points=1001)
    assert data["classification"] == "underdamped"

    wd = wn * math.sqrt(1.0 - zeta * zeta)
    expected_tp = math.pi / wd
    expected_mp = math.exp(-math.pi * zeta / math.sqrt(1.0 - zeta * zeta)) * 100.0

    metrics = data["metrics"]
    analytical = data["analytical_metrics"]
    assert metrics is not None and analytical is not None
    assert metrics["peak_time"] == pytest.approx(expected_tp, abs=0.05)
    assert metrics["overshoot_pct"] == pytest.approx(expected_mp, abs=0.1)
    assert analytical["peak_time"] == pytest.approx(expected_tp)
    assert analytical["overshoot_pct"] == pytest.approx(expected_mp)


def test_tc_c05_undamped_initial_state(client: TestClient) -> None:
    data = simulate(
        client,
        zeta=0.0,
        omega_n=1.0,
        input_type="initial",
        y0=1.0,
        v0=0.0,
        t_end=20.0,
        n_points=2001,
    )
    assert data["classification"] == "undamped"

    t = np.asarray(data["t"], dtype=float)
    y = np.asarray(data["y"], dtype=float)
    np.testing.assert_allclose(y, np.cos(t), rtol=1e-3, atol=1e-4)

    # Period 2*pi: y(2*pi) = 1 and y(pi) = -1 after interpolation.
    assert float(np.interp(2.0 * math.pi, t, y)) == pytest.approx(1.0, abs=1e-3)
    assert float(np.interp(math.pi, t, y)) == pytest.approx(-1.0, abs=1e-3)
    assert np.allclose(np.asarray(data["u"], dtype=float), 0.0)
    assert data["metrics"] is None
    assert data["analytical_metrics"] is None


def test_tc_c06_unstable_system_with_diagnostics(client: TestClient) -> None:
    data = simulate(client, zeta=-0.1, omega_n=1.0, input_type="step", t_end=20.0, n_points=1001)
    assert data["classification"] == "unstable"
    assert max(pole["real"] for pole in data["poles"]) > 0.0
    y = np.asarray(data["y"], dtype=float)
    assert abs(y[-1]) > abs(y[0])
    assert data["metrics"] is None
    assert data["analytical_metrics"] is None
    assert any("不稳定" in item for item in data["diagnostics"])


def test_tc_c07_impulse_matches_analytic_formula(client: TestClient) -> None:
    zeta, wn = 0.5, 2.0
    data = simulate(
        client,
        zeta=zeta,
        omega_n=wn,
        input_type="impulse",
        t_end=10.0,
        n_points=2001,
        include_metrics=False,
    )
    t = np.asarray(data["t"], dtype=float)
    y = np.asarray(data["y"], dtype=float)
    np.testing.assert_allclose(y, analytic_impulse(t, zeta, wn), rtol=1e-3, atol=1e-4)
    assert np.allclose(np.asarray(data["u"], dtype=float), 0.0)
    assert data["metrics"] is None and data["analytical_metrics"] is None


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"zeta": -0.51}, "INVALID_ZETA"),
        ({"zeta": 3.01}, "INVALID_ZETA"),
        ({"omega_n": 0.0}, "INVALID_OMEGA_N"),
        ({"omega_n": 10.01}, "INVALID_OMEGA_N"),
        ({"y0": -2.01}, "INVALID_Y0"),
        ({"v0": 2.01}, "INVALID_V0"),
        ({"t_end": 0.0}, "INVALID_T_END"),
        ({"t_end": 60.01}, "INVALID_T_END"),
        ({"n_points": 199}, "INVALID_N_POINTS"),
        ({"n_points": 5001}, "INVALID_N_POINTS"),
        ({"input_type": "ramp"}, "INVALID_INPUT_TYPE"),
    ],
)
def test_tc_c08_and_boundary_errors(client: TestClient, payload: dict[str, Any], code: str) -> None:
    response = client.post(SIMULATE, json=payload)
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == code
    assert isinstance(detail["message"], str) and detail["message"]


# ---------------------------------------------------------------------------
# Compute contract: modes, compare, presets
# ---------------------------------------------------------------------------


def test_compute_supports_three_input_modes(client: TestClient) -> None:
    step = simulate(client, input_type="step", zeta=0.5, omega_n=2.0)
    impulse = simulate(client, input_type="impulse", zeta=0.5, omega_n=2.0)
    initial = simulate(client, input_type="initial", zeta=0.5, omega_n=2.0, y0=1.0, v0=0.0)

    for payload in (step, impulse, initial):
        assert set(payload) == {
            "classification",
            "poles",
            "t",
            "y",
            "u",
            "metrics",
            "analytical_metrics",
            "diagnostics",
        }
        assert len(payload["t"]) == len(payload["y"]) == len(payload["u"]) == 1001
        assert payload["t"][0] == pytest.approx(0.0)
        assert payload["t"][-1] == pytest.approx(20.0)

    # Step has unity input; impulse/initial have zero forced input.
    assert set(step["u"]) == {1.0}
    assert set(impulse["u"]) == {0.0}
    assert set(initial["u"]) == {0.0}
    assert step["metrics"] is not None
    assert impulse["metrics"] is None and initial["metrics"] is None


def test_compute_compare_and_presets(client: TestClient) -> None:
    response = client.post(
        COMPARE,
        json={
            "runs": [
                {"zeta": 0.5, "omega_n": 1.0, "label": "a"},
                {"zeta": 1.0, "omega_n": 1.0, "label": "b"},
                {"zeta": 1.8, "omega_n": 1.0, "label": "c"},
                {"zeta": -0.15, "omega_n": 1.0, "label": "d"},
            ]
        },
    )
    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert [item["label"] for item in results] == ["a", "b", "c", "d"]
    assert [item["classification"] for item in results] == [
        "underdamped",
        "critically_damped",
        "overdamped",
        "unstable",
    ]

    # Top-level list form is part of the compatibility contract.
    response = client.post(COMPARE, json=[{"zeta": 0.5, "omega_n": 2.0}])
    assert response.status_code == 200
    assert len(response.json()["results"]) == 1

    too_many = client.post(COMPARE, json={"runs": [{"zeta": 0.5, "omega_n": 1.0}] * 5})
    assert too_many.status_code == 422
    assert too_many.json()["detail"]["code"] == "INVALID_COMPARE_RUNS"

    presets_response = client.get(PRESETS)
    assert presets_response.status_code == 200
    presets = presets_response.json()["presets"]
    assert [item["key"] for item in presets] == [
        "undamped",
        "underdamped",
        "critical",
        "overdamped",
        "unstable",
    ]
    assert {(item["zeta"], item["omega_n"]) for item in presets} == {
        (0.0, 2.0),
        (0.3, 2.0),
        (1.0, 2.0),
        (1.8, 2.0),
        (-0.15, 2.0),
    }


# ---------------------------------------------------------------------------
# Curriculum and content contract
# ---------------------------------------------------------------------------


def test_curriculum_expected_chapters_are_available(client: TestClient) -> None:
    response = client.get("/api/v1/curriculum")
    assert response.status_code == 200
    books = response.json()["books"]
    assert [book["id"] for book in books] == ["vol1", "vol2"]

    available_chapters = {"ch04", "ch05", "ch06"}
    for book in books:
        assert book["chapters"], book["id"]
        for chapter in book["chapters"]:
            chapter_available = chapter["status"] == "available"
            assert chapter_available is (chapter["id"] in available_chapters)
            for topic in chapter.get("topics", []):
                if chapter["id"] in available_chapters:
                    assert topic["status"] == "available"
                else:
                    assert topic["status"] == "planned"

    vol1 = books[0]
    ch05 = next(chapter for chapter in vol1["chapters"] if chapter["id"] == "ch05")
    assert ch05["title"] == "第5章 二阶系统的时域响应分析"
    assert [topic["id"] for topic in ch05["topics"]] == [
        "ch05-01",
        "ch05-02",
        "ch05-03",
        "ch05-04",
        "ch05-05",
    ]


def test_topic_detail_navigation_and_content_markers(client: TestClient) -> None:
    detail = client.get("/api/v1/topics/ch05-03")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["id"] == "ch05-03"
    assert payload["chapter_id"] == "ch05"
    assert payload["order"] == 3
    assert payload["learning_objectives"]
    assert payload["prerequisites"] == ["ch05-01", "ch05-02"]
    assert payload["prev_topic"]["id"] == "ch05-02"
    assert payload["next_topic"]["id"] == "ch05-04"

    body = payload["body_markdown"]
    assert "$" in body and "$$" in body  # KaTeX formulas present
    assert ":::details" in body and ":::" in body  # collapsible derivation
    assert "[[widget:" in body  # widget placeholder
    assert isinstance(payload["widgets"], list) and payload["widgets"]
    assert all({"id", "type"} <= set(widget) for widget in payload["widgets"])

    first = client.get("/api/v1/topics/ch04-01").json()
    last = client.get("/api/v1/topics/ch06-04").json()
    assert first["prev_topic"] is None and first["next_topic"]["id"] == "ch04-02"
    assert last["next_topic"] is None and last["prev_topic"]["id"] == "ch06-03"

    ch05_first = client.get("/api/v1/topics/ch05-01").json()
    ch05_last = client.get("/api/v1/topics/ch05-05").json()
    assert ch05_first["prev_topic"]["id"] == "ch04-04"
    assert ch05_last["next_topic"]["id"] == "ch06-01"


def test_planned_and_unknown_topics_are_rejected(client: TestClient) -> None:
    planned = client.get("/api/v1/topics/ch01-01")
    assert planned.status_code == 404
    assert planned.json()["detail"]["code"] == "TOPIC_NOT_AVAILABLE"

    unknown = client.get("/api/v1/topics/ch05-99")
    assert unknown.status_code == 404
    assert unknown.json()["detail"]["code"] == "TOPIC_NOT_FOUND"


# ---------------------------------------------------------------------------
# Settings: mock default, masking, empty-key preservation, reset
# ---------------------------------------------------------------------------


def test_settings_mock_default_and_key_masking(client: TestClient) -> None:
    default = client.get("/api/v1/settings/llm").json()
    assert default["provider"] == "deepseek"
    assert default["model"] == "deepseek-chat"
    assert default["has_api_key"] is False
    assert default["api_key_masked"] == ""
    assert default["key_source"] == "none"
    assert default["mode"] == "mock"
    assert default["effective_base_url"] == "https://api.deepseek.com/v1"

    # No key configured -> connection test is an offline Mock success.
    test_result = client.post("/api/v1/settings/llm/test").json()
    assert test_result["ok"] is True
    assert test_result["mode"] == "mock"
    assert test_result["code"] is None

    secret = "sk-acceptance-1234567890"
    updated_response = client.put(
        "/api/v1/settings/llm",
        json={
            "provider": "custom",
            "base_url": "https://llm.example.com",
            "model": "test-model",
            "api_key": secret,
            "temperature": 0.3,
            "max_tokens": 512,
        },
    )
    assert updated_response.status_code == 200, updated_response.text
    assert secret not in updated_response.text
    updated = updated_response.json()
    assert updated["has_api_key"] is True
    assert updated["api_key_masked"] == "****7890"
    assert updated["key_source"] == "database"
    assert updated["mode"] == "live"
    assert updated["effective_base_url"] == "https://llm.example.com/v1"

    # Empty api_key must preserve the stored secret.
    preserved = client.put("/api/v1/settings/llm", json={"api_key": ""}).json()
    assert preserved["has_api_key"] is True
    assert preserved["api_key_masked"] == "****7890"

    # Base URL already pointing at /chat/completions is normalized idempotently.
    normalized = client.put(
        "/api/v1/settings/llm",
        json={"base_url": "https://api.deepseek.com/chat/completions"},
    ).json()
    assert normalized["effective_base_url"] == "https://api.deepseek.com/v1"

    reset = client.post("/api/v1/settings/llm/reset").json()
    assert reset["provider"] == "deepseek"
    assert reset["has_api_key"] is False
    assert reset["mode"] == "mock"
    assert client.get("/api/v1/health").json()["llm_mode"] == "mock"


def test_settings_env_key_fallback(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_API_KEY", "sk-env-1234567890")
    response = client.get("/api/v1/settings/llm").json()
    assert response["has_api_key"] is True
    assert response["key_source"] == "environment"
    assert response["mode"] == "live"
    assert response["api_key_masked"] == "****7890"
    assert "sk-env-1234567890" not in json.dumps(response, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Progress and notes: persistence across a fresh app/DB connection
# ---------------------------------------------------------------------------


def test_progress_notes_persist_across_restart(client: TestClient) -> None:
    assert client.get("/api/v1/progress").json() == {"items": []}

    update = client.put("/api/v1/progress/ch05-01", json={"status": "completed"})
    assert update.status_code == 200
    client.put("/api/v1/progress/ch05-03", json={"status": "learning"})

    chapter = client.get("/api/v1/progress/ch05").json()
    assert chapter == {"chapter_id": "ch05", "total": 5, "completed": 1, "percent": 20.0}

    note = client.post(
        "/api/v1/notes",
        json={"topic_id": "ch05-03", "content": "验收笔记：欠阻尼会衰减振荡。"},
    ).json()
    note_id = note["id"]
    assert client.get("/api/v1/notes", params={"topic_id": "ch05-03"}).json()["items"][0]["id"] == note_id
    updated_note = client.put(f"/api/v1/notes/{note_id}", json={"content": "更新后的内容"}).json()
    assert updated_note["content"] == "更新后的内容"

    # Simulate a process restart by opening a fresh TestClient/lifespan on the
    # same SQLite file: data must still be there.
    with TestClient(app) as restarted:
        progress = restarted.get("/api/v1/progress").json()["items"]
        statuses = {item["topic_id"]: item["status"] for item in progress}
        assert statuses["ch05-01"] == "completed"
        assert statuses["ch05-03"] == "learning"
        assert restarted.get("/api/v1/progress/ch05").json()["completed"] == 1
        notes = restarted.get("/api/v1/notes", params={"topic_id": "ch05-03"}).json()["items"]
        assert [item["content"] for item in notes] == ["更新后的内容"]

        deleted = restarted.delete(f"/api/v1/notes/{note_id}")
        assert deleted.status_code == 200 and deleted.json()["deleted"] is True
        assert restarted.get("/api/v1/notes", params={"topic_id": "ch05-03"}).json()["items"] == []


# ---------------------------------------------------------------------------
# Chat: Mock SSE order, persistence, delete cascade
# ---------------------------------------------------------------------------


def test_chat_mock_sse_order_and_persistence(client: TestClient) -> None:
    created = client.post(
        "/api/v1/chat/sessions",
        json={"title": "验收会话", "context": {"book": "控制之美（卷 1）", "chapter": "ch05"}},
    )
    assert created.status_code == 201, created.text
    session_id = created.json()["id"]

    stream = client.post(
        f"/api/v1/chat/sessions/{session_id}/stream",
        json={"content": "什么是二阶系统？"},
    )
    assert stream.status_code == 200, stream.text
    assert stream.headers["content-type"].startswith("text/event-stream")

    events = parse_sse(stream.text)
    names = [name for name, _ in events]
    assert names[0] == "meta"
    assert names[-1] == "done"
    assert "error" not in names
    assert names.count("delta") >= 1
    assert set(names) <= {"meta", "delta", "done", "error"}

    meta = events[0][1]
    assert meta["mode"] == "mock"
    assert meta["message_id"].startswith("msg_")
    combined = "".join(data["content"] for name, data in events if name == "delta")
    assert "Mock" in combined and "API Key" in combined

    messages = client.get(f"/api/v1/chat/sessions/{session_id}/messages").json()["messages"]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "什么是二阶系统？"
    assert messages[1]["content"] == combined

    with TestClient(app) as restarted:
        persisted = restarted.get(f"/api/v1/chat/sessions/{session_id}/messages").json()["messages"]
        assert [message["content"] for message in persisted] == [messages[0]["content"], combined]
        sessions = restarted.get("/api/v1/chat/sessions").json()["sessions"]
        assert sessions[0]["id"] == session_id
        assert sessions[0]["message_count"] == 2
        assert sessions[0]["context"]["chapter"] == "ch05"

        deleted = restarted.delete(f"/api/v1/chat/sessions/{session_id}")
        assert deleted.status_code == 200
        assert restarted.get(f"/api/v1/chat/sessions/{session_id}/messages").status_code == 404


# ---------------------------------------------------------------------------
# Security / architecture guardrails (source + built assets)
# ---------------------------------------------------------------------------


def test_frontend_has_no_solver_or_key_persistence() -> None:
    frontend_src = ROOT / "frontend" / "src"
    assert frontend_src.exists(), "frontend source missing"

    package = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    dependencies = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
    assert not any("numpy" in name or "scipy" in name for name in dependencies)
    assert not (frontend_src / "mocks" / "secondOrder.ts").exists()

    frontend_text: list[str] = []
    for path in frontend_src.rglob("*"):
        if path.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
            continue
        text = path.read_text(encoding="utf-8")
        frontend_text.append(text)
        assert "from 'numpy'" not in text and 'from "numpy"' not in text
        assert "from 'scipy'" not in text and 'from "scipy"' not in text
        if "localStorage.setItem" in text or "sessionStorage.setItem" in text:
            assert "api_key" not in text and "apiKey" not in text, f"{path} may persist a key"

    combined_frontend = "\n".join(frontend_text)
    assert "generateMockSimulation" not in combined_frontend
    assert "mocks/secondOrder" not in combined_frontend

    secret_pattern = re.compile(r"sk-[A-Za-z0-9]{20,}")
    for base in (ROOT / "backend" / "app", frontend_src):
        for path in base.rglob("*"):
            if path.is_file() and path.suffix in {".py", ".ts", ".tsx", ".js", ".json", ".md"}:
                assert not secret_pattern.search(path.read_text(encoding="utf-8", errors="ignore")), path


def test_production_bundle_excludes_dev_solver_if_built() -> None:
    dist = ROOT / "frontend" / "dist"
    if not dist.exists():
        pytest.skip("frontend/dist not built in this environment")
    combined = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore") for path in dist.rglob("*.js")
    )
    # The DEV-only mock solver must not be reachable from the production bundle.
    assert "generateMockSimulation" not in combined
    assert "DEV-ONLY fallback" not in combined

# ---------------------------------------------------------------------------
# Regression coverage for the issues found during T10 acceptance
# ---------------------------------------------------------------------------


def test_validation_errors_use_unified_detail_envelope(client: TestClient) -> None:
    """All Pydantic validation failures must keep the docs/02 error envelope."""

    session = client.post("/api/v1/chat/sessions", json={}).json()
    cases = [
        client.put("/api/v1/progress/ch05-01", json={"status": "bogus"}),
        client.post("/api/v1/notes", json={"topic_id": "ch05-01", "content": ""}),
        client.post(
            f"/api/v1/chat/sessions/{session['id']}/stream",
            json={"content": "   "},
        ),
        client.put("/api/v1/settings/llm", json={"temperature": 9}),
        client.post(SIMULATE, json={"n_points": "not-an-int"}),
        client.post(SIMULATE, json={"unexpected_field": 1}),
    ]
    for response in cases:
        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert isinstance(detail, dict), response.text
        assert detail.get("code") == "VALIDATION_ERROR"
        assert isinstance(detail.get("message"), str) and detail["message"]
        assert isinstance(detail.get("errors"), list)


def test_failed_stream_removes_empty_assistant_placeholder(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failed live stream must not leave an empty assistant bubble."""

    import httpx

    from backend.app.schemas.settings import LLMSettingsUpdate
    from backend.app.services import llm

    llm.save_llm_settings(
        LLMSettingsUpdate(
            provider="custom",
            base_url="https://llm.example.com",
            model="test-model",
            api_key="sk-acceptance-failed-stream",
        )
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "invalid key"}})

    monkeypatch.setattr(
        llm,
        "_build_async_client",
        lambda timeout: httpx.AsyncClient(
            transport=httpx.MockTransport(handler), timeout=timeout
        ),
    )

    session_id = client.post("/api/v1/chat/sessions", json={"title": "失败流"}).json()["id"]
    response = client.post(
        f"/api/v1/chat/sessions/{session_id}/stream",
        json={"content": "hello"},
    )
    assert response.status_code == 200
    events = parse_sse(response.text)
    assert [name for name, _ in events] == ["meta", "error"]
    assert events[-1][1]["code"] == "LLM_AUTH_ERROR"

    messages = client.get(f"/api/v1/chat/sessions/{session_id}/messages").json()["messages"]
    assert [message["role"] for message in messages] == ["user"]
    assert messages[0]["content"] == "hello"
