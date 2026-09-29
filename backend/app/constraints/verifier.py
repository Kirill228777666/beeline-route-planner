from dataclasses import dataclass
from math import isclose, isfinite

from app.constraints.engine import ConstraintEngine
from app.constraints.schedule import calculate_schedule
from app.domain.models import ProblemData, RequestStatus, Solution


@dataclass(frozen=True)
class VerificationResult:
    valid: bool
    errors: tuple[str, ...]


def verify_solution(problem: ProblemData, solution: Solution, travel) -> VerificationResult:
    requests = {request.id: request for request in problem.requests}
    teams = {team.id: team for team in problem.teams}
    errors: list[str] = []
    seen: set[int] = set()
    seen_teams: set[int] = set()
    if len(requests) != len(problem.requests) or len(teams) != len(problem.teams):
        errors.append("duplicate input identifiers")
    if len(set(solution.unassigned)) != len(solution.unassigned):
        errors.append("duplicate unassigned request")
    engine = ConstraintEngine()
    for route in solution.routes:
        if route.team_id in seen_teams:
            errors.append(f"duplicate route for team {route.team_id}")
        seen_teams.add(route.team_id)
        team = teams.get(route.team_id)
        if not team:
            errors.append(f"unknown team {route.team_id}")
            continue
        route_requests = []
        for request_id in route.request_ids:
            if request_id in seen:
                errors.append(f"duplicate request {request_id}")
            seen.add(request_id)
            request = requests.get(request_id)
            if not request:
                errors.append(f"unknown request {request_id}")
                continue
            fixed = request.status in {RequestStatus.COMPLETED, RequestStatus.IN_PROGRESS, RequestStatus.ON_THE_WAY}
            if not engine.team_compatible(team, request, allow_unavailable=fixed).allowed:
                errors.append(f"request {request_id} incompatible with team {team.id}")
            route_requests.append(request)
        schedule = calculate_schedule(team, route_requests, travel)
        if not schedule.valid:
            errors.append(schedule.error or f"invalid route {team.id}")
        if len(route.schedule) != len(schedule.stops):
            errors.append(f"schedule length mismatch for team {team.id}")
        for actual, expected in zip(route.schedule, schedule.stops):
            if any(getattr(actual, name) != getattr(expected, name) for name in
                   ("request_id", "arrival", "start", "finish", "travel_time", "waiting")):
                errors.append(f"schedule mismatch for request {expected.request_id}")
            if not isfinite(actual.travel_distance) or not isclose(actual.travel_distance, expected.travel_distance, abs_tol=1e-7):
                errors.append(f"distance mismatch for request {expected.request_id}")
        if (route.total_travel_time != schedule.total_travel_time or
                not isfinite(route.total_distance) or
                not isclose(route.total_distance, schedule.total_distance, abs_tol=1e-7)):
            errors.append(f"route metrics mismatch for team {team.id}")
    all_ids = set(requests)
    if seen & set(solution.unassigned):
        errors.append("request is both assigned and unassigned")
    if seen | set(solution.unassigned) != all_ids:
        errors.append("solution does not account for every request")
    return VerificationResult(not errors, tuple(errors))
