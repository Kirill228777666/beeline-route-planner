# HISTORICAL / SUPERSEDED — not current release

This archived snapshot describes `v1.0.1`; it is not the current release.
Use the root README and `FINAL_RELEASE_AUDIT.md` for `v1.0.2 FINAL` status.

# Release snapshot v1.0.1

Status: **FROZEN FOR DEFENSE**  
Snapshot date: 2026-09-20  
Solver version: `cpp-solver-v1.0.1`  
Routing source: `haversine_synthetic`

This snapshot contains the final official business semantics. BK/HD are source
classification fields only; work types are `CONNECTION`, `EMERGENCY`,
`ADD_ON`, and `REPAIR`. Service duration is on-site work plus documents;
travel is calculated separately. Search algorithms and C++ optimization
operators were not changed.

Measured combined result: `205/205`, `20` used teams, `verified=true`.
Zone 3 currently returns `55/56` under the corrected official durations and
is still independently verifier-valid. See [acceptance_report.md](acceptance_report.md)
and [docs/BENCHMARKS.md](docs/BENCHMARKS.md) for the full measured table.

Do not change backend, solver, business semantics, datasets, or launcher before
the defense without an explicit release decision.
