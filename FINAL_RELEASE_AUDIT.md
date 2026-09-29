# Final release audit — Beeline Route Planner

Audit date: 2026-09-29
Audited branch/base commit: `main`, `e9a09f7f7cb8a0057088852833a795eadbfe7ada`
Project version: `v1.0.2 FINAL` (version string unchanged)
Status: **PARTIAL — fixes and verification are complete for the checked paths; several release gates below remain unverified.**

## Scope and source of truth

The source hackathon brief, current repository, tests, actual HTTP API, and browser were checked. The audit covered request/team modeling, constraints, schedule calculation, C++ binding, Python verifier, persistence, status events, replanning, Leaflet UI, launch/build scripts, and current datasets. Historical reports were not treated as proof. This checkout’s code and the measurements below are the current evidence.

The main confirmed defects were: route schedule calculation did not consistently apply request release time and post-event team position; C++ scheduling lacked release-time parity; replanning could persist the wrong team snapshot and reconstruct time/status events inconsistently; event validation accepted invalid state/time combinations or surfaced server errors; and plan restore trusted a stored verified flag without re-verifying the stored solution. These were addressed with Python, C++, frontend event UI, and regression-test changes. No dataset or objective change was made.

## Business rules checked

- `section_id` is the canonical operational boundary; `region_id` is a legacy alias. Cross-section work is rejected; `district` is descriptive and does not restrict assignments.
- Skills, transport, equipment, availability, release time, request windows, and team shifts are hard constraints. Missing skills/equipment do not become soft preferences.
- The source brief’s competency categories were checked rather than inferring a skill count from work labels. `LOCAL` is a skill; BK/HD are source metadata. Work types are CONNECTION, EMERGENCY, ADD_ON, and REPAIR (with the supported legacy repair mapping).
- Service duration is normalized from the central official catalogue: CONNECTION 70, EMERGENCY 80, ADD_ON 20, REPAIR 30 minutes; travel is separate.
- Emergency event time becomes release time, and the schedule/verifier reject service before release. Status transitions are validated against scheduled intervals. COMPLETED, IN_PROGRESS, and ON_THE_WAY are fixed to their existing team/order; CANCELLED is removed from the active route. Future route requests may be re-optimized.
- `TEAM_UNAVAILABLE` is implemented as an explicit event. Future work is reconsidered; already fixed work can remain with that team. This is not a live employee-location or shift-calendar system.

## Confirmed changes and regression coverage

- Schedule release-time, available-from, current-position, fixed-prefix, and shift handling were corrected; C++ request parsing/scheduling now carries release time.
- Replanning now validates event/request/team identity, monotonic event times and valid status intervals; emergency duration/release are normalized; team snapshots and the actual child-plan problem are persisted.
- Restored plans are recalculated through the independent Python verifier instead of trusting the persisted boolean.
- Explainability identifies unavailable teams; frontend event form exposes the implemented team-unavailable event.
- Regression tests cover status transitions, emergency timing and fixed work, completed work plus future requests, all-busy and free-team cases, unavailable teams, future availability/current position, malformed/foreign/duplicate events, persistence snapshot restoration, and verifier gating.

Backend/C++ test command: `python -m pytest backend/tests cpp_solver/tests -q` — **102 passed**. Frontend Vitest: **5 files, 36 tests passed**. `scripts/full_flow.py` passed optimize → explanation → cancellation event → child replan/diff → dispose/restart app → restore and explanation; parent and child were verified. These are meaningful regression checks, but do not constitute every possible production status sequence or real-world field-location scenario.

## Replanning smoke evidence and semantic boundary

A live HTTP flow was run against the started backend using an isolated SQLite database and a small explicit audit fixture:

| Step | Observed result |
|---|---|
| Build parent plan | HTTP 200, verified; team 882 route `[88201, 88202]` |
| Set request 88201 `IN_PROGRESS` at 13:17 | HTTP 200; planned interval included event time |
| Submit emergency 88203 at 13:17 | HTTP 200; child request received event-time release |
| Replan at 13:17 | HTTP 200, verified; request 88201 remained first on team 882 |
| Child route | `[88201, 88202, 88203]`; fixed work 13:00–13:30, future repair 14:00–14:30, emergency 14:30–15:50 |
| Restore child / explanation | HTTP 200, `verified=true`; emergency explanation HTTP 200 |

A second live check used the bundled zone_1 plan with an emergency at 13:17. When no request-status events were submitted, the parent’s 17 earlier scheduled stops still had status `NEW`; the child was constraint-valid but had 17 requests unassigned (50/67 assigned). The service does not infer `COMPLETED` from scheduled finish times, which avoids inventing field status. After explicit `COMPLETED` events were recorded for the 17 finished requests, replanning returned 67/67 assigned and verified, preserving those statuses. Operationally, dispatch must submit actual status updates before asking the planner to replan; a valid flag alone does not mean all work was assigned.

The future request remained before the emergency in this run because the existing route remained feasible. The implementation guarantees fixed work and release-time legality, and gives emergencies the configured priority for assignment/coverage; it does **not** encode a hard “serve every emergency at the earliest feasible instant before all future work” sequencing rule. The task brief defines priority lexicographically for unassigned coverage, not as a universal appointment-preemption constraint. If dispatch policy requires that stronger rule, it needs an explicit business decision and a separately tested objective/ordering change.

The API test suite additionally covers ON_THE_WAY, COMPLETED, CANCELLED, TEAM_UNAVAILABLE, all-teams-busy, and free-team situations. `scripts/full_flow.py` exercises cancellation and persistence. TEAM_UNAVAILABLE is covered by API tests, but the full ten-case status matrix was not individually run through an external process restart for every case.

## Current API benchmark sample

Recorded 2026-09-29 from live `/api/optimize`, using the checked-in frontend datasets, `seed=42`, requested `time_limit_ms=3000`, default `SolverConfig` feature values, `haversine_synthetic`, and Python verification. Baseline used the baseline mode with the same submitted seed/time-limit fields. Each row is a single run; wall-clock-bounded search can change runtime and secondary metrics.

| Dataset | Mode | Assigned | Teams | Travel (min) | Distance (km) | Runtime (ms) | Verified | Cross-section |
|---|---|---:|---:|---:|---:|---:|:---:|---:|
| zone_1 | baseline | 55/66 | 12 | 975 | 485.820 | 7.560 | true | 0 |
| zone_1 | C++ | 66/66 | 7 | 375 | 187.901 | 2703.065 | true | 0 |
| zone_2 | baseline | 70/83 | 12 | 1211 | 607.681 | 10.435 | true | 0 |
| zone_2 | C++ | 83/83 | 9 | 415 | 207.837 | 2705.074 | true | 0 |
| zone_3 | baseline | 43/56 | 11 | 627 | 314.786 | 5.341 | true | 0 |
| zone_3 | C++ | 56/56 | 7 | 336 | 165.918 | 2702.428 | true | 0 |
| combined | baseline | 168/205 | 35 | 2813 | 1408.287 | 30.595 | true | 0 |
| combined | C++ | 205/205 | 23 | 1208 | 601.692 | 2969.708 | true | 0 |
| demo_showcase | baseline | 5/5 | 4 | 1 | 0.447 | 0.172 | true | 0 |
| demo_showcase | C++ | 5/5 | 4 | 1 | 0.447 | 23.779 | true | 0 |

The current sample found 23 teams for combined; this is a result of this particular run, **not a proof of global optimality or a fixed release guarantee**. Previously documented 24-team results remain valid only as historical run-specific measurements, not as a requirement. Distances are comparative because the coordinates and Haversine matrix are synthetic. No same-conditions OR-Tools artifact was found, so no OR-Tools result is claimed.

## Build, app and browser evidence

- `npm run build`: passed; `npm test -- --run`: 36 passed.
- `scripts/full_flow.py`: passed again on 2026-09-29; parent and child were both verified and restart/restore returned true.
- `build.ps1`: **exit code 0** after rebuilding the C++ extension and frontend production bundle.
- Live `start.ps1` was run twice on default ports with the production Vite preview. Each launch reported backend `/health` HTTP 200 and frontend HTTP 200; the production JavaScript asset also returned HTTP 200. The C++ extension import resolved to this checkout’s `cpp_solver/cpp_solver.cp314-win_amd64.pyd` (manual import requires the local MSYS runtime DLL directory).
- Browser inspected the actual combined plan: 205/205, 23 teams, 1,208 travel minutes, 601.7 km, compact verified indicator, Leaflet map/OSM attribution, actual route and stop data, request drawer and backend explanation. A separate zone_1 browser view showed 66/66 and 7 teams. Map selection/filter behavior is also covered by frontend tests.
- Ctrl+C stopped both started backend/frontend process trees on both runs; ports 8000/5173 became free and no matching project server processes remained. A separate pre-existing Vite process from `Documents\beeline-route-planner` was identified and deliberately not touched.
- `git diff --check`: clean after the final documentation edits.

## Known limitations and remaining gates

- The full browser acceptance matrix was not manually exercised end-to-end for all five datasets, every UI event type, every selection/reset path, and every error state. Automated tests and the smoke paths above are not a substitute for that matrix.
- The server-side current-position value is a supplied snapshot, not live GPS. When actual coordinates/time are not supplied, the planner cannot infer a team’s physical position beyond the scheduled plan.
- Emergency priority currently governs lexicographic assignment/coverage; earliest-service sequencing ahead of all feasible future requests is not guaranteed (see live smoke observation).
- The benchmark table is one current run; metrics are not guaranteed constants.
- Global fleet-size optimality is not mathematically established. Routing is synthetic Haversine over anonymized/demo coordinates.

Historical acceptance and release snapshot files remain in the repository and are explicitly marked `HISTORICAL / SUPERSEDED`. Their old counts and measurements are not current results.

## Final gate

**PARTIAL.** The code-level regressions, backend/C++ and frontend suites, production build, `build.ps1`, five live dataset optimizations, verifier, live emergency/replan/restore flow, `full_flow.py` restart flow, repeated production-preview startup/shutdown, documentation-link checks, and final diff check passed. The full manual browser acceptance matrix and every status case as a separate external-process restart/restore scenario were not completed. GitHub publication is being completed at the user's request, but it does not turn those uncompleted acceptance checks into a PASS. Do not interpret this report as a claim that every item in the requested acceptance matrix has passed.
