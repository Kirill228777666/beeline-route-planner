from dataclasses import dataclass

from app.domain.models import Request, Stop, Team


@dataclass(frozen=True)
class ScheduleResult:
    valid: bool
    stops: tuple[Stop, ...]
    total_distance: float
    total_travel_time: int
    error: str | None = None


def calculate_schedule(team: Team, requests: list[Request], travel) -> ScheduleResult:
    previous = None
    previous_finish = max(team.shift_start, team.available_from)
    stops: list[Stop] = []
    total_distance = 0.0
    total_travel_time = 0
    for request in requests:
        if previous is None:
            travel_time, distance = travel.from_team(team, request)
        else:
            travel_time, distance = travel.from_request(previous, request, team.transport.value)
        arrival = previous_finish + travel_time
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
