from dataclasses import replace

from app.domain.models import ProblemData, Request, RequestStatus, Skill, Team, Transport, WorkType
from app.services.replanning import ReplanningEvent, ReplanningEventType, ReplanningService
from app.solver.regret3 import Regret3Solver
from app.geo.travel import HaversineTravelMatrix
from app.solver.common import materialize_solution


def make_problem():
    requests = (
        Request(1, "", "", WorkType.REPAIR, RequestStatus.COMPLETED, 1, "", "A", 55.750, 37.610, 540, 540, 900, 30, Skill.REPAIR),
        Request(2, "", "", WorkType.REPAIR, RequestStatus.ASSIGNED, 1, "", "B", 55.751, 37.611, 540, 540, 900, 30, Skill.REPAIR),
        Request(3, "", "", WorkType.REPAIR, RequestStatus.ASSIGNED, 1, "", "C", 55.752, 37.612, 540, 540, 900, 30, Skill.REPAIR),
    )
    teams = (
        Team(1, "T1", 55.750, 37.600, 540, 1000, Skill.REPAIR, Transport.CAR),
        Team(2, "T2", 55.750, 37.600, 540, 1000, Skill.REPAIR, Transport.CAR),
    )
    return ProblemData(requests, teams)


def test_replanning_locks_completed_and_passes_future_warm_start():
    problem = make_problem()
    old_plan = materialize_solution({1: [1, 2], 2: [3]}, problem, HaversineTravelMatrix())
    captured = {}

    def optimizer(planning_problem, travel, warm_start):
        captured["problem"] = planning_problem
        captured["warm_start"] = warm_start
        return Regret3Solver().solve(planning_problem, travel)

    result = ReplanningService(optimizer=optimizer).replan(
        problem, old_plan, 650, ReplanningEvent(ReplanningEventType.STATUS_CHANGED, request_id=1, status=RequestStatus.COMPLETED)
    )
    assert result.verification.valid
    assert 1 not in [request_id for request in captured["problem"].requests for request_id in [request.id]]
    assert all(1 not in route["request_ids"] for route in captured["warm_start"])
    assert result.plan.unassigned == []
    assert 1 not in result.diff.reassigned_request_ids


def test_replanning_cancels_request_and_adds_official_emergency_duration():
    problem = make_problem()
    old_plan = Regret3Solver().solve(problem, HaversineTravelMatrix())
    captured = {}

    def optimizer(planning_problem, travel, warm_start):
        captured["problem"] = planning_problem
        return Regret3Solver().solve(planning_problem, travel)

    emergency = Request(4, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "D", 55.753, 37.613,
                        650, 650, 900, 10, Skill.REPAIR)
    result = ReplanningService(optimizer=optimizer).replan(
        problem, old_plan, 650,
        ReplanningEvent(ReplanningEventType.NEW_EMERGENCY, request=emergency),
    )
    assert result.verification.valid
    added = next(request for request in captured["problem"].requests if request.id == 4)
    assert added.work_type == WorkType.EMERGENCY
    assert added.priority == 3
    assert added.service_duration == 80
    assert added.release_time == 650
    assert added.window_start >= 650
    assert 4 in result.diff.new_request_ids

    cancelled = ReplanningService(optimizer=optimizer).replan(
        problem, old_plan, 650,
        ReplanningEvent(ReplanningEventType.STATUS_CHANGED, request_id=2, status=RequestStatus.CANCELLED),
    )
    assert cancelled.verification.valid
    assert 2 in cancelled.diff.cancelled_request_ids
    assert all(2 not in route.request_ids for route in cancelled.plan.routes)


def test_replanning_preserves_region_and_rejects_cross_region_emergency():
    problem = make_problem()
    regional_problem = ProblemData(
        tuple(replace(request, region_id="zone_1") for request in problem.requests),
        tuple(replace(team, region_id="zone_1") for team in problem.teams),
    )
    old_plan = Regret3Solver().solve(regional_problem, HaversineTravelMatrix())
    captured = {}

    def optimizer(planning_problem, travel, warm_start):
        captured["problem"] = planning_problem
        return Regret3Solver().solve(planning_problem, travel)

    emergency = Request(4, "", "", WorkType.EMERGENCY, RequestStatus.NEW, 3, "", "D", 55.753, 37.613,
                        650, 650, 900, 80, Skill.EMERGENCY, region_id="zone_2")
    result = ReplanningService(optimizer=optimizer).replan(
        regional_problem, old_plan, 650,
        ReplanningEvent(ReplanningEventType.NEW_EMERGENCY, request=emergency),
    )
    assert result.verification.valid
    assert next(request for request in captured["problem"].requests if request.id == 4).region_id == "zone_2"
    assert all(team.region_id == "zone_1" for team in captured["problem"].teams)
    assert 4 in result.plan.unassigned


def test_in_progress_work_stays_first_before_new_emergency():
    active = Request(1, "", "", WorkType.REPAIR, RequestStatus.IN_PROGRESS, 1, "", "A", 55.750, 37.610,
                     600, 600, 900, 70, Skill.REPAIR)
    problem = ProblemData(
        (active,),
        (Team(1, "T1", 55.750, 37.600, 600, 1000, Skill.REPAIR, Transport.CAR),),
    )
    old_plan = materialize_solution({1: [1]}, problem, HaversineTravelMatrix())
    emergency = Request(2, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "B", 55.751, 37.611,
                        650, 650, 900, 10, Skill.REPAIR)

    result = ReplanningService(optimizer=lambda planning, travel, warm: Regret3Solver().solve(planning, travel)).replan(
        problem, old_plan, 650, ReplanningEvent(ReplanningEventType.NEW_EMERGENCY, request=emergency))

    route = next(route for route in result.plan.routes if route.team_id == 1)
    stops = {stop.request_id: stop for stop in route.schedule}
    assert result.verification.valid
    assert route.request_ids == [1, 2]
    assert stops[2].start >= 650
    assert stops[2].start >= stops[1].finish
