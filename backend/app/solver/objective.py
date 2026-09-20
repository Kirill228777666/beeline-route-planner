from app.domain.models import Objective, ProblemData, Solution, WorkType


class ObjectiveEvaluator:
    def evaluate(self, problem: ProblemData, routes, unassigned: list[int]) -> Objective:
        request_map = {request.id: request for request in problem.requests}
        missing = [request_map[request_id] for request_id in unassigned]
        return Objective(
            sum(request.work_type == WorkType.EMERGENCY for request in missing),
            sum(request.work_type == WorkType.CONNECTION for request in missing),
            sum(request.work_type not in (WorkType.EMERGENCY, WorkType.CONNECTION) for request in missing),
            len(routes),
            sum(route.total_travel_time for route in routes),
            sum(route.total_distance for route in routes),
        )

    def key(self, objective: Objective) -> tuple:
        return (
            objective.unassigned_emergency,
            objective.unassigned_connection,
            objective.unassigned_other,
            objective.used_teams,
            objective.total_travel_time,
            objective.total_distance,
        )

    def better(self, left: Objective, right: Objective) -> bool:
        return self.key(left) < self.key(right)

    def solution_better(self, left: Solution, right: Solution) -> bool:
        return left.objective is not None and right.objective is not None and self.better(left.objective, right.objective)
