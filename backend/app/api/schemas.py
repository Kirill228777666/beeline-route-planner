from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.domain.config import parse_minutes
from app.domain.models import RequestStatus, Transport
from app.domain.norms import normalize_work_type


def _validate_skills(values: list[str], single: bool = False) -> list[str]:
    normalized = ["LOCAL" if str(value).upper() == "REPAIR" else str(value).upper() for value in values]
    unsupported = sorted(set(normalized) - {"LOCAL", "CONNECTION", "EMERGENCY"})
    if unsupported:
        raise ValueError(f"unsupported skill(s): {', '.join(unsupported)}")
    normalized = list(dict.fromkeys(normalized))
    if single and len(normalized) > 1:
        raise ValueError("a request must have exactly one required skill")
    return normalized


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
    section_id: str = ""
    region_id: str = ""
    district: str = ""

    @field_validator("work_type")
    @classmethod
    def supported_work_type(cls, value: str) -> str:
        try:
            return normalize_work_type(value).value
        except (KeyError, ValueError) as error:
            raise ValueError(f"unsupported work type: {value}") from error

    @field_validator("required_transport")
    @classmethod
    def supported_required_transport(cls, value: str | None) -> str | None:
        if value is not None and value.upper() not in Transport.__members__:
            raise ValueError(f"unsupported required transport: {value}")
        return value.upper() if value else value

    @field_validator("required_skills")
    @classmethod
    def supported_required_skills(cls, values: list[str]) -> list[str]:
        return _validate_skills(values, single=True)

    @field_validator("window_start", "window_end", "release_time")
    @classmethod
    def valid_request_times(cls, value):
        if value is not None:
            parse_minutes(value)
        return value


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
    section_id: str = ""
    region_id: str = ""
    district: str = ""
    available: bool = True
    available_from: str | int | None = None
    current_lat: float | None = None
    current_lon: float | None = None

    @field_validator("transport")
    @classmethod
    def supported_team_transport(cls, value: str) -> str:
        if value.upper() not in Transport.__members__:
            raise ValueError(f"unsupported transport: {value}")
        return value.upper()

    @field_validator("skills")
    @classmethod
    def supported_team_skills(cls, values: list[str]) -> list[str]:
        return _validate_skills(values)

    @field_validator("shift_start", "shift_end", "available_from")
    @classmethod
    def valid_team_times(cls, value):
        if value is not None:
            parse_minutes(value)
        return value


class OptimizeInput(BaseModel):
    requests: list[RequestInput]
    teams: list[TeamInput]
    solver: str = "baseline"
    solver_config: dict[str, Any] | None = None


class PlanEventInput(BaseModel):
    event_type: Literal["STATUS_CHANGED", "NEW_EMERGENCY", "TEAM_UNAVAILABLE"]
    event_time: str | int
    request_id: int | None = None
    status: RequestStatus | None = None
    request: RequestInput | None = None
    team_id: int | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def event_fields_match_type(self):
        if self.event_type == "STATUS_CHANGED":
            if self.request_id is None or self.status is None or self.request is not None or self.team_id is not None:
                raise ValueError("STATUS_CHANGED requires request_id and status only")
        elif self.event_type == "NEW_EMERGENCY":
            if self.request is None or self.request_id is not None or self.status is not None or self.team_id is not None:
                raise ValueError("NEW_EMERGENCY requires request only")
        elif self.team_id is None or self.request is not None or self.request_id is not None or self.status is not None:
            raise ValueError("TEAM_UNAVAILABLE requires team_id only")
        return self


class ReplanInput(BaseModel):
    current_time: str | int | None = None
    event_id: int | None = None
