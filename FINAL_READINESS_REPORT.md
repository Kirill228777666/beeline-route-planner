# Current release readiness — v1.0.2 FINAL

Audit run: 2026-09-29. This report describes the current checkout and current audit sample; it supersedes the older acceptance measurements without deleting their historical record. The version string remains `v1.0.2`.

## Quick handoff

On Windows, install Python 3.12+, Node.js `^20.19` or `>=22.12`, npm, and MSYS2 g++ with C++20/UCRT64 runtime. From the repository root run `.\build.ps1`, then `.\start.ps1`; open <http://127.0.0.1:5173>. For the guided 3–5 minute demo, use `demo_showcase`, inspect an explanation, report actual request statuses, add a 13:17 emergency, replan, and show the child plan/diff. Then show the run-specific combined result. Full setup and constraints are in [README.md](README.md); detailed demo steps are in [docs/DEMO_SCENARIO.md](docs/DEMO_SCENARIO.md).

Repository: <https://github.com/Kirill228777666/beeline-route-planner> · branch `main` · audited implementation commit `82c69df` · current release `v1.0.2 FINAL`.

## Validation

| Check | Result |
|---|---|
| Backend + C++ tests | 102 passed |
| Frontend Vitest | 36 passed (5 files) |
| Frontend production build | Passed |
| `build.ps1` | Exit code 0; rebuilt C++ extension and frontend assets |
| `scripts/full_flow.py` | Parent/child verified; cancellation, explanation, diff, restart/restore passed |
| Live API datasets | baseline and C++ mode called for all five bundled datasets; all responses verified |
| Cross-section assignments | 0 in all measured optimized results |
| `start.ps1` | Two production-preview launches; backend `/health`, frontend and production JS asset returned HTTP 200; Ctrl+C stopped both process trees and ports were free afterward |
| Documentation | README, API, algorithm, architecture, benchmark, demo, limitations and audit links checked; repository-specific absolute paths removed from current handoff docs |
| GitHub | Published to `origin/main`; repository link below |
| C++ extension | Loaded from this checkout’s `cpp_solver/cpp_solver.cp314-win_amd64.pyd` |
| Browser | Production combined plan and Leaflet map inspected; combined KPIs and route/request data visible; zone_1 and explanation paths were also inspected in the audit |

## Current single-run measurements

Configuration: date 2026-09-29, seed 42, requested time limit 3000 ms, default `SolverConfig` feature values, synthetic Haversine routing. These values came from direct API responses and are run-specific.

| Dataset | Mode | Assigned | Teams | Travel | Distance | Runtime | Verified |
|---|---|---:|---:|---:|---:|---:|:---:|
| zone_1 | baseline | 55/66 | 12 | 975 min | 485.820 km | 7.560 ms | true |
| zone_1 | C++ | 66/66 | 7 | 375 min | 187.901 km | 2703.065 ms | true |
| zone_2 | baseline | 70/83 | 12 | 1211 min | 607.681 km | 10.435 ms | true |
| zone_2 | C++ | 83/83 | 9 | 415 min | 207.837 km | 2705.074 ms | true |
| zone_3 | baseline | 43/56 | 11 | 627 min | 314.786 km | 5.341 ms | true |
| zone_3 | C++ | 56/56 | 7 | 336 min | 165.918 km | 2702.428 ms | true |
| combined | baseline | 168/205 | 35 | 2813 min | 1408.287 km | 30.595 ms | true |
| combined | C++ | 205/205 | 23 | 1208 min | 601.692 km | 2969.708 ms | true |
| demo_showcase | baseline | 5/5 | 4 | 1 min | 0.447 km | 0.172 ms | true |
| demo_showcase | C++ | 5/5 | 4 | 1 min | 0.447 km | 23.779 ms | true |

The combined result is a single observed 23-team solution, not a proof of optimality or a guaranteed count. Travel/distance/runtime are not constants under a wall-clock search limit. Distances are comparative, not real road distances.

## Business and replanning checks

The audit added regressions and fixes for release-time scheduling, Python/C++ parity, fixed request prefixes, team position/availability snapshots, status/event validation, persisted child snapshots, and independent re-verification on plan restore. `section_id` remains the hard boundary; `region_id` is legacy-compatible; district is descriptive. Skills, transport, equipment, availability, windows and shifts are hard constraints. Source categories and the central 70/80/20/30 service norms were checked against the provided source brief.

The live 13:17 emergency scenario kept an IN_PROGRESS job with its team and before the new emergency; the emergency started no earlier than release time; its child plan, diff, explanation and restored representation were verified. The available regression suite covers ON_THE_WAY, COMPLETED, CANCELLED, free/busy teams, unavailable teams and future planned jobs. The complete ten-scenario status matrix was not manually repeated as ten separate external-process restart flows.

One run preserved an already-feasible future repair before the emergency. In a separate zone_1 event, when no operational status updates were submitted, 17 past scheduled stops still had status `NEW` and remained unassigned after replanning (50/67 assigned); explicitly reporting those stops `COMPLETED` before replanning resulted in 67/67 assigned and verified. The planner correctly does not infer completion from schedule timestamps, so dispatch must record actual statuses. Current priority semantics order assignment/coverage lexicographically; they do not guarantee that an emergency jumps ahead of every future job at the earliest feasible minute. The system also has no live GPS feed and cannot infer actual field position without a supplied snapshot.

## Readiness status

**PARTIAL.** Automated tests, release build, current dataset API optimizations, verifier checks, standard persistence/restart flow, repeated production-preview startup/shutdown, documentation checks, and sampled browser paths passed. README and supporting release documentation are ready, and `main` is pushed to GitHub. This status remains partial because the entire requested browser matrix and every status case through separate external restart/restore were not manually exercised. See [FINAL_RELEASE_AUDIT.md](FINAL_RELEASE_AUDIT.md) and [docs/BENCHMARKS.md](docs/BENCHMARKS.md) for evidence and limitations. Global optimality is not established; no same-conditions OR-Tools result is claimed.
