# Final logic audit — current checkout, 2026-09-29

This audit reflects the current source and tests, not the earlier v1.0.1/v1.0.2 reports. The source hackathon brief and expert clarifications were reviewed. See `FINAL_RELEASE_AUDIT.md` for the full run evidence.

## Canonical business interpretation

| Area | Current rule / evidence |
|---|---|
| Section and district | `section_id` is the hard operational boundary. `region_id` is a legacy alias/fallback. District is informational; different districts in the same section can share a team. |
| Work and skills | Work types: CONNECTION, EMERGENCY, ADD_ON, REPAIR. `LOCAL` is a skill alias/category, not a work type. BK/HD are source metadata. Requests have one canonical required skill; teams may have multiple. Unsupported skills are rejected. |
| Priority and duration | EMERGENCY > CONNECTION > REPAIR/ADD_ON for unassigned coverage. Service catalogue is CONNECTION 70, EMERGENCY 80, ADD_ON 20, REPAIR 30 minutes; travel is calculated separately. |
| Hard constraints | Skills, transport, equipment, availability, section, release time, request window, and team shift are checked by solver/verifier paths. |
| Statuses | ON_THE_WAY and IN_PROGRESS are retained on the current team and precede new work; COMPLETED stays assigned and is excluded from optimization; CANCELLED is removed. Invalid event time/transitions are rejected. |
| Emergency | Event time is release time; computed arrival/start cannot predate release. Current active work is kept. Future work is eligible for re-optimization. |
| Unavailable team | `TEAM_UNAVAILABLE` event/API/UI exists. Team is unavailable for future solver assignment; fixed active work can remain to avoid interruption. |
| Persistence | Child plan stores the actual planning problem/team snapshot; GET/restore independently re-verifies rather than trusting the persisted flag. |

## Dynamic replanning findings

Confirmed code defects were fixed and regression tests added for schedule release-time, team current position/availability, C++ release-time parity, fixed prefixes, event validation, team-unavailable behavior, child snapshot persistence, and restored-plan verification. API regressions cover IN_PROGRESS + emergency, ON_THE_WAY, COMPLETED plus future work, free/busy/all-busy teams, unavailable teams, cancellation, invalid timestamps, foreign/duplicate requests, and event ordering. `scripts/full_flow.py` exercises a cancellation child plan through restart/restore.

A live HTTP scenario at 13:17 kept the IN_PROGRESS request first on its current team, added the emergency with release at 13:17, produced a verified child and diff, returned explanation, and restored the child with verification. In this specific case an already-feasible future repair remained before the emergency; emergency priority is applied to assignment/coverage, not as a hard “earliest possible service before every future request” route-order constraint. No actual GPS stream exists, so the system only knows supplied team coordinates/availability snapshots and the planned schedule.

The entire ten-scenario status matrix was not individually exercised as ten distinct external-server restart flows. Automated endpoint tests cover the stated cases, but no live location data can prove actual physical movement. This is a validation limitation, not a hidden guarantee.

## Current benchmark interpretation

The current live sample in `docs/BENCHMARKS.md` shows zone_1 66/66, 7 teams; zone_2 83/83, 9; zone_3 56/56, 7; combined 205/205, 23; demo_showcase 5/5, 4. All are verified, with zero cross-section assignments. These are run-specific observations. The 23-team combined solution is found, not proven optimal. Old 20-team unrestricted, zone_3 55/56 and other old benchmark values are historical/superseded.

## Remaining limitations

- Heuristic search does not prove global fleet-size optimality.
- Search uses a wall-clock limit; travel, distance and runtime can vary.
- Haversine over anonymized coordinates gives comparative, synthetic distances.
- Priority ordering minimizes unassigned coverage lexicographically; it does not enforce earliest possible start-time ordering among all assigned jobs.
- No live GPS / dynamic shift calendar exists; actual team position is only available when supplied.
