import json
from pathlib import Path

from app.api.routes import _request_from_input, _team_from_input
from app.api.schemas import RequestInput, TeamInput
from app.constraints.verifier import verify_solution
from app.domain.models import ProblemData
from app.geo.travel import HaversineTravelMatrix
from app.solver.config import SolverConfig
from app.solver.modes import solve_by_mode


DATASETS = Path(__file__).resolve().parents[2] / "frontend" / "public" / "datasets"


def test_exact_neighborhood_config_is_bounded_and_verifier_safe():
    config = SolverConfig(time_limit_ms=500, seed=42, use_exact_neighborhood=True,
                          exact_neighborhood_max_routes=3, exact_neighborhood_node_limit=250)
    assert SolverConfig.from_dict(config.to_dict()) == config
    payload = json.loads((DATASETS / "zone_3.json").read_text(encoding="utf-8"))
    problem = ProblemData(
        tuple(_request_from_input(RequestInput(**item)) for item in payload["requests"]),
        tuple(_team_from_input(TeamInput(**item)) for item in payload["teams"]),
    )
    solution = solve_by_mode("cpp", problem, HaversineTravelMatrix(), config)
    assert solution.valid is True
    assert verify_solution(problem, solution, HaversineTravelMatrix()).valid
