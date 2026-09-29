import os
import sys
import json
from pathlib import Path

if os.name == "nt":
    os.add_dll_directory(r"C:\msys64\ucrt64\bin")
sys.path.insert(0, str(Path(__file__).parents[1]))
sys.path.insert(0, str(Path(__file__).parents[3]))
sys.path.insert(0, str(Path(__file__).parents[2] / "backend"))

import cpp_solver
from app.constraints.verifier import verify_solution
from app.domain.models import ProblemData, Route, Solution, Stop
from app.geo.travel import HaversineTravelMatrix
from app.solver.regret3 import Regret3Solver
from app.api.routes import _request_from_input, _team_from_input
from app.api.schemas import RequestInput, TeamInput


def _southcenter_problem():
    dataset = Path(__file__).parents[2] / "frontend" / "public" / "datasets" / "zone_3.json"
    payload = json.loads(dataset.read_text(encoding="utf-8"))
    return ProblemData(
        tuple(_request_from_input(RequestInput(**item)) for item in payload["requests"]),
        tuple(_team_from_input(TeamInput(**item)) for item in payload["teams"]),
    )


def _cpp_solution(result):
    routes = [Route(item["team_id"], list(item["request_ids"]), [], item["distance_km"], item["travel_time_minutes"])
              for item in result["routes"]]
    return Solution(routes, list(result["unassigned"]), None, False)


def test_source_skill_aliases_allow_python_and_cpp_to_assign_all_southcenter_requests():
    problem = _southcenter_problem()
    python_solution = Regret3Solver().solve(problem, HaversineTravelMatrix())
    requests = [{"id": r.id, "lat": r.lat, "lon": r.lon, "window_start": r.window_start, "window_end": r.window_end,
                 "service_duration": r.service_duration, "required_skills": int(r.required_skills), "work_type": r.work_type.value,
                 "region_id": r.region_id}
                for r in problem.requests]
    teams = [{"id": t.id, "start_lat": t.start_lat, "start_lon": t.start_lon, "shift_start": t.shift_start,
              "shift_end": t.shift_end, "skills": int(t.skills), "transport": t.transport.value, "available": t.available,
              "region_id": t.region_id}
             for t in problem.teams]
    cpp_result = cpp_solver.solve(requests, teams, 60_000, True)
    assert len(problem.requests) == 56
    assert len(problem.requests) - len(python_solution.unassigned) == 56
    assert len(problem.requests) - len(cpp_result["unassigned"]) == 56
    assert cpp_result["best_valid_solution"] is True


def test_southcenter_route_elimination_preserves_full_assignment_and_not_more_teams():
    problem = _southcenter_problem()
    requests = [{"id": r.id, "lat": r.lat, "lon": r.lon, "window_start": r.window_start, "window_end": r.window_end,
                 "service_duration": r.service_duration, "required_skills": int(r.required_skills), "work_type": r.work_type.value,
                 "region_id": r.region_id}
                for r in problem.requests]
    teams = [{"id": t.id, "start_lat": t.start_lat, "start_lon": t.start_lon, "shift_start": t.shift_start,
              "shift_end": t.shift_end, "skills": int(t.skills), "transport": t.transport.value, "available": t.available,
              "region_id": t.region_id}
             for t in problem.teams]
    without_elimination = cpp_solver.solve(requests, teams, 60_000, True, False)
    with_elimination = cpp_solver.solve(requests, teams, 60_000, True, True)
    assert len(problem.requests) - len(with_elimination["unassigned"]) == 56
    assert with_elimination["best_valid_solution"] is True
    assert with_elimination["objective"]["used_teams"] <= without_elimination["objective"]["used_teams"]


def test_southcenter_alns_preserves_full_assignment_and_verified_shape():
    problem = _southcenter_problem()
    requests = [{"id": r.id, "lat": r.lat, "lon": r.lon, "window_start": r.window_start, "window_end": r.window_end,
                 "service_duration": r.service_duration, "required_skills": int(r.required_skills), "work_type": r.work_type.value,
                 "region_id": r.region_id}
                for r in problem.requests]
    teams = [{"id": t.id, "start_lat": t.start_lat, "start_lon": t.start_lon, "shift_start": t.shift_start,
              "shift_end": t.shift_end, "skills": int(t.skills), "transport": t.transport.value, "available": t.available,
              "region_id": t.region_id}
             for t in problem.teams]
    result = cpp_solver.solve(requests, teams, 1000, True, True, True)
    assert len(problem.requests) - len(result["unassigned"]) == 56
    assert result["best_valid_solution"] is True
    assert result["cpp_execution_ms"] <= 1100
    assert result["objective"]["used_teams"] >= 1


def test_southcenter_alns_ejection_beam_multistart_preserves_full_assignment():
    problem = _southcenter_problem()
    requests = [{"id": r.id, "lat": r.lat, "lon": r.lon, "window_start": r.window_start, "window_end": r.window_end,
                 "service_duration": r.service_duration, "required_skills": int(r.required_skills), "work_type": r.work_type.value,
                 "region_id": r.region_id}
                for r in problem.requests]
    teams = [{"id": t.id, "start_lat": t.start_lat, "start_lon": t.start_lon, "shift_start": t.shift_start,
              "shift_end": t.shift_end, "skills": int(t.skills), "transport": t.transport.value, "available": t.available,
              "region_id": t.region_id}
             for t in problem.teams]
    result = cpp_solver.solve(requests, teams, 1000, True, True, True, True, True, 2)
    assert len(problem.requests) - len(result["unassigned"]) == 56
    assert result["best_valid_solution"] is True


def test_southcenter_route_pool_recombination_preserves_full_assignment():
    problem = _southcenter_problem()
    requests = [{"id": r.id, "lat": r.lat, "lon": r.lon, "window_start": r.window_start, "window_end": r.window_end,
                 "service_duration": r.service_duration, "required_skills": int(r.required_skills), "work_type": r.work_type.value,
                 "region_id": r.region_id}
                for r in problem.requests]
    teams = [{"id": t.id, "start_lat": t.start_lat, "start_lon": t.start_lon, "shift_start": t.shift_start,
              "shift_end": t.shift_end, "skills": int(t.skills), "transport": t.transport.value, "available": t.available,
              "region_id": t.region_id}
             for t in problem.teams]
    result = cpp_solver.solve(requests, teams, 1500, True, True, True, True, True, 2, True)
    assert len(problem.requests) - len(result["unassigned"]) == 56
    assert result["best_valid_solution"] is True
