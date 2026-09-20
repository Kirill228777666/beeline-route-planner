from app.constraints.engine import ConstraintEngine, RejectReason
from app.domain.models import Request, RequestStatus, Skill, Team, Transport, WorkType


def request():
    return Request(1, "", "", WorkType.EMERGENCY, RequestStatus.NEW, 3, "", "A", 55.75, 37.61,
                   540, 600, 720, 60, Skill.EMERGENCY, Transport.CAR)


def team(**kwargs):
    values = dict(id=1, name="T", start_lat=55.75, start_lon=37.61, shift_start=540,
                  shift_end=1200, skills=Skill.REPAIR, transport=Transport.CAR,
                  available=True, available_from=540)
    values.update(kwargs)
    return Team(**values)


def test_missing_skill_is_hard_ineligibility():
    result = ConstraintEngine().team_compatible(team(), request())
    assert not result.allowed
    assert result.reason == RejectReason.NO_SKILL


def test_transport_is_hard_ineligibility():
    result = ConstraintEngine().team_compatible(team(skills=Skill.EMERGENCY, transport=Transport.WALK), request())
    assert not result.allowed
    assert result.reason == RejectReason.NO_TRANSPORT


def test_region_is_a_hard_constraint_and_blank_is_not_a_wildcard():
    compatible = ConstraintEngine().team_compatible(
        team(skills=Skill.EMERGENCY, region_id="zone_1"),
        Request(1, "", "", WorkType.EMERGENCY, RequestStatus.NEW, 3, "", "A", 55.75, 37.61,
                540, 600, 720, 60, Skill.EMERGENCY, Transport.CAR, region_id="zone_2"),
    )
    assert not compatible.allowed
    assert compatible.reason == RejectReason.WRONG_REGION

    assert ConstraintEngine().team_compatible(team(skills=Skill.EMERGENCY), request()).allowed
    assert not ConstraintEngine().team_compatible(
        team(skills=Skill.EMERGENCY, region_id="zone_1"), request()).allowed
