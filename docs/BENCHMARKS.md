# Benchmarks — v1.0.2 FINAL

Recorded run: 2026-09-29, `seed=42`, C++ optimized mode, `time_limit_ms=3000`, default release configuration, official service durations, section isolation enabled. The solver is wall-clock bounded: seed fixes the random stream, but the amount of search completed before timeout can vary. The values below are this run's observations, not guaranteed identical travel or distance on every execution. They were independently checked by the Python verifier.

| Dataset | Requests | Baseline assigned / teams | Optimized assigned / teams | Optimized travel | Optimized distance | Verified |
|---|---:|---:|---:|---:|---:|:---:|
| zone_1 | 66 | 55 / 12 | 66 / 7 | 417 min | 207.615 km | true |
| zone_2 | 83 | 70 / 12 | 83 / 9 | 415 min | 207.837 km | true |
| zone_3 | 56 | 43 / 11 | 56 / 7 | 343 min | 169.793 km | true |
| combined | 205 | 168 / 35 | 205 / 24 | 1185 min | 589.655 km | true |

Release invariants are `verified=true`, all requests assigned on these four prepared datasets, and zero cross-section assignments in `combined`. The solver has found a 24-team combined solution; this does not prove that 24 is globally minimal. No reproducible OR-Tools benchmark artifact is included in this release, so no OR-Tools team-count comparison is claimed.

`combined` is the technical union of the three independent operational sections. Each request and team retains its `section_id`; cross-section assignment is prohibited. Distances are comparative because routing uses `haversine_synthetic` over anonymized coordinates.

## Historical results

The unrestricted `205/205, 20 teams` result is **HISTORICAL / SUPERSEDED — not current release**. It allowed cross-section assignments and is not a business-valid benchmark. Older benchmark values recorded in `acceptance_report.md` and `RELEASE_SNAPSHOT_v1.0.1.md` are historical snapshots, not current measurements.
