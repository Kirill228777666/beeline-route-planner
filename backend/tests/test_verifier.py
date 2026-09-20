from app.constraints.verifier import verify_solution
from app.domain.models import *
from app.geo.travel import HaversineTravelMatrix


def test_verifier_rejects_duplicate_request_ids():
    request = Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.75, 37.61,
                      540, 540, 720, 30, Skill.REPAIR)
    team = Team(1, "T", 55.75, 37.61, 540, 720, Skill.REPAIR, Transport.CAR)
    route = Route(1, [1, 1])
    result = verify_solution(ProblemData((request,), (team,)), Solution([route], []), HaversineTravelMatrix())
    assert not result.valid
    assert any("duplicate" in error.lower() for error in result.errors)


def test_verifier_rejects_cross_region_assignment():
    request = Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.75, 37.61,
                      540, 540, 720, 30, Skill.REPAIR, region_id="zone_1")
    team = Team(1, "T", 55.75, 37.61, 540, 720, Skill.REPAIR, Transport.CAR, region_id="zone_2")
    result = verify_solution(ProblemData((request,), (team,)), Solution([Route(1, [1])], []), HaversineTravelMatrix())
    assert not result.valid
    assert "incompatible" in " ".join(result.errors)
