# FINAL RELEASE AUDIT — v1.0.2 FINAL

Audit date: 2026-09-26. Scope was limited to Python solution verification and release documentation. C++ solver code, search algorithms, objective, and datasets were not changed.

## verifier hardening

The verifier recalculates every assigned route schedule from the input problem and travel matrix. It now requires the returned schedule to contain exactly one matching stop per recalculated stop, compares request ID, arrival, start, finish, travel time, waiting, and distance, and always compares route-level travel time and distance—even when the returned schedule is empty. An incomplete schedule or incorrect route metrics makes the result invalid. Schedule recalculation independently enforces release time, request start window, and team shift.

Regression coverage includes empty schedule, missing stop, altered route metrics, complete valid route, duplicate request assignment, and cross-section rejection. The empty-schedule regression was observed failing before the verifier change and passing after it.

## current release version

The release remains `v1.0.2 FINAL`; this work does not create a new version. The root README, current readiness report, and current benchmark document identify v1.0.2. Older acceptance and v1.0.1 snapshot files are retained and labeled `HISTORICAL / SUPERSEDED — not current release`.

## current benchmark

Recorded on 2026-09-26 with `seed=42`, C++ mode, `time_limit_ms=3000`, and current prepared datasets. Each optimized result passed the Python verifier and had 100% assignment:

| Dataset | Assigned | Unassigned | Used teams | Travel | Distance | Verified |
|---|---:|---:|---:|---:|---:|:---:|
| zone_1 | 66/66 | 0 | 7 | 417 min | 207.615 km | true |
| zone_2 | 83/83 | 0 | 9 | 415 min | 207.837 km | true |
| zone_3 | 56/56 | 0 | 7 | 343 min | 169.793 km | true |
| combined | 205/205 | 0 | 24 | 1173 min | 584.047 km | true |

These travel and distance values describe this particular wall-clock-bounded run, not guaranteed exact outputs. Seed fixes stochastic choices, but wall-clock cutoff can change the amount of search completed. The hard invariants are `verified=true`, full assignment on the prepared datasets, and zero cross-section assignments in combined. Twenty-four teams is a confirmed found solution; global optimality is not proved. No reproducible OR-Tools artifact for this release is present, so this audit makes no OR-Tools team-count claim.

## tests

| Validation | Result |
|---|---|
| `python -m pytest backend/tests cpp_solver/tests -q` | 72 passed |
| Frontend Vitest | 15 passed |
| Frontend production build (`tsc -b && vite build`) | Passed |
| `build.ps1` (pinned dependencies, C++ extension, frontend build) | Passed |
| `scripts/full_flow.py` | Parent/child verified; explanation, event, replan, restart, and restore passed |
| C++ optimized run + Python verifier: zone_1 | 66/66, verified |
| C++ optimized run + Python verifier: zone_2 | 83/83, verified |
| C++ optimized run + Python verifier: zone_3 | 56/56, verified |
| C++ optimized run + Python verifier: combined | 205/205, verified; zero cross-section assignments |

## known limitations

- Search is heuristic and does not prove a global fleet-size optimum.
- Wall-clock limits mean travel time and distance can vary between runs, even with a fixed seed.
- Haversine over anonymized/demo coordinates is synthetic routing; distances are comparative, not road-navigation measurements.
- The Python verifier is independent of the C++ search implementation, but uses the backend's shared constraint and schedule rules as its business-policy source.

## historical artifacts

- `RELEASE_SNAPSHOT_v1.0.1.md` is retained with a prominent superseded notice; its 20-team combined and 55/56 zone_3 figures are not current release results.
- `acceptance_report.md` is retained as the 2026-09-20 acceptance record and labeled historical; its old test count and measurements are not current validation.
- The unrestricted 20-team combined figure is not business-valid because it used cross-section assignments. It is explicitly labeled superseded in `docs/BENCHMARKS.md`.
- No current-release claim that OR-Tools achieves 23 teams is made; no reproducible same-conditions artifact is included.

## final readiness

The scoped verifier defect is fixed and covered by a red-green regression. Backend/C++ tests, frontend tests/build, release build, four dataset validations, and the persistence/replanning restart flow passed. The project is ready as `v1.0.2 FINAL` subject to the documented heuristic and synthetic-routing limitations. No solver, algorithm, objective, or dataset changes were made.
