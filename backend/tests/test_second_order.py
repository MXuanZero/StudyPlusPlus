"""Acceptance tests for the second-order compute service (T3).

Covers docs/03 section 6.1 cases TC-C01 through TC-C08 plus the small set of
API contract checks needed for the frontend.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy import signal

from backend.app.main import app
from backend.app.services.second_order import (
    SecondOrderValidationError,
    calculate_poles,
    classify_damping,
    compute_analytical_metrics,
)

SIMULATE_URL = "/api/v1/compute/second-order/simulate"
COMPARE_URL = "/api/v1/compute/second-order/compare"
PRESETS_URL = "/api/v1/compute/second-order/presets"

client = TestClient(app)


def _simulate(**kwargs) -> dict:
    response = client.post(SIMULATE_URL, json=kwargs)
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# TC-C01: undamped step response
# ---------------------------------------------------------------------------


def test_tc_c01_undamped_step() -> None:
    data = _simulate(zeta=0.0, omega_n=1.0, input_type="step", t_end=20.0, n_points=1001)

    assert data["classification"] == "undamped"

    poles = data["poles"]
    assert len(poles) == 2
    assert all(pole["real"] == pytest.approx(0.0, abs=1e-12) for pole in poles)
    assert sorted(pole["imag"] for pole in poles) == pytest.approx([-1.0, 1.0])

    t = np.asarray(data["t"], dtype=float)
    y = np.asarray(data["y"], dtype=float)
    np.testing.assert_allclose(y, 1.0 - np.cos(t), rtol=1e-3, atol=1e-3)

    metrics = data["metrics"]
    assert metrics is not None
    # The sampled grid may not contain pi exactly; dt = 20 / 1000 = 0.02.
    assert metrics["peak_time"] == pytest.approx(math.pi, abs=0.05)
    assert metrics["peak_value"] == pytest.approx(2.0, abs=0.01)
    assert metrics["overshoot_pct"] == pytest.approx(100.0, abs=0.1)
    assert data["analytical_metrics"] is None


# ---------------------------------------------------------------------------
# TC-C02: critically damped step response
# ---------------------------------------------------------------------------


def test_tc_c02_critically_damped_step() -> None:
    data = _simulate(zeta=1.0, omega_n=1.0, input_type="step", t_end=20.0, n_points=1001)

    assert data["classification"] == "critically_damped"

    t = np.asarray(data["t"], dtype=float)
    y = np.asarray(data["y"], dtype=float)
    expected = 1.0 - (1.0 + t) * np.exp(-t)
    np.testing.assert_allclose(y, expected, rtol=1e-3, atol=1e-3)

    # Monotonic and without overshoot.
    assert np.min(np.diff(y)) > -1e-8
    assert np.max(y) <= 1.0 + 1e-9

    metrics = data["metrics"]
    assert metrics is not None
    assert metrics["peak_time"] is None
    assert metrics["overshoot_pct"] == pytest.approx(0.0, abs=1e-9)
    assert data["analytical_metrics"] is None


# ---------------------------------------------------------------------------
# TC-C03: underdamped step response, zeta = 0.5
# ---------------------------------------------------------------------------


def test_tc_c03_underdamped_step_zeta_half() -> None:
    data = _simulate(zeta=0.5, omega_n=1.0, input_type="step", t_end=20.0, n_points=1001)

    assert data["classification"] == "underdamped"

    poles = data["poles"]
    assert [pole["real"] for pole in poles] == pytest.approx([-0.5, -0.5])
    assert sorted(abs(pole["imag"]) for pole in poles) == pytest.approx(
        [math.sqrt(3.0) / 2.0, math.sqrt(3.0) / 2.0]
    )

    metrics = data["metrics"]
    assert metrics is not None
    expected_tp = 2.0 * math.pi / math.sqrt(3.0)  # 3.6276 s
    assert metrics["peak_time"] == pytest.approx(expected_tp, abs=0.05)
    assert metrics["overshoot_pct"] == pytest.approx(16.3, abs=0.2)

    analytical = data["analytical_metrics"]
    assert analytical is not None
    assert analytical["peak_time"] == pytest.approx(expected_tp)
    assert analytical["overshoot_pct"] == pytest.approx(16.3, abs=0.1)
    assert analytical["settling_time_2pct"] == pytest.approx(8.0)
    assert analytical["settling_time_5pct"] == pytest.approx(6.0)

    # docs/03 allows the definition-level difference; test with a 10% window.
    assert metrics["settling_time_2pct"] == pytest.approx(
        analytical["settling_time_2pct"], rel=0.10
    )


# ---------------------------------------------------------------------------
# TC-C04: underdamped step response, zeta = 0.707
# ---------------------------------------------------------------------------


def test_tc_c04_underdamped_step_zeta_0707() -> None:
    data = _simulate(zeta=0.707, omega_n=1.0, input_type="step", t_end=20.0, n_points=1001)

    assert data["classification"] == "underdamped"

    metrics = data["metrics"]
    assert metrics is not None
    assert metrics["peak_time"] == pytest.approx(4.443, abs=0.05)
    assert metrics["overshoot_pct"] == pytest.approx(4.32, abs=0.1)

    analytical = data["analytical_metrics"]
    assert analytical is not None
    assert analytical["peak_time"] == pytest.approx(math.pi / math.sqrt(1.0 - 0.707**2))
    assert analytical["overshoot_pct"] == pytest.approx(4.32, abs=0.1)


# ---------------------------------------------------------------------------
# TC-C05: undamped initial-state response
# ---------------------------------------------------------------------------


def test_tc_c05_undamped_initial_state() -> None:
    data = _simulate(
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
    np.testing.assert_allclose(y, np.cos(t), rtol=1e-3, atol=1e-3)

    # y(t) = cos(t) has period 2*pi.
    assert y[0] == pytest.approx(1.0, abs=1e-6)
    assert np.allclose(np.asarray(data["u"]), 0.0)
    assert data["metrics"] is None
    assert data["analytical_metrics"] is None


# ---------------------------------------------------------------------------
# TC-C06: unstable system
# ---------------------------------------------------------------------------


def test_tc_c06_unstable_system() -> None:
    data = _simulate(zeta=-0.1, omega_n=1.0, input_type="step", t_end=20.0, n_points=1001)

    assert data["classification"] == "unstable"
    assert max(pole["real"] for pole in data["poles"]) > 0.0

    y = np.asarray(data["y"], dtype=float)
    assert abs(y[-1]) > abs(y[0])

    assert data["metrics"] is None
    assert data["analytical_metrics"] is None
    assert any("不稳定" in message for message in data["diagnostics"])


# ---------------------------------------------------------------------------
# TC-C07: impulse response matches scipy.signal.lti.impulse
# ---------------------------------------------------------------------------


def test_tc_c07_impulse_matches_scipy() -> None:
    zeta, omega_n = 0.5, 2.0
    data = _simulate(
        zeta=zeta,
        omega_n=omega_n,
        input_type="impulse",
        t_end=10.0,
        n_points=1001,
        include_metrics=False,
    )

    assert data["classification"] == "underdamped"
    assert data["metrics"] is None
    assert data["analytical_metrics"] is None
    assert np.allclose(np.asarray(data["u"]), 0.0)

    t = np.asarray(data["t"], dtype=float)
    y = np.asarray(data["y"], dtype=float)

    system = signal.lti(
        [omega_n**2],
        [1.0, 2.0 * zeta * omega_n, omega_n**2],
    )
    _, y_reference = system.impulse(T=t)
    np.testing.assert_allclose(y, y_reference, rtol=1e-6, atol=1e-9)


# ---------------------------------------------------------------------------
# TC-C08: invalid omega_n returns the unified error code
# ---------------------------------------------------------------------------


def test_tc_c08_invalid_omega_n() -> None:
    response = client.post(SIMULATE_URL, json={"zeta": 0.5, "omega_n": 0.0})
    assert response.status_code in (400, 422)
    assert response.json()["detail"]["code"] == "INVALID_OMEGA_N"


# ---------------------------------------------------------------------------
# Supporting API and validation checks
# ---------------------------------------------------------------------------


def test_simulate_response_contract() -> None:
    data = _simulate(zeta=0.5, omega_n=2.0)

    assert set(data) == {
        "classification",
        "poles",
        "t",
        "y",
        "u",
        "metrics",
        "analytical_metrics",
        "diagnostics",
    }
    assert set(data["metrics"]) == {
        "rise_time_10_90",
        "rise_time_0_100",
        "peak_time",
        "peak_value",
        "overshoot_pct",
        "settling_time_2pct",
        "settling_time_5pct",
        "steady_state_value",
    }
    assert len(data["t"]) == len(data["y"]) == len(data["u"]) == 1001
    assert data["t"][0] == pytest.approx(0.0)
    assert data["t"][-1] == pytest.approx(20.0)
    assert all(set(pole) == {"real", "imag"} for pole in data["poles"])


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"zeta": -0.51}, "INVALID_ZETA"),
        ({"zeta": 3.01}, "INVALID_ZETA"),
        ({"omega_n": 0.0}, "INVALID_OMEGA_N"),
        ({"omega_n": 10.01}, "INVALID_OMEGA_N"),
        ({"y0": -2.01}, "INVALID_Y0"),
        ({"y0": 2.01}, "INVALID_Y0"),
        ({"v0": -2.01}, "INVALID_V0"),
        ({"v0": 2.01}, "INVALID_V0"),
        ({"t_end": 0.0}, "INVALID_T_END"),
        ({"t_end": 60.01}, "INVALID_T_END"),
        ({"n_points": 199}, "INVALID_N_POINTS"),
        ({"n_points": 5001}, "INVALID_N_POINTS"),
        ({"input_type": "ramp"}, "INVALID_INPUT_TYPE"),
    ],
)
def test_parameter_error_codes(payload: dict, code: str) -> None:
    response = client.post(SIMULATE_URL, json=payload)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code


def test_include_metrics_false_returns_null_metrics() -> None:
    data = _simulate(zeta=0.5, omega_n=2.0, include_metrics=False)
    assert data["metrics"] is None
    assert data["analytical_metrics"] is None


def test_presets_endpoint() -> None:
    response = client.get(PRESETS_URL)
    assert response.status_code == 200

    presets = response.json()["presets"]
    assert len(presets) == 5
    assert [preset["key"] for preset in presets] == [
        "undamped",
        "underdamped",
        "critical",
        "overdamped",
        "unstable",
    ]
    assert presets[0]["zeta"] == 0.0
    assert presets[0]["omega_n"] == 2.0
    assert presets[1]["zeta"] == 0.3
    assert presets[2]["zeta"] == 1.0
    assert presets[3]["zeta"] == 1.8
    assert presets[4]["zeta"] == -0.15


def test_compare_endpoint() -> None:
    response = client.post(
        COMPARE_URL,
        json={
            "runs": [
                {"zeta": 0.5, "omega_n": 2.0, "label": "欠阻尼"},
                {"zeta": 1.0, "omega_n": 2.0, "label": "临界阻尼"},
            ]
        },
    )
    assert response.status_code == 200

    results = response.json()["results"]
    assert [item["label"] for item in results] == ["欠阻尼", "临界阻尼"]
    assert [item["classification"] for item in results] == [
        "underdamped",
        "critically_damped",
    ]
    assert len(results[0]["t"]) == 1001


def test_compare_endpoint_rejects_too_many_runs() -> None:
    response = client.post(
        COMPARE_URL,
        json={"runs": [{"zeta": 0.5, "omega_n": 2.0}] * 5},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_COMPARE_RUNS"


# ---------------------------------------------------------------------------
# Pure service-level helpers
# ---------------------------------------------------------------------------


def test_classify_damping_boundaries() -> None:
    assert classify_damping(-0.01) == "unstable"
    assert classify_damping(0.0) == "undamped"
    assert classify_damping(0.5) == "underdamped"
    assert classify_damping(1.0) == "critically_damped"
    assert classify_damping(1.5) == "overdamped"


def test_analytical_metrics_only_underdamped() -> None:
    assert compute_analytical_metrics(0.0, 1.0) is None
    assert compute_analytical_metrics(1.0, 1.0) is None
    assert compute_analytical_metrics(0.5, 2.0)["peak_time"] == pytest.approx(
        math.pi / (2.0 * math.sqrt(0.75))
    )


def test_calculate_poles_matches_characteristic_roots() -> None:
    poles = calculate_poles(0.25, 3.0)
    roots = np.roots([1.0, 2.0 * 0.25 * 3.0, 3.0**2])
    assert sorted((pole["real"], pole["imag"]) for pole in poles) == pytest.approx(
        sorted((complex(root).real, complex(root).imag) for root in roots)
    )


def test_service_validation_error_has_code() -> None:
    from backend.app.services.second_order import validate_parameters

    with pytest.raises(SecondOrderValidationError) as exc_info:
        validate_parameters(
            zeta=0.5,
            omega_n=0.0,
            y0=0.0,
            v0=0.0,
            t_end=20.0,
            n_points=1001,
        )
    assert exc_info.value.code == "INVALID_OMEGA_N"
