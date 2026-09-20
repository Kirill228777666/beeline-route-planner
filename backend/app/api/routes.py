from dataclasses import asdict
import time
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request as HttpRequest

from app.api.schemas import OptimizeInput, PlanEventInput, ReplanInput
from app.db.repositories import PlanRepository
from app.domain.config import parse_minutes
from app.domain.models import ProblemData, Request, RequestStatus, Route, Skill, Stop, Team, Transport, WorkType
from app.domain.norms import default_skill_for, normalize_work_type, priority_for, service_duration_for
from app.constraints.verifier import verify_solution
from app.geo.travel import HaversineTravelMatrix
from app.benchmark import benchmark_dataset
from app.services.metrics import solution_metrics
from app.services.explainability import ExplainabilityService
from app.services.replanning import ReplanningEvent, ReplanningEventType, ReplanningService
from app.solver.modes import solve_by_mode
from app.solver.config import ROUTING_SOURCE, SOLVER_VERSION, SolverConfig

router = APIRouter()


def _skills(values: list[str]) -> Skill:
    result = Skill(0)
    for value in values:
        result |= Skill[value.upper()]
    return result


def _request_from_input(item, status: RequestStatus = RequestStatus.NEW) -> Request:
    work_type = normalize_work_type(item.work_type)
    required_skills = _skills(item.required_skills) or default_skill_for(work_type)
    release_time = parse_minutes(item.release_time) if item.release_time is not None else 0
    window_start = max(parse_minutes(item.window_start), release_time)
    return Request(id=item.id, source_bk="", source_hd="", work_type=work_type, status=status,
                   priority=priority_for(work_type),
                   district="", address=item.address, lat=item.lat, lon=item.lon,
                   created_at=window_start, window_start=window_start,
                   window_end=parse_minutes(item.window_end), service_duration=service_duration_for(work_type),
                   required_skills=required_skills, release_time=release_time,
                   required_transport=Transport[item.required_transport] if item.required_transport else None,
                   required_equipment=tuple(item.required_equipment), region_id=item.region_id)


def _team_from_input(item) -> Team:
    return Team(id=item.id, name=item.name, start_lat=item.start_lat, start_lon=item.start_lon,
                shift_start=parse_minutes(item.shift_start), shift_end=parse_minutes(item.shift_end),
                skills=_skills(item.skills), transport=Transport[item.transport], equipment=tuple(item.equipment),
                region_id=item.region_id)


def _problem_payload(problem: ProblemData) -> dict:
    return {"requests": [_request_payload(request) for request in problem.requests],
            "teams": [_team_payload(team) for team in problem.teams]}


def _request_payload(request: Request) -> dict:
    return {"id": request.id, "source_bk": request.source_bk, "source_hd": request.source_hd,
            "work_type": request.work_type.value, "status": request.status.value, "priority": request.priority,
            "district": request.district, "address": request.address, "lat": request.lat, "lon": request.lon,
            "created_at": request.created_at, "window_start": request.window_start, "window_end": request.window_end,
            "service_duration": request.service_duration, "required_skills": int(request.required_skills),
            "release_time": request.release_time, "region_id": request.region_id,
            "required_transport": request.required_transport.value if request.required_transport else None,
            "required_equipment": list(request.required_equipment), "gigabit": request.gigabit, "fmc": request.fmc}


def _team_payload(team: Team) -> dict:
    return {"id": team.id, "name": team.name, "start_lat": team.start_lat, "start_lon": team.start_lon,
            "shift_start": team.shift_start, "shift_end": team.shift_end, "skills": int(team.skills),
            "transport": team.transport.value, "equipment": list(team.equipment), "available": team.available,
            "available_from": team.available_from, "current_lat": team.current_lat, "current_lon": team.current_lon,
            "region_id": team.region_id}


def _problem_from_payload(payload: dict) -> ProblemData:
    requests = tuple(Request(id=item["id"], source_bk=item.get("source_bk", ""), source_hd=item.get("source_hd", ""),
                             work_type=normalize_work_type(item["work_type"]), status=RequestStatus(item.get("status", "NEW")),
                             priority=priority_for(item["work_type"]), district=item.get("district", ""), address=item.get("address", ""),
                             lat=item["lat"], lon=item["lon"], created_at=item.get("created_at", item["window_start"]),
                             window_start=item["window_start"], window_end=item["window_end"],
                             service_duration=service_duration_for(item["work_type"]),
                             required_skills=Skill(item.get("required_skills", 0)) or default_skill_for(item["work_type"]),
                             required_transport=Transport(item["required_transport"]) if item.get("required_transport") else None,
                             required_equipment=tuple(item.get("required_equipment", ())), gigabit=item.get("gigabit", False),
                             fmc=item.get("fmc", False), release_time=item.get("release_time", 0),
                             region_id=item.get("region_id", "")) for item in payload["requests"])
    teams = tuple(Team(id=item["id"], name=item["name"], start_lat=item["start_lat"], start_lon=item["start_lon"],
                       shift_start=item["shift_start"], shift_end=item["shift_end"], skills=Skill(item["skills"]),
                       transport=Transport(item["transport"]), equipment=tuple(item.get("equipment", ())),
                       available=item.get("available", True), available_from=item.get("available_from", 0),
                       current_lat=item.get("current_lat"), current_lon=item.get("current_lon"),
                       region_id=item.get("region_id", "")) for item in payload["teams"])
    return ProblemData(requests, teams)


def _apply_event_history(problem: ProblemData, events) -> ProblemData:
    requests = {request.id: request for request in problem.requests}
    for event in events:
        payload = event.payload
        if payload.get("event_type") == ReplanningEventType.STATUS_CHANGED.value and payload.get("request_id") is not None:
            request = requests.get(payload["request_id"])
            if request is not None and payload.get("status"):
                requests[request.id] = __import__("dataclasses", fromlist=["replace"]).replace(
                    request, status=RequestStatus(payload["status"]))
        elif payload.get("event_type") == ReplanningEventType.NEW_EMERGENCY.value and payload.get("request"):
            request = _request_from_input(__import__("app.api.schemas", fromlist=["RequestInput"]).RequestInput(**payload["request"]))
            requests[request.id] = __import__("dataclasses", fromlist=["replace"]).replace(
                request, status=RequestStatus.NEW, work_type=WorkType.EMERGENCY,
                priority=priority_for(WorkType.EMERGENCY), service_duration=service_duration_for(WorkType.EMERGENCY),
                release_time=event.event_time, window_start=max(request.window_start, event.event_time))
    return ProblemData(tuple(requests.values()), problem.teams)


def _solution_payload(solution) -> dict:
    return {"routes": [{"team_id": route.team_id, "request_ids": route.request_ids,
                         "total_distance": route.total_distance, "total_travel_time": route.total_travel_time,
                         "schedule": [asdict(stop) for stop in route.schedule]}
                        for route in solution.routes], "unassigned": solution.unassigned}


def _solution_from_payload(payload: dict):
    routes = [Route(item["team_id"], list(item["request_ids"]),
                    [Stop(**stop) for stop in item.get("schedule", [])], item.get("total_distance", 0.0),
                    item.get("total_travel_time", 0)) for item in payload["routes"]]
    return __import__("app.domain.models", fromlist=["Solution"]).Solution(routes, list(payload["unassigned"]), None, False)


def _plan_response(plan_id: str, parent_plan_id: str | None, solution, metrics: dict, verified: bool,
                   diff: dict | None = None, solver_config: dict | None = None,
                   solver_version: str = SOLVER_VERSION, routing_source: str = ROUTING_SOURCE):
    result = {"plan_id": plan_id, "parent_plan_id": parent_plan_id, "verified": verified,
              "solver_config": solver_config or {}, "solver_version": solver_version,
              "routing_source": routing_source, "metrics": metrics, "routes": [{"team_id": route.team_id, "request_ids": route.request_ids,
              "distance_km": round(route.total_distance, 3), "stops": [asdict(stop) for stop in route.schedule]}
             for route in solution.routes], "unassigned_requests": solution.unassigned}
    if diff is not None:
        result["diff"] = diff
    return result


@router.post("/optimize")
def optimize(payload: OptimizeInput, http_request: HttpRequest):
    api_started = time.perf_counter()
    input_started = time.perf_counter()
    requests = tuple(_request_from_input(item) for item in payload.requests)
    teams = tuple(_team_from_input(item) for item in payload.teams)
    problem = ProblemData(requests, teams)
    input_preparation_ms = round((time.perf_counter() - input_started) * 1000, 3)
    config_values = payload.solver_config or {}
    if payload.solver == "baseline" and not config_values:
        config_values = SolverConfig(use_vnd=False, use_alns=False, use_ejection=False, use_beam=False,
                                     use_route_elimination=False, multi_start=1).to_dict()
    config = SolverConfig.from_dict(config_values)
    started = time.perf_counter()
    travel = HaversineTravelMatrix()
    try:
        solution = solve_by_mode(payload.solver, problem, travel, config)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail="solver could not produce a verified solution") from error
    runtime_ms = round((time.perf_counter() - started) * 1000, 3)
    verifier_started = time.perf_counter()
    verification = verify_solution(problem, solution, travel)
    verifier_ms = round((time.perf_counter() - verifier_started) * 1000, 3)
    solution.valid = verification.valid
    if not verification.valid:
        raise HTTPException(status_code=503, detail="solver returned a solution rejected by verifier")
    metrics = solution_metrics(solution)
    metrics["runtime_ms"] = runtime_ms
    solver_stats = dict(getattr(solution, "solver_stats", {}) or {})
    metrics["solver_engine"] = solver_stats.get("engine", str(payload.solver))
    if "fallback_reason" in solver_stats:
        metrics["fallback_reason"] = solver_stats["fallback_reason"]
    phase_timings = {str(name): round(float(value), 3)
                     for name, value in dict(solver_stats.get("phase_timings_ms", {})).items()}
    phase_timings["input_preparation"] = input_preparation_ms
    phase_timings["python_verifier"] = verifier_ms
    metrics["phase_timings_ms"] = phase_timings
    metrics["cpp_execution_ms"] = round(float(solver_stats.get("cpp_execution_ms", runtime_ms if payload.solver == "cpp" else 0.0)), 3)
    metrics["python_cpp_conversion_ms"] = round(float(solver_stats.get("python_cpp_conversion_ms", 0.0)), 3)
    metrics["verifier_ms"] = verifier_ms
    metrics["profile_counters"] = solver_stats.get("profile_counters", {})
    metrics["route_pool_size"] = int(solver_stats.get("route_pool_size", 0))
    plan_id = str(uuid4())
    db_started = time.perf_counter()
    with http_request.app.state.session_factory() as session:
        PlanRepository(session).save_plan(plan_id, None, _problem_payload(problem), _solution_payload(solution),
                                           metrics, solution.valid, 0, config.to_dict(),
                                           "baseline-v1" if payload.solver == "baseline" else SOLVER_VERSION,
                                           ROUTING_SOURCE)
    db_persistence_ms = round((time.perf_counter() - db_started) * 1000, 3)
    phase_timings["db_persistence"] = db_persistence_ms
    metrics["db_persistence_ms"] = db_persistence_ms
    api_latency_ms = round((time.perf_counter() - api_started) * 1000, 3)
    phase_timings["api_latency"] = api_latency_ms
    metrics["api_latency_ms"] = api_latency_ms
    return _plan_response(plan_id, None, solution, metrics, solution.valid,
                          solver_config=config.to_dict(),
                          solver_version="baseline-v1" if payload.solver == "baseline" else SOLVER_VERSION,
                          routing_source=ROUTING_SOURCE)


@router.get("/plans/{plan_id}")
def get_plan(plan_id: str, http_request: HttpRequest):
    with http_request.app.state.session_factory() as session:
        row = PlanRepository(session).get_plan(plan_id)
        if row is None:
            raise HTTPException(status_code=404, detail="plan not found")
        solution = _solution_from_payload(row.solution_payload)
        return _plan_response(row.id, row.parent_plan_id, solution, row.metrics_payload, row.verified,
                              solver_config=row.solver_config, solver_version=row.solver_version,
                              routing_source=row.routing_source)


@router.post("/plans/{plan_id}/events")
def create_plan_event(plan_id: str, payload: PlanEventInput, http_request: HttpRequest):
    with http_request.app.state.session_factory() as session:
        repository = PlanRepository(session)
        if repository.get_plan(plan_id) is None:
            raise HTTPException(status_code=404, detail="plan not found")
        event_time = parse_minutes(payload.event_time)
        event_payload = payload.model_dump()
        row = repository.save_event(plan_id, event_time, event_payload)
        return {"event_id": row.id, "plan_id": plan_id, "event_time": event_time, **event_payload}


@router.post("/plans/{plan_id}/replan")
def replan_plan(plan_id: str, payload: ReplanInput, http_request: HttpRequest):
    with http_request.app.state.session_factory() as session:
        repository = PlanRepository(session)
        parent = repository.get_plan(plan_id)
        if parent is None:
            raise HTTPException(status_code=404, detail="plan not found")
        event = repository.get_event(payload.event_id) if payload.event_id else repository.latest_event(plan_id)
        if event is None:
            raise HTTPException(status_code=400, detail="plan has no event")
        problem = _apply_event_history(_problem_from_payload(parent.problem_payload), repository.events(plan_id))
        current_plan = _solution_from_payload(parent.solution_payload)
        event_payload = event.payload
        event_request = None
        if event_payload.get("request"):
            event_request = _request_from_input(__import__("app.api.schemas", fromlist=["RequestInput"]).RequestInput(**event_payload["request"]))
        event_object = ReplanningEvent(event_payload["event_type"], event_payload.get("request_id"),
                                       RequestStatus(event_payload["status"]) if event_payload.get("status") else None,
                                       event_request)
        current_time = parse_minutes(payload.current_time) if payload.current_time is not None else event.event_time
        config = SolverConfig.from_dict(parent.solver_config)
        result = ReplanningService(config=config).replan(problem, current_plan, current_time, event_object)
        if not result.verification.valid:
            raise HTTPException(status_code=503, detail="replanned solution rejected by verifier")
        new_plan_id = str(uuid4())
        after_metrics = solution_metrics(result.plan)
        diff_payload = {"reassigned_request_ids": list(result.diff.reassigned_request_ids),
                        "time_changed_request_ids": list(result.diff.time_changed_request_ids),
                        "route_changed_team_ids": list(result.diff.route_changed_team_ids),
                        "cancelled_request_ids": list(result.diff.cancelled_request_ids),
                        "new_request_ids": list(result.diff.new_request_ids)}
        repository.save_plan(new_plan_id, plan_id, _problem_payload(problem), _solution_payload(result.plan),
                             after_metrics, result.verification.valid, current_time,
                             config.to_dict(), parent.solver_version, parent.routing_source)
        repository.save_diff(new_plan_id, event.id, diff_payload)
        response = _plan_response(new_plan_id, plan_id, result.plan, after_metrics, result.verification.valid, diff_payload,
                                  config.to_dict(), parent.solver_version, parent.routing_source)
        response["event_id"] = event.id
        response["event_time"] = event.event_time
        response["metrics_before"] = parent.metrics_payload
        response["metrics_after"] = after_metrics
        return response


@router.get("/plans/{plan_id}/diff")
def get_plan_diff(plan_id: str, http_request: HttpRequest):
    with http_request.app.state.session_factory() as session:
        repository = PlanRepository(session)
        if repository.get_plan(plan_id) is None:
            raise HTTPException(status_code=404, detail="plan not found")
        diff = repository.get_diff(plan_id)
        if diff is None:
            raise HTTPException(status_code=404, detail="diff not found")
        return {"plan_id": plan_id, "event_id": diff.event_id, **diff.payload}


@router.get("/plans/{plan_id}/requests/{request_id}/explanation")
def get_request_explanation(plan_id: str, request_id: int, http_request: HttpRequest):
    with http_request.app.state.session_factory() as session:
        repository = PlanRepository(session)
        row = repository.get_plan(plan_id)
        if row is None:
            raise HTTPException(status_code=404, detail="plan not found")
        problem = _problem_from_payload(row.problem_payload)
        if request_id not in {request.id for request in problem.requests}:
            raise HTTPException(status_code=404, detail="request not found in plan snapshot")
        solution = _solution_from_payload(row.solution_payload)
        parent_problem = parent_solution = event_payload = diff_payload = None
        if row.parent_plan_id:
            parent = repository.get_plan(row.parent_plan_id)
            diff = repository.get_diff(plan_id)
            if parent is not None:
                parent_problem = _problem_from_payload(parent.problem_payload)
                parent_solution = _solution_from_payload(parent.solution_payload)
            if diff is not None:
                diff_payload = diff.payload
                event = repository.get_event(diff.event_id) if diff.event_id else None
                event_payload = event.payload if event else None
        explanation = ExplainabilityService(HaversineTravelMatrix()).explain(
            problem, solution, request_id, parent_problem, parent_solution, event_payload, diff_payload)
        explanation["plan_id"] = plan_id
        explanation["verified"] = row.verified
        return explanation


@router.post("/benchmark")
def benchmark(payload: OptimizeInput):
    requests = tuple(_request_from_input(item) for item in payload.requests)
    teams = tuple(_team_from_input(item) for item in payload.teams)
    return {"results": benchmark_dataset(ProblemData(requests, teams), HaversineTravelMatrix())}
