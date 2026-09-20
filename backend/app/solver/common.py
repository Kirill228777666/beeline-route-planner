from app.constraints.schedule import calculate_schedule
from app.constraints.verifier import verify_solution
from app.domain.models import ProblemData, Route, Solution
from app.solver.objective import ObjectiveEvaluator


def materialize_solution(route_ids: dict[int, list[int]], problem: ProblemData, travel) -> Solution:
    request_map = {request.id: request for request in problem.requests}
    team_map = {team.id: team for team in problem.teams}
    routes: list[Route] = []
    assigned: set[int] = set()
    for team_id, request_ids in route_ids.items():
        if not request_ids:
            continue
        team = team_map[team_id]
        requests = [request_map[request_id] for request_id in request_ids]
        schedule = calculate_schedule(team, requests, travel)
        if not schedule.valid:
            return Solution([], list(request_map), None, False)
        routes.append(Route(team_id, list(request_ids), list(schedule.stops), schedule.total_distance, schedule.total_travel_time))
        assigned.update(request_ids)
    unassigned = [request.id for request in problem.requests if request.id not in assigned]
    unassigned_map = {request.id: request for request in problem.requests if request.id in unassigned}
    objective = ObjectiveEvaluator().evaluate(problem, routes, unassigned)
    solution = Solution(routes, unassigned, objective, False)
    solution.valid = verify_solution(problem, solution, travel).valid
    return solution
