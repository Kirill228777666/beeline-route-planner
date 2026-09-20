# Beeline Route Planner 1.0.2 FINAL

Единый рабочий проект содержит FastAPI backend, C++20/pybind11 solver, React frontend, миграции SQLite, production datasets и независимый Python verifier.

## Сборка

Требуются Python 3.12+, Node.js 18+, npm, g++ с поддержкой C++20 и DLL runtime MSYS2 в `PATH`/DLL search path.

```powershell
cd outputs/clean_project
.\build.ps1
```

Скрипт создаёт `.venv`, устанавливает точные версии из `requirements.lock`, собирает C++ extension и production frontend. C++ модуль создаётся только сборкой из `cpp_solver/src`; prebuilt binary в проект не включён.

## Запуск

```powershell
.\start.ps1
```

Или без пересборки:

```powershell
.\start.ps1
```

Backend: `http://127.0.0.1:8000`, frontend: `http://127.0.0.1:5173`. SQLite database и схема создаются/обновляются автоматически через idempotent migration runner. Для другого пути используется `BEELINE_DATABASE_URL`.

## Проверки

```powershell
.\.venv\Scripts\python.exe -m pytest -q backend\tests cpp_solver\tests
.\.venv\Scripts\python.exe scripts\full_flow.py
```

`full_flow.py` выполняет `optimize → save → explanation → event → replan → restart → restore` на dataset zone_1 и проверяет `verified=true` на каждом результате.

Версия solver: `cpp-solver-v1.0.2`. Routing source: `haversine_synthetic`; обезличенные адреса не подменяются псевдореальным OSRM расстоянием. `LOCAL` — квалификация (skill) из исходных данных, а не тип работы. Заявка может быть назначена только бригаде с тем же `region_id`.

Production path не содержит старых stage benchmark, audit snapshots, промежуточных бинарников, node_modules, dist или Python caches. Исторические материалы остаются в соседних каталогах `outputs/stage*` и `outputs/solver_audit` для сравнения.
