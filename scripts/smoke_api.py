#!/usr/bin/env python3
"""Repeatable end-to-end API smoke test for a running StudyPlusPlus server.

Usage::

    .venv/bin/python scripts/smoke_api.py [base_url]

The default ``base_url`` is ``http://127.0.0.1:8000`` (the production
single-port deployment from docs/02 section 9).

The script is intentionally independent from the backend implementation: the
key second-order values are re-derived from the analytic formulas in
``docs/03`` and compared with the HTTP responses.  It never calls a real LLM
provider: live streaming is skipped when the server reports ``llm_mode=live``,
and destructive settings/progress writes are skipped when a key/state already
exists.

Exit code is ``0`` when every required check passes, ``1`` otherwise.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import uuid
from typing import Any

import httpx

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
WARN = "\033[33mWARN\033[0m"

STEP_URL = "/api/v1/compute/second-order/simulate"
COMPARE_URL = "/api/v1/compute/second-order/compare"
PRESETS_URL = "/api/v1/compute/second-order/presets"


class SmokeRunner:
    def __init__(self, base_url: str) -> None:
        self.client = httpx.Client(base_url=base_url.rstrip("/"), timeout=30.0)
        self.failures: list[str] = []
        self.warnings: list[str] = []
        self.checks = 0

    # -- reporting ---------------------------------------------------------
    def check(self, name: str, condition: bool, detail: str = "") -> bool:
        self.checks += 1
        if condition:
            print(f"[{PASS}] {name}" + (f" — {detail}" if detail else ""))
        else:
            self.failures.append(name)
            print(f"[{FAIL}] {name}" + (f" — {detail}" if detail else ""))
        return condition

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        print(f"[{WARN}] {message}")

    def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.client.get(path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.client.post(path, **kwargs)

    def put(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.client.put(path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.client.delete(path, **kwargs)

    def close(self) -> None:
        self.client.close()


# ---------------------------------------------------------------------------
# Independent analytic formulas (docs/03 section 2)
# ---------------------------------------------------------------------------


def analytic_step_underdamped(t: list[float], zeta: float, wn: float) -> list[float]:
    wd = wn * math.sqrt(1.0 - zeta * zeta)
    phi = math.acos(zeta)
    return [
        1.0 - math.exp(-zeta * wn * x) / math.sqrt(1.0 - zeta * zeta) * math.sin(wd * x + phi)
        for x in t
    ]


def analytic_impulse_underdamped(t: list[float], zeta: float, wn: float) -> list[float]:
    wd = wn * math.sqrt(1.0 - zeta * zeta)
    return [wn * wn / wd * math.exp(-zeta * wn * x) * math.sin(wd * x) for x in t]


def max_rel_error(actual: list[float], expected: list[float]) -> float:
    worst = 0.0
    for a, e in zip(actual, expected):
        denom = max(abs(e), 1e-9)
        worst = max(worst, abs(a - e) / denom)
    return worst


def parse_sse(text: str) -> list[tuple[str, dict[str, Any]]]:
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
        try:
            payload = json.loads("\n".join(data_lines) or "{}")
        except json.JSONDecodeError:
            payload = {}
        events.append((event, payload))
    return events


# ---------------------------------------------------------------------------
# Smoke sections
# ---------------------------------------------------------------------------


def check_spa(r: SmokeRunner) -> None:
    for path in ("/", "/settings", "/learn/ch05/ch05-03"):
        try:
            response = r.get(path)
        except httpx.HTTPError as exc:  # pragma: no cover - connection issue
            r.check(f"SPA fallback {path}", False, str(exc))
            continue
        content_type = response.headers.get("content-type", "")
        is_html = "text/html" in content_type
        r.check(
            f"SPA fallback {path} -> 200",
            response.status_code == 200,
            f"status={response.status_code}, content-type={content_type}",
        )
        serves_index = is_html and 'id="root"' in response.text
        r.check(
            f"SPA fallback {path} serves index.html",
            serves_index,
            "" if serves_index else "response does not look like the built index.html",
        )


def check_health_and_content(r: SmokeRunner) -> str:
    health = r.get("/api/v1/health")
    r.check("GET /api/v1/health -> 200", health.status_code == 200, health.text[:160])
    health_body = health.json() if health.status_code == 200 else {}
    r.check("health.status == ok", health_body.get("status") == "ok", str(health_body))
    r.check("health.version == 0.1.0", health_body.get("version") == "0.1.0", str(health_body.get("version")))
    llm_mode = str(health_body.get("llm_mode", ""))
    r.check("health.llm_mode in {mock, live}", llm_mode in {"mock", "live"}, llm_mode)

    curriculum = r.get("/api/v1/curriculum")
    r.check("GET /api/v1/curriculum -> 200", curriculum.status_code == 200)
    books = curriculum.json().get("books", []) if curriculum.status_code == 200 else []
    r.check("curriculum has vol1 + vol2", [book.get("id") for book in books] == ["vol1", "vol2"])
    available_chapters = [
        chapter.get("id")
        for book in books
        for chapter in book.get("chapters", [])
        if chapter.get("status") == "available"
    ]
    r.check("only ch05 is available", available_chapters == ["ch05"], str(available_chapters))

    topic = r.get("/api/v1/topics/ch05-03")
    r.check("GET /api/v1/topics/ch05-03 -> 200", topic.status_code == 200, topic.text[:160])
    if topic.status_code == 200:
        payload = topic.json()
        r.check("topic has prev/next navigation", payload.get("prev_topic", {}).get("id") == "ch05-02" and payload.get("next_topic", {}).get("id") == "ch05-04")
        body = payload.get("body_markdown", "")
        r.check("topic body has KaTeX/details/widget markers", "$$" in body and ":::details" in body and "[[widget:" in body)
        r.check("topic declares widgets", bool(payload.get("widgets")))

    planned = r.get("/api/v1/topics/ch01-01")
    r.check(
        "planned topic -> 404 TOPIC_NOT_AVAILABLE",
        planned.status_code == 404 and planned.json().get("detail", {}).get("code") == "TOPIC_NOT_AVAILABLE",
        planned.text[:160],
    )
    return llm_mode


def check_compute(r: SmokeRunner) -> None:
    # TC-C03 analytic check (zeta=0.5, wn=1).
    response = r.post(STEP_URL, json={"zeta": 0.5, "omega_n": 1.0, "input_type": "step", "t_end": 20.0, "n_points": 1001})
    r.check("POST simulate(step) -> 200", response.status_code == 200, response.text[:160])
    data = response.json() if response.status_code == 200 else {}
    if data:
        r.check("step classification == underdamped", data.get("classification") == "underdamped")
        poles = sorted((pole["real"], abs(pole["imag"])) for pole in data.get("poles", []))
        r.check(
            "step poles == -0.5 ± j0.866",
            len(poles) == 2
            and abs(poles[0][0] + 0.5) < 1e-9
            and abs(poles[1][0] + 0.5) < 1e-9
            and abs(poles[0][1] - math.sqrt(3) / 2) < 1e-9
            and abs(poles[1][1] - math.sqrt(3) / 2) < 1e-9,
            str(poles),
        )
        t = [float(item) for item in data.get("t", [])]
        y = [float(item) for item in data.get("y", [])]
        expected = analytic_step_underdamped(t, 0.5, 1.0)
        error = max_rel_error(y, expected)
        r.check("step response matches analytic formula (rel < 1e-3)", error < 1e-3, f"max_rel_error={error:.2e}")

        wd = 1.0 * math.sqrt(1.0 - 0.5**2)
        expected_tp = math.pi / wd
        expected_mp = math.exp(-math.pi * 0.5 / math.sqrt(1.0 - 0.5**2)) * 100.0
        metrics = data.get("metrics") or {}
        analytical = data.get("analytical_metrics") or {}
        r.check("numeric tp ≈ analytic tp", abs(metrics.get("peak_time", 0.0) - expected_tp) <= 0.05)
        r.check("numeric Mp ≈ analytic Mp", abs(metrics.get("overshoot_pct", 0.0) - expected_mp) <= 0.2)
        r.check("analytic tp/Mp present", abs(analytical.get("peak_time", 0.0) - expected_tp) < 1e-9 and abs(analytical.get("overshoot_pct", 0.0) - expected_mp) < 1e-9)
        r.check("numeric ts(2%) within 10% of 4/(zeta*wn)", abs(metrics.get("settling_time_2pct", 0.0) - 8.0) <= 0.8)

    # Undamped step TC-C01.
    response = r.post(STEP_URL, json={"zeta": 0.0, "omega_n": 1.0, "input_type": "step", "t_end": 20.0, "n_points": 2001})
    data = response.json() if response.status_code == 200 else {}
    r.check("POST simulate(undamped step) -> 200", response.status_code == 200)
    if data:
        t = [float(item) for item in data.get("t", [])]
        y = [float(item) for item in data.get("y", [])]
        r.check("undamped y ≈ 1-cos(t)", max_rel_error(y, [1.0 - math.cos(x) for x in t]) < 1e-3)
        metrics = data.get("metrics") or {}
        r.check("undamped tp ≈ pi", abs(metrics.get("peak_time", 0.0) - math.pi) <= 0.05)
        r.check("undamped Mp ≈ 100%", abs(metrics.get("overshoot_pct", 0.0) - 100.0) <= 0.1)
        r.check("undamped classification", data.get("classification") == "undamped")

    # Impulse mode TC-C07 analytic check.
    response = r.post(STEP_URL, json={"zeta": 0.5, "omega_n": 2.0, "input_type": "impulse", "t_end": 10.0, "n_points": 2001})
    data = response.json() if response.status_code == 200 else {}
    r.check("POST simulate(impulse) -> 200", response.status_code == 200)
    if data:
        t = [float(item) for item in data.get("t", [])]
        y = [float(item) for item in data.get("y", [])]
        r.check("impulse y matches analytic h(t)", max_rel_error(y, analytic_impulse_underdamped(t, 0.5, 2.0)) < 1e-3)
        r.check("impulse input u == 0", set(round(float(item), 9) for item in data.get("u", [])) == {0.0})

    # Initial-state mode TC-C05.
    response = r.post(STEP_URL, json={"zeta": 0.0, "omega_n": 1.0, "input_type": "initial", "y0": 1.0, "v0": 0.0, "t_end": 20.0, "n_points": 2001})
    data = response.json() if response.status_code == 200 else {}
    r.check("POST simulate(initial) -> 200", response.status_code == 200)
    if data:
        t = [float(item) for item in data.get("t", [])]
        y = [float(item) for item in data.get("y", [])]
        r.check("initial y ≈ cos(t)", max_rel_error(y, [math.cos(x) for x in t]) < 1e-3)

    # Unstable TC-C06.
    response = r.post(STEP_URL, json={"zeta": -0.1, "omega_n": 1.0, "input_type": "step", "t_end": 20.0, "n_points": 1001})
    data = response.json() if response.status_code == 200 else {}
    r.check("unstable classification + diagnostics", data.get("classification") == "unstable" and data.get("metrics") is None and any("不稳定" in item for item in data.get("diagnostics", [])))

    # Boundary error TC-C08.
    response = r.post(STEP_URL, json={"omega_n": 0.0})
    detail = response.json().get("detail", {}) if response.status_code == 422 else {}
    r.check("invalid omega_n -> 422 INVALID_OMEGA_N", response.status_code == 422 and detail.get("code") == "INVALID_OMEGA_N", response.text[:160])

    # Compare and presets.
    response = r.post(COMPARE_URL, json={"runs": [{"zeta": 0.5, "omega_n": 1.0, "label": "a"}, {"zeta": 1.0, "omega_n": 1.0, "label": "b"}]})
    results = response.json().get("results", []) if response.status_code == 200 else []
    r.check("POST compare -> 200 with labels", response.status_code == 200 and [item.get("label") for item in results] == ["a", "b"])
    r.check("compare classifications", [item.get("classification") for item in results] == ["underdamped", "critically_damped"])

    response = r.post(COMPARE_URL, json={"runs": [{"zeta": 0.5, "omega_n": 1.0}] * 5})
    r.check("compare >4 -> 422 INVALID_COMPARE_RUNS", response.status_code == 422 and response.json().get("detail", {}).get("code") == "INVALID_COMPARE_RUNS")

    response = r.get(PRESETS_URL)
    presets = response.json().get("presets", []) if response.status_code == 200 else []
    r.check("GET presets -> 5 named presets", response.status_code == 200 and [item.get("key") for item in presets] == ["undamped", "underdamped", "critical", "overdamped", "unstable"])


def check_settings(r: SmokeRunner, llm_mode: str) -> None:
    current = r.get("/api/v1/settings/llm")
    r.check("GET /api/v1/settings/llm -> 200", current.status_code == 200, current.text[:160])
    if current.status_code != 200:
        return
    body = current.json()
    r.check("settings response never contains plaintext api_key", "api_key" not in body, str(list(body)))
    r.check("settings returns masked key shape", "api_key_masked" in body and body.get("has_api_key") in (True, False))

    if body.get("has_api_key"):
        r.warn("existing API key detected; skipping settings mutation smoke to avoid overwriting user config")
        return

    test_result = r.post("/api/v1/settings/llm/test")
    test_body = test_result.json() if test_result.status_code == 200 else {}
    r.check("POST /settings/llm/test (no key) -> offline mock success", test_result.status_code == 200 and test_body.get("ok") is True and test_body.get("mode") == "mock")

    fake_key = "sk-smoke-" + uuid.uuid4().hex[:12]
    updated = r.put(
        "/api/v1/settings/llm",
        json={
            "provider": "custom",
            "base_url": "https://llm.example.com",
            "model": "smoke-model",
            "api_key": fake_key,
            "temperature": 0.4,
            "max_tokens": 256,
        },
    )
    updated_body = updated.json() if updated.status_code == 200 else {}
    r.check("PUT settings(fake key) -> 200 live mode", updated.status_code == 200 and updated_body.get("mode") == "live" and updated_body.get("has_api_key") is True)
    r.check("fake key is masked in response and never echoed", fake_key not in updated.text and updated_body.get("api_key_masked", "").endswith(fake_key[-4:]))

    preserved = r.put("/api/v1/settings/llm", json={"api_key": ""})
    preserved_body = preserved.json() if preserved.status_code == 200 else {}
    r.check("PUT settings with empty key preserves stored key", preserved_body.get("has_api_key") is True and preserved_body.get("api_key_masked", "").endswith(fake_key[-4:]))

    normalized = r.put("/api/v1/settings/llm", json={"base_url": "https://api.deepseek.com/chat/completions"})
    normalized_body = normalized.json() if normalized.status_code == 200 else {}
    r.check("base URL /chat/completions is normalized to /v1", normalized_body.get("effective_base_url") == "https://api.deepseek.com/v1")

    reset = r.post("/api/v1/settings/llm/reset")
    reset_body = reset.json() if reset.status_code == 200 else {}
    r.check("POST settings/reset restores DeepSeek mock default", reset.status_code == 200 and reset_body.get("provider") == "deepseek" and reset_body.get("mode") == "mock" and reset_body.get("has_api_key") is False)


def check_progress_and_notes(r: SmokeRunner) -> None:
    progress_before = {item["topic_id"]: item["status"] for item in r.get("/api/v1/progress").json().get("items", [])}
    original = progress_before.get("ch05-01")
    chapter_before = r.get("/api/v1/progress/ch05").json()
    expected_completed = chapter_before.get("completed", 0) + (0 if original == "completed" else 1)

    try:
        put = r.put("/api/v1/progress/ch05-01", json={"status": "completed"})
        r.check("PUT /progress/ch05-01 -> 200", put.status_code == 200 and put.json().get("status") == "completed", put.text[:160])
        chapter = r.get("/api/v1/progress/ch05").json()
        r.check(
            "GET /progress/ch05 percent matches independent count",
            chapter.get("total") == 5
            and chapter.get("completed") == expected_completed
            and chapter.get("percent") == round(expected_completed / 5 * 100, 1),
            str(chapter),
        )
        items = {item["topic_id"]: item["status"] for item in r.get("/api/v1/progress").json().get("items", [])}
        r.check("GET /progress lists updated topic", items.get("ch05-01") == "completed")
    finally:
        restore = original or "not_started"
        r.put("/api/v1/progress/ch05-01", json={"status": restore})

    topic_id = f"smoke-topic-{uuid.uuid4().hex[:8]}"
    created = r.post("/api/v1/notes", json={"topic_id": topic_id, "content": "smoke note"})
    note = created.json() if created.status_code == 200 else {}
    note_id = note.get("id")
    r.check("POST /notes -> 200", created.status_code == 200 and note.get("content") == "smoke note", created.text[:160])
    if note_id is not None:
        listed = r.get("/api/v1/notes", params={"topic_id": topic_id}).json().get("items", [])
        r.check("GET /notes?topic_id returns created note", any(item.get("id") == note_id for item in listed))
        updated = r.put(f"/api/v1/notes/{note_id}", json={"content": "smoke note updated"})
        r.check("PUT /notes/{id} -> updated", updated.status_code == 200 and updated.json().get("content") == "smoke note updated")
        deleted = r.delete(f"/api/v1/notes/{note_id}")
        r.check("DELETE /notes/{id} -> deleted", deleted.status_code == 200 and deleted.json().get("deleted") is True)
        r.check("deleted note no longer listed", not any(item.get("id") == note_id for item in r.get("/api/v1/notes", params={"topic_id": topic_id}).json().get("items", [])))


def check_chat(r: SmokeRunner, llm_mode: str) -> None:
    created = r.post("/api/v1/chat/sessions", json={"title": "smoke session", "context": {"chapter": "ch05", "topic": "ch05-03"}})
    session = created.json() if created.status_code == 201 else {}
    session_id = session.get("id")
    r.check("POST /chat/sessions -> 201", created.status_code == 201 and bool(session_id), created.text[:160])
    if not session_id:
        return

    try:
        sessions = r.get("/api/v1/chat/sessions").json().get("sessions", [])
        r.check("GET /chat/sessions lists session", any(item.get("id") == session_id for item in sessions))
        messages = r.get(f"/api/v1/chat/sessions/{session_id}/messages")
        r.check("GET chat messages -> empty history", messages.status_code == 200 and messages.json().get("messages") == [])

        if llm_mode != "mock":
            r.warn("llm_mode=live; skipping SSE stream smoke to avoid a real provider call")
            return

        stream = r.post(f"/api/v1/chat/sessions/{session_id}/stream", json={"content": "什么是二阶系统？"})
        r.check("POST chat stream -> 200 SSE", stream.status_code == 200 and stream.headers.get("content-type", "").startswith("text/event-stream"), stream.text[:160])
        events = parse_sse(stream.text)
        names = [name for name, _ in events]
        r.check("SSE order meta -> delta* -> done", names and names[0] == "meta" and names[-1] == "done" and names.count("delta") >= 1 and "error" not in names, str(names))
        delta_text = "".join(data.get("content", "") for name, data in events if name == "delta")
        r.check("mock delta text is present", "Mock" in delta_text and "API Key" in delta_text, delta_text[:120])

        persisted = r.get(f"/api/v1/chat/sessions/{session_id}/messages").json().get("messages", [])
        r.check("chat persists user + assistant messages", [item.get("role") for item in persisted] == ["user", "assistant"] and persisted[1].get("content") == delta_text)
        listed = r.get("/api/v1/chat/sessions").json().get("sessions", [])
        matching = next((item for item in listed if item.get("id") == session_id), {})
        r.check("session message_count == 2", matching.get("message_count") == 2)
    finally:
        deleted = r.delete(f"/api/v1/chat/sessions/{session_id}")
        r.check("DELETE /chat/sessions/{id} -> 200", deleted.status_code == 200)
        r.check("deleted session messages -> 404", r.get(f"/api/v1/chat/sessions/{session_id}/messages").status_code == 404)


def main() -> int:
    parser = argparse.ArgumentParser(description="StudyPlusPlus API smoke test")
    parser.add_argument("base_url", nargs="?", default="http://127.0.0.1:8000")
    args = parser.parse_args()

    runner = SmokeRunner(args.base_url)
    try:
        check_spa(runner)
        llm_mode = check_health_and_content(runner)
        check_compute(runner)
        check_settings(runner, llm_mode)
        check_progress_and_notes(runner)
        check_chat(runner, llm_mode)
    except httpx.HTTPError as exc:
        runner.check("HTTP transport", False, str(exc))
    finally:
        runner.close()

    print("-" * 72)
    if runner.failures:
        print(f"{FAIL}: {len(runner.failures)}/{runner.checks} checks failed")
        for name in runner.failures:
            print(f"  - {name}")
        return 1
    print(f"{PASS}: all {runner.checks} checks passed")
    if runner.warnings:
        print(f"{WARN}: {len(runner.warnings)} warning(s) (manual follow-up)")
        for message in runner.warnings:
            print(f"  - {message}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
