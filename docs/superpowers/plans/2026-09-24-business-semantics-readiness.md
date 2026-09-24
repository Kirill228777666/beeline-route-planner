# Business Semantics Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct section/district semantics and API availability handling, add an auditable constraint showcase, and prove every business rule without modifying C++ search logic.

**Architecture:** Python exposes `section_id` as the canonical external business value while preserving `region_id` as an API and persistence alias. At the Python-to-C++ boundary canonical section values continue to use the existing C++ `region_id` key. District is informational and never affects compatibility.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, SQLAlchemy/SQLite, C++20/pybind11, React/TypeScript/Vite, pytest, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-business-semantics-readiness-design.md`

## Global Constraints

- Do not change Regret-3, VND, ALNS, Route Pool, ejection, beam, exact-neighborhood, or objective logic.
- Do not alter the four release benchmark JSON files.
- C++ retains its `region_id` payload key; the backend maps canonical section values into it.
- `section_id` wins over `region_id`; an empty identifier matches only an empty identifier.
- Every production change starts with a failing test and ends with the full regression suite.
- Do not change the release version.

## Review Focus

- A payload containing both identifiers consistently uses `section_id`.
- A legacy persisted plan containing only `region_id` restores with identical isolation.
- `available=false` survives FastAPI input through C++ conversion.
- An in-progress prefix remains before a new emergency after replanning.
- Demo data exercises every stated transport and equipment condition without changing benchmark inputs.

---

### Task 1: Canonical Section and Team Availability

**Files:**
- Modify: `backend/app/domain/models.py`
- Modify: `backend/app/api/schemas.py`
- Modify: `backend/app/api/routes.py`
- Modify: `backend/app/importer/csv_parser.py`
- Test: `backend/tests/test_constraints.py`
- Test: `backend/tests/test_api.py`
- Test: `backend/tests/test_persistence.py`

**Produces:** canonical domain properties `Request.section_id`, `Team.section_id`; API fields `section_id`, `district`, `available`, and `available_from` while retaining `region_id`.

- [ ] Write failing tests for same-section/different-district compatibility, cross-section rejection, canonical precedence, API `available=false`, and legacy persistence.
- [ ] Run `.venv\Scripts\python.exe -m pytest backend/tests/test_constraints.py backend/tests/test_api.py backend/tests/test_persistence.py -q` and verify failures name the missing behavior.
- [ ] Add canonical-first resolution at API/import/persistence boundaries and map availability/minutes into `Team`; retain stored and C++ payload `region_id` compatibility.
- [ ] Re-run the focused tests and verify PASS.
- [ ] Commit with `git commit -m "fix: support canonical operational sections"`.

### Task 2: Constraint Explanations and Emergency Regression

**Files:**
- Modify: `backend/app/constraints/engine.py`
- Modify: `backend/app/services/explainability.py`
- Modify: `backend/app/services/replanning.py`
- Test: `backend/tests/test_constraints.py`
- Test: `backend/tests/test_explainability.py`
- Test: `backend/tests/test_replanning.py`
- Test: `backend/tests/test_solver_audit.py`

**Consumes:** canonical aliases from Task 1. **Produces:** section-aware explanation labels, real availability reasons, and in-progress emergency regression coverage without changing replanning or solver interfaces.

- [ ] Write failing tests for `TEAM_UNAVAILABLE` explanations, CAR/WALK/BIKE/PUBLIC_TRANSPORT matching, router/fiber_tool equipment, and `IN_PROGRESS + NEW_EMERGENCY` ordering/release time.
- [ ] Run `.venv\Scripts\python.exe -m pytest backend/tests/test_explainability.py backend/tests/test_replanning.py backend/tests/test_solver_audit.py -q` and verify RED.
- [ ] Compare canonical section aliases in ConstraintEngine/explanations and confirm existing C++ adapter passes availability and canonical section under its legacy key.
- [ ] Re-run focused tests and verify PASS.
- [ ] Commit with `git commit -m "test: cover operational hard constraints"`.

### Task 3: Showcase Data and Frontend Terminology

**Files:**
- Create: `frontend/public/datasets/demo_showcase.json`
- Modify: `frontend/public/datasets/index.json`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/ControlBar.tsx`
- Modify: `frontend/src/components/RouteMap.tsx`
- Modify: `frontend/src/components/TeamsPanel.tsx`
- Modify: `frontend/src/components/RequestDrawer.tsx`
- Modify: `frontend/src/components/EventDialog.tsx`
- Modify: `frontend/src/lib/presentation.ts`
- Test: `frontend/src/**/*.test.ts*`

**Consumes:** canonical/legacy section values and district. **Produces:** `demo_showcase` selection, labels `Участок` / `Район`, and a schematic-coordinate disclaimer.

- [ ] Write failing component tests for canonical section/district text and the exact map disclaimer.
- [ ] Run `npm test -- --run src/components/PlanSummary.test.tsx src/components/RouteMap.test.tsx` and verify RED.
- [ ] Add deterministic demo JSON with two sections, two districts inside the first, all four transports, router/fiber_tool constraints, two-hour windows, and an emergency; resolve display values with `section_id ?? region_id`.
- [ ] Run `npm test -- --run; npm run build` and verify PASS.
- [ ] Commit with `git commit -m "feat: add business-rule showcase dataset"`.

### Task 4: Documentation, Final Verification, and Report

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEMO_SCENARIO.md`
- Modify: `docs/FINAL_LOGIC_AUDIT.md`
- Modify: `scripts/full_flow.py`
- Test: `backend/tests/test_stage18_hardening.py`
- Create: `FINAL_READINESS_REPORT.md`

**Consumes:** the compatibility contract and showcase from Tasks 1–3. **Produces:** final evidence and an accurate handoff report.

- [ ] Write failing tests that optimize `demo_showcase` through the API and prove canonical section survives save, restart, restore, event, and replan.
- [ ] Run `.venv\Scripts\python.exe -m pytest backend/tests/test_stage18_hardening.py backend/tests/test_persistence.py -q` and verify RED.
- [ ] Update documentation, supersede the historical unrestricted audit wording, and write the final report after collecting final command output.
- [ ] Run the full regression commands:

```powershell
.\venv\Scripts\python.exe -m pytest -q
.\venv\Scripts\python.exe scripts\build_cpp_solver.py
npm --prefix frontend test -- --run
npm --prefix frontend run build
$env:PYTHONPATH='backend'; .\venv\Scripts\python.exe scripts\full_flow.py
```

- [ ] Optimize all four benchmark datasets with the fixed release configuration, assert `verified=true`, and compare assigned/used-team metrics with existing thresholds.
- [ ] Commit with `git commit -m "docs: record final business readiness"`.

## Plan Self-Review

- Tasks 1–4 cover sections/districts, windows, replanning, availability, transport, equipment, frontend, showcase data, docs, and the final report.
- The canonical `section_id` and legacy `region_id` contract is consistent in all task interfaces.
- Each Review Focus case has a named task and executable regression coverage.
