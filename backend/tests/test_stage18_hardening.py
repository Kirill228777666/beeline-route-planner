from __future__ import annotations

import json
import random
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.routes import _request_from_input, _team_from_input
from app.api.schemas import RequestInput, TeamInput
from app.constraints.verifier import verify_solution
from app.domain.models import ProblemData, Request, RequestStatus, Skill, Team, Transport, WorkType
from app.geo.travel import HaversineTravelMatrix
from app.main import create_app
from app.db.repositories import PlanRepository
from app.solver.config import ROUTING_SOURCE, SOLVER_VERSION, SolverConfig
from app.solver.modes import solve_by_mode


DATASETS = Path(__file__).resolve().parents[2] / "frontend" / "public" / "datasets"


def fast_config(seed: int = 42) -> SolverConfig:
    return SolverConfig(time_limit_ms=300, seed=seed, use_vnd=False, use_alns=False,
                        use_ejection=False, use_beam=False, use_route_pool=False,
                        use_team_minimization=False, multi_start=1, use_route_elimination=False)


def cpp_solution(problem: ProblemData, config: SolverConfig | None = None):
    solution = solve_by_mode("cpp", problem, HaversineTravelMatrix(), config or fast_config())
    assert solution.valid
    assert verify_solution(problem, solution, HaversineTravelMatrix()).valid
    return solution


def dataset_problem(name: str) -> ProblemData:
    payload = json.loads((DATASETS / f"{name}.json").read_text(encoding="utf-8"))
    return ProblemData(
        tuple(_request_from_input(RequestInput(**item)) for item in payload["requests"]),
        tuple(_team_from_input(TeamInput(**item)) for item in payload["teams"]),
    )


def test_solver_config_round_trip_and_cpp_seed_reproducibility():
    config = SolverConfig(seed=123, time_limit_ms=0, iteration_limit=4, use_alns=True, multi_start=2)
    assert SolverConfig.from_dict(config.to_dict()) == config
    problem = dataset_problem("zone_3")
    first = cpp_solution(problem, config)
    second = cpp_solution(problem, config)
    assert [(route.team_id, route.request_ids) for route in first.routes] == [(route.team_id, route.request_ids) for route in second.routes]
    assert first.unassigned == second.unassigned


def test_prepared_dataset_regression_invariants():
    thresholds = {"zone_1": (66, 7), "zone_2": (83, 9), "zone_3": (56, 7), "combined": (205, 24)}
    for name, (expected_assigned, max_teams) in thresholds.items():
        problem = dataset_problem(name)
        solution = cpp_solution(problem, SolverConfig(seed=42, time_limit_ms=3000))
        assert len(solution.unassigned) == len(problem.requests) - expected_assigned
        assert sum(len(route.request_ids) for route in solution.routes) == expected_assigned
        assert len(solution.routes) <= max_teams
        request_regions = {request.id: request.region_id for request in problem.requests}
        team_regions = {team.id: team.region_id for team in problem.teams}
        assert all(team_regions[route.team_id] == request_regions[request_id]
                   for route in solution.routes for request_id in route.request_ids)


def test_cpp_edge_case_matrix_is_verifier_safe():
    empty = ProblemData((), ())
    assert cpp_solution(empty).unassigned == []

    one_request = Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.75, 37.61, 540, 540, 900, 30, Skill.REPAIR)
    one_team = Team(1, "T1", 55.75, 37.60, 540, 900, Skill.REPAIR, Transport.CAR)
    assert cpp_solution(ProblemData((one_request,), (one_team,))).unassigned == []

    cases = [
        Request(2, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "skill", 55.75, 37.61, 540, 540, 900, 30, Skill.GIGABIT),
        Request(3, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "transport", 55.75, 37.61, 540, 540, 900, 30, Skill.REPAIR, Transport.WALK),
        Request(4, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "equipment", 55.75, 37.61, 540, 540, 900, 30, Skill.REPAIR, None, ("OTDR",)),
        Request(5, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "short shift", 55.75, 37.61, 540, 540, 900, 30, Skill.REPAIR),
    ]
    for request in cases:
        team = Team(1, "T1", 55.75, 37.60, 540, 550 if request.id == 5 else 900, Skill.REPAIR, Transport.CAR)
        solution = cpp_solution(ProblemData((request,), (team,)))
        assert solution.unassigned == [request.id]

    narrow = tuple(Request(i, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", str(i), 55.75, 37.61, 540, 540, 570, 30, Skill.REPAIR) for i in (10, 11))
    narrow_solution = cpp_solution(ProblemData(narrow, (one_team,)))
    assert len(narrow_solution.unassigned) == 1

    zero_skill = Request(20, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "zero", 55.75, 37.61, 540, 540, 900, 30, Skill(0))
    assert cpp_solution(ProblemData((zero_skill,), (Team(1, "T1", 55.75, 37.61, 540, 900, Skill(0), Transport.CAR),))).unassigned == []

    emergencies = tuple(Request(30 + i, "", "", WorkType.EMERGENCY, RequestStatus.NEW, 3, "", str(i), 55.75, 37.61, 540, 540, 900, 30, Skill.EMERGENCY) for i in range(3))
    assert cpp_solution(ProblemData(emergencies, (Team(1, "T1", 55.75, 37.61, 540, 900, Skill.EMERGENCY, Transport.CAR),))).unassigned == []

    same_point = tuple(Request(40 + i, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", str(i), 55.75, 37.61, 540, 540, 900, 30, Skill.REPAIR) for i in range(3))
    assert cpp_solution(ProblemData(same_point, (one_team,))).unassigned == []


def test_small_random_property_suite_never_returns_invalid_solution():
    rng = random.Random(20260919)
    for trial in range(20):
        teams = tuple(Team(100 + index, f"T{index}", 55.75, 37.61, 540, 900,
                           Skill(rng.choice([0, int(Skill.REPAIR), int(Skill.CONNECTION), int(Skill.REPAIR | Skill.CONNECTION)])),
                           Transport.CAR) for index in range(rng.randint(1, 3)))
        requests = tuple(Request(1000 + trial * 10 + index, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", str(index),
                                 55.75 + rng.random() * 0.01, 37.61 + rng.random() * 0.01, 540, 540,
                                 rng.choice([600, 720, 900]), rng.choice([15, 30, 45]),
                                 Skill(rng.choice([0, int(Skill.REPAIR), int(Skill.CONNECTION)])))
                          for index in range(rng.randint(0, 5)))
        solution = cpp_solution(ProblemData(requests, teams), fast_config(seed=trial))
        assert verify_solution(ProblemData(requests, teams), solution, HaversineTravelMatrix()).valid


def test_plan_persistence_reload_and_replan():
    database = Path(tempfile.gettempdir()) / "beeline_stage18_persistence_test.db"
    database.unlink(missing_ok=True)
    config = fast_config(seed=77).to_dict()
    payload = {
        "solver": "cpp", "solver_config": config,
        "requests": [{"id": 1, "address": "A", "lat": 55.75, "lon": 37.61, "window_start": "09:00", "window_end": "18:00", "service_duration": 30, "required_skills": ["REPAIR"]}],
        "teams": [{"id": 1, "name": "T1", "start_lat": 55.75, "start_lon": 37.60, "shift_start": "09:00", "shift_end": "18:00", "skills": ["REPAIR"], "transport": "CAR"}],
    }
    try:
        first_app = create_app(f"sqlite:///{database}")
        with TestClient(first_app) as client:
            created = client.post("/api/optimize", json=payload)
            assert created.status_code == 200, created.text
            body = created.json()
            assert body["solver_config"]["seed"] == 77
            assert body["solver_version"] == SOLVER_VERSION
            assert body["routing_source"] == ROUTING_SOURCE
            plan_id = body["plan_id"]
        second_app = create_app(f"sqlite:///{database}")
        with TestClient(second_app) as client:
            loaded = client.get(f"/api/plans/{plan_id}")
            assert loaded.status_code == 200
            assert loaded.json()["solver_config"] == config
            event = client.post(f"/api/plans/{plan_id}/events", json={"event_type": "STATUS_CHANGED", "event_time": "13:17", "request_id": 1, "status": "CANCELLED"})
            assert event.status_code == 200
            replanned = client.post(f"/api/plans/{plan_id}/replan", json={"current_time": "13:17", "event_id": event.json()["event_id"]})
            assert replanned.status_code == 200, replanned.text
            assert replanned.json()["verified"] is True
    finally:
        if "first_app" in locals():
            first_app.state.engine.dispose()
        if "second_app" in locals():
            second_app.state.engine.dispose()
        database.unlink(missing_ok=True)


def test_demo_showcase_section_survives_save_event_replan_and_restart():
    database = Path(tempfile.gettempdir()) / "beeline_showcase_persistence_test.db"
    database.unlink(missing_ok=True)
    payload = json.loads((DATASETS / "demo_showcase.json").read_text(encoding="utf-8"))
    config = fast_config(seed=91).to_dict()
    try:
        first_app = create_app(f"sqlite:///{database}")
        with TestClient(first_app) as client:
            created = client.post("/api/optimize", json={**payload, "solver": "cpp", "solver_config": config})
            assert created.status_code == 200, created.text
            parent = created.json()
            assert parent["verified"] is True
            assert parent["unassigned_requests"] == []
            with first_app.state.session_factory() as session:
                stored = PlanRepository(session).get_plan(parent["plan_id"])
                assert stored is not None
                assert {item["section_id"] for item in stored.problem_payload["requests"]} == {"section_1", "section_2"}

            event = client.post(f"/api/plans/{parent['plan_id']}/events", json={
                "event_type": "NEW_EMERGENCY", "event_time": "13:17",
                "request": {"id": 9099, "address": "Демо, новая авария", "lat": 55.7515, "lon": 37.6115,
                            "window_start": "13:17", "window_end": "18:00", "service_duration": 80,
                            "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"],
                            "required_transport": "CAR", "required_equipment": ["router"],
                            "section_id": "section_1", "district": "район А"},
            })
            assert event.status_code == 200, event.text
            replanned = client.post(f"/api/plans/{parent['plan_id']}/replan", json={
                "current_time": "13:17", "event_id": event.json()["event_id"],
            })
            assert replanned.status_code == 200, replanned.text
            child = replanned.json()
            assert child["verified"] is True
            with first_app.state.session_factory() as session:
                stored = PlanRepository(session).get_plan(child["plan_id"])
                assert stored is not None
                restored_request = next(item for item in stored.problem_payload["requests"] if item["id"] == 9099)
                assert restored_request["section_id"] == "section_1"
        first_app.state.engine.dispose()

        restarted_app = create_app(f"sqlite:///{database}")
        with TestClient(restarted_app) as client:
            restored = client.get(f"/api/plans/{child['plan_id']}")
            assert restored.status_code == 200, restored.text
            assert restored.json()["verified"] is True
        restarted_app.state.engine.dispose()
    finally:
        if "first_app" in locals():
            first_app.state.engine.dispose()
        if "restarted_app" in locals():
            restarted_app.state.engine.dispose()
        database.unlink(missing_ok=True)
