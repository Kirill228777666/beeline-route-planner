# API

Base URL: `http://127.0.0.1:8000`.

## Build a plan

`POST /api/optimize`

Request body contains `requests`, `teams`, `solver` (`baseline` or `cpp`), and optional `solver_config`. `section_id` is the canonical operational field: an assignment is allowed only when request and team have the same section. `district` is informational and never blocks an assignment inside one section. `region_id` remains a supported legacy alias; if both are passed, non-empty `section_id` wins. Empty values match only empty values.

Team input additionally supports `available` and `available_from`. An unavailable team is a hard-ineligible candidate and receives `TEAM_UNAVAILABLE` in an explanation.

`service_duration` is accepted at the API boundary for input compatibility, but the backend normalizes it through the official catalogue: CONNECTION 70, EMERGENCY 80, ADD_ON 20, REPAIR 30 minutes. Travel is calculated separately.

The response contains `plan_id`, routes, unassigned requests, metrics, `verified`, `solver_config`, `solver_version`, and `routing_source`.

## Persisted plans and replanning

- `GET /api/plans/{plan_id}` — restore a saved plan.
- `POST /api/plans/{plan_id}/events` — save a status change, cancellation, or new emergency event.
- `POST /api/plans/{plan_id}/replan` — create a new child plan using the parent plan and event history.
- `GET /api/plans/{plan_id}/diff` — return changed assignments, times, routes, cancellations, and new requests.
- `GET /api/plans/{plan_id}/requests/{request_id}/explanation` — deterministic assignment/constraint explanation.

Replanning preserves `COMPLETED`, `IN_PROGRESS`, and `ON_THE_WAY` work, removes `CANCELLED` work, and returns not-yet-started work to the optimization pool. A new emergency receives `release_time=event_time`, is normalized to 80 minutes of onsite service, and cannot start before the event. The response includes before/after metrics and `verified=true` for an accepted child plan.

## Error contract

Invalid request payloads return FastAPI validation errors (`422`). Missing plans or requests return `404`; a replan without an event returns `400`. A solver result rejected by the verifier returns `503`. These errors are request-scoped and do not terminate the backend process.
