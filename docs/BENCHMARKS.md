# Benchmarks

Final `v1.0.2` smoke benchmark, executed with `seed=42`, optimized C++ mode with a 3000 ms limit, and baseline mode with its documented first-feasible policy. All rows were checked through the API and independent Python verifier. The official service-duration correction is included: travel is calculated separately and is not added to `service_duration`.

| Dataset | Requests | Baseline assigned | Baseline teams | Baseline verified | Optimized assigned | Optimized teams | Optimized verified |
|---|---:|---:|---:|:---:|---:|---:|:---:|
| zone_1 | 66 | 55 | 12 | true | 66 | 7 | true |
| zone_2 | 83 | 70 | 12 | true | 83 | 9 | true |
| zone_3 | 56 | 43 | 11 | true | **56** | **7** | **true** |
| combined | 205 | 168 | 35 | true | **205** | **24** | **true** |

`combined` is now an official technical union of the three independent operational sections: each request and team retains its canonical `section_id` (stored as `region_id` in the legacy C++ payload), every cross-section assignment is rejected, and the benchmark has `0` cross-section assignments. The earlier unrestricted `205/205, 20 teams` result is not a release benchmark because it used cross-section assignments. Zone 3 is fully assigned through the generic post-VND Regret repair. Distances are comparative because the release uses `haversine_synthetic` routing over anonymized coordinates.

| Dataset | Optimized travel | Optimized distance |
|---|---:|---:|
| zone_1 | 417 min | 207.615 km |
| zone_2 | 415 min | 207.837 km |
| zone_3 | 343 min | 169.793 km |
| combined | 1172 min | 583.900 km |

The API also records `runtime_ms`, `phase_timings_ms`, C++ execution, verifier, persistence, and API latency metrics in each plan.
