from app.domain.models import *
from app.geo.travel import HaversineTravelMatrix
from app.solver.baseline import BaselineSolver


def test_baseline_assigns_in_input_order_to_first_feasible_team():
    req = Request(1, "", "", WorkType.REPAIR, RequestStatus.NEW, 1, "", "A", 55.75, 37.61,
                  540, 540, 720, 30, Skill.REPAIR)
    teams = (Team(1, "first", 55.75, 37.61, 540, 720, Skill.REPAIR, Transport.CAR),
             Team(2, "second", 55.75, 37.61, 540, 720, Skill.REPAIR, Transport.CAR))
    solution = BaselineSolver().solve(ProblemData((req,), teams), HaversineTravelMatrix())
    assert solution.unassigned == []
    assert solution.routes[0].team_id == 1
    assert solution.valid

