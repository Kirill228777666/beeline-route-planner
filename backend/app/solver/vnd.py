from copy import deepcopy

from app.constraints.engine import ConstraintEngine
from app.solver.common import materialize_solution
from app.solver.objective import ObjectiveEvaluator
from app.solver.regret3 import Regret3Solver


class VNDOptimizer:
    def __init__(self):
        self.evaluator = ObjectiveEvaluator()
        self.engine = ConstraintEngine()

    def improve(self, solution, problem, travel):
        route_ids = {team.id: [] for team in problem.teams}
        for route in solution.routes:
            route_ids[route.team_id] = list(route.request_ids)
        current = materialize_solution(route_ids, problem, travel)
        route_ids, current = self._run_neighborhoods(route_ids, problem, travel, current)
        if current.unassigned:
            repaired_ids, repaired = Regret3Solver().repair(route_ids, problem, travel)
            if self.evaluator.solution_better(repaired, current):
                route_ids, current = self._run_neighborhoods(repaired_ids, problem, travel, repaired)
        return current

    def _run_neighborhoods(self, route_ids, problem, travel, current):
        for operator in (self._relocate, self._swap, self._two_opt):
            while True:
                candidate = operator(route_ids, problem, travel, current)
                if candidate is None or not self.evaluator.solution_better(candidate[1], current):
                    break
                route_ids, current = candidate
        return route_ids, current

    def _relocate(self, route_ids, problem, travel, current):
        for source_id, source in route_ids.items():
            for index, request_id in enumerate(source):
                for destination_id in route_ids:
                    for position in range(len(route_ids[destination_id]) + 1):
                        if source_id == destination_id and position in (index, index + 1):
                            continue
                        candidate_ids = deepcopy(route_ids)
                        candidate_ids[source_id].pop(index)
                        candidate_ids[destination_id].insert(position, request_id)
                        candidate = materialize_solution(candidate_ids, problem, travel)
                        if candidate.valid and self.evaluator.solution_better(candidate, current):
                            return candidate_ids, candidate
        return None

    def _swap(self, route_ids, problem, travel, current):
        route_items = list(route_ids.items())
        for left, (left_id, left_route) in enumerate(route_items):
            for right_id, right_route in route_items[left + 1:]:
                for left_index, left_request in enumerate(left_route):
                    for right_index, right_request in enumerate(right_route):
                        candidate_ids = deepcopy(route_ids)
                        candidate_ids[left_id][left_index], candidate_ids[right_id][right_index] = right_request, left_request
                        candidate = materialize_solution(candidate_ids, problem, travel)
                        if candidate.valid and self.evaluator.solution_better(candidate, current):
                            return candidate_ids, candidate
        return None

    def _two_opt(self, route_ids, problem, travel, current):
        for team_id, route in route_ids.items():
            for start in range(len(route)):
                for end in range(start + 2, len(route) + 1):
                    candidate_ids = deepcopy(route_ids)
                    candidate_ids[team_id][start:end] = reversed(candidate_ids[team_id][start:end])
                    candidate = materialize_solution(candidate_ids, problem, travel)
                    if candidate.valid and self.evaluator.solution_better(candidate, current):
                        return candidate_ids, candidate
        return None
