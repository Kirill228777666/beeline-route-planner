from app.domain.models import ProblemData, Request, RequestStatus, Skill, Team, Transport, WorkType
from app.geo.travel import HaversineTravelMatrix
from app.services.explainability import ExplainabilityService
from app.solver.common import materialize_solution


def test_explanation_uses_constraint_engine_reason_codes_for_alternatives():
    request = Request(101, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.75, 37.61,
                      540, 540, 900, 30, Skill.REPAIR)
    problem = ProblemData((request,), (
        Team(7, "repair", 55.75, 37.60, 540, 1000, Skill.REPAIR, Transport.CAR),
        Team(4, "connection", 55.75, 37.60, 540, 1000, Skill.CONNECTION, Transport.CAR),
    ))
    solution = materialize_solution({7: [101]}, problem, HaversineTravelMatrix())
    explanation = ExplainabilityService(HaversineTravelMatrix()).explain(problem, solution, 101)
    assert explanation["team_id"] == 7
    assert explanation["arrival"] is not None
    assert any(item["code"] == "SKILL" and item["passed"] for item in explanation["hard_constraints"])
    alternative = next(item for item in explanation["alternatives"] if item["team_id"] == 4)
    assert alternative["rejected_reason"] == "NO_SKILL"


def test_explanation_uses_section_label_and_reports_unavailable_team():
    request = Request(101, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.75, 37.61,
                      540, 540, 900, 30, Skill.REPAIR, region_id="section_1")
    unavailable = Team(4, "offline", 55.75, 37.60, 540, 1000, Skill.REPAIR, Transport.CAR,
                       available=False, region_id="section_1")
    problem = ProblemData((request,), (unavailable,))
    explanation = ExplainabilityService(HaversineTravelMatrix()).explain(
        problem, materialize_solution({}, problem, HaversineTravelMatrix()), 101)

    assert {item["code"] for item in explanation["hard_constraints"]} == {"ASSIGNMENT"}
    assert explanation["alternatives"] == [{"team_id": 4, "rejected_reason": "TEAM_UNAVAILABLE"}]

    assigned = ProblemData((request,), (Team(7, "repair", 55.75, 37.60, 540, 1000,
                                              Skill.REPAIR, Transport.CAR, region_id="section_1"),))
    assigned_solution = materialize_solution({7: [101]}, assigned, HaversineTravelMatrix())
    assigned_explanation = ExplainabilityService(HaversineTravelMatrix()).explain(
        assigned, assigned_solution, 101)
    assert any(item["code"] == "SECTION" and item["passed"] for item in assigned_explanation["hard_constraints"])
