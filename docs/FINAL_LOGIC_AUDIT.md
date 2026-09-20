# Final logic, data, and result audit — v1.0.1

> Historical audit snapshot. Its two mandatory findings (the zone_3 repair omission and missing regional isolation) were resolved in `v1.0.2 FINAL`; current release figures are in [BENCHMARKS.md](BENCHMARKS.md).

Audit date: 2026-09-20  
Scope: `outputs/clean_project` production path only  
Source changes during this audit: **none**. The only generated files were local build artifacts used to reproduce C++ runs.

## Method

- Rebuilt the project with `build.ps1` from the v1.0.1 source tree.
- Ran `python -m pytest -q backend/tests cpp_solver/tests`: **49 passed**.
- Loaded each JSON dataset through the same `RequestInput` / `TeamInput` normalization path used by `POST /api/optimize`.
- For every dataset, ran `baseline` and C++ optimized mode with `seed=42` and `time_limit_ms=3000`; every returned plan was checked again by the independent Python verifier.
- Tested zone 3 with seeds `1`, `42`, `2026`, `777` and limits 3, 10, 30, and 60 seconds.
- Tested API replanning on an in-memory SQLite database: one `COMPLETED` event and one emergency event at 13:17.

All travel figures below use the release's synthetic Haversine matrix. They are comparative, not operational road distances.

## 1. Dataset diagnostics and reproducible results

`office_id`, `region`, and `district` are absent from every production JSON request and team record. The dataset name is only `zone_1`, `zone_2`, `zone_3`, or `combined`; the leading digit of existing request/team IDs was used solely as a diagnostic proxy for origin in the regional analysis below.

| Dataset | Requests / teams | Work types | Service durations | Request skills | Team transport / equipment | Office/region | Baseline: assigned, teams, travel, distance, verified | C++: assigned, teams, travel, distance, verified |
|---|---:|---|---|---|---|---|---|---|
| zone_1 | 66 / 12 | CONNECTION 32; EMERGENCY 13; ADD_ON 5; REPAIR 16 | 70×32; 80×13; 20×5; 30×16 | CONNECTION 37; EMERGENCY 13; LOCAL 11; REPAIR 5 | CAR×12; equipment empty on all teams; requests require no transport/equipment | absent | 55/66; 12; 967 min; 482.419 km; true | **66/66; 7; 441 min; 221.375 km; true** |
| zone_2 | 83 / 12 | CONNECTION 37; EMERGENCY 23; ADD_ON 3; REPAIR 20 | 70×37; 80×23; 20×3; 30×20 | CONNECTION 40; EMERGENCY 23; LOCAL 20 | CAR×12; equipment empty; no request transport/equipment requirement | absent | 70/83; 12; 1211 min; 607.681 km; true | **83/83; 9; 446 min; 222.287 km; true** |
| zone_3 | 56 / 11 | CONNECTION 29; EMERGENCY 10; ADD_ON 1; REPAIR 16 | 70×29; 80×10; 20×1; 30×16 | CONNECTION 30; EMERGENCY 10; LOCAL 15; REPAIR 1 | CAR×11; equipment empty; no request transport/equipment requirement | absent | 43/56; 11; 627 min; 314.786 km; true | **55/56; 11; 300 min; 148.973 km; true** |
| combined | 205 / 35 | CONNECTION 98; EMERGENCY 46; ADD_ON 9; REPAIR 52 | 70×98; 80×46; 20×9; 30×52 | CONNECTION 107; EMERGENCY 46; LOCAL 46; REPAIR 6 | CAR×35; equipment empty; no request transport/equipment requirement | absent | 201/205; 34; 3369 min; 1681.598 km; true | **205/205; 20; 1060 min; 530.068 km; true** |

`LOCAL` in the table is a **skill label**, not a work type. It remains in the input skill masks and is mapped to a distinct `Skill.LOCAL` bit. All work type values in the JSON data are the four official values only.

### Per-dataset skill inventory

The compact rows above show request masks. Team masks are as follows; this is relevant because the data has no equipment or transport variation to exercise those hard constraints in a production dataset.

| Dataset | Team skill-mask distribution |
|---|---|
| zone_1 | LOCAL+CONNECTION+EMERGENCY ×3; LOCAL+CONNECTION+REPAIR+EMERGENCY ×1; LOCAL+CONNECTION ×4; CONNECTION+EMERGENCY ×2; REPAIR+EMERGENCY ×1; CONNECTION+REPAIR+EMERGENCY ×1 |
| zone_2 | LOCAL+CONNECTION+EMERGENCY ×6; LOCAL ×1; CONNECTION ×2; LOCAL+CONNECTION ×1; CONNECTION+EMERGENCY ×2 |
| zone_3 | LOCAL+CONNECTION ×2; CONNECTION+REPAIR+EMERGENCY ×1; CONNECTION ×2; CONNECTION+EMERGENCY ×3; LOCAL+CONNECTION+EMERGENCY ×3 |
| combined | Exact union of the three zone inventories: 35 teams |

## 2. Zone 3: why request 3018023 is unassigned

### Request facts

| Field | Value |
|---|---|
| request_id | `3018023` |
| work type | `REPAIR` |
| time window | 840–960 minutes, 14:00–16:00 |
| service duration | 30 minutes |
| required skill | `REPAIR` |
| required equipment | none |
| required transport | none |

### Static compatibility

Only team `30003` has the `REPAIR` bit. The other ten teams are hard-rejected with `NO_SKILL`:

| Team | Static result | Route in the 55/56 solution | Exact insertion result |
|---|---|---|---|
| 30001 | NO_SKILL | 7 requests | hard prohibition |
| 30002 | NO_SKILL | 6 requests | hard prohibition |
| 30003 | compatible | `3055711 → 3090373 → 3095501` | **valid insertion exists at position 2** |
| 30004 | NO_SKILL | 3 requests | hard prohibition |
| 30005 | NO_SKILL | 3 requests | hard prohibition |
| 30006 | NO_SKILL | 7 requests | hard prohibition |
| 30007 | NO_SKILL | 5 requests | hard prohibition |
| 30008 | NO_SKILL | 10 requests | hard prohibition |
| 30009 | NO_SKILL | 3 requests | hard prohibition |
| 30010 | NO_SKILL | 5 requests | hard prohibition |
| 30011 | NO_SKILL | 3 requests | hard prohibition |

For team `30003`, the exact independent Python scheduling check is:

| Position | Candidate route | Result |
|---:|---|---|
| 0 | `3018023 → 3055711 → 3090373 → 3095501` | invalid: `3055711` starts after its window |
| 1 | `3055711 → 3018023 → 3090373 → 3095501` | invalid: `3090373` starts after its window |
| 2 | `3055711 → 3090373 → 3018023 → 3095501` | **valid**; request starts 868, finishes 898 |
| 3 | `3055711 → 3090373 → 3095501 → 3018023` | invalid: `3018023` starts after its own window |

The request alone is also feasible for team `30003` (start 840). Therefore it is **not truly infeasible**.

### Limit and seed experiment

Every one of the 16 cold-start runs returned the same valid but incomplete solution: `55/56`, unassigned `[3018023]`, 11 teams, 300 travel minutes, 148.973 km.

| Max time | Seeds | C++ execution observed | Any 56/56 cold start? |
|---|---|---:|:---:|
| 3 s | 1, 42, 2026, 777 | 10.5–11.2 ms | no |
| 10 s | 1, 42, 2026, 777 | 11.1–11.6 ms | no |
| 30 s | 1, 42, 2026, 777 | 10.7–11.3 ms | no |
| 60 s | 1, 42, 2026, 777 | 10.6–11.4 ms | no |

`time_limit_ms` is a maximum, not a requirement to search for that long; the run finishes after its own phases in roughly 11 ms. However, a C++ warm start built from the reported 55-request plan immediately produces `56/56` and verified=true. With VND/ALNS/route-elimination disabled, it returns the direct route `3055711 → 3090373 → 3018023 → 3095501`.

**Conclusion:** `zone_3=55/56` is a solver construction/repair defect, not an infeasibility caused by the official durations. It must not be presented as an unavoidable business limitation.

## 3. Regional isolation and combined

### Current production model

There is no `region` or `office_id` field in the request/team schema, no region condition in `ConstraintEngine`, no region value passed to C++, and no region check in `SolutionVerifier`. An individual zone appears isolated only because its JSON file contains only its own teams.

Consequently, the three requested prohibitions cannot currently be guaranteed by production code:

- a zone 1 request can be served by a zone 2 or 3 team when they are present in the same problem;
- the same is true for zone 2 and zone 3.

### Actual combined assignments

Using the ID-prefix diagnostic proxy, the optimized combined solution contains **138 cross-zone assignments out of 205**.

| Team origin → request origin | zone_1 | zone_2 | zone_3 |
|---|---:|---:|---:|
| zone_1 team IDs | 22 | 28 | 20 |
| zone_2 team IDs | 15 | 23 | 14 |
| zone_3 team IDs | 29 | 32 | 22 |

All 20 used teams make at least one cross-zone assignment:

- zone 1 teams: `10001`, `10002`, `10003`, `10004`, `10006`, `10007`, `10009`;
- zone 2 teams: `20002`, `20003`, `20006`, `20007`, `20010`;
- zone 3 teams: `30002`, `30003`, `30005`, `30006`, `30007`, `30008`, `30009`, `30010`.

The 20-team result is better than the independent-zone total because the solver pools all skills and all teams across zones. It uses teams with otherwise scarce skills outside their nominal origin and globally repacks work. This is exactly the behavior prohibited by the official independent-zone interpretation.

### Region-isolated combined diagnostic

Because the current solver does not accept a region field, the only non-invasive audit construction is to solve the three production zone files independently with identical C++ configuration and aggregate their verified routes. Under independent components this is equivalent to a hard region partition, but it is **not** an implemented `region/office_id` constraint.

| Scenario | Assigned | Unassigned | Used teams | Travel time | Distance | Verified |
|---|---:|---:|---:|---:|---:|:---:|
| Current combined, unrestricted | 205 | 0 | 20 | 1060 min | 530.068 km | true |
| Region-isolated diagnostic composition | 204 | 1 | 27 | 1176 min | 584.733 km | true |

The isolated outcome inherits the zone 3 solver defect above. It is the only defensible comparison available without adding a real region constraint.

**Classification:** current `combined=205/205, 20 teams` is a **synthetic stress-test only**, not an official business scenario.

## 4. Official semantic checks

| Requirement | Evidence | Result |
|---|---|---|
| BK/HD are not work type or skill | CSV parser derives type only from explicit work-type columns and preserves BK/HD as source fields; `test_business_model.py` covers conflicting BK/HD text | correct in importer path; demo JSON has no BK/HD fields to exercise end-to-end |
| Priority | Python catalog: EMERGENCY=3, CONNECTION=2, REPAIR/ADD_ON=1; C++ uses the same emergency/connection/other buckets | correct |
| Durations | Central Python catalog: CONNECTION 70, EMERGENCY 80, ADD_ON 20, REPAIR 30; all JSON values match | correct in production API path |
| Travel separate from service | Schedule adds travel and service separately; catalog's total norms are 90/100/40/50 with 20-minute reference travel | correct |
| Emergency release time | API replan test: event 13:17=797; stop start 914; finish 994; service 80 | correct through backend production path |
| Completed work fixed in replan | API test retained request `1098182` on team `10001`, with no reassignment/time diff | correct |
| Team equipment preserved | Replanning snapshots use `replace(team, ...)` only for position/availability; focused tests pass | correct |
| Missing skill/equipment prohibited | Python engine, C++ `compatible`, and verifier all test masks/equipment; focused tests pass | correct |

Two boundary caveats:

1. The C++ binding does not carry a separate `release_time`; the backend is safe because it raises `window_start` to at least release time before conversion. A direct pybind caller could bypass that semantic unless it performs the same normalization.
2. The API schema requires a `service_duration` field but `_request_from_input` replaces it with the official catalog duration. This is intentional normalization, but the API documentation does not say that the supplied value is ignored.

## 5. Synchronization audit

### Correctly synchronized

- Backend, frontend datasets, and persisted-plan normalization use four official work-type values.
- Backend normalization, frontend emergency payload, and production JSON use service durations 70/80/20/30.
- Python and C++ both enforce skill masks, transport, equipment, time windows, shifts, and the same three priority buckets.
- Python verifier recomputes schedules independently and rejected solutions are not returned from the API.
- `BENCHMARKS.md` assignment and team counts reproduce exactly under the stated v1.0.1 seed/configuration.

### Suspicious or misleading

- `Skill.LOCAL` remains widely used in datasets. This does not violate the work-type rule, but its business meaning is undocumented and visually easy to confuse with the removed legacy work type `LOCAL`.
- No production dataset requires equipment or a particular transport. The code and tests cover these hard constraints, but the release data does not demonstrate them.
- The C++ solver receives already-normalized durations but does not own the normative catalogue. Direct C++ calls can pass arbitrary durations.
- `time_limit_ms` does not make zone 3 search for 3/10/30/60 seconds; it stops in roughly 11 ms. This is valid maximum-limit behavior, but the documentation should not imply that a larger limit alone strengthens this instance.

### Definitely incorrect

1. The production model has no region/office constraint, while the official interpretation requires independent zones.
2. The published combined result is presented as a normal demo result despite 138 cross-zone assignments. It must be labeled synthetic, or removed from official comparison.
3. Zone 3's one unassigned request is feasible, but `BENCHMARKS.md` currently attributes it to corrected durations rather than a reproducible solver omission.
4. `build.ps1` ends with `Beeline Route Planner v1.0.0 built successfully.` although all package/application/solver metadata is v1.0.1.

### Acceptable assumptions

- Haversine/synthetic travel is an explicitly documented demo limitation; distance remains comparative.
- Compatibility aliases for legacy input (`ADDITIONAL_ORDER`, legacy work-type `LOCAL`) are acceptable at the boundary because production data serializes only official work types.
- The absence of meaningful equipment/transport variation is acceptable for a demo only if it is not claimed as empirical evidence of those constraints on supplied datasets.

## 6. Benchmark-documentation status

`docs/BENCHMARKS.md` contains no remaining v1.0.0 numbers and its current table reproduces:

- zone 1: baseline 55/12, optimized 66/7;
- zone 2: baseline 70/12, optimized 83/9;
- zone 3: baseline 43/11, optimized 55/11;
- combined: baseline 201/34, optimized 205/20.

It must still be corrected before a final freeze in two places: label combined as an unrestricted synthetic stress-test and describe zone 3 as a feasible request missed by the current cold-start search. `docs/DEMO_SCENARIO.md` must make the same combined distinction.

## 7. Required action list before final freeze

### Must fix

1. Add a first-class `region`/`office_id` to requests and teams; enforce equality in Python `ConstraintEngine`, C++ compatibility, and Python verifier; persist and expose it; add cross-zone rejection tests. Then regenerate the official combined benchmark.
2. Fix the zone 3 cold-start construction/repair defect and add a regression test requiring `3018023` to be assigned in its valid position. The current result is demonstrably not a feasibility limit.
3. Mark or replace the unrestricted combined figure in `BENCHMARKS.md` and `DEMO_SCENARIO.md`; do not present it as official regional planning.
4. Correct the stale `v1.0.0` completion string in `build.ps1`.

### Should clarify, but need not block a technical demo

1. Document `LOCAL` as a qualification label or rename/map it to an official skill vocabulary after confirming the business source.
2. State in API documentation that server-side duration is normative and that caller-supplied `service_duration` is normalized.
3. Make the pybind boundary either receive `release_time` or explicitly document that callers must pre-normalize `window_start`.
4. Add at least one demo dataset or visible scenario with equipment and transport requirements.

### Do not change solely because of this audit

- The Haversine routing fallback and comparative-kilometre disclaimer.
- The lexicographic priority order and official service-duration catalogue; they are internally consistent.
- Backend fallback/verifier safety gate; it is working as designed.

## Final answers

1. **Can zone 1 be considered correct?** Yes for the supplied single-zone input: 66/66, 7 teams, verifier-valid, and its work types/durations are correct. It is not evidence of cross-region enforcement because no foreign teams are present.
2. **Can zone 2 be considered correct?** Yes on the same limited basis: 83/83, 9 teams, verifier-valid, with correct production semantics.
3. **What happens in zone 3?** The solver cold start deterministically misses feasible request `3018023`; every tested seed/limit returns 55/56 in about 11 ms, but a valid direct insertion and C++ warm start yield 56/56. This is a solver defect, not infeasibility.
4. **Is combined correct as an official scenario?** No. It has 138 cross-zone assignments and no enforced region/office rule. It is useful only as an unrestricted synthetic stress-test.
5. **Are there official-requirement violations?** Yes: missing regional isolation; a feasible request left unassigned; and misleading presentation/documentation of those results. Core work-type, priority, duration, replanning, and hard compatibility semantics are correct in the backend production path.
6. **What must be fixed before final freeze?** Implement and verify region/office hard constraints, fix the zone 3 repair regression, relabel/regenerate combined benchmarks, and fix the stale build version string.
