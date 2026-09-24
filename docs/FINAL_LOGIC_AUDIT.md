# Final logic audit

## Current production interpretation

The historical unrestricted audit is superseded. `section_id` is the canonical operational boundary. `region_id` remains only a compatibility alias at the API, persistence, and C++ payload boundary. A team may receive work from different districts in its section; it cannot receive work from another section. Empty identifiers match only empty identifiers.

## Verified rules

| Area | Result |
|---|---|
| Work types | BK/HD remain source metadata. Work uses CONNECTION, EMERGENCY, ADD_ON, or REPAIR. |
| Priority | EMERGENCY > CONNECTION > REPAIR / ADD_ON. |
| Duration | Onsite services are 70 / 80 / 20 / 30 minutes; travel is separate. |
| Time windows | Arrival, start, finish, shift end, and release time are checked by schedule calculation and verifier. |
| Sections and districts | Same section is required; districts are informational. |
| Skills, transport, equipment | All are hard constraints in Python, C++, and the independent verifier path. |
| Availability | `available=false` is a hard rejection with `TEAM_UNAVAILABLE`. |
| Replanning | COMPLETED, IN_PROGRESS, and ON_THE_WAY remain fixed. A new emergency uses event time as release time and follows active work. |
| Persistence | Plan snapshots retain canonical section data through save, event, replan, restart, and restore. |
| Frontend | Displays sections and districts, actual explanations, and the synthetic-map disclaimer. |

## Dataset interpretation

`zone_1`, `zone_2`, and `zone_3` are independent operational sections. `combined` is their technical union: source section values remain attached to every request and team, and cross-section assignment is rejected. The old unrestricted 20-team combined result is not a release benchmark.

## Limits

The routing view is schematic and the released matrix uses Haversine over anonymized coordinates. Distance values are comparative. Search is heuristic rather than a proof of global optimality; every returned solution still requires the independent Python verifier.
