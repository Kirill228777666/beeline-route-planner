from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.main import create_app


DATASET = ROOT / "frontend" / "public" / "datasets" / "zone_1.json"


def main() -> None:
    payload = json.loads(DATASET.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="beeline-flow-") as directory:
        database = Path(directory) / "flow.db"
        url = f"sqlite:///{database}"

        first_app = create_app(url)
        with TestClient(first_app) as client:
            optimize = client.post("/api/optimize", json={
                **payload,
                "solver": "cpp",
                "solver_config": {
                    "time_limit_ms": 1000,
                    "seed": 42,
                    "use_vnd": True,
                    "use_alns": True,
                    "use_ejection": True,
                    "use_beam": True,
                    "use_route_elimination": True,
                    "multi_start": 2,
                },
            })
            assert optimize.status_code == 200, optimize.text
            parent = optimize.json()
            assert parent["verified"] is True

            assigned_request_id = payload["requests"][0]["id"]
            explanation = client.get(
                f"/api/plans/{parent['plan_id']}/requests/{assigned_request_id}/explanation"
            )
            assert explanation.status_code == 200, explanation.text
            assert explanation.json()["verified"] is True

            event = client.post(
                f"/api/plans/{parent['plan_id']}/events",
                json={
                    "event_type": "STATUS_CHANGED",
                    "event_time": "13:17",
                    "request_id": assigned_request_id,
                    "status": "CANCELLED",
                },
            )
            assert event.status_code == 200, event.text
            child_response = client.post(
                f"/api/plans/{parent['plan_id']}/replan",
                json={"current_time": "13:17", "event_id": event.json()["event_id"]},
            )
            assert child_response.status_code == 200, child_response.text
            child = child_response.json()
            assert child["verified"] is True
            assert child["parent_plan_id"] == parent["plan_id"]
            diff = client.get(f"/api/plans/{child['plan_id']}/diff")
            assert diff.status_code == 200, diff.text
            child_id = child["plan_id"]
        first_app.state.engine.dispose()

        restarted_app = create_app(url)
        with TestClient(restarted_app) as client:
            restored = client.get(f"/api/plans/{child_id}")
            assert restored.status_code == 200, restored.text
            restored_body = restored.json()
            assert restored_body["verified"] is True
            assert restored_body["parent_plan_id"] == parent["plan_id"]
            restored_explanation = client.get(
                f"/api/plans/{child_id}/requests/{payload['requests'][1]['id']}/explanation"
            )
            assert restored_explanation.status_code == 200, restored_explanation.text
        restarted_app.state.engine.dispose()
        print(json.dumps({
            "parent_plan_id": parent["plan_id"],
            "child_plan_id": child_id,
            "parent_verified": parent["verified"],
            "child_verified": child["verified"],
            "restart_restore": True,
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
