from time import perf_counter

from app.geo.travel import HaversineTravelMatrix
from app.services.metrics import solution_metrics
from app.solver.modes import SolverMode, solve_by_mode


def benchmark_dataset(problem, travel: HaversineTravelMatrix | None = None) -> list[dict]:
    travel = travel or HaversineTravelMatrix()
    rows = []
    for mode in SolverMode:
        started = perf_counter()
        solution = solve_by_mode(mode, problem, travel)
        elapsed = (perf_counter() - started) * 1000
        metrics = solution_metrics(solution)
        rows.append({"mode": mode.value, "assigned": metrics["assigned"], "used_teams": metrics["used_teams"],
                     "distance_km": metrics["total_distance_km"], "runtime_ms": round(elapsed, 3), "verified": solution.valid})
    return rows
