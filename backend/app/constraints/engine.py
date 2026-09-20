from dataclasses import dataclass
from enum import Enum

from app.domain.models import Request, Team


class RejectReason(str, Enum):
    NONE = "NONE"
    WRONG_REGION = "WRONG_REGION"
    NO_SKILL = "NO_SKILL"
    NO_TRANSPORT = "NO_TRANSPORT"
    NO_EQUIPMENT = "NO_EQUIPMENT"
    TEAM_UNAVAILABLE = "TEAM_UNAVAILABLE"
    NO_TIME_FEASIBLE_ROUTE = "NO_TIME_FEASIBLE_ROUTE"


@dataclass(frozen=True)
class Compatibility:
    allowed: bool
    reason: RejectReason
    message: str


class ConstraintEngine:
    def team_compatible(self, team: Team, request: Request) -> Compatibility:
        if not team.available:
            return Compatibility(False, RejectReason.TEAM_UNAVAILABLE, "team is unavailable")
        if team.region_id != request.region_id:
            return Compatibility(False, RejectReason.WRONG_REGION, "request and team belong to different regions")
        if (team.skills & request.required_skills) != request.required_skills:
            return Compatibility(False, RejectReason.NO_SKILL, "required skill is missing")
        if request.required_transport and team.transport != request.required_transport:
            return Compatibility(False, RejectReason.NO_TRANSPORT, "required transport is missing")
        if not set(request.required_equipment).issubset(team.equipment):
            return Compatibility(False, RejectReason.NO_EQUIPMENT, "required equipment is missing")
        return Compatibility(True, RejectReason.NONE, "team is compatible")
