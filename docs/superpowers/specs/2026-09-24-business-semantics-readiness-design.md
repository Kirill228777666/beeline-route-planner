# HISTORICAL / IMPLEMENTED — business semantics design

This specification records the completed business-semantics change. Current behavior and validation status are documented in `README.md` and `FINAL_RELEASE_AUDIT.md`.

# Business Semantics Readiness Design

## Goal

Align the production Beeline Route Planner with the expert interpretation of an operational section: a team may serve different districts inside one section, but never requests from another section. Preserve the C++20 solver and all existing benchmark datasets and optimization logic.

## Audit Evidence

- Existing `region_id` values in `zone_1`, `zone_2`, and `zone_3` identify mutually isolated operational sections, not geographic districts.
- `district` exists in the Python domain model but is absent from the public JSON datasets, API schemas, and frontend types.
- Python and C++ compatibility currently reject unequal `region_id` values, which correctly prevents cross-section assignments but has an inaccurate business name.
- `TeamInput` does not expose `available` or `available_from`; incoming API values are ignored even though the Python and C++ solvers enforce availability internally.
- Time-window scheduling, release time, transport, equipment, and the independent Python verifier already implement the desired hard-constraint behavior.

## Scope

### Canonical business fields

`section_id` becomes the canonical external and user-facing identifier for the operational section. `district` becomes an optional informational field on a request and a team. Compatibility must compare only section identifiers. Equal section identifiers allow assignments regardless of district; unequal identifiers reject the assignment.

Existing `region_id` remains an accepted API, dataset, persistence, and C++-payload alias for one release-compatible path. When both fields are supplied, non-empty `section_id` wins. When only `region_id` is supplied, it is interpreted as the section. An empty legacy value remains compatible only with another empty value.

The C++ solver keeps its internal `region_id` payload member unchanged. The backend maps canonical `section_id` into that member at the Python-to-C++ boundary. No solver operator, objective, route move, or C++ search logic changes.

### Availability

`available` and `available_from` must be accepted from API and JSON input, normalized into the existing domain `Team`, persisted with plans, sent to C++, and reflected by explanations. A team with `available=false` must receive no route and must be listed as `TEAM_UNAVAILABLE` when considered as an alternative.

### Time windows and replanning

Existing schedule semantics are retained: `arrival` is travel completion, `start=max(arrival, window_start, release_time)`, `finish=start+service_duration`; starts after a window or finishes after shift end are invalid. Regression coverage must pin fixed windows and an infeasible request reason.

For `IN_PROGRESS + NEW_EMERGENCY`, the in-progress request stays first and the new emergency starts no earlier than event time. The replanner may change only future work and continues to use the existing warm-start path.

### Demo data and frontend

Add `frontend/public/datasets/demo_showcase.json` without changing benchmark datasets. It must contain two sections, at least two districts in the first section, CAR/WALK/BIKE/PUBLIC_TRANSPORT teams, required transport and equipment cases, fixed two-hour windows, and an emergency request.

The frontend reads both canonical and legacy identifiers, displays `Участок` and optional `Район`, adds the fixed note `Схематическая карта. Координаты демонстрационные.`, and exposes `demo_showcase` in the dataset selector. It does not redesign the dashboard or modify the solver configuration UI.

### Documentation and report

Update API, architecture, demo, and benchmark-facing documentation to define `section_id` and legacy `region_id`. Do not alter recorded benchmark values unless measured verification shows a real change. Add `FINAL_READINESS_REPORT.md` with audit evidence, modifications, requirements coverage, test commands/results, and remaining routing limitations.

## Compatibility Rules

1. API input accepts `section_id`, `region_id`, or both.
2. `section_id` is returned/persisted for new records; `region_id` remains available for old clients and old plan payloads.
3. Existing `zone_1`, `zone_2`, `zone_3`, and `combined` JSON files remain unchanged and retain their legacy keys.
4. New demo JSON uses `section_id` and `district` to exercise the canonical path.
5. Stored plans without `section_id` restore with their stored `region_id` value as the section.

## Required Regression Coverage

- Same section, different district: compatible and assignable.
- Different sections: rejected with `WRONG_SECTION` in explanation-compatible output.
- A request waits until its window and cannot start after its window.
- An unavailable team is never used by Python or C++ solving and reports `TEAM_UNAVAILABLE`.
- CAR, WALK, BIKE, and PUBLIC_TRANSPORT matching is a hard constraint.
- Equipment matching assigns `router` and rejects missing `fiber_tool` with `NO_EQUIPMENT`.
- An in-progress request remains before a new emergency; the emergency release time is the event time.
- Legacy `region_id` payloads restore and produce the same section isolation behavior.

## Non-Goals

- No change to Regret-3, VND, ALNS, Route Pool, ejection, beam, exact-neighborhood, or objective code.
- No change to routing source or mileage semantics.
- No migration that rewrites existing plan records.
- No redesign of the frontend or addition of operational features beyond the requested display and showcase data.
