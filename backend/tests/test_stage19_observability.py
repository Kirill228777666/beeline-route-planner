from fastapi.testclient import TestClient

from app.main import create_app
from app.solver.config import SolverConfig
from app.api.routes import _request_from_input, _team_from_input
from app.api.schemas import RequestInput, TeamInput
from app.domain.models import ProblemData
from app.geo.travel import HaversineTravelMatrix
from app.solver.modes import solve_by_mode


def small_problem() -> ProblemData:
    request = _request_from_input(RequestInput(
        id=1, address="A", lat=55.75, lon=37.61, window_start="09:00", window_end="18:00",
        service_duration=30, required_skills=["REPAIR"],
    ))
    team = _team_from_input(TeamInput(
        id=1, name="T1", start_lat=55.75, start_lon=37.60, shift_start="09:00", shift_end="18:00",
        skills=["REPAIR"], transport="CAR",
    ))
    return ProblemData((request,), (team,))


def test_cpp_result_contains_phase_timings_and_profile_counters():
    solution = solve_by_mode("cpp", small_problem(), HaversineTravelMatrix(), SolverConfig(
        time_limit_ms=100, seed=19, use_vnd=False, use_alns=False, use_ejection=False,
        use_beam=False, use_route_pool=False, use_team_minimization=False,
        multi_start=1, use_route_elimination=False,
    ))
    assert solution.valid is True
    assert solution.solver_stats["engine"] == "cpp"
    assert solution.solver_stats["seed"] == 19
    assert "phase_timings_ms" in solution.solver_stats
    assert "python_verifier" in solution.solver_stats["phase_timings_ms"]
    assert "schedule_route_calls" in solution.solver_stats["profile_counters"]


def test_optimize_exposes_api_and_persistence_timings():
    problem = small_problem()
    payload = {
        "solver": "cpp", "solver_config": {"time_limit_ms": 100, "seed": 19, "use_vnd": False,
        "use_alns": False, "use_ejection": False, "use_beam": False, "use_route_pool": False,
        "use_team_minimization": False, "multi_start": 1, "use_route_elimination": False},
        "requests": [{"id": 1, "address": "A", "lat": problem.requests[0].lat, "lon": problem.requests[0].lon,
                      "window_start": "09:00", "window_end": "18:00", "service_duration": 30,
                      "required_skills": ["REPAIR"]}],
        "teams": [{"id": 1, "name": "T1", "start_lat": problem.teams[0].start_lat,
                   "start_lon": problem.teams[0].start_lon, "shift_start": "09:00", "shift_end": "18:00",
                   "skills": ["REPAIR"], "transport": "CAR"}],
    }
    with TestClient(create_app()) as client:
        response = client.post("/api/optimize", json=payload)
        assert response.status_code == 200, response.text
        body = response.json()
    metrics = body["metrics"]
    assert body["verified"] is True
    assert metrics["cpp_execution_ms"] >= 0
    assert metrics["python_cpp_conversion_ms"] >= 0
    assert metrics["verifier_ms"] >= 0
    assert metrics["api_latency_ms"] >= metrics["runtime_ms"]
    assert metrics["phase_timings_ms"]["db_persistence"] >= 0
    assert metrics["phase_timings_ms"]["api_latency"] == metrics["api_latency_ms"]
