from datetime import datetime

from app.domain.models import Request, RequestStatus, Skill, Team, Transport, WorkType
from app.domain.config import parse_minutes


def test_parse_minutes_from_datetime_string():
    assert parse_minutes("17.08.2026 18:00") == 1080
    assert parse_minutes("09:05") == 545


def test_request_and_team_keep_explicit_hard_constraint_fields():
    request = Request(
        id=1,
        source_bk="Подключение",
        source_hd="",
        work_type=WorkType.CONNECTION,
        status=RequestStatus.NEW,
        priority=2,
        district="Центр",
        address="Москва",
        lat=55.75,
        lon=37.61,
        created_at=540,
        window_start=600,
        window_end=720,
        service_duration=90,
        required_skills=Skill.CONNECTION,
        required_transport=Transport.CAR,
        required_equipment=(),
    )
    team = Team(
        id=7,
        name="Бригада 7",
        start_lat=55.75,
        start_lon=37.61,
        shift_start=540,
        shift_end=1260,
        skills=Skill.CONNECTION | Skill.REPAIR,
        transport=Transport.CAR,
        equipment=(),
        available=True,
        available_from=540,
    )
    assert request.required_skills & team.skills == request.required_skills
    assert request.required_transport == team.transport
