from dataclasses import asdict

from app.domain.models import Solution


def solution_metrics(solution: Solution) -> dict:
    return {
        "assigned": sum(len(route.request_ids) for route in solution.routes),
        "unassigned": len(solution.unassigned),
        "used_teams": len(solution.routes),
        "total_distance_km": round(sum(route.total_distance for route in solution.routes), 3),
        "total_travel_minutes": sum(route.total_travel_time for route in solution.routes),
        "objective": asdict(solution.objective) if solution.objective else None,
    }
