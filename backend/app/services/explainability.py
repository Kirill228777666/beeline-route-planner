from __future__ import annotations

from app.constraints.engine import ConstraintEngine, RejectReason
from app.constraints.schedule import calculate_schedule
from app.domain.models import ProblemData, RequestStatus, Solution


def _clock(minutes: int | None) -> str | None:
    if minutes is None:
        return None
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


class ExplainabilityService:
    """Builds deterministic explanations from compatibility and schedule checks."""

    def __init__(self, travel):
        self.travel = travel
        self.engine = ConstraintEngine()

    def explain(self, problem: ProblemData, solution: Solution, request_id: int,
                parent_problem: ProblemData | None = None, parent_solution: Solution | None = None,
                event_payload: dict | None = None, diff_payload: dict | None = None) -> dict:
        request_map = {request.id: request for request in problem.requests}
        request = request_map.get(request_id)
        if request is None:
            raise KeyError(request_id)
        route_by_request = {rid: route for route in solution.routes for rid in route.request_ids}
        route = route_by_request.get(request_id)
        team_map = {team.id: team for team in problem.teams}
        team = team_map.get(route.team_id) if route else None
        stop = next((item for item in route.schedule if item.request_id == request_id), None) if route else None
        if route and stop is None:
            schedule = calculate_schedule(team, [request_map[rid] for rid in route.request_ids], self.travel)
            stop = next((item for item in schedule.stops if item.request_id == request_id), None)

        alternatives = []
        for alternative_team in sorted(problem.teams, key=lambda item: item.id):
            if team and alternative_team.id == team.id:
                continue
            alternatives.append(self._alternative(alternative_team, request, solution, request_id, request_map))

        hard_constraints = []
        if team is not None:
            fixed = request.status in {RequestStatus.COMPLETED, RequestStatus.IN_PROGRESS, RequestStatus.ON_THE_WAY}
            compatibility = self.engine.team_compatible(team, request, allow_unavailable=fixed)
            hard_constraints.extend([
                {"code": "TEAM_COMPATIBILITY", "passed": compatibility.allowed,
                 "reason_code": compatibility.reason.value},
                {"code": "SKILL", "passed": (team.skills & request.required_skills) == request.required_skills},
                {"code": "SECTION", "passed": team.section_id == request.section_id},
                {"code": "TRANSPORT", "passed": not request.required_transport or team.transport == request.required_transport},
                {"code": "EQUIPMENT", "passed": set(request.required_equipment).issubset(team.equipment)},
                {"code": "TEAM_AVAILABLE", "passed": team.available or fixed},
            ])
            if stop is not None:
                hard_constraints.extend([
                    {"code": "TIME_WINDOW", "passed": stop.start <= request.window_end},
                    {"code": "SHIFT_END", "passed": stop.finish <= team.shift_end},
                    {"code": "ROUTE_SCHEDULE", "passed": True},
                ])
        else:
            hard_constraints.append({"code": "ASSIGNMENT", "passed": False, "reason_code": "UNASSIGNED"})

        reason = self._assignment_reason(request, team, stop, alternatives, solution)
        result = {
            "request_id": request_id,
            "team_id": team.id if team else None,
            "reason": reason,
            "hard_constraints": hard_constraints,
            "arrival": _clock(stop.arrival) if stop else None,
            "start": _clock(stop.start) if stop else None,
            "finish": _clock(stop.finish) if stop else None,
            "alternatives": alternatives,
        }
        replanning_reason = self._replanning_reason(request_id, parent_problem, parent_solution,
                                                    solution, event_payload, diff_payload)
        if replanning_reason:
            result["replanning_reason"] = replanning_reason
        return result

    def _alternative(self, team, request, solution, request_id: int, request_map: dict) -> dict:
        compatibility = self.engine.team_compatible(team, request)
        if not compatibility.allowed:
            return {"team_id": team.id, "rejected_reason": compatibility.reason.value}
        route = next((item for item in solution.routes if item.team_id == team.id), None)
        route_ids = list(route.request_ids) if route else []
        route_ids = [item for item in route_ids if item != request_id]
        problem_requests = request_map
        feasible = False
        for position in range(len(route_ids) + 1):
            ids = route_ids[:position] + [request.id] + route_ids[position:]
            ordered = [problem_requests[item] if item in problem_requests else request for item in ids]
            if calculate_schedule(team, ordered, self.travel).valid:
                feasible = True
                break
        if feasible:
            return {"team_id": team.id, "rejected_reason": None, "status": "FEASIBLE_ALTERNATIVE"}
        return {"team_id": team.id, "rejected_reason": RejectReason.NO_TIME_FEASIBLE_ROUTE.value}

    def _assignment_reason(self, request, team, stop, alternatives, solution) -> str:
        if team is None:
            reasons = ", ".join(sorted({item["rejected_reason"] for item in alternatives if item.get("rejected_reason")}))
            if reasons and all(item.get("rejected_reason") for item in alternatives):
                return f"Заявка осталась неназначенной: все проверенные бригады отклонены ({reasons})."
            return "Заявка осталась неназначенной в сохранённом решении; фактические проверки альтернатив приведены в alternatives."
        if stop is not None:
            return "Бригада прошла проверки квалификации, транспорта, оборудования, доступности и временного окна."
        return "Заявка назначена бригаде, но расписание остановки отсутствует в сохранённом плане."

    def _replanning_reason(self, request_id, parent_problem, parent_solution, solution, event_payload, diff_payload):
        if parent_problem is None or parent_solution is None or not diff_payload:
            return None
        changed_assignment = request_id in diff_payload.get("reassigned_request_ids", [])
        changed_time = request_id in diff_payload.get("time_changed_request_ids", [])
        if not changed_assignment and not changed_time:
            return None
        if event_payload and event_payload.get("event_type") == "NEW_EMERGENCY":
            event_time = event_payload.get("event_time", "")
            if isinstance(event_time, int):
                event_time = _clock(event_time)
            return f"Заявка переназначена из-за поступления аварийной заявки в {event_time}, имеющей более высокий приоритет."
        if event_payload and event_payload.get("event_type") == "STATUS_CHANGED":
            status = event_payload.get("status")
            return f"Изменение связано с событием изменения статуса заявки на {status}."
        if changed_assignment:
            return "Назначение изменено при replanning после повторной проверки ограничений."
        return "Время заявки изменено при replanning после повторного расчёта расписания."
