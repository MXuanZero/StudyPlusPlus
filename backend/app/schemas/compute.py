"""Pydantic request/response models for the second-order compute API.

The response shape follows ``docs/02_技术方案与架构.md`` section 5.2; the
simulation semantics follow ``docs/03_二阶系统分析模块详细设计.md`` section 3.
"""

from __future__ import annotations

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class SimulationRequest(BaseModel):
    """Parameters for a single second-order simulation."""

    model_config = ConfigDict(extra="forbid")

    zeta: float = Field(default=0.5, description="阻尼比，范围 [-0.5, 3.0]")
    omega_n: float = Field(default=2.0, description="自然频率，范围 (0, 10]")
    input_type: str = Field(
        default="step",
        description="输入类型：step、impulse 或 initial",
    )
    y0: float = Field(default=1.0, description="初始位移，范围 [-2, 2]")
    v0: float = Field(default=0.0, description="初始速度，范围 [-2, 2]")
    t_end: float = Field(default=20.0, description="仿真时长，范围 (0, 60]")
    n_points: int = Field(default=1001, description="采样点数，范围 [200, 5000]")
    include_metrics: bool = Field(
        default=True,
        description="是否计算阶跃响应的数值指标",
    )


class CompareRun(SimulationRequest):
    """One parameter set in a comparison request."""

    label: str | None = Field(default=None, description="曲线图例标签")


class CompareRequest(BaseModel):
    """Request body for comparing 1-4 second-order parameter sets.

    ``runs`` is the primary field name.  For frontend flexibility the aliases
    ``cases``, ``simulations`` and ``configs`` are accepted as well.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    runs: list[CompareRun] = Field(
        default_factory=list,
        validation_alias=AliasChoices("runs", "cases", "simulations", "configs"),
        description="1-4 组仿真参数",
    )


class PoleOut(BaseModel):
    """A complex pole represented by real and imaginary parts."""

    real: float
    imag: float


class MetricsOut(BaseModel):
    """Numerical step-response metrics (null when not applicable)."""

    rise_time_10_90: float | None = None
    rise_time_0_100: float | None = None
    peak_time: float | None = None
    peak_value: float | None = None
    overshoot_pct: float | None = None
    settling_time_2pct: float | None = None
    settling_time_5pct: float | None = None
    steady_state_value: float | None = None


class AnalyticalMetricsOut(BaseModel):
    """Underdamped analytical approximations from docs/03 section 3.5."""

    peak_time: float
    overshoot_pct: float
    settling_time_2pct: float
    settling_time_5pct: float


class SimulationResponse(BaseModel):
    """Single simulation response (docs/02 section 5.2)."""

    classification: str
    poles: list[PoleOut]
    t: list[float]
    y: list[float]
    u: list[float]
    metrics: MetricsOut | None = None
    analytical_metrics: AnalyticalMetricsOut | None = None
    diagnostics: list[str] = Field(default_factory=list)


class CompareResult(SimulationResponse):
    """One simulation inside a comparison response."""

    label: str | None = None


class CompareResponse(BaseModel):
    """Response body for the comparison endpoint."""

    results: list[CompareResult]


class PresetOut(BaseModel):
    """A named parameter preset returned by the presets endpoint."""

    key: str
    name: str
    zeta: float
    omega_n: float
    description: str


class PresetListResponse(BaseModel):
    """Response body for the presets endpoint."""

    presets: list[PresetOut]
