"""Second-order system simulation and performance metrics.

This module is the single source of truth for the second-order lab.  It
implements exactly the model described in ``docs/03_二阶系统分析模块详细设计.md``
(section 3):

* standard transfer function ``G(s) = wn^2 / (s^2 + 2*zeta*wn*s + wn^2)``
* state space ``x = [y, y_dot]`` with ``A = [[0, 1], [-wn^2, -2*zeta*wn]]``
  and ``B = [0, wn^2]^T``
* step / impulse / initial-response simulation,
* pole calculation and damping classification,
* numerical step metrics and underdamped analytical approximations.

Only ``numpy`` and ``scipy`` are used; the optional ``control`` package is
deliberately not required.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy import signal
from scipy.integrate import solve_ivp

# ---------------------------------------------------------------------------
# Parameter ranges (docs/03 section 3.6)
# ---------------------------------------------------------------------------

ZETA_MIN = -0.5
ZETA_MAX = 3.0
OMEGA_N_MIN_EXCLUSIVE = 0.0
OMEGA_N_MAX = 10.0
Y0_MIN, Y0_MAX = -2.0, 2.0
V0_MIN, V0_MAX = -2.0, 2.0
T_END_MIN_EXCLUSIVE = 0.0
T_END_MAX = 60.0
N_POINTS_MIN = 200
N_POINTS_MAX = 5000

DEFAULT_ZETA = 0.5
DEFAULT_OMEGA_N = 2.0
DEFAULT_Y0 = 1.0
DEFAULT_V0 = 0.0
DEFAULT_T_END = 20.0
DEFAULT_N_POINTS = 1001

VALID_INPUT_TYPES = ("step", "impulse", "initial")

#: Maximum absolute value kept in an outgoing response.  Unstable systems can
#: overflow IEEE-754 for extreme parameter combinations; clipping keeps the
#: JSON serialisable while the diagnostics flag the divergence.
RESPONSE_CLIP = 1.0e12


class SecondOrderValidationError(ValueError):
    """Raised when one of the second-order parameters is out of range."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Presets (docs/03 section 4.1.4)
# ---------------------------------------------------------------------------

PRESETS: list[dict[str, Any]] = [
    {
        "key": "undamped",
        "name": "无阻尼",
        "zeta": 0.0,
        "omega_n": 2.0,
        "description": "等幅振荡",
    },
    {
        "key": "underdamped",
        "name": "欠阻尼",
        "zeta": 0.3,
        "omega_n": 2.0,
        "description": "明显超调",
    },
    {
        "key": "critical",
        "name": "临界阻尼",
        "zeta": 1.0,
        "omega_n": 2.0,
        "description": "无超调",
    },
    {
        "key": "overdamped",
        "name": "过阻尼",
        "zeta": 1.8,
        "omega_n": 2.0,
        "description": "缓慢无超调",
    },
    {
        "key": "unstable",
        "name": "不稳定",
        "zeta": -0.15,
        "omega_n": 2.0,
        "description": "发散",
    },
]


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _fail(code: str, message: str) -> None:
    raise SecondOrderValidationError(code, message)


def validate_parameters(
    *,
    zeta: float,
    omega_n: float,
    y0: float,
    v0: float,
    t_end: float,
    n_points: int,
    input_type: str = "step",
) -> None:
    """Validate a full simulation parameter set.

    Error codes follow docs/03 section 3.6.  ``input_type`` is validated as
    well so the API can always return the unified ``{"code", "message"}``
    error body instead of a raw Pydantic error list.
    """

    # ``math.isfinite`` also rejects nan/inf coming from a hand-built payload.
    if not math.isfinite(zeta) or zeta < ZETA_MIN or zeta > ZETA_MAX:
        _fail(
            "INVALID_ZETA",
            f"阻尼比必须在 {ZETA_MIN} 到 {ZETA_MAX} 之间",
        )

    if (
        not math.isfinite(omega_n)
        or omega_n <= OMEGA_N_MIN_EXCLUSIVE
        or omega_n > OMEGA_N_MAX
    ):
        _fail(
            "INVALID_OMEGA_N",
            f"自然频率必须大于 {OMEGA_N_MIN_EXCLUSIVE} 且不超过 {OMEGA_N_MAX}",
        )

    if not math.isfinite(y0) or y0 < Y0_MIN or y0 > Y0_MAX:
        _fail("INVALID_Y0", f"初始位移必须在 {Y0_MIN} 到 {Y0_MAX} 之间")

    if not math.isfinite(v0) or v0 < V0_MIN or v0 > V0_MAX:
        _fail("INVALID_V0", f"初始速度必须在 {V0_MIN} 到 {V0_MAX} 之间")

    if not math.isfinite(t_end) or t_end <= T_END_MIN_EXCLUSIVE or t_end > T_END_MAX:
        _fail("INVALID_T_END", f"仿真时长必须大于 0 且不超过 {T_END_MAX}")

    if (
        isinstance(n_points, bool)
        or not isinstance(n_points, (int, np.integer))
        or n_points < N_POINTS_MIN
        or n_points > N_POINTS_MAX
    ):
        _fail(
            "INVALID_N_POINTS",
            f"采样点数必须在 {N_POINTS_MIN} 到 {N_POINTS_MAX} 之间",
        )

    if input_type not in VALID_INPUT_TYPES:
        _fail(
            "INVALID_INPUT_TYPE",
            "输入类型必须是 step、impulse 或 initial",
        )


# ---------------------------------------------------------------------------
# Poles and classification (docs/03 sections 3.2 and 3.3)
# ---------------------------------------------------------------------------


def calculate_poles(zeta: float, omega_n: float) -> list[dict[str, float]]:
    """Return the two poles as ``{"real": ..., "imag": ...}`` dicts."""

    roots = np.roots([1.0, 2.0 * zeta * omega_n, omega_n * omega_n])
    poles = [
        {"real": float(np.real(root)), "imag": float(np.imag(root))}
        for root in roots
    ]
    # Deterministic order makes snapshots and logs stable.
    poles.sort(key=lambda item: (item["real"], item["imag"]))
    return poles


def classify_damping(zeta: float) -> str:
    """Classify a damping ratio exactly as specified in docs/03 section 3.3."""

    if zeta < 0:
        return "unstable"
    if zeta == 0:
        return "undamped"
    if zeta < 1:
        return "underdamped"
    if zeta == 1:
        return "critically_damped"
    return "overdamped"


# ---------------------------------------------------------------------------
# Simulation backends (docs/03 section 3.4)
# ---------------------------------------------------------------------------


def _lti_system(zeta: float, omega_n: float) -> signal.lti:
    """Continuous LTI system for the standard second-order transfer function."""

    numerator = [omega_n * omega_n]
    denominator = [1.0, 2.0 * zeta * omega_n, omega_n * omega_n]
    return signal.lti(numerator, denominator)


def _simulate_step(t: np.ndarray, zeta: float, omega_n: float) -> np.ndarray:
    """Unit-step response from zero initial state via ``scipy.signal.lsim``."""

    _, y, _ = signal.lsim(
        _lti_system(zeta, omega_n),
        U=np.ones_like(t, dtype=float),
        T=t,
    )
    return np.asarray(y, dtype=float)


def _simulate_impulse(t: np.ndarray, zeta: float, omega_n: float) -> np.ndarray:
    """Unit-impulse response via ``scipy.signal.lti.impulse(T=...)``."""

    _, y = _lti_system(zeta, omega_n).impulse(T=t)
    return np.asarray(y, dtype=float)


def _simulate_initial(
    t: np.ndarray,
    zeta: float,
    omega_n: float,
    y0: float,
    v0: float,
) -> np.ndarray:
    """Zero-input response via ``scipy.integrate.solve_ivp``."""

    a = np.array(
        [[0.0, 1.0], [-omega_n * omega_n, -2.0 * zeta * omega_n]],
        dtype=float,
    )

    def rhs(_time: float, state: np.ndarray) -> np.ndarray:
        return a @ state

    solution = solve_ivp(
        rhs,
        (0.0, float(t[-1])),
        [float(y0), float(v0)],
        t_eval=t,
        method="RK45",
        rtol=1.0e-9,
        atol=1.0e-12,
    )
    if not solution.success:  # pragma: no cover - defensive
        raise RuntimeError(f"求解初始状态响应失败：{solution.message}")
    return np.asarray(solution.y[0], dtype=float)


def _sanitise_response(y: np.ndarray) -> tuple[np.ndarray, bool]:
    """Keep the response finite and JSON-serialisable.

    Returns the sanitised array plus a flag indicating whether clipping was
    applied.
    """

    y = np.asarray(y, dtype=float)
    if np.all(np.isfinite(y)):
        return y, False
    return np.nan_to_num(
        y,
        nan=0.0,
        posinf=RESPONSE_CLIP,
        neginf=-RESPONSE_CLIP,
    ), True


# ---------------------------------------------------------------------------
# Numerical step metrics (docs/03 section 3.5)
# ---------------------------------------------------------------------------


def _first_crossing_time(t: np.ndarray, y: np.ndarray, level: float) -> float | None:
    """First time the signal reaches ``level`` from below, with interpolation."""

    if y.size == 0:
        return None
    if y[0] >= level:
        return float(t[0])

    below = y[:-1] < level
    reaches = y[1:] >= level
    candidates = np.flatnonzero(below & reaches)
    if candidates.size == 0:
        return None

    index = int(candidates[0])
    y_low = float(y[index])
    y_high = float(y[index + 1])
    if math.isclose(y_high, y_low, rel_tol=0.0, abs_tol=0.0):
        fraction = 0.0
    else:
        fraction = (level - y_low) / (y_high - y_low)
    fraction = float(np.clip(fraction, 0.0, 1.0))
    return float(t[index] + fraction * (t[index + 1] - t[index]))


def _settling_time(
    t: np.ndarray,
    y: np.ndarray,
    steady_state_value: float,
    tolerance: float,
) -> float | None:
    """Earliest time after which the response stays in the tolerance band.

    The search is done backwards from the end so the result is the last
    violation plus a linearly interpolated crossing (docs/03 section 3.5).
    """

    if y.size == 0:
        return None

    if abs(steady_state_value) <= 1.0e-9:
        error = np.abs(y - steady_state_value)
        limit = tolerance
    else:
        error = np.abs(y - steady_state_value) / abs(steady_state_value)
        limit = tolerance

    outside = np.flatnonzero(error > limit)
    if outside.size == 0:
        return float(t[0])

    last_outside = int(outside[-1])
    next_index = last_outside + 1
    if next_index >= t.size:
        return None

    error_before = float(error[last_outside])
    error_after = float(error[next_index])
    if math.isclose(error_after, error_before, rel_tol=0.0, abs_tol=0.0):
        fraction = 0.0
    else:
        fraction = (limit - error_before) / (error_after - error_before)
    fraction = float(np.clip(fraction, 0.0, 1.0))
    return float(t[last_outside] + fraction * (t[next_index] - t[last_outside]))


def compute_step_metrics(
    t: np.ndarray,
    y: np.ndarray,
    steady_state_value: float,
) -> dict[str, float | None]:
    """Compute numerical step-response metrics.

    Parameters follow docs/03 section 3.5.  ``null`` (``None``) is returned for
    any metric that is undefined (threshold not reached, no overshoot, ...).
    """

    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    if t.size == 0 or y.size == 0 or t.size != y.size:
        return _empty_metrics(steady_state_value)

    if not np.all(np.isfinite(y)):
        return _empty_metrics(steady_state_value)

    steady_state_value = float(steady_state_value)

    # Rise times -----------------------------------------------------------
    rise_time_10_90: float | None = None
    rise_time_0_100: float | None = None
    if steady_state_value > 0:
        t10 = _first_crossing_time(t, y, 0.10 * steady_state_value)
        t90 = _first_crossing_time(t, y, 0.90 * steady_state_value)
        if t10 is not None and t90 is not None:
            rise_time_10_90 = float(t90 - t10)

        t100 = _first_crossing_time(t, y, steady_state_value)
        if t100 is not None:
            rise_time_0_100 = float(t100 - t[0])

    # Peak / overshoot -----------------------------------------------------
    peak_index = int(np.argmax(y))
    peak_value = float(y[peak_index])
    peak_time: float | None = None
    overshoot_pct: float | None

    if abs(steady_state_value) <= 1.0e-9:
        overshoot_pct = None
    else:
        raw_overshoot = (peak_value - steady_state_value) / abs(steady_state_value) * 100.0
        # Numerical noise should not turn a monotonic response into overshoot.
        overshoot_pct = float(max(0.0, raw_overshoot))
        if overshoot_pct > 1.0e-9:
            peak_time = float(t[peak_index])

    # Settling times -------------------------------------------------------
    settling_time_2pct = _settling_time(t, y, steady_state_value, 0.02)
    settling_time_5pct = _settling_time(t, y, steady_state_value, 0.05)

    return {
        "rise_time_10_90": rise_time_10_90,
        "rise_time_0_100": rise_time_0_100,
        "peak_time": peak_time,
        "peak_value": peak_value,
        "overshoot_pct": overshoot_pct,
        "settling_time_2pct": settling_time_2pct,
        "settling_time_5pct": settling_time_5pct,
        "steady_state_value": steady_state_value,
    }


def _empty_metrics(steady_state_value: float) -> dict[str, float | None]:
    return {
        "rise_time_10_90": None,
        "rise_time_0_100": None,
        "peak_time": None,
        "peak_value": None,
        "overshoot_pct": None,
        "settling_time_2pct": None,
        "settling_time_5pct": None,
        "steady_state_value": steady_state_value,
    }


# ---------------------------------------------------------------------------
# Analytical underdamped approximations (docs/03 section 3.5)
# ---------------------------------------------------------------------------


def compute_analytical_metrics(
    zeta: float,
    omega_n: float,
) -> dict[str, float] | None:
    """Return the underdamped approximations for ``0 < zeta < 1``.

    ``None`` is returned for every other damping regime because the formulas
    are only valid in the underdamped case.
    """

    if not (0.0 < zeta < 1.0):
        return None

    omega_d = omega_n * math.sqrt(1.0 - zeta * zeta)
    if omega_d <= 0.0:  # pragma: no cover - guarded by the range above
        return None

    return {
        "peak_time": math.pi / omega_d,
        "overshoot_pct": math.exp(-math.pi * zeta / math.sqrt(1.0 - zeta * zeta))
        * 100.0,
        "settling_time_2pct": 4.0 / (zeta * omega_n),
        "settling_time_5pct": 3.0 / (zeta * omega_n),
    }


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------


def _build_diagnostics(
    *,
    t: np.ndarray,
    y: np.ndarray,
    classification: str,
    input_type: str,
    clipped: bool,
) -> list[str]:
    diagnostics: list[str] = []

    if classification == "unstable":
        diagnostics.append("系统不稳定，响应将发散；性能指标不适用")
    if clipped:
        diagnostics.append("响应幅值超出可显示范围，已截断处理")

    if classification != "unstable" and input_type == "step" and y.size:
        settling_time_5pct = _settling_time(t, y, 1.0, 0.05)
        if settling_time_5pct is None:
            diagnostics.append("当前时间范围可能不足以观察到稳态，建议增大 t_end")

    # docs/03 section 3.6: numerical peak equal to the last sample means the
    # peak is very likely truncated by the selected time window.
    if classification in {"undamped", "underdamped"} and y.size and int(np.argmax(y)) == y.size - 1:
        diagnostics.append("峰值可能被截断，请增大时间范围")

    return diagnostics


# ---------------------------------------------------------------------------
# Public simulation entry point
# ---------------------------------------------------------------------------


def simulate_second_order(
    *,
    zeta: float = DEFAULT_ZETA,
    omega_n: float = DEFAULT_OMEGA_N,
    input_type: str = "step",
    y0: float = DEFAULT_Y0,
    v0: float = DEFAULT_V0,
    t_end: float = DEFAULT_T_END,
    n_points: int = DEFAULT_N_POINTS,
    include_metrics: bool = True,
) -> dict[str, Any]:
    """Run one second-order simulation and return an API-ready dictionary."""

    validate_parameters(
        zeta=zeta,
        omega_n=omega_n,
        y0=y0,
        v0=v0,
        t_end=t_end,
        n_points=n_points,
        input_type=input_type,
    )

    t = np.linspace(0.0, float(t_end), int(n_points), dtype=float)

    if input_type == "step":
        u = np.ones_like(t, dtype=float)
        y = _simulate_step(t, zeta, omega_n)
    elif input_type == "impulse":
        u = np.zeros_like(t, dtype=float)
        y = _simulate_impulse(t, zeta, omega_n)
    else:
        u = np.zeros_like(t, dtype=float)
        y = _simulate_initial(t, zeta, omega_n, y0, v0)

    y, clipped = _sanitise_response(y)
    classification = classify_damping(zeta)
    poles = calculate_poles(zeta, omega_n)

    metrics: dict[str, float | None] | None = None
    analytical_metrics: dict[str, float] | None = None
    if include_metrics and input_type == "step" and classification != "unstable":
        # The standard second-order transfer function has unity DC gain, so the
        # step steady state is 1.0.  Using the theoretical value keeps the
        # metrics meaningful for the undamped case (where y[-1] oscillates).
        metrics = compute_step_metrics(t, y, 1.0)
        analytical_metrics = compute_analytical_metrics(zeta, omega_n)

    diagnostics = _build_diagnostics(
        t=t,
        y=y,
        classification=classification,
        input_type=input_type,
        clipped=clipped,
    )

    return {
        "classification": classification,
        "poles": poles,
        "t": t.tolist(),
        "y": y.tolist(),
        "u": u.tolist(),
        "metrics": metrics,
        "analytical_metrics": analytical_metrics,
        "diagnostics": diagnostics,
    }


__all__ = [
    "PRESETS",
    "SecondOrderValidationError",
    "calculate_poles",
    "classify_damping",
    "compute_analytical_metrics",
    "compute_step_metrics",
    "simulate_second_order",
    "validate_parameters",
]
