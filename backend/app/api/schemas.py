from typing import Any

from pydantic import BaseModel, Field


class RequestInput(BaseModel):
    id: int
    address: str = ""
    lat: float
    lon: float
    window_start: str
    window_end: str
    service_duration: int = Field(gt=0)
    release_time: str | int | None = None
    work_type: str = "REPAIR"
    required_skills: list[str] = []
    required_transport: str | None = None
    required_equipment: list[str] = []
    region_id: str = ""


class TeamInput(BaseModel):
    id: int
    name: str
    start_lat: float
    start_lon: float
    shift_start: str
    shift_end: str
    skills: list[str]
    transport: str = "CAR"
    equipment: list[str] = []
    region_id: str = ""


class OptimizeInput(BaseModel):
    requests: list[RequestInput]
    teams: list[TeamInput]
    solver: str = "baseline"
    solver_config: dict[str, Any] | None = None


class PlanEventInput(BaseModel):
    event_type: str
    event_time: str | int
    request_id: int | None = None
    status: str | None = None
    request: RequestInput | None = None


class ReplanInput(BaseModel):
    current_time: str | int | None = None
    event_id: int | None = None
