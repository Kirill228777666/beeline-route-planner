# Current Release Readiness — v1.0.2 FINAL

This report supersedes the original acceptance record dated 2026-09-20. The current solver and datasets were not changed for this hardening; the Python verifier now rejects incomplete schedules and always checks route metrics against an independently recalculated schedule.

## Current validation

| Check | Result |
|---|---|
| Backend and C++ tests | 72 passed |
| Frontend tests | 35 passed |
| Frontend production build | Passed |
| `build.ps1` | Passed |
| Prepared datasets | All four fully assigned and Python-verified |
| Persistence/replanning flow | Covered by `scripts/full_flow.py` and integration tests; parent/child restore verified |

The latest recorded C++ sample used `seed=42`, `time_limit_ms=3000`, the default release configuration, and section isolation:

| Dataset | Assigned | Unassigned | Used teams | Travel | Distance | Verified |
|---|---:|---:|---:|---:|---:|:---:|
| zone_1 | 66/66 | 0 | 7 | 417 min | 207.615 km | true |
| zone_2 | 83/83 | 0 | 9 | 415 min | 207.837 km | true |
| zone_3 | 56/56 | 0 | 7 | 343 min | 169.793 km | true |
| combined | 205/205 | 0 | 24 | 1185 min | 589.655 km | true |

These are observations from one wall-clock-bounded run, not exact reproducibility guarantees for travel, distance, runtime, or search progress. The hard release checks are full assignment on these datasets, no cross-section assignments, and `verified=true`. The 24-team combined solution is a confirmed found solution, not a proof of global minimum.

## Scope and limitations

Release version remains `v1.0.2 FINAL`. C++ solver code, search algorithms, objective, and benchmark datasets were not modified. Routing remains synthetic Haversine over anonymized coordinates; distances are comparative. Historical v1.0.0/v1.0.1 documentation is retained but labeled superseded. See `docs/BENCHMARKS.md` for benchmark methodology and the current sample.
