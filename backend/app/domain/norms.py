from dataclasses import dataclass

from app.domain.models import Skill, WorkType


@dataclass(frozen=True)
class WorkNorm:
    technical_minutes: int
    documents_minutes: int
    travel_norm_minutes: int = 20

    @property
    def service_duration(self) -> int:
        return self.technical_minutes + self.documents_minutes

    @property
    def total_norm(self) -> int:
        return self.travel_norm_minutes + self.service_duration


WORK_NORMS: dict[WorkType, WorkNorm] = {
    WorkType.CONNECTION: WorkNorm(60, 10),
    WorkType.EMERGENCY: WorkNorm(80, 0),
    WorkType.ADD_ON: WorkNorm(10, 10),
    WorkType.REPAIR: WorkNorm(30, 0),
}

WORK_TYPE_PRIORITY: dict[WorkType, int] = {
    WorkType.EMERGENCY: 3,
    WorkType.CONNECTION: 2,
    WorkType.REPAIR: 1,
    WorkType.ADD_ON: 1,
}

DEFAULT_SKILL: dict[WorkType, Skill] = {
    WorkType.EMERGENCY: Skill.EMERGENCY,
    WorkType.CONNECTION: Skill.CONNECTION,
    WorkType.REPAIR: Skill.LOCAL,
    WorkType.ADD_ON: Skill.CONNECTION,
}


def normalize_work_type(value: WorkType | str) -> WorkType:
    raw = value.value if isinstance(value, WorkType) else str(value)
    key = raw.strip().upper().replace("-", "_").replace(" ", "_")
    aliases = {
        "ADDITIONAL_ORDER": WorkType.ADD_ON,
        "ADDITIONAL": WorkType.ADD_ON,
        "ADDON": WorkType.ADD_ON,
        "LOCAL": WorkType.REPAIR,
    }
    if key in aliases:
        return aliases[key]
    return WorkType[key]


def norm_for(value: WorkType | str) -> WorkNorm:
    return WORK_NORMS[normalize_work_type(value)]


def service_duration_for(value: WorkType | str) -> int:
    return norm_for(value).service_duration


def total_norm_for(value: WorkType | str) -> int:
    return norm_for(value).total_norm


def priority_for(value: WorkType | str) -> int:
    return WORK_TYPE_PRIORITY[normalize_work_type(value)]


def default_skill_for(value: WorkType | str) -> Skill:
    return DEFAULT_SKILL[normalize_work_type(value)]
