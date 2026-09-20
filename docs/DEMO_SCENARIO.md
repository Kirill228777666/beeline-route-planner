# Demo scenario

1. From the project root run `.\build.ps1` once.
2. Run `.\start.ps1`.
3. Open `http://127.0.0.1:5173` and select `combined`.
4. Build the optimized plan. Confirm `205/205`, `24` teams, `0` cross-region assignments, and `verified=true`.
5. Select a request and open its explanation. The response is produced from the stored constraint/solver facts.
6. Add an event at `13:17`: cancellation/status change or a new emergency request. For an emergency, select its source region; it can only be assigned to a team in that same region.
7. Replan. The API returns a new child plan, before/after metrics, and a diff.
8. Confirm fixed statuses are unchanged and inspect changed assignments, times, routes, and new/cancelled requests.
9. Stop and restart the backend with `.\start.ps1`; load the child plan again to verify SQLite restoration.

The command-line equivalent of the persistence/replanning scenario is `.\.venv\Scripts\python.exe scripts\full_flow.py` after build.
