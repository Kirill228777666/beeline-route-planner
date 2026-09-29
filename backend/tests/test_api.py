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
            {"id": 2, "address": "B", "lat": 55.751, "lon": 37.611, "window_start": "15:00", "window_end": "18:00", "service_duration": 30, "required_skills": ["REPAIR"]},
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
    parent_stops = {stop["request_id"]: stop for route in parent["routes"] for stop in route["stops"]}
    child_stops = {stop["request_id"]: stop for route in body["routes"] for stop in route["stops"]}
    assert (child_stops[1]["start"], child_stops[1]["finish"]) == (parent_stops[1]["start"], parent_stops[1]["finish"])
    assert child_stops[2]["arrival"] >= 13 * 60 + 17
    child_routes = {route["team_id"]: route["request_ids"] for route in body["routes"]}
    for team_id, route_ids in child_routes.items():
        expected_fixed = [request_id for parent_route in parent["routes"]
                          if parent_route["team_id"] == team_id
                          for request_id in parent_route["request_ids"] if request_id in {1, 2}]
        actual_fixed = [request_id for request_id in route_ids if request_id in {1, 2}]
        assert actual_fixed == expected_fixed
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


def _small_saved_plan(client, skills=None, request_id=501, team_id=601):
    skills = skills or ["REPAIR"]
    response = client.post("/api/optimize", json={
        "requests": [{"id": request_id, "address": "A", "lat": 55.75, "lon": 37.61,
                      "window_start": "09:00", "window_end": "18:00", "service_duration": 30,
                      "required_skills": ["REPAIR"]}],
        "teams": [{"id": team_id, "name": "T", "start_lat": 55.75, "start_lon": 37.61,
                   "shift_start": "09:00", "shift_end": "18:00", "skills": skills, "transport": "CAR"}],
    })
    assert response.status_code == 200
    return response.json()


def test_event_api_rejects_unknown_request_without_storing_event():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    response = client.post(f"/api/plans/{plan['plan_id']}/events", json={
        "event_type": "STATUS_CHANGED", "event_time": "13:17", "request_id": 999,
        "status": "CANCELLED",
    })
    assert response.status_code == 404


def test_event_api_rejects_unknown_status_and_event_type():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    path = f"/api/plans/{plan['plan_id']}/events"
    unknown_status = client.post(path, json={
        "event_type": "STATUS_CHANGED", "event_time": "13:17", "request_id": 501,
        "status": "SOME_STATUS",
    })
    unknown_type = client.post(path, json={"event_type": "MAGIC", "event_time": "13:17"})
    assert unknown_status.status_code == 422
    assert unknown_type.status_code == 422


def test_team_unavailable_event_reassigns_future_work_and_verifies_fixed_work():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = client.post("/api/optimize", json={
        "requests": [
            {"id": 701, "address": "Fixed", "lat": 55.75, "lon": 37.61,
             "window_start": "13:00", "window_end": "14:00", "service_duration": 30,
             "required_skills": ["REPAIR"]},
            {"id": 702, "address": "Future", "lat": 55.751, "lon": 37.611,
             "window_start": "14:00", "window_end": "18:00", "service_duration": 30,
             "required_skills": ["REPAIR"]},
        ],
        "teams": [
            {"id": 711, "name": "Unavailable", "start_lat": 55.75, "start_lon": 37.61,
             "shift_start": "09:00", "shift_end": "18:00", "skills": ["REPAIR"], "transport": "CAR"},
            {"id": 712, "name": "Available", "start_lat": 55.75, "start_lon": 37.61,
             "shift_start": "09:00", "shift_end": "18:00", "skills": ["REPAIR"], "transport": "CAR"},
        ],
    }).json()
    route_for_fixed = next(route for route in plan["routes"] if 701 in route["request_ids"])
    status_event = client.post(f"/api/plans/{plan['plan_id']}/events", json={
        "event_type": "STATUS_CHANGED", "event_time": "13:00", "request_id": 701,
        "status": "IN_PROGRESS",
    })
    assert status_event.status_code == 200
    unavailable_event = client.post(f"/api/plans/{plan['plan_id']}/events", json={
        "event_type": "TEAM_UNAVAILABLE", "event_time": "13:17", "team_id": route_for_fixed["team_id"],
        "reason": "vehicle failure",
    })
    assert unavailable_event.status_code == 200, unavailable_event.text
    replanned = client.post(f"/api/plans/{plan['plan_id']}/replan", json={"current_time": "13:17"})
    assert replanned.status_code == 200, replanned.text
    body = replanned.json()
    assert body["verified"] is True
    assert client.get(f"/api/plans/{plan['plan_id']}").json()["verified"] is True
    restored = client.get(f"/api/plans/{body['plan_id']}")
    assert restored.status_code == 200, restored.text
    assert restored.json()["verified"] is True
    assignment = {rid: route["team_id"] for route in body["routes"] for rid in route["request_ids"]}
    assert assignment[701] == route_for_fixed["team_id"]
    assert assignment.get(702) != route_for_fixed["team_id"]
    explanation = client.get(f"/api/plans/{body['plan_id']}/requests/702/explanation")
    assert explanation.status_code == 200
    assert {item["rejected_reason"] for item in explanation.json()["alternatives"]} >= {"TEAM_UNAVAILABLE"}


def test_team_unavailable_event_rejects_unknown_team():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    response = client.post(f"/api/plans/{plan['plan_id']}/events", json={
        "event_type": "TEAM_UNAVAILABLE", "event_time": "13:17", "team_id": 9999,
        "reason": "not on shift",
    })
    assert response.status_code == 404


def test_api_rejects_skill_not_in_source_specification():
    client = TestClient(create_app(), raise_server_exceptions=False)
    response = client.post("/api/optimize", json={
        "requests": [{"id": 501, "address": "A", "lat": 55.75, "lon": 37.61,
                      "window_start": "09:00", "window_end": "18:00", "service_duration": 30,
                      "required_skills": ["GIGABIT"]}],
        "teams": [{"id": 601, "name": "T", "start_lat": 55.75, "start_lon": 37.61,
                   "shift_start": "09:00", "shift_end": "18:00", "skills": ["LOCAL"], "transport": "CAR"}],
    })
    assert response.status_code == 422


def test_request_has_one_canonical_skill_and_team_aliases_are_deduplicated():
    from pydantic import ValidationError

    with __import__("pytest").raises(ValidationError):
        RequestInput(id=1, lat=55.75, lon=37.61, window_start="09:00", window_end="12:00",
                     service_duration=30, required_skills=["LOCAL", "CONNECTION"])
    request = RequestInput(id=2, lat=55.75, lon=37.61, window_start="09:00", window_end="12:00",
                           service_duration=30, required_skills=["REPAIR", "LOCAL"])
    team = TeamInput(id=1, name="T", start_lat=55.75, start_lon=37.61, shift_start="09:00",
                     shift_end="18:00", skills=["LOCAL", "REPAIR", "CONNECTION", "EMERGENCY"])
    assert request.required_skills == ["LOCAL"]
    assert team.skills == ["LOCAL", "CONNECTION", "EMERGENCY"]


def test_optimize_rejects_unknown_work_type_and_transport_as_client_errors():
    client = TestClient(create_app(), raise_server_exceptions=False)
    base = {
        "requests": [{"id": 1, "lat": 55.75, "lon": 37.61, "window_start": "09:00",
                      "window_end": "12:00", "service_duration": 30, "work_type": "REPAIR"}],
        "teams": [{"id": 2, "name": "T", "start_lat": 55.75, "start_lon": 37.61,
                   "shift_start": "09:00", "shift_end": "18:00", "skills": ["LOCAL"],
                   "transport": "CAR"}],
    }
    bad_work = {**base, "requests": [{**base["requests"][0], "work_type": "UNKNOWN"}]}
    bad_transport = {**base, "teams": [{**base["teams"][0], "transport": "TELEPORT"}]}
    assert client.post("/api/optimize", json=bad_work).status_code == 422
    assert client.post("/api/optimize", json=bad_transport).status_code == 422


def test_restored_plan_is_reverified_instead_of_trusting_persisted_flag():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    with client.app.state.session_factory() as session:
        row = __import__("app.db.repositories", fromlist=["PlanRepository"]).PlanRepository(session).get_plan(plan["plan_id"])
        corrupted_route = {**row.solution_payload["routes"][0], "schedule": [],
                           "total_distance": 0.0, "total_travel_time": 0}
        row.solution_payload = {**row.solution_payload, "routes": [corrupted_route]}
        session.commit()
    restored = client.get(f"/api/plans/{plan['plan_id']}")
    assert restored.status_code == 503


def test_event_api_rejects_completed_before_planned_start_and_backwards_transition():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    path = f"/api/plans/{plan['plan_id']}/events"
    before_start = client.post(path, json={
        "event_type": "STATUS_CHANGED", "event_time": "08:00", "request_id": 501,
        "status": "COMPLETED",
    })
    assert before_start.status_code == 422
    completed = client.post(path, json={
        "event_type": "STATUS_CHANGED", "event_time": "13:17", "request_id": 501,
        "status": "COMPLETED",
    })
    assert completed.status_code == 200
    backwards = client.post(path, json={
        "event_type": "STATUS_CHANGED", "event_time": "13:18", "request_id": 501,
        "status": "IN_PROGRESS",
    })
    assert backwards.status_code == 422


def test_event_api_rejects_invalid_event_time():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    response = client.post(f"/api/plans/{plan['plan_id']}/events", json={
        "event_type": "STATUS_CHANGED", "event_time": "tomorrow-ish", "request_id": 501,
        "status": "CANCELLED",
    })
    assert response.status_code == 422


def test_event_api_rejects_request_from_another_plan_and_duplicate_emergency():
    client = TestClient(create_app(), raise_server_exceptions=False)
    first = _small_saved_plan(client)
    second = _small_saved_plan(client, request_id=503, team_id=603)
    wrong_plan_request = client.post(f"/api/plans/{first['plan_id']}/events", json={
        "event_type": "STATUS_CHANGED", "event_time": "13:17", "request_id": 503,
        "status": "CANCELLED",
    })
    emergency_payload = {
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 502, "address": "Emergency", "lat": 55.751, "lon": 37.611,
                    "window_start": "13:17", "window_end": "18:00", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    }
    first_event = client.post(f"/api/plans/{first['plan_id']}/events", json=emergency_payload)
    duplicate = client.post(f"/api/plans/{first['plan_id']}/events", json=emergency_payload)
    foreign_event_replan = client.post(f"/api/plans/{second['plan_id']}/replan", json={
        "event_id": first_event.json()["event_id"],
    })
    assert wrong_plan_request.status_code == 404
    assert first_event.status_code == 200
    assert duplicate.status_code == 422
    assert foreign_event_replan.status_code == 404


def test_event_api_rejects_non_monotonic_status_event_time():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    path = f"/api/plans/{plan['plan_id']}/events"
    first = client.post(path, json={
        "event_type": "STATUS_CHANGED", "event_time": "08:00", "request_id": 501,
        "status": "ON_THE_WAY",
    })
    earlier = client.post(path, json={
        "event_type": "STATUS_CHANGED", "event_time": "07:59", "request_id": 501,
        "status": "IN_PROGRESS",
    })
    assert first.status_code == 200
    assert earlier.status_code == 422


def test_replan_rejects_current_time_before_emergency_event_time():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    event = client.post(f"/api/plans/{plan['plan_id']}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 502, "address": "Emergency", "lat": 55.751, "lon": 37.611,
                    "window_start": "13:17", "window_end": "18:00", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    })
    assert event.status_code == 200
    response = client.post(f"/api/plans/{plan['plan_id']}/replan", json={"current_time": "13:00"})
    assert response.status_code == 422


def test_emergency_arrival_uses_event_time_and_current_dispatch_time():
    client = TestClient(create_app())
    plan = _small_saved_plan(client, ["REPAIR", "EMERGENCY"])
    event = client.post(f"/api/plans/{plan['plan_id']}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 502, "address": "Emergency", "lat": 55.751, "lon": 37.611,
                    "window_start": "13:17", "window_end": "18:00", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    })
    assert event.status_code == 200
    child = client.post(f"/api/plans/{plan['plan_id']}/replan", json={"current_time": "13:20"})
    assert child.status_code == 200, child.text
    stop = next(stop for route in child.json()["routes"] for stop in route["stops"]
                if stop["request_id"] == 502)
    assert child.json()["verified"] is True
    assert stop["arrival"] >= 797
    assert stop["start"] >= 797
    assert stop["finish"] > stop["start"]


def test_emergency_event_with_bad_request_time_is_not_persisted():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    response = client.post(f"/api/plans/{plan['plan_id']}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 502, "address": "Emergency", "lat": 55.751, "lon": 37.611,
                    "window_start": "noon", "window_end": "18:00", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    })
    assert response.status_code == 422


def test_child_plan_persists_replanning_team_snapshot_for_restore_verification():
    from app.api.routes import _problem_from_payload, _solution_from_payload
    from app.constraints.verifier import verify_solution
    from app.db.repositories import PlanRepository
    from app.geo.travel import HaversineTravelMatrix

    client = TestClient(create_app())
    initial = client.post("/api/optimize", json={
        "solver": "regret_vnd", "requests": [],
        "teams": [{"id": 701, "name": "T", "start_lat": 55.70, "start_lon": 37.50,
                   "current_lat": 55.72, "current_lon": 37.53,
                   "shift_start": "09:00", "shift_end": "18:00",
                   "skills": ["EMERGENCY"], "transport": "CAR"}],
    })
    assert initial.status_code == 200
    parent_id = initial.json()["plan_id"]
    event = client.post(f"/api/plans/{parent_id}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 702, "address": "Emergency", "lat": 55.721, "lon": 37.531,
                    "window_start": "13:17", "window_end": "18:00", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    })
    assert event.status_code == 200
    child = client.post(f"/api/plans/{parent_id}/replan", json={"current_time": "13:20"})
    assert child.status_code == 200, child.text

    with client.app.state.session_factory() as session:
        row = PlanRepository(session).get_plan(child.json()["plan_id"])
        restored_problem = _problem_from_payload(row.problem_payload)
        restored_solution = _solution_from_payload(row.solution_payload)
    verification = verify_solution(restored_problem, restored_solution, HaversineTravelMatrix())
    assert verification.valid, verification.errors


def test_emergency_route_starts_from_supplied_current_team_position():
    client = TestClient(create_app())
    parent = client.post("/api/optimize", json={
        "solver": "baseline", "requests": [],
        "teams": [{"id": 771, "name": "Moved", "start_lat": 55.70, "start_lon": 37.50,
                   "current_lat": 55.721, "current_lon": 37.531,
                   "shift_start": "09:00", "shift_end": "18:00", "skills": ["EMERGENCY"],
                   "transport": "CAR"}],
    })
    assert parent.status_code == 200
    plan_id = parent.json()["plan_id"]
    event = client.post(f"/api/plans/{plan_id}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 772, "address": "At current position", "lat": 55.721, "lon": 37.531,
                    "window_start": "13:17", "window_end": "18:00", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    })
    child = client.post(f"/api/plans/{plan_id}/replan", json={"current_time": "13:20", "event_id": event.json()["event_id"]})
    assert child.status_code == 200, child.text
    stop = next(stop for route in child.json()["routes"] for stop in route["stops"] if stop["request_id"] == 772)
    assert child.json()["verified"] is True
    assert stop["arrival"] >= 13 * 60 + 17
    assert stop["travel_time"] == 0


def test_busy_teams_are_not_interrupted_when_free_team_can_take_emergency():
    client = TestClient(create_app())
    initial = client.post("/api/optimize", json={
        "solver": "baseline",
        "requests": [
            {"id": 801, "address": "Active local", "lat": 55.75, "lon": 37.61,
             "window_start": "13:00", "window_end": "15:00", "service_duration": 30,
             "work_type": "REPAIR", "required_skills": ["LOCAL"]},
            {"id": 802, "address": "Active connection", "lat": 55.751, "lon": 37.611,
             "window_start": "13:00", "window_end": "15:30", "service_duration": 70,
             "work_type": "CONNECTION", "required_skills": ["CONNECTION"]},
            {"id": 803, "address": "Future local", "lat": 55.752, "lon": 37.612,
             "window_start": "16:00", "window_end": "18:00", "service_duration": 30,
             "work_type": "REPAIR", "required_skills": ["LOCAL"]},
        ],
        "teams": [
            {"id": 811, "name": "A", "start_lat": 55.75, "start_lon": 37.60,
             "shift_start": "09:00", "shift_end": "18:00", "skills": ["LOCAL"], "transport": "CAR"},
            {"id": 812, "name": "B", "start_lat": 55.75, "start_lon": 37.60,
             "shift_start": "09:00", "shift_end": "18:00", "skills": ["CONNECTION"], "transport": "CAR"},
            {"id": 813, "name": "C", "start_lat": 55.75, "start_lon": 37.60,
             "shift_start": "09:00", "shift_end": "18:00", "skills": ["EMERGENCY"], "transport": "CAR"},
        ],
    })
    assert initial.status_code == 200
    plan_id = initial.json()["plan_id"]
    for request_id in (801, 802):
        response = client.post(f"/api/plans/{plan_id}/events", json={
            "event_type": "STATUS_CHANGED", "event_time": "13:17", "request_id": request_id,
            "status": "IN_PROGRESS",
        })
        assert response.status_code == 200
    event = client.post(f"/api/plans/{plan_id}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 804, "address": "Emergency", "lat": 55.753, "lon": 37.613,
                    "window_start": "13:17", "window_end": "18:00", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    })
    assert event.status_code == 200
    child = client.post(f"/api/plans/{plan_id}/replan", json={"current_time": "13:17"})
    assert child.status_code == 200, child.text
    body = child.json()
    routes = {route["team_id"]: route["request_ids"] for route in body["routes"]}
    assignment = {rid: team_id for team_id, ids in routes.items() for rid in ids}
    assert body["verified"] is True
    assert assignment[801] == 811
    assert assignment[802] == 812
    assert assignment[804] == 813
    assert routes[811][0] == 801
    assert routes[812][0] == 802
    assert 803 in routes[811]


def test_emergency_is_queued_after_fixed_work_when_every_team_is_busy():
    client = TestClient(create_app())
    initial = client.post("/api/optimize", json={
        "solver": "baseline",
        "requests": [
            {"id": 851, "address": "Active A", "lat": 55.75, "lon": 37.61,
             "window_start": "13:00", "window_end": "15:00", "service_duration": 30,
             "work_type": "REPAIR", "required_skills": ["LOCAL"]},
            {"id": 852, "address": "Active B", "lat": 55.751, "lon": 37.611,
             "window_start": "13:00", "window_end": "15:00", "service_duration": 30,
             "work_type": "CONNECTION", "required_skills": ["CONNECTION"]},
        ],
        "teams": [
            {"id": 861, "name": "A", "start_lat": 55.75, "start_lon": 37.60,
             "shift_start": "09:00", "shift_end": "18:00", "skills": ["LOCAL", "EMERGENCY"], "transport": "CAR"},
            {"id": 862, "name": "B", "start_lat": 55.75, "start_lon": 37.60,
             "shift_start": "09:00", "shift_end": "18:00", "skills": ["CONNECTION", "EMERGENCY"], "transport": "CAR"},
        ],
    })
    assert initial.status_code == 200
    parent = initial.json()
    plan_id = parent["plan_id"]
    assignment = {rid: route["team_id"] for route in parent["routes"] for rid in route["request_ids"]}
    for request_id in (851, 852):
        event = client.post(f"/api/plans/{plan_id}/events", json={
            "event_type": "STATUS_CHANGED", "event_time": "13:17", "request_id": request_id,
            "status": "IN_PROGRESS",
        })
        assert event.status_code == 200, event.text
    event = client.post(f"/api/plans/{plan_id}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 853, "address": "Emergency", "lat": 55.752, "lon": 37.612,
                    "window_start": "13:17", "window_end": "17:00", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    })
    assert event.status_code == 200
    child = client.post(f"/api/plans/{plan_id}/replan", json={"current_time": "13:17"})
    assert child.status_code == 200, child.text
    body = child.json()
    routes = {route["team_id"]: route for route in body["routes"]}
    new_assignment = {rid: route["team_id"] for route in body["routes"] for rid in route["request_ids"]}
    assert body["verified"] is True
    assert new_assignment[851] == assignment[851]
    assert new_assignment[852] == assignment[852]
    emergency_team = new_assignment[853]
    fixed_request = next(request_id for request_id in (851, 852) if assignment[request_id] == emergency_team)
    route = routes[emergency_team]
    assert route["request_ids"].index(853) > route["request_ids"].index(fixed_request)
    stop = next(stop for stop in route["stops"] if stop["request_id"] == 853)
    assert stop["start"] >= 13 * 60 + 17


def test_on_the_way_status_cannot_be_reported_after_planned_start():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    response = client.post(f"/api/plans/{plan['plan_id']}/events", json={
        "event_type": "STATUS_CHANGED", "event_time": "13:17", "request_id": 501,
        "status": "ON_THE_WAY",
    })
    assert response.status_code == 422


def test_status_timestamps_must_match_the_planned_work_interval():
    client = TestClient(create_app(), raise_server_exceptions=False)
    plan = _small_saved_plan(client)
    path = f"/api/plans/{plan['plan_id']}/events"
    in_progress_too_early = client.post(path, json={
        "event_type": "STATUS_CHANGED", "event_time": "08:30", "request_id": 501,
        "status": "IN_PROGRESS",
    })
    completed_too_early = client.post(path, json={
        "event_type": "STATUS_CHANGED", "event_time": "09:20", "request_id": 501,
        "status": "COMPLETED",
    })
    assert in_progress_too_early.status_code == 422
    assert completed_too_early.status_code == 422


def test_completed_work_future_request_and_emergency_keep_feasible_priority_order():
    client = TestClient(create_app())
    initial = client.post("/api/optimize", json={
        "solver": "baseline",
        "requests": [
            {"id": 821, "address": "Completed", "lat": 55.75, "lon": 37.61,
             "window_start": "09:00", "window_end": "10:00", "service_duration": 30,
             "work_type": "REPAIR", "required_skills": ["LOCAL"]},
            {"id": 822, "address": "Future", "lat": 55.752, "lon": 37.612,
             "window_start": "16:00", "window_end": "18:00", "service_duration": 30,
             "work_type": "REPAIR", "required_skills": ["LOCAL"]},
        ],
        "teams": [{"id": 831, "name": "A", "start_lat": 55.75, "start_lon": 37.60,
                   "shift_start": "09:00", "shift_end": "18:00",
                   "skills": ["LOCAL", "EMERGENCY"], "transport": "CAR"}],
    })
    assert initial.status_code == 200
    plan_id = initial.json()["plan_id"]
    completed = client.post(f"/api/plans/{plan_id}/events", json={
        "event_type": "STATUS_CHANGED", "event_time": "13:17", "request_id": 821,
        "status": "COMPLETED",
    })
    assert completed.status_code == 200
    event = client.post(f"/api/plans/{plan_id}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 823, "address": "Emergency", "lat": 55.751, "lon": 37.611,
                    "window_start": "13:17", "window_end": "15:00", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    })
    assert event.status_code == 200
    child = client.post(f"/api/plans/{plan_id}/replan", json={"current_time": "13:17"})
    assert child.status_code == 200, child.text
    route = child.json()["routes"][0]
    assert route["request_ids"] == [821, 823, 822]
    assert child.json()["verified"] is True


def test_unavailable_team_is_not_called_for_emergency_replan():
    client = TestClient(create_app())
    initial = client.post("/api/optimize", json={
        "solver": "baseline", "requests": [],
        "teams": [{"id": 841, "name": "Unavailable", "start_lat": 55.75, "start_lon": 37.61,
                   "shift_start": "09:00", "shift_end": "18:00", "skills": ["EMERGENCY"],
                   "transport": "CAR", "available": False}],
    })
    assert initial.status_code == 200
    plan_id = initial.json()["plan_id"]
    event = client.post(f"/api/plans/{plan_id}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 842, "address": "Emergency", "lat": 55.751, "lon": 37.611,
                    "window_start": "13:17", "window_end": "18:00", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    })
    assert event.status_code == 200
    child = client.post(f"/api/plans/{plan_id}/replan", json={"current_time": "13:17"})
    assert child.status_code == 200, child.text
    assert child.json()["unassigned_requests"] == [842]
    assert child.json()["verified"] is True
    explanation = client.get(f"/api/plans/{child.json()['plan_id']}/requests/842/explanation")
    assert explanation.status_code == 200
    assert explanation.json()["alternatives"] == [{"team_id": 841, "rejected_reason": "TEAM_UNAVAILABLE"}]


def test_future_available_team_does_not_hide_a_team_available_now():
    client = TestClient(create_app())
    initial = client.post("/api/optimize", json={
        "solver": "baseline", "requests": [],
        "teams": [
            {"id": 851, "name": "Later", "start_lat": 55.75, "start_lon": 37.61,
             "shift_start": "09:00", "shift_end": "18:00", "available_from": "15:00",
             "skills": ["EMERGENCY"], "transport": "CAR"},
            {"id": 852, "name": "Now", "start_lat": 55.75, "start_lon": 37.61,
             "shift_start": "09:00", "shift_end": "18:00", "available_from": "09:00",
             "skills": ["EMERGENCY"], "transport": "CAR"},
        ],
    })
    assert initial.status_code == 200
    plan_id = initial.json()["plan_id"]
    event = client.post(f"/api/plans/{plan_id}/events", json={
        "event_type": "NEW_EMERGENCY", "event_time": "13:17",
        "request": {"id": 853, "address": "Emergency", "lat": 55.751, "lon": 37.611,
                    "window_start": "13:17", "window_end": "14:30", "service_duration": 80,
                    "work_type": "EMERGENCY", "required_skills": ["EMERGENCY"]},
    })
    assert event.status_code == 200
    child = client.post(f"/api/plans/{plan_id}/replan", json={"current_time": "13:17"})
    assert child.status_code == 200, child.text
    assert child.json()["verified"] is True
    assert next(route["team_id"] for route in child.json()["routes"]
                if 853 in route["request_ids"]) == 852
