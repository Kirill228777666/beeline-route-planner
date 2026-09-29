from __future__ import annotations

import os
import sys
import time
import logging
from dataclasses import dataclass, replace
from enum import StrEnum
from pathlib import Path
from typing import Callable, Protocol

from app.constraints.schedule import calculate_schedule
from app.constraints.verifier import VerificationResult, verify_solution
from app.domain.models import ProblemData, Request, RequestStatus, Route, Solution, Team, WorkType
from app.domain.norms import priority_for, service_duration_for
from app.geo.travel import HaversineTravelMatrix
from app.solver.common import materialize_solution
from app.solver.regret3 import Regret3Solver
from app.solver.vnd import VNDOptimizer
from app.solver.config import SolverConfig


class ReplanningEventType(StrEnum):
    STATUS_CHANGED = "STATUS_CHANGED"
    NEW_EMERGENCY = "NEW_EMERGENCY"
    TEAM_UNAVAILABLE = "TEAM_UNAVAILABLE"


@dataclass(frozen=True)
class ReplanningEvent:
    event_type: ReplanningEventType | str
    request_id: int | None = None
    status: RequestStatus | None = None
    request: Request | None = None
    event_time: int | None = None
    team_id: int | None = None


@dataclass(frozen=True)
class ReplanningDiff:
    reassigned_request_ids: tuple[int, ...] = ()
    time_changed_request_ids: tuple[int, ...] = ()
    route_changed_team_ids: tuple[int, ...] = ()
    cancelled_request_ids: tuple[int, ...] = ()
    new_request_ids: tuple[int, ...] = ()


@dataclass(frozen=True)
class ReplanningResult:
    plan: Solution
    diff: ReplanningDiff
    verification: VerificationResult
    problem: ProblemData


class Optimizer(Protocol):
    def __call__(self, problem: ProblemData, travel, warm_start: list[dict]) -> Solution: ...


class ReplanningService:
    _FIXED = {RequestStatus.COMPLETED, RequestStatus.IN_PROGRESS, RequestStatus.ON_THE_WAY}

    def __init__(self, travel=None, optimizer: Optimizer | None = None, time_limit_ms: int = 3000,
                 config: SolverConfig | None = None):
        self.travel = travel or HaversineTravelMatrix()
        self.optimizer = optimizer or self._cpp_optimizer
        self.config = config or SolverConfig(time_limit_ms=time_limit_ms)
        self.time_limit_ms = self.config.time_limit_ms

    def replan(self, problem: ProblemData, current_plan: Solution, current_time: int,
               event: ReplanningEvent) -> ReplanningResult:
        request_map = {request.id: request for request in problem.requests}
        status_map = {request.id: request.status for request in problem.requests}
        event_type = ReplanningEventType(event.event_type)
        if event.event_time is not None and current_time < event.event_time:
            raise ValueError("current_time cannot precede event_time")
        new_ids: list[int] = []
        if event_type == ReplanningEventType.STATUS_CHANGED:
            if event.request_id is None or event.status is None:
                raise ValueError("STATUS_CHANGED requires request_id and status")
            if event.request_id not in request_map:
                raise ValueError(f"unknown request {event.request_id}")
            status_map[event.request_id] = RequestStatus(event.status)
            if status_map[event.request_id] == RequestStatus.ON_THE_WAY and event.event_time is not None:
                request = request_map[event.request_id]
                request_map[event.request_id] = replace(
                    request,
                    release_time=max(request.release_time, event.event_time),
                    window_start=max(request.window_start, event.event_time),
                )
        elif event_type == ReplanningEventType.NEW_EMERGENCY:
            if event.request is None:
                raise ValueError("NEW_EMERGENCY requires request")
            event_time = event.event_time if event.event_time is not None else current_time
            existing = request_map.get(event.request.id)
            if existing is not None:
                if existing.work_type != WorkType.EMERGENCY or existing.release_time != event_time:
                    raise ValueError(f"duplicate request {event.request.id}")
                emergency = existing
            else:
                emergency = replace(event.request, status=RequestStatus.NEW,
                                    work_type=WorkType.EMERGENCY,
                                    priority=priority_for(WorkType.EMERGENCY),
                                    service_duration=service_duration_for(WorkType.EMERGENCY),
                                    release_time=event_time,
                                    window_start=max(event.request.window_start, event_time))
            request_map[emergency.id] = emergency
            status_map[emergency.id] = RequestStatus.NEW
            new_ids.append(emergency.id)
        elif event_type == ReplanningEventType.TEAM_UNAVAILABLE:
            if event.team_id is None or event.team_id not in {team.id for team in problem.teams}:
                raise ValueError(f"unknown team {event.team_id}")
            problem = ProblemData(problem.requests, tuple(
                replace(team, available=False) if team.id == event.team_id else team for team in problem.teams
            ))

        effective_requests = {
            request_id: replace(request, status=status_map[request_id])
            for request_id, request in request_map.items()
            if status_map.get(request_id, request.status) != RequestStatus.CANCELLED
        }
        fixed_ids = {request_id for request_id, status in status_map.items() if status in self._FIXED}
        old_routes = {route.team_id: list(route.request_ids) for route in current_plan.routes}
        old_stops = self._stops_by_request(problem, current_plan)
        fixed_by_team: dict[int, list[int]] = {team.id: [] for team in problem.teams}
        pending_by_team: dict[int, list[int]] = {team.id: [] for team in problem.teams}
        assigned_old: set[int] = set()
        for route in current_plan.routes:
            if route.team_id not in fixed_by_team:
                continue
            for request_id in route.request_ids:
                if request_id not in effective_requests or request_id in assigned_old:
                    continue
                assigned_old.add(request_id)
                if request_id in fixed_ids:
                    fixed_by_team[route.team_id].append(request_id)
                else:
                    pending_by_team[route.team_id].append(request_id)

        pending_ids = [request_id for request_id in effective_requests if request_id not in fixed_ids]

        planning_teams = tuple(self._team_snapshot(team, fixed_by_team[team.id], effective_requests,
                                                   old_stops, current_time, problem) for team in problem.teams)
        planning_requests = tuple(effective_requests[request_id] for request_id in pending_ids)
        planning_problem = ProblemData(planning_requests, planning_teams)
        warm_start = [
            {"team_id": team_id, "request_ids": [request_id for request_id in ids if request_id in pending_ids]}
            for team_id, ids in pending_by_team.items() if any(request_id in pending_ids for request_id in ids)
        ]
        optimized = self.optimizer(planning_problem, self.travel, warm_start)

        optimized_by_team = {route.team_id: list(route.request_ids) for route in optimized.routes}
        final_route_ids: dict[int, list[int]] = {}
        for team in problem.teams:
            ids = list(fixed_by_team[team.id])
            ids.extend(request_id for request_id in optimized_by_team.get(team.id, [])
                       if request_id in effective_requests and request_id not in fixed_ids and request_id not in ids)
            if ids:
                final_route_ids[team.id] = ids
        active_problem = ProblemData(tuple(effective_requests.values()), planning_teams)
        final_plan = materialize_solution(final_route_ids, active_problem, self.travel)
        verification = verify_solution(active_problem, final_plan, self.travel)
        if not verification.valid:
            final_plan = self._fallback_plan(current_plan, active_problem, fixed_by_team, effective_requests)
            verification = verify_solution(active_problem, final_plan, self.travel)
        diff = self._diff(current_plan, final_plan, old_routes, old_stops, new_ids, status_map)
        return ReplanningResult(final_plan, diff, verification, active_problem)

    def _team_snapshot(self, team: Team, fixed_ids: list[int], requests: dict[int, Request],
                       old_stops: dict[int, object], current_time: int, problem: ProblemData) -> Team:
        initial_available_from = (team.initial_available_from if team.initial_available_from is not None
                                  else team.available_from)
        current_lat = team.current_lat if team.current_lat is not None else team.start_lat
        current_lon = team.current_lon if team.current_lon is not None else team.start_lon
        available_from = max(team.shift_start, team.available_from, current_time)
        if fixed_ids:
            last_id = fixed_ids[-1]
            last_request = requests[last_id]
            stop = old_stops.get(last_id)
            current_lat, current_lon = last_request.lat, last_request.lon
            available_from = max(available_from, getattr(stop, "finish", current_time))
        return replace(team, available_from=available_from, current_lat=current_lat, current_lon=current_lon,
                       initial_available_from=initial_available_from)

    def _stops_by_request(self, problem: ProblemData, plan: Solution) -> dict[int, object]:
        result: dict[int, object] = {}
        team_map = {team.id: team for team in problem.teams}
        request_map = {request.id: request for request in problem.requests}
        for route in plan.routes:
            stops = route.schedule
            if not stops:
                schedule = calculate_schedule(team_map[route.team_id],
                                              [request_map[request_id] for request_id in route.request_ids], self.travel)
                stops = list(schedule.stops)
            result.update({stop.request_id: stop for stop in stops})
        return result

    def _fallback_plan(self, old_plan: Solution, problem: ProblemData, fixed_by_team: dict[int, list[int]],
                       requests: dict[int, Request]) -> Solution:
        route_ids = {team_id: [request_id for request_id in ids if request_id in requests]
                     for team_id, ids in fixed_by_team.items() if ids}
        for route in old_plan.routes:
            route_ids.setdefault(route.team_id, [])
            route_ids[route.team_id].extend(request_id for request_id in route.request_ids
                                             if request_id in requests and request_id not in route_ids[route.team_id])
        return materialize_solution(route_ids, problem, self.travel)

    def _diff(self, old_plan: Solution, new_plan: Solution, old_routes: dict[int, list[int]],
              old_stops: dict[int, object], new_ids: list[int], statuses: dict[int, RequestStatus]) -> ReplanningDiff:
        old_team = {request_id: team_id for team_id, ids in old_routes.items() for request_id in ids}
        new_team = {request_id: route.team_id for route in new_plan.routes for request_id in route.request_ids}
        reassigned = sorted(request_id for request_id, team_id in new_team.items()
                            if old_team.get(request_id) != team_id)
        new_stops = {stop.request_id: stop for route in new_plan.routes for stop in route.schedule}
        time_changed = sorted(request_id for request_id in set(old_stops) & set(new_stops)
                              if statuses.get(request_id) not in self._FIXED and
                              old_stops[request_id].start != new_stops[request_id].start)
        old_sequences = {team_id: tuple(ids) for team_id, ids in old_routes.items() if ids}
        new_sequences = {route.team_id: tuple(route.request_ids) for route in new_plan.routes}
        route_changed = sorted(team_id for team_id in set(old_sequences) | set(new_sequences)
                               if old_sequences.get(team_id, ()) != new_sequences.get(team_id, ()))
        cancelled = sorted(request_id for request_id, status in statuses.items() if status == RequestStatus.CANCELLED)
        return ReplanningDiff(tuple(reassigned), tuple(time_changed), tuple(route_changed), tuple(cancelled), tuple(new_ids))

    def _cpp_optimizer(self, problem: ProblemData, travel, warm_start: list[dict]) -> Solution:
        total_started = time.perf_counter()
        try:
            cpp_root = Path(__file__).resolve().parents[3] / "cpp_solver"
            if str(cpp_root) not in sys.path:
                sys.path.insert(0, str(cpp_root))
            os.add_dll_directory(r"C:\msys64\ucrt64\bin")
            import cpp_solver
            conversion_started = time.perf_counter()
            request_payload = [{"id": request.id, "lat": request.lat, "lon": request.lon,
                                "window_start": request.window_start, "window_end": request.window_end,
                                "release_time": request.release_time,
                                "service_duration": request.service_duration,
                                "required_skills": int(request.required_skills),
                                "required_equipment": list(request.required_equipment),
                                **({"required_transport": request.required_transport.value} if request.required_transport else {}),
                                "work_type": request.work_type.value, "region_id": request.region_id}
                               for request in problem.requests]
            team_payload = [{"id": team.id,
                             "start_lat": team.current_lat if team.current_lat is not None else team.start_lat,
                             "start_lon": team.current_lon if team.current_lon is not None else team.start_lon,
                             "shift_start": max(team.shift_start, team.available_from), "shift_end": team.shift_end,
                             "skills": int(team.skills), "equipment": list(team.equipment), "transport": team.transport.value,
                             "available": team.available, "region_id": team.region_id} for team in problem.teams]
            payload_conversion_ms = (time.perf_counter() - conversion_started) * 1000.0
            cpp_started = time.perf_counter()
            result = cpp_solver.solve_config(request_payload, team_payload, self.config.to_dict(), warm_start)
            cpp_wall_ms = (time.perf_counter() - cpp_started) * 1000.0
            response_conversion_started = time.perf_counter()
            routes = []
            for item in result["routes"]:
                stops = [
                    __import__("app.domain.models", fromlist=["Stop"]).Stop(
                        request_id=stop["request_id"], arrival=stop["arrival"], start=stop["start"],
                        finish=stop["finish"], travel_time=stop["travel_minutes"],
                        travel_distance=stop["distance_km"], waiting=stop["waiting_minutes"])
                    for stop in item["stops"]
                ]
                routes.append(Route(item["team_id"], list(item["request_ids"]), stops,
                                    item["distance_km"], item["travel_time_minutes"]))
            response_conversion_ms = (time.perf_counter() - response_conversion_started) * 1000.0
            solution = Solution(routes, list(result["unassigned"]), None, False)
            verifier_started = time.perf_counter()
            solution.valid = verify_solution(problem, solution, travel).valid
            if not solution.valid:
                raise RuntimeError("C++ result rejected by independent verifier")
            verifier_ms = (time.perf_counter() - verifier_started) * 1000.0
            phase_timings = {str(name): float(value) for name, value in dict(result.get("phase_timings_ms", {})).items()}
            phase_timings["python_cpp_conversion"] = payload_conversion_ms + response_conversion_ms
            phase_timings["python_verifier"] = verifier_ms
            solution.solver_stats = {
                "phase_timings_ms": phase_timings,
                "profile_counters": {str(name): int(value) for name, value in dict(result.get("profile_counters", {})).items()},
                "route_pool_size": int(result.get("route_pool_size", 0)),
                "cpp_execution_ms": float(result.get("cpp_execution_ms", cpp_wall_ms)),
                "python_cpp_conversion_ms": payload_conversion_ms + response_conversion_ms,
                "verifier_ms": verifier_ms,
                "total_cpp_path_ms": (time.perf_counter() - total_started) * 1000.0,
                "seed": self.config.seed,
                "engine": "cpp",
            }
            return solution
        except Exception as error:
            logging.getLogger(__name__).warning("C++ solver failed; verified Python fallback: %s", error)
            fallback_started = time.perf_counter()
            solution = VNDOptimizer().improve(Regret3Solver().solve(problem, travel), problem, travel)
            verifier_started = time.perf_counter()
            solution.valid = verify_solution(problem, solution, travel).valid
            if not solution.valid:
                raise RuntimeError("Both C++ and Python fallback failed independent verification") from error
            verifier_ms = (time.perf_counter() - verifier_started) * 1000.0
            fallback_ms = (time.perf_counter() - fallback_started) * 1000.0
            solution.solver_stats = {
                "phase_timings_ms": {"python_fallback": fallback_ms, "python_verifier": verifier_ms,
                                      "python_cpp_conversion": (time.perf_counter() - total_started) * 1000.0},
                "profile_counters": {}, "cpp_execution_ms": 0.0,
                "python_cpp_conversion_ms": (time.perf_counter() - total_started) * 1000.0,
                "verifier_ms": verifier_ms, "total_cpp_path_ms": fallback_ms,
                "seed": self.config.seed, "engine": "python_fallback", "fallback_reason": type(error).__name__,
            }
            return solution
