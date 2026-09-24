import pytest

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


def test_same_section_allows_different_districts_but_other_section_does_not():
    job = Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "district_a", "A", 55.75, 37.61,
                  540, 600, 720, 30, Skill.REPAIR, region_id="section_1")
    same_section = team(skills=Skill.REPAIR, region_id="section_1", district="district_b")
    other_section = team(skills=Skill.REPAIR, region_id="section_2", district="district_a")

    assert job.section_id == "section_1"
    assert same_section.section_id == "section_1"
    assert ConstraintEngine().team_compatible(same_section, job).allowed
    rejected = ConstraintEngine().team_compatible(other_section, job)
    assert not rejected.allowed
    assert rejected.message == "request and team belong to different sections"


@pytest.mark.parametrize("transport", list(Transport))
def test_each_supported_transport_is_a_hard_exact_match(transport):
    job = Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.75, 37.61,
                  540, 600, 720, 30, Skill.REPAIR, required_transport=transport)
    assert ConstraintEngine().team_compatible(team(transport=transport), job).allowed
    other = next(item for item in Transport if item != transport)
    assert ConstraintEngine().team_compatible(team(transport=other), job).reason == RejectReason.NO_TRANSPORT


def test_equipment_is_a_hard_requirement():
    router_job = Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.75, 37.61,
                         540, 600, 720, 30, Skill.REPAIR, required_equipment=("router",))
    fiber_job = Request(2, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "B", 55.75, 37.61,
                        540, 600, 720, 30, Skill.REPAIR, required_equipment=("fiber_tool",))
    equipped_team = team(equipment=("router",))
    assert ConstraintEngine().team_compatible(equipped_team, router_job).allowed
    assert ConstraintEngine().team_compatible(equipped_team, fiber_job).reason == RejectReason.NO_EQUIPMENT
