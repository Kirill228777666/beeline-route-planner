# Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current monolithic planner screen with a polished, tested, single-screen operations dashboard backed by the existing API.

**Architecture:** Keep network and workflow state in `App`, move shared contracts and presentation calculations into typed modules, and render focused React components for controls, metrics, SVG routes, teams, request details, events, and plan history. No backend contract or solver behavior changes.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest, React Testing Library, SVG, existing FastAPI endpoints

**Spec:** `docs/superpowers/specs/2026-09-20-operations-dashboard-design.md`

## Global Constraints

- Work only in `C:\Users\Kirill\Documents\Biline project`.
- Keep Python backend, C++ solver, datasets, API contracts, priorities, constraints, and persistence unchanged.
- Keep the map network-independent and based on the current dataset coordinates.
- Replanning remains available only for optimized plans.
- Preserve `zone_1`, `zone_2`, `zone_3`, `combined`, and JSON upload.
- Do not introduce authentication, live GPS, external routing, mobile UI, BI configuration, or solver controls.
- Do not add source-code comments or explanatory docstrings.

## Review Focus

- A plan with zero baseline metric values must produce finite, readable comparison values.
- Identical request coordinates must remain separately selectable on the SVG map.
- An explanation request failure must leave the active plan and selected request visible.
- A custom JSON file with missing request/team arrays must be rejected before optimization.
- Baseline mode must disable replanning and never display optimized diff state as baseline data.

---

### Task 1: Typed presentation model and test infrastructure

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/lib/presentation.ts`
- Create: `frontend/src/lib/presentation.test.ts`
- Create: `frontend/src/test/setup.ts`
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Produces: shared `Dataset`, `Plan`, `Route`, `Stop`, `Explanation`, `PlanDiff`, `SolverViewMode`, and event types.
- Produces: `formatClock`, `formatDistance`, `percentageChange`, `metricComparison`, `normalizeMapPoints`, `workTypeLabel`, `validateDataset`.

- [ ] **Step 1: Add the test runner and write failing presentation tests**

```ts
import { describe, expect, it } from "vitest";
import { formatClock, percentageChange, validateDataset, workTypeLabel } from "./presentation";

describe("presentation helpers", () => {
  it("formats minute values as a clock", () => expect(formatClock(568)).toBe("09:28"));
  it("handles a zero comparison denominator", () => expect(percentageChange(0, 7)).toBeNull());
  it("translates official work types", () => expect(workTypeLabel("EMERGENCY")).toBe("Авария"));
  it("rejects datasets without teams", () => expect(() => validateDataset({ requests: [] })).toThrow("teams"));
});
```

- [ ] **Step 2: Run `npm test -- --run` and verify module-resolution failures**

- [ ] **Step 3: Implement the typed contracts and minimal helper behavior**

```ts
export function percentageChange(before: number, after: number) {
  if (before === 0) return null;
  return ((after - before) / before) * 100;
}
```

- [ ] **Step 4: Run the frontend test suite and verify all helper tests pass**

- [ ] **Step 5: Commit the task**

```powershell
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/types.ts frontend/src/lib frontend/src/test
git commit -m "test: add dashboard presentation model"
```

### Task 2: Summary, comparison, and control components

**Files:**
- Create: `frontend/src/components/ControlBar.tsx`
- Create: `frontend/src/components/PlanSummary.tsx`
- Create: `frontend/src/components/PlanSummary.test.tsx`
- Create: `frontend/src/components/PlanHistory.tsx`

**Interfaces:**
- Consumes: typed plans, datasets, comparison helpers, and callback props.
- Produces: accessible dataset controls, solver switch, KPI cards, verifier banner, baseline delta strip, and parent-child history.

- [ ] **Step 1: Write failing component tests for coverage, verifier, finite percentage text, and disabled baseline replanning**

```tsx
render(<PlanSummary plan={optimizedPlan} baseline={baselinePlan} datasetSize={66} />);
expect(screen.getByText("66/66")).toBeInTheDocument();
expect(screen.getByText("Python verifier: OK")).toBeInTheDocument();
expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused tests and verify missing-component failures**

- [ ] **Step 3: Implement controls, KPI cards, baseline deltas, and history cards**

```tsx
<button type="button" disabled={!canReplan} onClick={onOpenEvent}>Событие в течение дня</button>
```

- [ ] **Step 4: Run focused and full frontend tests**

- [ ] **Step 5: Commit the task**

```powershell
git add frontend/src/components
git commit -m "feat: add planner controls and metrics"
```

### Task 3: Interactive map, teams panel, and request drawer

**Files:**
- Create: `frontend/src/components/RouteMap.tsx`
- Create: `frontend/src/components/RouteMap.test.tsx`
- Create: `frontend/src/components/TeamsPanel.tsx`
- Create: `frontend/src/components/RequestDrawer.tsx`
- Create: `frontend/src/components/UnassignedSection.tsx`

**Interfaces:**
- Consumes: dataset lookups, active plan, selected team/request, statuses, diff, and explanation state.
- Produces: selectable SVG routes and stops, route timelines, request details, hard-constraint evidence, and unassigned request states.

- [ ] **Step 1: Write failing tests for numbered stops, emergency labels, duplicate-coordinate offsets, team focus, and unassigned zero/nonzero states**

```tsx
render(<RouteMap dataset={datasetWithDuplicatePoints} plan={plan} selectedTeamId={10003} />);
expect(screen.getAllByRole("button", { name: /Заявка/ })).toHaveLength(2);
expect(screen.getByText("Авария")).toBeInTheDocument();
```

- [ ] **Step 2: Run focused tests and verify missing-component failures**

- [ ] **Step 3: Implement the SVG map and route focus behavior**

```tsx
<g role="button" tabIndex={0} aria-label={`Заявка ${request.id}`} onClick={() => onSelectRequest(request.id)} />
```

- [ ] **Step 4: Implement the teams timeline, drawer, and unassigned section**

```tsx
<time>{formatClock(stop.start)}–{formatClock(stop.finish)}</time>
```

- [ ] **Step 5: Run focused and full frontend tests**

- [ ] **Step 6: Commit the task**

```powershell
git add frontend/src/components frontend/src/lib/presentation.ts frontend/src/lib/presentation.test.ts
git commit -m "feat: add interactive route workspace"
```

### Task 4: Replanning workflow and application composition

**Files:**
- Create: `frontend/src/api.ts`
- Create: `frontend/src/components/EventDialog.tsx`
- Create: `frontend/src/App.test.tsx`
- Replace: `frontend/src/App.tsx`
- Replace: `frontend/src/styles.css`

**Interfaces:**
- Consumes: all components and the existing optimize, explanation, event, replan, and diff endpoints.
- Produces: the complete responsive dashboard and preserved application workflow.

- [ ] **Step 1: Write failing application tests for initial dataset state, JSON validation, optimized/baseline switching, request selection, and replanning diff rendering**

```tsx
render(<App />);
expect(await screen.findByText("Построить план")).toBeInTheDocument();
expect(screen.getByText(/zone_1/)).toBeInTheDocument();
```

- [ ] **Step 2: Run application tests and verify expected composition failures**

- [ ] **Step 3: Implement typed API calls and compose application state**

```ts
const [baseline, optimized] = await Promise.all([
  optimize(dataset, "baseline"),
  optimize(dataset, "cpp"),
]);
```

- [ ] **Step 4: Implement the event dialog and parent-child diff flow**

```ts
const event = await createPlanEvent(plan.plan_id, payload);
const child = await replan(plan.plan_id, event.event_id, eventTime);
```

- [ ] **Step 5: Replace styling with the approved desktop and responsive dashboard system**

```css
.operations-grid { display: grid; grid-template-columns: minmax(0, 1fr) 390px; gap: 16px; }
@media (max-width: 1100px) { .operations-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Run application tests and the full frontend suite**

- [ ] **Step 7: Commit the task**

```powershell
git add frontend/src frontend/package.json frontend/package-lock.json frontend/vite.config.ts
git commit -m "feat: deliver operations dashboard"
```

### Task 5: Release verification

**Files:**
- Modify only if verification exposes a tested defect.

**Interfaces:**
- Consumes: complete project.
- Produces: fresh evidence for frontend, backend, C++, and API compatibility.

- [ ] **Step 1: Run `npm test -- --run` in `frontend` and require zero failures**
- [ ] **Step 2: Run `npm run build` in `frontend` and require TypeScript/Vite success**
- [ ] **Step 3: Run `.\.venv\Scripts\python.exe -m pytest backend/tests cpp_solver/tests -q` and require all existing tests to pass**
- [ ] **Step 4: Run `.\.venv\Scripts\python.exe scripts\full_flow.py` and require verified parent/child plans and restart restore**
- [ ] **Step 5: Start the application, inspect the rendered dashboard at desktop and laptop widths, and verify the primary interaction path**
- [ ] **Step 6: Run `git diff --check` and confirm the working tree contains only intentional changes**
- [ ] **Step 7: Commit any verification-backed correction and record final evidence in the delivery response**
