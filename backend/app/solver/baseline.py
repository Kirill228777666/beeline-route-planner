from app.constraints.engine import ConstraintEngine
from app.constraints.schedule import calculate_schedule
from app.domain.models import ProblemData, Route
from app.solver.common import materialize_solution


class BaselineSolver:
    def solve(self, problem: ProblemData, travel) -> Solution:
        engine = ConstraintEngine()
        routes = {team.id: Route(team.id) for team in problem.teams}
        unassigned: list[int] = []
        for request in problem.requests:
            assigned = False
            for team in problem.teams:
                if not engine.team_compatible(team, request).allowed:
                    continue
                candidate = list(routes[team.id].request_ids) + [request.id]
                candidate_requests = [next(r for r in problem.requests if r.id == request_id) for request_id in candidate]
                schedule = calculate_schedule(team, candidate_requests, travel)
                if schedule.valid:
                    routes[team.id].request_ids.append(request.id)
                    routes[team.id].schedule = list(schedule.stops)
                    routes[team.id].total_distance = schedule.total_distance
                    routes[team.id].total_travel_time = schedule.total_travel_time
                    assigned = True
                    break
            if not assigned:
                unassigned.append(request.id)
        return materialize_solution({team_id: route.request_ids for team_id, route in routes.items()}, problem, travel)
