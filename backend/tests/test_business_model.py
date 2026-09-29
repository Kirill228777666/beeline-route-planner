from io import StringIO

from app.constraints.schedule import calculate_schedule
from app.domain.models import Request, RequestStatus, Skill, Team, Transport, WorkType
from app.domain.norms import (
    default_skill_for,
    priority_for,
    service_duration_for,
    total_norm_for,
)
from app.domain.models import Skill
from app.geo.travel import HaversineTravelMatrix
from app.importer.csv_parser import parse_csv


def test_official_norms_keep_travel_out_of_service_duration():
    expected = {
        WorkType.CONNECTION: (70, 90),
        WorkType.EMERGENCY: (80, 100),
        WorkType.ADD_ON: (20, 40),
        WorkType.REPAIR: (30, 50),
    }
    for work_type, (service, total) in expected.items():
        assert service_duration_for(work_type) == service
        assert total_norm_for(work_type) == total
        assert 20 + service_duration_for(work_type) == total


def test_bk_hd_are_source_fields_and_do_not_determine_work_type():
    data = StringIO(
        "ID;Адрес;BK;HD;work_type;Начало;Окончание;Широта;Долгота\n"
        "1;A;EMERGENCY;CONNECTION;REPAIR;09:00;18:00;55.75;37.61\n"
        "2;B;Авария;Подключение;;09:00;18:00;55.75;37.61\n"
    )
    problem = parse_csv(data)
    assert [request.work_type for request in problem.requests] == [WorkType.REPAIR, WorkType.REPAIR]
    assert problem.requests[0].source_bk == "EMERGENCY"
    assert problem.requests[0].source_hd == "CONNECTION"


def test_official_priority_order():
    assert priority_for(WorkType.EMERGENCY) > priority_for(WorkType.CONNECTION)
    assert priority_for(WorkType.CONNECTION) > priority_for(WorkType.REPAIR)
    assert priority_for(WorkType.REPAIR) == priority_for(WorkType.ADD_ON)


def test_required_skill_catalogue_matches_source_specification():
    assert {skill.name for skill in Skill} == {"LOCAL", "CONNECTION", "EMERGENCY"}
    assert default_skill_for(WorkType.REPAIR) == Skill.LOCAL
    assert default_skill_for(WorkType.ADD_ON) == Skill.CONNECTION


def test_release_time_is_a_hard_lower_bound_for_emergency():
    request = Request(1, "", "", WorkType.EMERGENCY, RequestStatus.NEW, 3, "", "A",
                      55.75, 37.61, 540, 540, 900, 80, Skill.EMERGENCY,
                      release_time=650)
    team = Team(1, "T", 55.75, 37.61, 540, 900, Skill.EMERGENCY, Transport.CAR)
    result = calculate_schedule(team, [request], HaversineTravelMatrix())
    assert result.valid
    assert result.stops[0].start >= 650
