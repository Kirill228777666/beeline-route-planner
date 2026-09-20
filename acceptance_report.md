# Final Acceptance Report — v1.0.2 FINAL

Date: 2026-09-20  
Scope: `outputs/clean_project` only  
This final correction adds no new search operator. It closes two correctness defects: generic post-VND Regret repair restores feasible work left by construction, and `region_id` is a hard equality constraint in the backend, C++ solver, verifier, persistence, explanations, and replanning. BK/HD remain source fields, work types are normalized to four official values, and service durations exclude travel.

## Clean-start procedure

Before the run, the following were absent from `clean_project`: SQLite database, `.venv`, `frontend/node_modules`, `frontend/dist`, Python caches, egg-info, and C++ extension binary.

Executed from the project root:

```powershell
.\build.ps1
.\start.ps1
```

Build result: exit code `0`; pinned Python dependencies installed, editable backend `1.0.2` installed, C++20 extension built, and Vite production build completed.

Runtime result: backend `http://127.0.0.1:8000` and frontend `http://127.0.0.1:5173` both returned HTTP `200` during the smoke check.

## Tests and flows

The business-model regression tests and the complete backend/C++ suite pass after the correction: `55 passed`.

The full suite included `backend/tests` and `cpp_solver/tests`. The documented flow script returned:

```json
{
  "parent_verified": true,
  "child_verified": true,
  "restart_restore": true
}
```

Malformed `POST /api/optimize` returned `422`; a subsequent `GET /openapi.json` returned `200`, confirming request errors do not crash the backend.

## Dataset acceptance

| Dataset | Requests | Baseline | Optimized | Verified |
|---|---:|---:|---:|:---:|
| zone_1 | 66 | 55/66, 12 teams | 66/66, 7 teams | true |
| zone_2 | 83 | 70/83, 12 teams | 83/83, 9 teams | true |
| zone_3 | 56 | 43/56, 11 teams | **56/56, 7 teams** | **true** |
| combined | 205 | 168/205, 35 teams | **205/205, 24 teams** | **true** |

The optimized combined response persisted `solver_version=cpp-solver-v1.0.2`, `routing_source=haversine_synthetic`, and `solver_config.seed=42`. It has `0` cross-region assignments. The restart flow restored the child plan and its metadata from clean SQLite. All measured solutions were checked by the independent Python verifier.

## Release decision

`clean_project` is frozen as `v1.0.2 FINAL`. The source snapshot is intentionally free of generated binaries, virtualenvs, frontend dependencies, build output, and local databases. Recreate them only with `build.ps1`; start only with `start.ps1`.
