from dataclasses import dataclass

from app.constraints.engine import ConstraintEngine
from app.constraints.schedule import calculate_schedule
from app.domain.models import ProblemData, Request, Solution
from app.solver.common import materialize_solution


@dataclass(frozen=True)
class Insertion:
    team_id: int
    position: int
    request_ids: tuple[int, ...]
    delta_travel_time: int
    delta_distance: float

    @property
    def cost(self) -> tuple[int, float]:
        return self.delta_travel_time, self.delta_distance


class Regret3Solver:
    def __init__(self):
        self.engine = ConstraintEngine()

    def enumerate_insertions(self, request: Request, problem: ProblemData, route_ids: dict[int, list[int]], travel) -> list[Insertion]:
        request_map = {item.id: item for item in problem.requests}
        result: list[Insertion] = []
        for team in problem.teams:
            if not self.engine.team_compatible(team, request).allowed:
                continue
            current_ids = route_ids.get(team.id, [])
            current_requests = [request_map[item] for item in current_ids]
            before = calculate_schedule(team, current_requests, travel)
            for position in range(len(current_ids) + 1):
                candidate_ids = current_ids[:position] + [request.id] + current_ids[position:]
                candidate_requests = [request_map[item] if item != request.id else request for item in candidate_ids]
                after = calculate_schedule(team, candidate_requests, travel)
                if after.valid:
                    result.append(Insertion(team.id, position, tuple(candidate_ids),
                                            after.total_travel_time - before.total_travel_time,
                                            after.total_distance - before.total_distance))
        return result

    def solve(self, problem: ProblemData, travel) -> Solution:
        route_ids = {team.id: [] for team in problem.teams}
        _, solution = self.repair(route_ids, problem, travel)
        return solution

    def repair(self, route_ids: dict[int, list[int]], problem: ProblemData, travel) -> tuple[dict[int, list[int]], Solution]:
        route_ids = {team.id: list(route_ids.get(team.id, [])) for team in problem.teams}
        assigned = {request_id for ids in route_ids.values() for request_id in ids}
        remaining = [request for request in problem.requests if request.id not in assigned]
        while remaining:
            candidates = []
            for request in remaining:
                insertions = self.enumerate_insertions(request, problem, route_ids, travel)
                if not insertions:
                    candidates.append((request, (), None))
                    continue
                ranked = sorted(insertions, key=lambda item: item.cost)
                best_cost = ranked[0].cost
                regret = sum(item.cost[0] - best_cost[0] for item in ranked[1:3])
                eligible_teams = len({item.team_id for item in insertions})
                candidates.append((request, ranked, (regret, eligible_teams, request.window_end - request.window_start)))
            feasible = [item for item in candidates if item[1]]
            if not feasible:
                break
            request, insertions, ranking = min(feasible, key=lambda item: (-item[0].priority, item[2][1], item[2][2], -item[2][0], item[0].id))
            chosen = min(insertions, key=lambda item: item.cost)
            route_ids[chosen.team_id] = list(chosen.request_ids)
            remaining.remove(request)
        return route_ids, materialize_solution(route_ids, problem, travel)
