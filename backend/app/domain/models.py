from dataclasses import dataclass, field
from enum import Enum, IntFlag


class WorkType(str, Enum):
    EMERGENCY = "EMERGENCY"
    CONNECTION = "CONNECTION"
    REPAIR = "REPAIR"
    ADD_ON = "ADD_ON"
    ADDITIONAL_ORDER = "ADD_ON"
    LOCAL = "REPAIR"


class RequestStatus(str, Enum):
    NEW = "NEW"
    ASSIGNED = "ASSIGNED"
    ON_THE_WAY = "ON_THE_WAY"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class Transport(str, Enum):
    CAR = "CAR"
    WALK = "WALK"
    BIKE = "BIKE"
    PUBLIC_TRANSPORT = "PUBLIC_TRANSPORT"


class Skill(IntFlag):
    LOCAL = 1 << 0
    CONNECTION = 1 << 1
    REPAIR = 1 << 2
    EMERGENCY = 1 << 3
    GIGABIT = 1 << 4


@dataclass(frozen=True)
class Request:
    id: int
    source_bk: str
    source_hd: str
    work_type: WorkType
    status: RequestStatus
    priority: int
    district: str
    address: str
    lat: float
    lon: float
    created_at: int
    window_start: int
    window_end: int
    service_duration: int
    required_skills: Skill
    required_transport: Transport | None = None
    required_equipment: tuple[str, ...] = ()
    gigabit: bool = False
    fmc: bool = False
    release_time: int = 0
    region_id: str = ""

    @property
    def section_id(self) -> str:
        return self.region_id


@dataclass(frozen=True)
class Team:
    id: int
    name: str
    start_lat: float
    start_lon: float
    shift_start: int
    shift_end: int
    skills: Skill
    transport: Transport
    equipment: tuple[str, ...] = ()
    available: bool = True
    available_from: int = 0
    current_lat: float | None = None
    current_lon: float | None = None
    region_id: str = ""
    district: str = ""

    @property
    def section_id(self) -> str:
        return self.region_id


@dataclass(frozen=True)
class Stop:
    request_id: int
    arrival: int
    start: int
    finish: int
    travel_time: int
    travel_distance: float
    waiting: int


@dataclass
class Route:
    team_id: int
    request_ids: list[int] = field(default_factory=list)
    schedule: list[Stop] = field(default_factory=list)
    total_distance: float = 0.0
    total_travel_time: int = 0


@dataclass(frozen=True)
class Objective:
    unassigned_emergency: int
    unassigned_connection: int
    unassigned_other: int
    used_teams: int
    total_travel_time: int
    total_distance: float


@dataclass
class Solution:
    routes: list[Route]
    unassigned: list[int]
    objective: Objective | None = None
    valid: bool = False
    solver_stats: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ProblemData:
    requests: tuple[Request, ...]
    teams: tuple[Team, ...]
