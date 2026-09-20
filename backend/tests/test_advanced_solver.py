from app.domain.models import *
from app.geo.travel import HaversineTravelMatrix
from app.solver.objective import ObjectiveEvaluator
from app.solver.regret3 import Regret3Solver
from app.solver.vnd import VNDOptimizer
from app.solver.modes import SolverMode, solve_by_mode
from app.benchmark import benchmark_dataset


def problem():
    requests = (
        Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.750, 37.610, 540, 540, 900, 30, Skill.REPAIR),
        Request(2, "", "", WorkType.EMERGENCY, RequestStatus.NEW, 3, "", "B", 55.755, 37.620, 540, 540, 900, 30, Skill.EMERGENCY),
        Request(3, "", "", WorkType.CONNECTION, RequestStatus.NEW, 2, "", "C", 55.760, 37.630, 540, 540, 900, 30, Skill.CONNECTION),
    )
    teams = (
        Team(1, "T1", 55.750, 37.600, 540, 1000, Skill.REPAIR | Skill.EMERGENCY, Transport.CAR),
        Team(2, "T2", 55.750, 37.600, 540, 1000, Skill.CONNECTION, Transport.CAR),
    )
    return ProblemData(requests, teams)


def test_objective_is_lexicographic():
    evaluator = ObjectiveEvaluator()
    assert evaluator.better(Objective(0, 0, 0, 99, 999, 999), Objective(1, 0, 0, 1, 1, 1))


def test_regret3_enumerates_insertions_and_returns_verified_solution():
    data = problem()
    solver = Regret3Solver()
    options = solver.enumerate_insertions(data.requests[0], data, {1: [], 2: []}, HaversineTravelMatrix())
    assert options
    solution = solver.solve(data, HaversineTravelMatrix())
    assert solution.valid
    assert solution.unassigned == []


def test_vnd_runs_relocate_swap_and_two_opt_without_invalidating_plan():
    data = problem()
    initial = Regret3Solver().solve(data, HaversineTravelMatrix())
    improved = VNDOptimizer().improve(initial, data, HaversineTravelMatrix())
    assert improved.valid
    assert sorted(improved.routes[0].request_ids + improved.routes[1].request_ids) == [1, 2, 3]


def test_solver_modes_and_benchmark_report_required_metrics():
    data = problem()
    for mode in SolverMode:
        result = solve_by_mode(mode, data, HaversineTravelMatrix())
        assert result.valid
    report = benchmark_dataset(data, HaversineTravelMatrix())
    assert {row["mode"] for row in report} == {"baseline", "regret3", "regret_vnd"}
    assert all({"assigned", "used_teams", "distance_km", "runtime_ms"} <= row.keys() for row in report)
