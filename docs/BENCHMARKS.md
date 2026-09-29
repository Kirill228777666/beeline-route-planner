# Benchmarks — current audit sample, 2026-09-29

Direct `POST /api/optimize` responses from the current checkout. Each dataset was run in baseline and C++ mode with submitted `seed=42`, `time_limit_ms=3000`, default `SolverConfig` feature defaults, official normalized service durations, `haversine_synthetic`, and Python verifier enabled. Metrics and runtime below describe this specific run only. A fixed seed does not guarantee identical search progress under a wall-clock cutoff.

| Dataset | Mode | Assigned | Teams | Travel (min) | Distance (km) | Runtime (ms) | Verified | Cross-section assignments |
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

For this run the optimized solver returned 100% assignment on all five datasets, all verified, with zero cross-section assignments. Combined had 23 used teams in this run. That is a found result, not a proof of global minimum and not a fixed benchmark guarantee. Global optimality is not mathematically proved. No reproducible same-conditions OR-Tools artifact is available, so no OR-Tools team-count claim is made.

The baseline numbers come from the actual baseline endpoint mode and are not required to be fully assigned. KPI totals and team counts in the UI must come from the API response. Coordinates are anonymized/synthetic and routing uses Haversine; distances are comparative and not road-navigation measurements.

## Historical / superseded

The unrestricted combined result `205/205, 20 teams` used cross-section assignments and is not business-valid. Earlier runs showing 24 combined teams or different travel/distance values are historical run-specific samples. The old v1.0.0/v1.0.1 records, including zone_3 `55/56`, remain historical and must not be substituted for this run. See `acceptance_report.md` and `RELEASE_SNAPSHOT_v1.0.1.md` for records marked superseded.
