# Algorithm

The solver handles a VRPTW-like problem with hard skills, transport, equipment, time-window, and shift constraints.

## Objective

Solutions are compared lexicographically:

1. fewer unassigned emergency requests;
2. fewer unassigned connection requests;
3. fewer other unassigned requests;
4. fewer used teams;
5. lower travel time;
6. lower distance.

## Search pipeline

- Baseline: requests in input order, first feasible team.
- Optimized mode: Regret-3 insertion over every feasible team and position, followed by VND (`relocate`, `swap`, `2-opt`, and cross-route `2-opt*`).
- Advanced phases include route elimination, ALNS, ejection chains, beam search, multi-start, route-pool recombination, and target-free fleet reduction when enabled by `SolverConfig`.
- Incremental route tables and compatibility/travel caches reduce repeated schedule work. The C++ solver retains the best valid incumbent until the time limit.

The Python `SolutionVerifier`/`verify_solution` is independent from the search implementation and is the final acceptance gate. The solver does not hardcode a target fleet size.
