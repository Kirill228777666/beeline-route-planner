from datetime import datetime


def parse_minutes(value: str | int) -> int:
    if isinstance(value, int):
        return value
    value = value.strip()
    for fmt in ("%d.%m.%Y %H:%M", "%Y-%m-%d %H:%M", "%H:%M"):
        try:
            return datetime.strptime(value, fmt).hour * 60 + datetime.strptime(value, fmt).minute
        except ValueError:
            continue
    raise ValueError(f"Unsupported time value: {value!r}")
