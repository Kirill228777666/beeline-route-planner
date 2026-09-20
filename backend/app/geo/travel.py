from math import asin, cos, radians, sin, sqrt

from app.domain.models import Request, Team


class HaversineTravelMatrix:
    def __init__(self, speeds_kmh: dict[str, float] | None = None):
        self.speeds_kmh = speeds_kmh or {"CAR": 30.0, "WALK": 5.0, "BIKE": 15.0, "PUBLIC_TRANSPORT": 20.0}

    @staticmethod
    def distance_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
        earth_radius = 6371.0088
        d_lat, d_lon = radians(b_lat - a_lat), radians(b_lon - a_lon)
        h = sin(d_lat / 2) ** 2 + cos(radians(a_lat)) * cos(radians(b_lat)) * sin(d_lon / 2) ** 2
        return 2 * earth_radius * asin(sqrt(h))

    def between(self, from_point: tuple[float, float], to_point: tuple[float, float], transport: str) -> tuple[int, float]:
        distance = self.distance_km(*from_point, *to_point)
        speed = self.speeds_kmh[transport]
        return round(distance / speed * 60), distance

    def from_team(self, team: Team, request: Request) -> tuple[int, float]:
        return self.between((team.start_lat, team.start_lon), (request.lat, request.lon), team.transport.value)

    def from_request(self, previous: Request, request: Request, transport: str) -> tuple[int, float]:
        return self.between((previous.lat, previous.lon), (request.lat, request.lon), transport)
