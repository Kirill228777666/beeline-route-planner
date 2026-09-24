# Demo scenario

1. From the project root run `.\build.ps1` once.
2. Run `.\start.ps1`.
3. Open `http://127.0.0.1:5173` and select `demo_showcase`.
4. Build the optimized plan. Show two sections, two districts inside `section_1`, all four transport types, router/fiber-tool requirements, fixed two-hour windows, and `verified=true`.
5. Select a request and open its explanation. Show hard constraint outcomes and a rejected alternative such as `NO_TRANSPORT`, `NO_EQUIPMENT`, or `TEAM_UNAVAILABLE`.
6. Add a new emergency at `13:17` in `section_1`. Explain that it cannot start before the event and cannot cross to another section.
7. Replan. The API returns a new child plan, before/after metrics, and a diff. Confirm an `IN_PROGRESS` request remains first when used in the scenario.
8. Then select `combined` for the production-scale result: confirm `205/205`, at most `24` teams, no cross-section assignments, and `verified=true`.
9. Stop and restart the backend with `.\start.ps1`; load the child plan again to verify SQLite restoration.

The command-line equivalent of the persistence/replanning scenario is `.\.venv\Scripts\python.exe scripts\full_flow.py` after build.
