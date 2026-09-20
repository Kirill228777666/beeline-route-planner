import os
import sys
from pathlib import Path
from dataclasses import replace
import random
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "cpp_solver"))
if os.name == "nt":
    _dll = os.add_dll_directory(r"C:\msys64\ucrt64\bin")
import cpp_solver

from app.constraints.verifier import verify_solution
from app.domain.models import Route, Solution
from app.constraints.schedule import calculate_schedule
from app.domain.models import ProblemData, Skill, Transport
from app.geo.travel import HaversineTravelMatrix
from test_stage19_observability import small_problem


def test_relocate_can_merge_two_singleton_routes():
    requests = [dict(id=i, lat=0., lon=0., window_start=0, window_end=100,
                     service_duration=10, required_skills=0) for i in (1, 2)]
    teams = [dict(id=i, start_lat=0., start_lon=0., shift_start=0, shift_end=100,
                  skills=0, transport="CAR") for i in (1, 2)]
    config = dict(time_limit_ms=100, use_vnd=True, use_alns=False, use_route_elimination=False,
                  use_ejection=False, use_beam=False, multi_start=1)
    result = cpp_solver.solve_config(requests, teams, config,
                                     [dict(team_id=i, request_ids=[i]) for i in (1, 2)])
    assert result["objective"]["used_teams"] == 1
    assert result["unassigned"] == []


def test_verifier_rejects_two_routes_for_one_team():
    p = small_problem()
    p = replace(p, requests=(p.requests[0], replace(p.requests[0], id=2)))
    solution = Solution([Route(1, [1]), Route(1, [2])], [])
    assert not verify_solution(p, solution, HaversineTravelMatrix()).valid


def test_verifier_rejects_forged_schedule_and_metrics():
    p = small_problem()
    schedule = calculate_schedule(p.teams[0], list(p.requests), HaversineTravelMatrix())
    route = Route(1, [1], [replace(schedule.stops[0], finish=0)], schedule.total_distance, schedule.total_travel_time)
    assert not verify_solution(p, Solution([route], []), HaversineTravelMatrix()).valid


def test_cpp_invalid_result_uses_verified_fallback(monkeypatch):
    from app.solver.modes import solve_by_mode
    from app.solver.config import SolverConfig
    monkeypatch.setattr(cpp_solver, "solve_config", lambda *args: dict(routes=[], unassigned=[]))
    p = small_problem()
    result = solve_by_mode("cpp", p, HaversineTravelMatrix(), SolverConfig(time_limit_ms=100))
    assert result.valid
    assert result.solver_stats["engine"] == "python_fallback"


def test_cpp_respects_available_from_without_fallback():
    from app.solver.modes import solve_by_mode
    from app.solver.config import SolverConfig
    p = small_problem()
    p = replace(p, teams=(replace(p.teams[0], available_from=800),))
    result = solve_by_mode("cpp", p, HaversineTravelMatrix(), SolverConfig(time_limit_ms=100, use_alns=False))
    assert result.valid and result.solver_stats["engine"] == "cpp"
    assert result.routes[0].schedule[0].start >= 800


def test_incremental_insertion_matches_independent_full_schedule():
    rng = random.Random(719)
    for trial in range(100):
        base = small_problem()
        team = replace(base.teams[0], start_lat=55.75, start_lon=37.61, shift_start=0,
                       shift_end=rng.randint(100, 220), transport=rng.choice(list(Transport)), skills=Skill(0))
        requests = tuple(replace(base.requests[0], id=i+1, lat=55.75+rng.uniform(-.01,.01),
                                 lon=37.61+rng.uniform(-.01,.01), window_start=rng.randint(0,40),
                                 window_end=rng.randint(70,180), service_duration=rng.randint(5,30),
                                 required_skills=Skill(0)) for i in range(rng.randint(2,6)))
        travel = HaversineTravelMatrix()
        old = list(requests[:-1])
        if not calculate_schedule(team, old, travel).valid:
            continue
        feasible = []
        for pos in range(len(old)+1):
            order = old[:pos]+[requests[-1]]+old[pos:]
            s = calculate_schedule(team, order, travel)
            if s.valid:
                feasible.append((s.total_travel_time, s.total_distance, [r.id for r in order]))
        payload = [dict(id=r.id, lat=r.lat, lon=r.lon, window_start=r.window_start, window_end=r.window_end,
                        service_duration=r.service_duration, required_skills=0) for r in requests]
        teams = [dict(id=1, start_lat=team.start_lat, start_lon=team.start_lon, shift_start=team.shift_start,
                      shift_end=team.shift_end, skills=0, transport=team.transport.value)]
        result = cpp_solver.solve_config(payload, teams, dict(time_limit_ms=1000, use_vnd=False, use_alns=False,
            use_route_elimination=False, multi_start=1), [dict(team_id=1, request_ids=[r.id for r in old])])
        assert (not result["unassigned"]) == bool(feasible)
        if feasible:
            optimum = min(feasible)
            assert result["objective"]["travel_time"] == optimum[0]
            assert result["objective"]["distance"] == pytest.approx(optimum[1])


def test_cpp_ignores_malformed_warm_start_without_losing_requests():
    reqs = [dict(id=i, lat=0., lon=0., window_start=0, window_end=100,
                 service_duration=10, required_skills=0) for i in (1, 2)]
    teams = [dict(id=1, start_lat=0., start_lon=0., shift_start=0, shift_end=100, skills=0, transport="CAR")]
    config = dict(time_limit_ms=100, use_vnd=False, use_alns=False, use_route_elimination=False)
    for warm in ([dict(team_id=1, request_ids=[1,1])],
                 [dict(team_id=1, request_ids=[1]), dict(team_id=1, request_ids=[2])]):
        result = cpp_solver.solve_config(reqs, teams, config, warm)
        assigned = [rid for route in result["routes"] for rid in route["request_ids"]]
        assert sorted(assigned) == [1, 2]
        assert not result["unassigned"]


def test_full_search_random_problems_pass_strict_verifier():
    from app.solver.modes import solve_by_mode
    from app.solver.config import SolverConfig
    rng = random.Random(8173)
    base = small_problem()
    for case in range(60):
        teams = tuple(replace(base.teams[0], id=i+1, shift_start=0, shift_end=rng.randint(100,250),
                              start_lat=55.75, start_lon=37.61,
                              skills=Skill(rng.choice([0, 2, 4, 6])), equipment=("E",) if i%2 else (),
                              transport=rng.choice(list(Transport))) for i in range(rng.randint(1,5)))
        requests = tuple(replace(base.requests[0], id=100+i, required_skills=Skill(rng.choice([0, 2, 4])),
                                 lat=55.75+rng.uniform(-.005,.005), lon=37.61+rng.uniform(-.005,.005),
                                 window_start=rng.randint(0,70), window_end=rng.randint(80,160),
                                 service_duration=rng.randint(5,35),
                                 required_equipment=("E",) if i%7==0 else ()) for i in range(rng.randint(0,12)))
        problem = ProblemData(requests, teams)
        config = SolverConfig(time_limit_ms=30, seed=case, use_route_pool=bool(case%2),
                              use_team_minimization=True, use_exact_neighborhood=True)
        result = solve_by_mode("cpp", problem, HaversineTravelMatrix(), config)
        assert result.solver_stats["engine"] == "cpp"
        assert verify_solution(problem, result, HaversineTravelMatrix()).valid
