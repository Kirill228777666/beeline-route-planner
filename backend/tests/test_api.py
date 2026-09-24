from fastapi.testclient import TestClient

from app.api.routes import _request_from_input, _team_from_input
from app.api.schemas import RequestInput, TeamInput
from app.main import create_app


def test_health_endpoint():
    client = TestClient(create_app())
    assert client.get("/health").json() == {"status": "ok"}


def test_optimize_endpoint_is_verifier_gated():
    client = TestClient(create_app())
    response = client.post("/api/optimize", json={
        "requests": [{"id": 1, "address": "A", "lat": 55.75, "lon": 37.61,
                      "window_start": "09:00", "window_end": "12:00", "service_duration": 30,
                      "work_type": "REPAIR", "required_skills": ["REPAIR"]}],
        "teams": [{"id": 1, "name": "T", "start_lat": 55.75, "start_lon": 37.61,
                   "shift_start": "09:00", "shift_end": "18:00", "skills": ["REPAIR"], "transport": "CAR"}],
    })
    assert response.status_code == 200
    assert response.json()["verified"] is True
    assert response.json()["metrics"]["assigned"] == 1


def test_regret_vnd_mode_is_available_over_api():
    client = TestClient(create_app())
    response = client.post("/api/optimize", json={
        "solver": "regret_vnd",
        "requests": [{"id": 1, "address": "A", "lat": 55.75, "lon": 37.61,
                      "window_start": "09:00", "window_end": "12:00", "service_duration": 30,
                      "work_type": "REPAIR", "required_skills": ["REPAIR"]}],
        "teams": [{"id": 1, "name": "T", "start_lat": 55.75, "start_lon": 37.61,
                   "shift_start": "09:00", "shift_end": "18:00", "skills": ["REPAIR"], "transport": "CAR"}],
    })
    assert response.status_code == 200
    assert response.json()["verified"] is True


def test_api_persists_region_constraint_and_explains_cross_region_rejection():
    client = TestClient(create_app())
    response = client.post("/api/optimize", json={
        "requests": [{"id": 1, "address": "A", "lat": 55.75, "lon": 37.61,
                      "window_start": "09:00", "window_end": "12:00", "service_duration": 30,
                      "work_type": "REPAIR", "required_skills": ["REPAIR"], "region_id": "zone_1"}],
        "teams": [{"id": 1, "name": "T", "start_lat": 55.75, "start_lon": 37.61,
                   "shift_start": "09:00", "shift_end": "18:00", "skills": ["REPAIR"],
                   "transport": "CAR", "region_id": "zone_2"}],
    })
    assert response.status_code == 200
    body = response.json()
    assert body["verified"] is True
    assert body["unassigned_requests"] == [1]

    explanation = client.get(f"/api/plans/{body['plan_id']}/requests/1/explanation")
    assert explanation.status_code == 200
    assert explanation.json()["alternatives"] == [{"team_id": 1, "rejected_reason": "WRONG_REGION"}]


def test_canonical_section_takes_precedence_and_api_preserves_team_availability():
    request = _request_from_input(RequestInput(
        id=1, address="A", lat=55.75, lon=37.61, window_start="09:00", window_end="12:00",
        service_duration=30, section_id="section_1", region_id="legacy_section",
    ))
    team = _team_from_input(TeamInput(
        id=1, name="T", start_lat=55.75, start_lon=37.61, shift_start="09:00", shift_end="18:00",
        skills=["REPAIR"], section_id="section_1", region_id="legacy_section",
        district="district_b", available=False, available_from="10:30",
    ))

    assert request.section_id == "section_1"
    assert team.section_id == "section_1"
    assert team.district == "district_b"
    assert team.available is False
    assert team.available_from == 630


def test_api_does_not_assign_an_unavailable_team():
    client = TestClient(create_app())
    response = client.post("/api/optimize", json={
        "requests": [{"id": 1, "address": "A", "lat": 55.75, "lon": 37.61,
                      "window_start": "09:00", "window_end": "12:00", "service_duration": 30,
                      "work_type": "REPAIR", "required_skills": ["REPAIR"]}],
        "teams": [{"id": 1, "name": "Unavailable", "start_lat": 55.75, "start_lon": 37.61,
                   "shift_start": "09:00", "shift_end": "18:00", "skills": ["REPAIR"],
                   "transport": "CAR", "available": False}],
    })
    assert response.status_code == 200
    assert response.json()["unassigned_requests"] == [1]


def test_replanning_api_13_17_preserves_completed_and_on_the_way():
    client = TestClient(create_app())
    initial = client.post("/api/optimize", json={
        "solver": "regret_vnd",
        "requests": [
            {"id": 1, "address": "A", "lat": 55.750, "lon": 37.610, "window_start": "09:00", "window_end": "18:00", "service_duration": 30, "required_skills": ["REPAIR"]},
            {"id": 2, "address": "B", "lat": 55.751, "lon": 37.611, "window_start": "09:00", "window_end": "18:00", "service_duration": 30, "required_skills": ["REPAIR"]},
            {"id": 3, "address": "C", "lat": 55.752, "lon": 37.612, "window_start": "09:00", "window_end": "18:00", "service_duration": 30, "required_skills": ["REPAIR"]},
        ],
        "teams": [{"id": 1, "name": "T1", "start_lat": 55.750, "start_lon": 37.600, "shift_start": "09:00", "shift_end": "20:00", "skills": ["REPAIR"], "transport": "CAR"},
                   {"id": 2, "name": "T2", "start_lat": 55.750, "start_lon": 37.600, "shift_start": "09:00", "shift_end": "20:00", "skills": ["REPAIR"], "transport": "CAR"}],
    })
    assert initial.status_code == 200
    parent = initial.json()
    plan_id = parent["plan_id"]
    old_assignment = {request_id: route["team_id"] for route in parent["routes"] for request_id in route["request_ids"]}

    for request_id, status in ((1, "COMPLETED"), (2, "ON_THE_WAY")):
        event = client.post(f"/api/plans/{plan_id}/events", json={
            "event_type": "STATUS_CHANGED", "event_time": "13:17", "request_id": request_id, "status": status,
        })
        assert event.status_code == 200
    emergency = client.post(f"/api/plans/{plan_id}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 4, "address": "D", "lat": 55.753, "lon": 37.613,
                     "window_start": "13:30", "window_end": "18:00", "service_duration": 10,
                     "required_skills": ["REPAIR"]},
    })
    assert emergency.status_code == 200

    replanned = client.post(f"/api/plans/{plan_id}/replan", json={"current_time": "13:17"})
    assert replanned.status_code == 200, replanned.text
    body = replanned.json()
    assert body["parent_plan_id"] == plan_id
    assert body["plan_id"] != plan_id
    assert body["verified"] is True
    assert body["metrics_after"]["assigned"] == 4
    new_assignment = {request_id: route["team_id"] for route in body["routes"] for request_id in route["request_ids"]}
    assert new_assignment[1] == old_assignment[1]
    assert new_assignment[2] == old_assignment[2]
    assert 4 in body["diff"]["new_request_ids"]

    diff = client.get(f"/api/plans/{body['plan_id']}/diff")
    assert diff.status_code == 200
    assert diff.json()["route_changed_team_ids"] == body["diff"]["route_changed_team_ids"]

    explanation = client.get(f"/api/plans/{body['plan_id']}/requests/4/explanation")
    assert explanation.status_code == 200, explanation.text
    explanation_body = explanation.json()
    assert explanation_body["verified"] is True
    assert explanation_body["request_id"] == 4
    assert explanation_body["hard_constraints"]
    assert "replanning_reason" in explanation_body
    assert "аварийной заявки" in explanation_body["replanning_reason"]

    fixed_explanation = client.get(f"/api/plans/{body['plan_id']}/requests/1/explanation")
    assert fixed_explanation.status_code == 200
    assert "replanning_reason" not in fixed_explanation.json()
