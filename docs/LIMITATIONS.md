# Limitations

- Global mathematical optimality is not proved; the solver is a bounded heuristic/hybrid search.
- Demo routing currently uses synthetic coordinates and Haversine fallback, not authoritative road-network distances.
- Therefore kilometres and travel distances are comparative benchmark values, not operational navigation estimates.
- Wall-clock time limits can slightly change secondary metrics even with a fixed seed; hard feasibility and the verifier gate remain mandatory.
- The primary correctness guarantee is the independent Python verifier, run after solver output and before API response.
- The release package does not include a prebuilt C++ binary or `node_modules`; `build.ps1` requires Python 3.12+, Node.js/npm, and a C++20-capable g++ toolchain.
