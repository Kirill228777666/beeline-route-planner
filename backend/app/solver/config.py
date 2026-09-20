from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


SOLVER_VERSION = "cpp-solver-v1.0.2"
ROUTING_SOURCE = "haversine_synthetic"


@dataclass(frozen=True)
class SolverConfig:
    time_limit_ms: int = 3000
    seed: int = 42
    use_vnd: bool = True
    use_alns: bool = True
    use_ejection: bool = True
    use_beam: bool = True
    use_route_pool: bool = False
    use_team_minimization: bool = False
    multi_start: int = 2
    iteration_limit: int = 0
    use_route_elimination: bool = True
    use_exact_neighborhood: bool = False
    exact_neighborhood_max_routes: int = 6
    exact_neighborhood_node_limit: int = 5000
    exact_neighborhood_ejection_depth: int = 2

    def __post_init__(self) -> None:
        if self.time_limit_ms < 0:
            raise ValueError("time_limit_ms must be non-negative")
        if self.multi_start < 1:
            raise ValueError("multi_start must be at least 1")
        if self.iteration_limit < 0:
            raise ValueError("iteration_limit must be non-negative")
        if not 3 <= self.exact_neighborhood_max_routes <= 6:
            raise ValueError("exact_neighborhood_max_routes must be between 3 and 6")
        if self.exact_neighborhood_node_limit < 1:
            raise ValueError("exact_neighborhood_node_limit must be positive")
        if not 0 <= self.exact_neighborhood_ejection_depth <= 4:
            raise ValueError("exact_neighborhood_ejection_depth must be between 0 and 4")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, values: dict[str, Any] | None) -> "SolverConfig":
        if not values:
            return cls()
        allowed = {field for field in cls.__dataclass_fields__}
        return cls(**{key: value for key, value in values.items() if key in allowed})
