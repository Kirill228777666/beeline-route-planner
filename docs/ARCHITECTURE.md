# Architecture

## Runtime

The release candidate is a single local project with three runtime layers:

1. React/Vite frontend (`frontend/`), served on `127.0.0.1:5173`.
2. FastAPI backend (`backend/app/`), served on `127.0.0.1:8000`.
3. C++20/pybind11 optimization core (`cpp_solver/`), loaded by Python after `build.ps1`.

SQLite is the default persistence layer. `backend/app/db/migrations.py` runs idempotent schema migrations at application startup. A `Plan` stores the input snapshot, solution, metrics, verification flag, solver configuration, solver version, and routing source. Replanning creates a child plan and leaves the parent unchanged.

The Python layer owns domain models, importing, routing fallback, constraint verification, persistence, explainability, and replanning. The C++ module performs the optimization search. Python calls the independent verifier after every solver result; an unverified solution is never returned by the API.

## Production path

`start.ps1` is the only supported local launcher. It starts both processes and sets `PYTHONPATH`, `BEELINE_DATABASE_URL`, and `VITE_API_URL`. `build.ps1` is the only build entry point: it installs `requirements.lock`, builds the C++ extension, runs `npm ci`, and creates the frontend bundle.

Historical stage/audit outputs are outside this release package and are not imported by the production path.
