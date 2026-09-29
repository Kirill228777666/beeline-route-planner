# HISTORICAL / SUPERSEDED — initial dashboard design

This specification predates the Leaflet implementation and describes the original dashboard direction. It is not the current UI contract; see `README.md` and `FINAL_RELEASE_AUDIT.md`.

# Operations Dashboard Design

## Purpose

Build a single-screen dispatch dashboard that presents the existing route-planning backend as a complete demo product. The interface must let a jury member select or upload a dataset, calculate optimized and baseline plans, inspect routes and explanations, and demonstrate emergency replanning without exposing solver internals or changing backend behavior.

## Constraints

- Keep the Python backend, C++ solver, datasets, API contracts, priorities, constraints, and persistence behavior unchanged.
- Work only in the `Biline project` release copy.
- Use the existing React 19, TypeScript, and Vite application.
- Keep the map self-contained and network-independent because demo coordinates and routing are synthetic/Haversine-based.
- Replanning is available only for the optimized plan.
- Do not add authentication, roles, live GPS, chat, mobile applications, OSRM, solver tuning controls, BI dashboards, or `TEAM_UNAVAILABLE` UI.
- Preserve support for `zone_1`, `zone_2`, `zone_3`, `combined`, and uploaded JSON datasets.

## Visual Direction

The dashboard uses Beeline yellow as the primary action and route-highlight color, graphite and deep navy surfaces for operational contrast, and restrained green/red state colors. Information density is high but structured: controls first, plan health second, operational map and routes third. All important labels remain in Russian, while backend reason codes remain visible where they help diagnostics.

The layout consists of:

1. A sticky top control bar with project identity, current district, dataset selection, JSON upload, plan build action, optimized/baseline switch, and intraday event action.
2. A KPI row with assignment coverage, used teams, distance, travel time, unassigned count, runtime, and independent verifier status.
3. A compact baseline comparison strip with absolute and percentage changes.
4. A main two-column workspace: a large map and a right-side teams panel.
5. A request drawer opened from map markers or route stops.
6. Lower sections for unassigned requests and plan history/diff.
7. A modal for emergency creation, cancellation, and request status changes.

At desktop widths, the map remains the visual center. At narrower widths, the teams panel moves below the map and cards remain readable without forcing a fixed minimum page width.

## Component Boundaries

### Application state

`App` owns dataset selection, API requests, current optimized and baseline plans, active view, event workflow, selected team/request, explanations, and error/loading state. It delegates rendering to focused components and derives lookup maps and view models with memoized selectors.

### Control bar

`ControlBar` displays the active region explicitly and owns no network behavior. It emits dataset selection, file selection, build, solver-view switch, and event-open actions.

### Plan summary

`PlanSummary` renders KPI cards and verifier status. `BaselineComparison` compares the two existing plan responses and presents both absolute and percentage differences while handling zero denominators safely.

### Route map

`RouteMap` normalizes dataset coordinates into an SVG viewport. It renders office markers, route polylines, numbered stops, emergency markers, unassigned markers, and a legend. Selecting a team keeps its route at full opacity and dims all other routes. Selecting a point opens the request drawer. Coordinates with identical values receive a stable visual offset so markers remain selectable.

### Teams panel

`TeamsPanel` contains only used teams. Each `TeamRouteCard` displays team identity, region, shift, skills, transport, equipment, request count, and route distance. Its timeline begins at the office and shows each request address, work type, client window, actual start, and finish. Cards support team focus and clearly mark changed routes and fixed requests after replanning.

### Request drawer

`RequestDrawer` combines immutable request data, the selected stop, request status, and the existing explanation endpoint. It displays assignment, schedule, requirements, hard-constraint checks, rejected alternatives, and replanning reason. Loading, API error, assigned, and unassigned states are distinct.

### Replanning and history

`EventDialog` supports `NEW_EMERGENCY` and `STATUS_CHANGED`; cancellation is represented as status `CANCELLED`, matching the existing backend contract. After replanning, `PlanHistory` shows the parent-child relationship and `PlanDiffSummary` lists reassigned requests, changed times, changed routes, new requests, cancelled requests, and before/after metrics.

### Unassigned requests

`UnassignedSection` is always present, including the zero state. For each unassigned request it displays address, type, region, and the reason returned by the explanation endpoint after selection.

## Data Flow

1. Dataset selection fetches static JSON and resets plan-specific state.
2. Building a plan sends the same dataset concurrently to `/api/optimize` with `baseline` and `cpp` solvers.
3. The optimized plan becomes the initial active view; switching views changes only presentation state.
4. Selecting a request fetches `/api/plans/{plan_id}/requests/{request_id}/explanation`.
5. Submitting an event posts to `/api/plans/{plan_id}/events`, then `/api/plans/{plan_id}/replan`, then reads `/api/plans/{new_plan_id}/diff`.
6. The child optimized plan replaces the active optimized view while the parent remains in local history for comparison.

No client-side calculation may claim feasibility. The verifier badge reflects only the backend `verified` field.

## Error Handling

- Invalid uploaded JSON is rejected before optimization with a user-readable message.
- Failed dataset, optimize, explanation, event, replan, or diff requests show contextual errors without clearing the last valid plan.
- Buttons that would create duplicate requests are disabled during active operations.
- Empty datasets and missing teams cannot be optimized.
- A failed explanation request affects only the drawer and does not invalidate the plan display.
- Baseline and optimized verification states are displayed independently.

## Accessibility and Interaction

- All interactive controls use native buttons, inputs, labels, and visible focus states.
- Map points are keyboard-selectable SVG buttons or equivalent accessible controls.
- Color is supplemented with labels, shapes, numbering, and status text.
- Dialog focus remains inside the event modal until it is closed.
- Loading and verification status are announced with readable text, not icons alone.

## Testing

Add a minimal Vitest and React Testing Library setup. Tests cover metric calculations, safe percentage comparison, work-type labels, coordinate normalization, team-route filtering, uploaded dataset validation, initial dashboard rendering, optimized/baseline switching, request selection, unassigned zero/nonzero states, and replanning diff rendering. The final verification includes frontend tests, TypeScript/Vite production build, the existing backend/C++ suite, and a smoke test against the existing API flow.

## Acceptance Criteria

- All four bundled datasets can be selected and optimized through the existing API.
- Optimized and baseline plans can be compared and independently inspected.
- KPI values, verifier state, route timelines, and unassigned counts come from the returned plan.
- The map displays offices, numbered route stops, emergency and unassigned states, route colors, and a legend.
- Team selection dims unrelated routes.
- Request selection displays the backend explanation and hard-constraint evidence.
- Emergency/status/cancellation replanning produces a child plan and visible diff.
- The interface remains usable at common laptop widths.
- Existing backend and C++ tests remain green and the frontend production build succeeds.

## Non-Goals

The change does not add new solver behavior, backend endpoints, authentication, user management, live tracking, external routing, mobile applications, advanced analytics, or new event types.
