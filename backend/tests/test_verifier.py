from app.constraints.verifier import verify_solution
from app.constraints.schedule import calculate_schedule
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


def _valid_single_request_case():
    request = Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.75, 37.61,
                      540, 540, 720, 30, Skill.REPAIR)
    team = Team(1, "T", 55.75, 37.60, 540, 720, Skill.REPAIR, Transport.CAR)
    problem = ProblemData((request,), (team,))
    travel = HaversineTravelMatrix()
    schedule = calculate_schedule(team, [request], travel)
    return problem, travel, schedule


def test_verifier_rejects_assigned_request_with_empty_schedule():
    problem, travel, _ = _valid_single_request_case()
    result = verify_solution(problem, Solution([Route(1, [1], [], 0.0, 0)], []), travel)

    assert not result.valid
    assert any("schedule" in error.lower() for error in result.errors)


def test_verifier_rejects_assigned_request_with_incorrect_route_metrics():
    problem, travel, schedule = _valid_single_request_case()
    route = Route(1, [1], list(schedule.stops), 0.0, schedule.total_travel_time + 1)
    result = verify_solution(problem, Solution([route], []), travel)

    assert not result.valid
    assert any("metrics mismatch" in error.lower() for error in result.errors)


def test_verifier_rejects_assigned_request_missing_from_schedule():
    request = Request(2, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "B", 55.76, 37.62,
                      540, 540, 720, 30, Skill.REPAIR)
    first_problem, travel, _ = _valid_single_request_case()
    first = first_problem.requests[0]
    team = first_problem.teams[0]
    problem = ProblemData((first, request), (team,))
    partial = calculate_schedule(team, [first], travel)
    route = Route(1, [1, 2], list(partial.stops), partial.total_distance, partial.total_travel_time)

    result = verify_solution(problem, Solution([route], []), travel)

    assert not result.valid
    assert any("schedule" in error.lower() for error in result.errors)


def test_verifier_accepts_complete_route_with_recomputed_schedule_and_metrics():
    problem, travel, schedule = _valid_single_request_case()
    route = Route(1, [1], list(schedule.stops), schedule.total_distance, schedule.total_travel_time)

    result = verify_solution(problem, Solution([route], []), travel)

    assert result.valid
    assert result.errors == ()
