from dataclasses import dataclass, replace

from app.domain.models import Request, RequestStatus, Stop, Team


@dataclass(frozen=True)
class ScheduleResult:
    valid: bool
    stops: tuple[Stop, ...]
    total_distance: float
    total_travel_time: int
    error: str | None = None


def calculate_schedule(team: Team, requests: list[Request], travel) -> ScheduleResult:
    previous = None
    fixed_statuses = {RequestStatus.COMPLETED, RequestStatus.IN_PROGRESS, RequestStatus.ON_THE_WAY}
    fixed_prefix_length = 0
    while fixed_prefix_length < len(requests) and requests[fixed_prefix_length].status in fixed_statuses:
        fixed_prefix_length += 1
    has_fixed_prefix = fixed_prefix_length > 0
    if has_fixed_prefix:
        previous_finish = max(team.shift_start, team.initial_available_from
                              if team.initial_available_from is not None else team.available_from)
        from_lat, from_lon = team.start_lat, team.start_lon
    else:
        previous_finish = max(team.shift_start, team.available_from)
        from_lat = team.current_lat if team.current_lat is not None else team.start_lat
        from_lon = team.current_lon if team.current_lon is not None else team.start_lon
    stops: list[Stop] = []
    total_distance = 0.0
    total_travel_time = 0
    for request in requests:
        if has_fixed_prefix and len(stops) == fixed_prefix_length:
            previous_finish = max(previous_finish, team.available_from)
            from_lat = team.current_lat if team.current_lat is not None else (previous.lat if previous else team.start_lat)
            from_lon = team.current_lon if team.current_lon is not None else (previous.lon if previous else team.start_lon)
            previous = None
        if previous is not None:
            travel_time, distance = travel.from_request(previous, request, team.transport.value)
        else:
            travel_time, distance = travel.from_team(replace(team, start_lat=from_lat, start_lon=from_lon), request)
        arrival = max(previous_finish, request.release_time) + travel_time
        start = max(arrival, request.window_start, request.release_time)
        finish = start + request.service_duration
        if start > request.window_end:
            return ScheduleResult(False, tuple(stops), total_distance, total_travel_time, f"request {request.id} starts after its window")
        if finish > team.shift_end:
            return ScheduleResult(False, tuple(stops), total_distance, total_travel_time, f"request {request.id} finishes after team shift")
        stops.append(Stop(request.id, arrival, start, finish, travel_time, distance, start - arrival))
        total_distance += distance
        total_travel_time += travel_time
        previous, previous_finish = request, finish
    return ScheduleResult(True, tuple(stops), total_distance, total_travel_time)
