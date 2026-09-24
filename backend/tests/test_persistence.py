from sqlalchemy import select

from app.db.models import DatasetRow
from app.db.repositories import DatasetRepository
from app.db.session import Base, make_session_factory
from app.api.routes import _problem_from_payload, _problem_payload
from app.constraints.engine import ConstraintEngine
from app.domain.models import ProblemData, Request, RequestStatus, Skill, Team, Transport, WorkType


def test_dataset_repository_persists_dataset():
    engine, factory = make_session_factory("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with factory() as session:
        DatasetRepository(session).save("day-1", "Demo", [{"id": 1}], [])
        assert session.scalar(select(DatasetRow).where(DatasetRow.id == "day-1")).name == "Demo"


def test_legacy_plan_payload_without_region_restores_as_blank_to_blank_only():
    problem = ProblemData(
        (Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.75, 37.61,
                 540, 540, 900, 30, Skill.REPAIR),),
        (Team(1, "T", 55.75, 37.60, 540, 900, Skill.REPAIR, Transport.CAR),),
    )
    legacy_payload = _problem_payload(problem)
    legacy_payload["requests"][0].pop("region_id")
    legacy_payload["teams"][0].pop("region_id")
    restored = _problem_from_payload(legacy_payload)
    assert restored.requests[0].region_id == ""
    assert restored.teams[0].region_id == ""
    assert ConstraintEngine().team_compatible(restored.teams[0], restored.requests[0]).allowed


def test_payload_restores_canonical_section_while_retaining_legacy_region_key():
    problem = ProblemData(
        (Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "district_a", "A", 55.75, 37.61,
                 540, 540, 900, 30, Skill.REPAIR, region_id="section_1"),),
        (Team(1, "T", 55.75, 37.60, 540, 900, Skill.REPAIR, Transport.CAR,
              region_id="section_1", district="district_b"),),
    )
    payload = _problem_payload(problem)
    payload["requests"][0]["section_id"] = "section_1"
    payload["requests"][0]["region_id"] = "legacy_section"
    payload["teams"][0]["section_id"] = "section_1"
    payload["teams"][0]["region_id"] = "legacy_section"
    restored = _problem_from_payload(payload)

    assert restored.requests[0].section_id == "section_1"
    assert restored.teams[0].section_id == "section_1"
    assert restored.teams[0].district == "district_b"
