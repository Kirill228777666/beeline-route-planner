# Route Control frontend

React + TypeScript + Vite frontend for the ready-plan MVP.

## Run

From the project root, start backend and frontend together:

```powershell
.\\start.ps1
```

For frontend-only development:

```powershell
cd frontend
npm install
npm run dev
```

The frontend uses `http://127.0.0.1:8000` by default. Set `VITE_API_URL` to point at another backend URL.

Prepared datasets are bundled in `public/datasets`: `zone_1` (66), `zone_2` (83), `zone_3` (56), `combined` (205), and `demo_showcase` for the business-constraint demonstration. Their coordinates use the same deterministic synthetic fallback as the benchmark because the source addresses are anonymized.

The **Построить план** action calls `POST /api/optimize` twice, with `solver: "baseline"` and `solver: "cpp"`. The screen compares both verified solutions and lets the user switch the displayed map/routes. **Добавить событие** is enabled only for the optimized plan and sends a status change or emergency request through the existing events/replan/diff API. Animations are not included.
