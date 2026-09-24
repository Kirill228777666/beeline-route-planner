# Final readiness report

## 1. What was verified

- Operational boundary semantics: a team works only inside its `section_id`; districts are informational.
- Canonical `section_id` accepts and preserves legacy `region_id` compatibility, with canonical data taking precedence.
- Fixed time windows, schedule fields, skills, transport, equipment, availability, and shift constraints.
- Emergency replanning: release time is the event time; IN_PROGRESS work remains fixed and precedes the emergency.
- Independent Python verification after C++ results and replanning.
- SQLite persistence across optimize, event, replan, backend restart, plan restore, and explanation retrieval.
- Frontend display of sections, districts, real explanation reason codes, baseline/optimized views, and the schematic-map disclaimer.

## 2. What changed

- Added canonical external `section_id`, optional district on teams, and API support for `available` and `available_from`.
- Kept the existing C++ `region_id` payload key as a compatibility adapter; no C++ solver operators, objective, or search strategy changed.
- Added hard-constraint regressions for all transport types, equipment, unavailable teams, and in-progress emergency ordering.
- Added `frontend/public/datasets/demo_showcase.json` for the jury demonstration. It contains two sections, multiple districts in one section, CAR/WALK/BIKE/PUBLIC_TRANSPORT, router/fiber-tool requirements, fixed windows, and an emergency.
- Updated the API, architecture, demo, benchmark wording, and logic audit to reflect section semantics.

## 3. Requirements covered

| Requirement | Evidence |
|---|---|
| One section, multiple districts | Same-section/different-district regression and `demo_showcase`. |
| No cross-section assignments | Python/C++ compatibility path plus all four dataset regression checks. |
| Time windows | Schedule and verifier regressions; showcase uses fixed two-hour windows. |
| Emergency replanning | `IN_PROGRESS + NEW_EMERGENCY` regression and full persistence flow. |
| Team availability | API and C++ regressions return `TEAM_UNAVAILABLE`. |
| Transport and equipment | Four transport and router/fiber-tool hard-constraint regressions. |
| Explainability | Deterministic API explanation based on ConstraintEngine facts. |
| UI evidence | Section/district labels, showcase selection, and synthetic-map notice. |

## 4. Validation results

| Check | Result |
|---|---|
| `build.ps1` | Passed: dependencies, editable backend, C++ extension, frontend production build. |
| Backend + C++ test suite | 68 passed. |
| Frontend tests | 15 passed. |
| Persistence flow | Passed: optimize → save → explanation → event → replan → restart → restore. |
| All production datasets | Passed, each independently verified. |

Fixed configuration: C++ mode, `seed=42`, `time_limit_ms=3000`.

| Dataset | Assigned | Unassigned | Used teams | Travel | Distance | Verified |
|---|---:|---:|---:|---:|---:|:---:|
| zone_1 | 66 | 0 | 7 | 417 min | 207.615 km | true |
| zone_2 | 83 | 0 | 9 | 415 min | 207.837 km | true |
| zone_3 | 56 | 0 | 7 | 343 min | 169.793 km | true |
| combined | 205 | 0 | 24 | 1172 min | 583.900 km | true |

## 5. Remaining limitations

- Optimization is heuristic; it does not mathematically prove a global optimum.
- The released routing matrix uses Haversine over anonymized/demo coordinates, so kilometres are comparative.
- The map is explicitly schematic and not a navigation service.
- `region_id` remains in persisted/C++ payloads only as an intentional backward-compatible alias for `section_id`.
- Any accepted plan is protected by the independent Python verifier.
