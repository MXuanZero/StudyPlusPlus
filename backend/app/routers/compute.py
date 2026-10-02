"""Compute endpoints: second-order simulation, comparison and presets.

All mathematical work happens in
``backend/app/services/second_order.py``; this router only translates between
HTTP/Pydantic and the service layer.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas.compute import (
    CompareRequest,
    CompareResponse,
    CompareRun,
    PresetListResponse,
    SimulationRequest,
    SimulationResponse,
)
from ..services.second_order import (
    PRESETS,
    SecondOrderValidationError,
    simulate_second_order,
)

router = APIRouter(prefix="/compute/second-order", tags=["compute"])

MAX_COMPARE_RUNS = 4


def _request_error(code: str, message: str) -> HTTPException:
    """Build the unified error body described in docs/02 section 5."""

    return HTTPException(status_code=422, detail={"code": code, "message": message})


def _simulate_payload(payload: SimulationRequest) -> dict:
    try:
        return simulate_second_order(**payload.model_dump())
    except SecondOrderValidationError as exc:
        raise _request_error(exc.code, exc.message) from exc


@router.post("/simulate", response_model=SimulationResponse)
def simulate(payload: SimulationRequest) -> dict:
    """Simulate one second-order system configuration."""

    return _simulate_payload(payload)


@router.post("/compare", response_model=CompareResponse)
def compare(payload: CompareRequest | list[CompareRun]) -> dict:
    """Simulate and compare 1-4 second-order configurations.

    A top-level JSON array is accepted as a convenience in addition to the
    documented ``{"runs": [...]}`` object form.
    """

    runs: list[CompareRun] = payload if isinstance(payload, list) else payload.runs

    if not 1 <= len(runs) <= MAX_COMPARE_RUNS:
        raise _request_error(
            "INVALID_COMPARE_RUNS",
            f"对比组数必须在 1 到 {MAX_COMPARE_RUNS} 之间",
        )

    results: list[dict] = []
    for index, run in enumerate(runs, start=1):
        try:
            result = simulate_second_order(**run.model_dump(exclude={"label"}))
        except SecondOrderValidationError as exc:
            raise _request_error(
                exc.code,
                f"第 {index} 组参数：{exc.message}",
            ) from exc
        result["label"] = run.label
        results.append(result)

    return {"results": results}


@router.get("/presets", response_model=PresetListResponse)
def presets() -> dict:
    """Return the five standard parameter presets from docs/03 section 4.1.4."""

    return {"presets": PRESETS}
