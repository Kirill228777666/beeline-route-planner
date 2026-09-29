from app.constraints.schedule import calculate_schedule
from app.domain.models import Request, RequestStatus, Skill, Team, Transport, WorkType
from app.geo.travel import HaversineTravelMatrix


def make_request(**kwargs):
    values = dict(id=1, source_bk="", source_hd="", work_type=WorkType.REPAIR,
                  status=RequestStatus.NEW, priority=1, district="", address="A",
                  lat=55.75, lon=37.61, created_at=540, window_start=600,
                  window_end=720, service_duration=60, required_skills=Skill.REPAIR)
    values.update(kwargs)
    return Request(**values)


def make_team(**kwargs):
    values = dict(id=1, name="T", start_lat=55.75, start_lon=37.61,
                  shift_start=540, shift_end=720, skills=Skill.REPAIR,
                  transport=Transport.CAR, available=True, available_from=540)
    values.update(kwargs)
    return Team(**values)


def test_early_arrival_waits_until_window_start():
    result = calculate_schedule(make_team(), [make_request()], HaversineTravelMatrix())
    assert result.valid
    assert result.stops[0].arrival <= 600
    assert result.stops[0].start == 600
    assert result.stops[0].waiting >= 0


def test_service_that_finishes_after_shift_is_invalid():
    result = calculate_schedule(make_team(shift_end=630), [make_request(service_duration=60)], HaversineTravelMatrix())
    assert not result.valid


def test_release_time_delays_departure_so_arrival_is_not_historical():
    travel = HaversineTravelMatrix()
    team = make_team(available_from=600, shift_end=1000)
    request = make_request(lat=55.76, lon=37.62, window_start=600, window_end=900, release_time=797)

    result = calculate_schedule(team, [request], travel)

    assert result.valid
    stop = result.stops[0]
    assert stop.arrival >= request.release_time
    assert stop.start >= request.release_time
    assert stop.finish > stop.start
