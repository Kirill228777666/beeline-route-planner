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


def _section_id(item) -> str:
    return (getattr(item, "section_id", "") or getattr(item, "region_id", "") or "").strip()


def _payload_section_id(item: dict) -> str:
    return (item.get("section_id") or item.get("region_id") or "").strip()


def _request_from_input(item, status: RequestStatus = RequestStatus.NEW) -> Request:
    work_type = normalize_work_type(item.work_type)
    required_skills = _skills(item.required_skills) or default_skill_for(work_type)
    release_time = parse_minutes(item.release_time) if item.release_time is not None else 0
    window_start = max(parse_minutes(item.window_start), release_time)
    return Request(id=item.id, source_bk="", source_hd="", work_type=work_type, status=status,
                   priority=priority_for(work_type),
                   district=item.district, address=item.address, lat=item.lat, lon=item.lon,
                   created_at=window_start, window_start=window_start,
                   window_end=parse_minutes(item.window_end), service_duration=service_duration_for(work_type),
                   required_skills=required_skills, release_time=release_time,
                   required_transport=Transport[item.required_transport] if item.required_transport else None,
                   required_equipment=tuple(item.required_equipment), region_id=_section_id(item))


def _team_from_input(item) -> Team:
    shift_start = parse_minutes(item.shift_start)
    available_from = parse_minutes(item.available_from) if item.available_from is not None else shift_start
    return Team(id=item.id, name=item.name, start_lat=item.start_lat, start_lon=item.start_lon,
                shift_start=shift_start, shift_end=parse_minutes(item.shift_end),
                skills=_skills(item.skills), transport=Transport[item.transport], equipment=tuple(item.equipment),
                available=item.available,
                available_from=available_from, current_lat=item.current_lat, current_lon=item.current_lon,
                region_id=_section_id(item), district=item.district,
                initial_available_from=available_from)


def _problem_payload(problem: ProblemData) -> dict:
    return {"requests": [_request_payload(request) for request in problem.requests],
            "teams": [_team_payload(team) for team in problem.teams]}


def _request_payload(request: Request) -> dict:
    return {"id": request.id, "source_bk": request.source_bk, "source_hd": request.source_hd,
            "work_type": request.work_type.value, "status": request.status.value, "priority": request.priority,
            "district": request.district, "address": request.address, "lat": request.lat, "lon": request.lon,
            "created_at": request.created_at, "window_start": request.window_start, "window_end": request.window_end,
            "service_duration": request.service_duration, "required_skills": int(request.required_skills),
            "release_time": request.release_time, "section_id": request.section_id, "region_id": request.region_id,
            "required_transport": request.required_transport.value if request.required_transport else None,
            "required_equipment": list(request.required_equipment), "gigabit": request.gigabit, "fmc": request.fmc}


def _team_payload(team: Team) -> dict:
    return {"id": team.id, "name": team.name, "start_lat": team.start_lat, "start_lon": team.start_lon,
            "shift_start": team.shift_start, "shift_end": team.shift_end, "skills": int(team.skills),
            "transport": team.transport.value, "equipment": list(team.equipment), "available": team.available,
            "available_from": team.available_from, "current_lat": team.current_lat, "current_lon": team.current_lon,
            "section_id": team.section_id, "region_id": team.region_id, "district": team.district,
            "initial_available_from": team.initial_available_from}


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
                             region_id=_payload_section_id(item)) for item in payload["requests"])
    teams = tuple(Team(id=item["id"], name=item["name"], start_lat=item["start_lat"], start_lon=item["start_lon"],
                       shift_start=item["shift_start"], shift_end=item["shift_end"], skills=Skill(item["skills"]),
                       transport=Transport(item["transport"]), equipment=tuple(item.get("equipment", ())),
                       available=item.get("available", True), available_from=item.get("available_from", 0),
                       current_lat=item.get("current_lat"), current_lon=item.get("current_lon"),
                       region_id=_payload_section_id(item), district=item.get("district", ""),
                       initial_available_from=item.get("initial_available_from", item.get("available_from", 0)))
                   for item in payload["teams"])
    return ProblemData(requests, teams)


def _apply_event_history(problem: ProblemData, events) -> ProblemData:
    requests = {request.id: request for request in problem.requests}
    teams = {team.id: team for team in problem.teams}
    for event in events:
        payload = event.payload
        if payload.get("event_type") == ReplanningEventType.STATUS_CHANGED.value and payload.get("request_id") is not None:
            request = requests.get(payload["request_id"])
            if request is not None and payload.get("status"):
                status = RequestStatus(payload["status"])
                changes = {"status": status}
                if status == RequestStatus.ON_THE_WAY:
                    changes["release_time"] = max(request.release_time, event.event_time)
                    changes["window_start"] = max(request.window_start, event.event_time)
                requests[request.id] = __import__("dataclasses", fromlist=["replace"]).replace(request, **changes)
        elif payload.get("event_type") == ReplanningEventType.NEW_EMERGENCY.value and payload.get("request"):
            request = _request_from_input(__import__("app.api.schemas", fromlist=["RequestInput"]).RequestInput(**payload["request"]))
            requests[request.id] = __import__("dataclasses", fromlist=["replace"]).replace(
                request, status=RequestStatus.NEW, work_type=WorkType.EMERGENCY,
                priority=priority_for(WorkType.EMERGENCY), service_duration=service_duration_for(WorkType.EMERGENCY),
                release_time=event.event_time, window_start=max(request.window_start, event.event_time))
        elif payload.get("event_type") == ReplanningEventType.TEAM_UNAVAILABLE.value and payload.get("team_id") is not None:
            team = teams.get(payload["team_id"])
            if team is not None:
                teams[team.id] = __import__("dataclasses", fromlist=["replace"]).replace(team, available=False)
    return ProblemData(tuple(requests.values()), tuple(teams.values()))


def _event_time(value, field_name: str) -> int:
    try:
        return parse_minutes(value)
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=f"invalid {field_name}: {error}") from error


def _validate_status_event(problem: ProblemData, solution, events, request_id: int,
                           status: RequestStatus, event_time: int) -> None:
    effective = _apply_event_history(problem, events)
    request_map = {request.id: request for request in effective.requests}
    request = request_map.get(request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="request not found in plan")

    current = request.status
    if current in {RequestStatus.COMPLETED, RequestStatus.CANCELLED}:
        raise HTTPException(status_code=422, detail=f"terminal request status {current.value}")
    if status == current or status in {RequestStatus.NEW, RequestStatus.ASSIGNED}:
        raise HTTPException(status_code=422, detail="status transition must move forward")
    if status != RequestStatus.CANCELLED:
        progress = {RequestStatus.NEW: 0, RequestStatus.ASSIGNED: 0,
                    RequestStatus.ON_THE_WAY: 1, RequestStatus.IN_PROGRESS: 2,
                    RequestStatus.COMPLETED: 3}
        if progress[status] <= progress[current]:
            raise HTTPException(status_code=422, detail="status transition must move forward")

    stops = {stop.request_id: stop for route in solution.routes for stop in route.schedule}
    stop = stops.get(request_id)
    if status in {RequestStatus.ON_THE_WAY, RequestStatus.IN_PROGRESS, RequestStatus.COMPLETED} and stop is None:
        raise HTTPException(status_code=422, detail=f"{status.value} requires an assigned scheduled request")
    if stop is not None and status == RequestStatus.ON_THE_WAY and event_time > stop.start:
        raise HTTPException(status_code=422, detail="ON_THE_WAY cannot follow planned start")
    if stop is not None and status == RequestStatus.IN_PROGRESS and not stop.start <= event_time < stop.finish:
        raise HTTPException(status_code=422, detail="IN_PROGRESS must fall within the planned work interval")
    if stop is not None and status == RequestStatus.COMPLETED and event_time < stop.finish:
        raise HTTPException(status_code=422, detail="COMPLETED cannot precede planned finish")


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
        problem = _problem_from_payload(row.problem_payload)
        solution = _solution_from_payload(row.solution_payload)
        verification = verify_solution(problem, solution, HaversineTravelMatrix())
        if not row.verified or not verification.valid:
            raise HTTPException(status_code=503, detail="stored plan failed independent verification")
        return _plan_response(row.id, row.parent_plan_id, solution, row.metrics_payload, verification.valid,
                              solver_config=row.solver_config, solver_version=row.solver_version,
                              routing_source=row.routing_source)


@router.post("/plans/{plan_id}/events")
def create_plan_event(plan_id: str, payload: PlanEventInput, http_request: HttpRequest):
    with http_request.app.state.session_factory() as session:
        repository = PlanRepository(session)
        plan = repository.get_plan(plan_id)
        if plan is None:
            raise HTTPException(status_code=404, detail="plan not found")
        event_time = _event_time(payload.event_time, "event_time")
        events = repository.events(plan_id)
        if events and event_time < events[-1].event_time:
            raise HTTPException(status_code=422, detail="event_time cannot precede a previous plan event")
        problem = _problem_from_payload(plan.problem_payload)
        solution = _solution_from_payload(plan.solution_payload)
        event_payload = payload.model_dump(mode="json")
        if payload.event_type == ReplanningEventType.STATUS_CHANGED.value:
            _validate_status_event(problem, solution, events, payload.request_id, payload.status, event_time)
        elif payload.event_type == ReplanningEventType.NEW_EMERGENCY.value:
            try:
                _request_from_input(payload.request)
            except (KeyError, TypeError, ValueError) as error:
                raise HTTPException(status_code=422, detail=f"invalid emergency request: {error}") from error
            existing_ids = {request.id for request in _apply_event_history(problem, events).requests}
            if payload.request.id in existing_ids:
                raise HTTPException(status_code=422, detail="emergency request id already exists in plan")
        else:
            team = next((team for team in problem.teams if team.id == payload.team_id), None)
            if team is None:
                raise HTTPException(status_code=404, detail="team not found in plan")
            if not team.available:
                raise HTTPException(status_code=422, detail="team is already unavailable")
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
        if event.plan_id != plan_id:
            raise HTTPException(status_code=404, detail="event not found in plan")
        events = repository.events(plan_id)
        current_time = _event_time(payload.current_time, "current_time") if payload.current_time is not None else event.event_time
        if events and current_time < max(item.event_time for item in events):
            raise HTTPException(status_code=422, detail="current_time cannot precede a plan event")
        try:
            problem = _apply_event_history(_problem_from_payload(parent.problem_payload), events)
        except (KeyError, ValueError, TypeError) as error:
            raise HTTPException(status_code=422, detail=f"invalid stored event history: {error}") from error
        current_plan = _solution_from_payload(parent.solution_payload)
        event_payload = event.payload
        event_request = None
        if event_payload.get("request"):
            event_request = _request_from_input(__import__("app.api.schemas", fromlist=["RequestInput"]).RequestInput(**event_payload["request"]))
        event_object = ReplanningEvent(event_payload["event_type"], event_payload.get("request_id"),
                                       RequestStatus(event_payload["status"]) if event_payload.get("status") else None,
                                       event_request, event.event_time, event_payload.get("team_id"))
        config = SolverConfig.from_dict(parent.solver_config)
        try:
            result = ReplanningService(config=config).replan(problem, current_plan, current_time, event_object)
        except (KeyError, ValueError, TypeError) as error:
            raise HTTPException(status_code=422, detail=f"invalid replanning event: {error}") from error
        if not result.verification.valid:
            raise HTTPException(status_code=503, detail="replanned solution rejected by verifier")
        new_plan_id = str(uuid4())
        after_metrics = solution_metrics(result.plan)
        diff_payload = {"reassigned_request_ids": list(result.diff.reassigned_request_ids),
                        "time_changed_request_ids": list(result.diff.time_changed_request_ids),
                        "route_changed_team_ids": list(result.diff.route_changed_team_ids),
                        "cancelled_request_ids": list(result.diff.cancelled_request_ids),
                        "new_request_ids": list(result.diff.new_request_ids)}
        repository.save_plan(new_plan_id, plan_id, _problem_payload(result.problem), _solution_payload(result.plan),
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
