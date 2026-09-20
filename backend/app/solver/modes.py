from enum import StrEnum
import time

from app.solver.baseline import BaselineSolver
from app.solver.regret3 import Regret3Solver
from app.solver.vnd import VNDOptimizer
from app.solver.config import SolverConfig


class SolverMode(StrEnum):
    BASELINE = "baseline"
    REGRET3 = "regret3"
    REGRET_VND = "regret_vnd"


def solve_by_mode(mode: SolverMode | str, problem, travel, config: SolverConfig | None = None):
    if str(mode) == "cpp":
        from app.services.replanning import ReplanningService
        return ReplanningService(travel=travel, config=config or SolverConfig())._cpp_optimizer(problem, travel, [])
    mode = SolverMode(mode)
    if mode == SolverMode.BASELINE:
        started = time.perf_counter()
        solution = BaselineSolver().solve(problem, travel)
        solution.solver_stats = {"phase_timings_ms": {"baseline": (time.perf_counter() - started) * 1000.0},
                                 "profile_counters": {}, "engine": "python_baseline"}
        return solution
    regret_started = time.perf_counter()
    solution = Regret3Solver().solve(problem, travel)
    regret_ms = (time.perf_counter() - regret_started) * 1000.0
    phase_timings = {"regret3": regret_ms}
    if mode == SolverMode.REGRET_VND:
        vnd_started = time.perf_counter()
        solution = VNDOptimizer().improve(solution, problem, travel)
        phase_timings["vnd"] = (time.perf_counter() - vnd_started) * 1000.0
    solution.solver_stats = {"phase_timings_ms": phase_timings, "profile_counters": {},
                             "engine": "python_regret_vnd" if mode == SolverMode.REGRET_VND else "python_regret3"}
    return solution
