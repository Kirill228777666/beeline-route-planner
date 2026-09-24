import csv
from io import TextIOBase

from app.domain.config import parse_minutes
from app.domain.models import ProblemData, Request, RequestStatus, Skill, Team, Transport, WorkType
from app.domain.norms import default_skill_for, normalize_work_type, priority_for, service_duration_for


def _work_type(row: dict[str, str]) -> WorkType:
    for key in ("work_type", "Тип работы", "тип работы", "Работа", "work type"):
        value = (row.get(key) or "").strip()
        if value:
            return normalize_work_type(value)
    return WorkType.REPAIR


def _explicit_skill(row: dict[str, str]) -> Skill | None:
    value = (row.get("required_skills") or row.get("skill") or row.get("Skill") or "").strip()
    if not value:
        return None
    result = Skill(0)
    for item in value.replace(";", ",").split(","):
        item = item.strip()
        if item:
            result |= Skill[item.upper()]
    return result


def _section_id(row: dict[str, str]) -> str:
    return (row.get("section_id") or row.get("section") or row.get("участок") or row.get("Участок") or
            row.get("region_id") or row.get("region") or row.get("office_id") or row.get("Регион") or
            row.get("Офис") or "").strip()


def parse_csv(stream: TextIOBase) -> ProblemData:
    sample = stream.read(4096)
    stream.seek(0)
    delimiter = ";" if sample.count(";") >= sample.count(",") else ","
    rows = csv.DictReader((line for line in stream if line.strip()), delimiter=delimiter)
    requests = []
    for row in rows:
        address = (row.get("Адрес") or row.get("address") or "").strip()
        if not (row.get("ID") or row.get("id")) or "адрес офиса" in address.lower():
            continue
        bk = row.get("BK") or row.get("bk") or ""
        hd = row.get("HD") or row.get("hd") or ""
        work_type = _work_type(row)
        skill = _explicit_skill(row) or default_skill_for(work_type)
        requests.append(Request(
            id=int(row.get("ID") or row.get("id")), source_bk=bk, source_hd=hd,
            work_type=work_type, status=RequestStatus.NEW, priority=priority_for(work_type),
            district=row.get("Район") or row.get("district") or "", address=address,
            lat=float(row.get("Широта") or row.get("lat") or 0), lon=float(row.get("Долгота") or row.get("lon") or 0),
            created_at=parse_minutes(row.get("Начало") or row.get("start") or "00:00"),
            window_start=parse_minutes(row.get("Начало") or row.get("start") or "00:00"), window_end=parse_minutes(row.get("Окончание") or row.get("end") or "23:59"),
            service_duration=service_duration_for(work_type), required_skills=skill,
            region_id=_section_id(row),
        ))
    return ProblemData(tuple(requests), ())
