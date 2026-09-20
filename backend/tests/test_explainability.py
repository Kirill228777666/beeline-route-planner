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
