import { useEffect, useMemo, useState } from "react";

type RequestInput = {
  id: number; address: string; lat: number; lon: number; window_start: string; window_end: string;
  service_duration: number; work_type: string; required_skills: string[]; required_transport?: string | null; region_id?: string;
};
type TeamInput = { id: number; name: string; start_lat: number; start_lon: number; shift_start: string; shift_end: string; skills: string[]; transport: string; region_id?: string };
type Dataset = { name: string; requests: RequestInput[]; teams: TeamInput[]; regions?: string[] };
type DatasetOption = { id: string; label: string; request_count: number; team_count: number; file: string };
type Stop = { request_id: number; arrival: number; start: number; finish: number; travel_time: number; travel_distance: number; waiting: number };
type Route = { team_id: number; request_ids: number[]; distance_km: number; stops: Stop[] };
type PlanDiff = { reassigned_request_ids: number[]; time_changed_request_ids: number[]; route_changed_team_ids: number[]; cancelled_request_ids: number[]; new_request_ids: number[] };
type Plan = { plan_id: string; parent_plan_id?: string | null; verified: boolean; metrics: Record<string, number>; routes: Route[]; unassigned_requests: number[]; diff?: PlanDiff; metrics_before?: Record<string, number>; metrics_after?: Record<string, number>; event_id?: number; event_time?: number };
type Explanation = { request_id: number; team_id: number | null; reason: string; arrival: string | null; start: string | null; finish: string | null; hard_constraints: { code: string; passed: boolean; reason_code?: string }[]; alternatives: { team_id: number; rejected_reason: string | null; status?: string }[]; replanning_reason?: string };
type EventType = "NEW_EMERGENCY" | "STATUS_CHANGED";
type RequestStatus = "NEW" | "ASSIGNED" | "ON_THE_WAY" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type EmergencyDraft = { id: number; address: string; lat: number; lon: number; window_start: string; window_end: string; region_id: string };
type SolverViewMode = "optimized" | "baseline";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";
const COLORS = ["#ffb547", "#7c8cff", "#31d6aa", "#ff6f91", "#b995ff", "#61c8ff"];

const datasetCatalog: DatasetOption[] = [
  { id: "zone_1", label: "zone_1 · 66 заявок", request_count: 66, team_count: 12, file: "/datasets/zone_1.json" },
  { id: "zone_2", label: "zone_2 · 83 заявки", request_count: 83, team_count: 12, file: "/datasets/zone_2.json" },
  { id: "zone_3", label: "zone_3 · 56 заявок", request_count: 56, team_count: 11, file: "/datasets/zone_3.json" },
  { id: "combined", label: "combined · 205 заявок", request_count: 205, team_count: 35, file: "/datasets/combined.json" },
];

const emptyDataset: Dataset = { name: "Загрузка dataset…", requests: [], teams: [] };

function formatMinutes(value: number | undefined) {
  if (value === undefined) return "—";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function emptyDiff(): PlanDiff {
  return { reassigned_request_ids: [], time_changed_request_ids: [], route_changed_team_ids: [], cancelled_request_ids: [], new_request_ids: [] };
}

function isFixedStatus(status: RequestStatus | undefined) {
  return status === "COMPLETED" || status === "IN_PROGRESS" || status === "ON_THE_WAY";
}

function nextRequestId(requests: RequestInput[]) {
  return requests.reduce((max, request) => Math.max(max, request.id), 0) + 1;
}

function App() {
  const [datasetId, setDatasetId] = useState("zone_1");
  const [dataset, setDataset] = useState<Dataset>(emptyDataset);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [optimizedPlan, setOptimizedPlan] = useState<Plan | null>(null);
  const [baselinePlan, setBaselinePlan] = useState<Plan | null>(null);
  const [viewMode, setViewMode] = useState<SolverViewMode>("optimized");
  const [previousPlan, setPreviousPlan] = useState<Plan | null>(null);
  const [diff, setDiff] = useState<PlanDiff>(emptyDiff());
  const [requestStatuses, setRequestStatuses] = useState<Record<number, RequestStatus>>({});
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [eventOpen, setEventOpen] = useState(false);
  const [eventType, setEventType] = useState<EventType>("NEW_EMERGENCY");
  const [eventTime, setEventTime] = useState("13:17");
  const [eventRequestId, setEventRequestId] = useState<number | "">("");
  const [eventStatus, setEventStatus] = useState<RequestStatus>("CANCELLED");
  const [emergency, setEmergency] = useState<EmergencyDraft>({ id: 0, address: "", lat: 55.75, lon: 37.62, window_start: "13:17", window_end: "18:00", region_id: "" });

  const requestMap = useMemo(() => new Map(dataset.requests.map((request) => [request.id, request])), [dataset]);
  const teamMap = useMemo(() => new Map(dataset.teams.map((team) => [team.id, team])), [dataset]);

  async function loadDataset(id: string) {
    const option = datasetCatalog.find((item) => item.id === id);
    if (!option) return;
    setLoading(true); setError(""); setPlan(null); setOptimizedPlan(null); setBaselinePlan(null); setPreviousPlan(null); setDiff(emptyDiff()); setExplanation(null); setSelectedRequestId(null);
    try {
      const response = await fetch(option.file);
      if (!response.ok) throw new Error(`Не удалось загрузить ${id}`);
      const loaded = await response.json() as Dataset;
      setDataset(loaded);
      setDatasetId(id);
      setViewMode("optimized"); setPreviousPlan(null); setDiff(emptyDiff()); setRequestStatuses({});
      setEmergency((current) => ({ ...current, id: nextRequestId(loaded.requests), region_id: loaded.regions?.[0] ?? loaded.teams[0]?.region_id ?? "" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить dataset");
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadDataset("zone_1"); }, []);

  async function buildPlan() {
    if (!dataset.requests.length || !dataset.teams.length) {
      setError("Dataset ещё не загружен");
      return;
    }
    setLoading(true); setError(""); setExplanation(null); setSelectedRequestId(null);
    try {
      const optimize = async (solver: SolverViewMode) => {
        const response = await fetch(`${API_URL}/api/optimize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...dataset, solver: solver === "optimized" ? "cpp" : "baseline" }) });
        if (!response.ok) throw new Error(await response.text());
        return await response.json() as Plan;
      };
      const [baseline, optimized] = await Promise.all([optimize("baseline"), optimize("optimized")]);
      setBaselinePlan(baseline); setOptimizedPlan(optimized); setPlan(optimized); setViewMode("optimized"); setPreviousPlan(null); setDiff(emptyDiff());
      setRequestStatuses(Object.fromEntries(dataset.requests.map((request) => [request.id, "NEW"])) as Record<number, RequestStatus>);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось построить план");
    } finally { setLoading(false); }
  }

  async function selectRequest(requestId: number) {
    setSelectedRequestId(requestId); setExplanation(null);
    if (!plan) return;
    await loadExplanation(plan.plan_id, requestId);
  }

  async function loadExplanation(planId: string, requestId: number) {
    try {
      const response = await fetch(`${API_URL}/api/plans/${planId}/requests/${requestId}/explanation`);
      if (!response.ok) throw new Error(await response.text());
      setExplanation(await response.json() as Explanation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить объяснение"); }
  }

  function openEventDialog() {
    setEmergency((current) => ({ ...current, id: current.id || nextRequestId(dataset.requests) }));
    setEventRequestId(selectedRequestId ?? dataset.requests[0]?.id ?? "");
    setEventOpen(true); setError("");
  }

  function switchView(mode: SolverViewMode) {
    const nextPlan = mode === "optimized" ? optimizedPlan : baselinePlan;
    if (!nextPlan) return;
    setViewMode(mode); setPlan(nextPlan); setDiff(mode === "optimized" ? (nextPlan.diff ?? diff) : emptyDiff()); setSelectedRequestId(null); setExplanation(null);
  }

  async function submitEvent() {
    if (!plan) return;
    if (eventType === "STATUS_CHANGED" && eventRequestId === "") {
      setError("Выберите заявку для изменения статуса");
      return;
    }
    if (eventType === "NEW_EMERGENCY" && !emergency.address.trim()) {
      setError("Укажите адрес аварийной заявки");
      return;
    }
    setLoading(true); setError("");
    try {
      const eventBody = eventType === "NEW_EMERGENCY"
        ? { event_type: eventType, event_time: eventTime, request: { id: emergency.id || nextRequestId(dataset.requests), address: emergency.address, lat: emergency.lat, lon: emergency.lon, window_start: emergency.window_start, window_end: emergency.window_end, service_duration: 80, work_type: "EMERGENCY", required_skills: ["EMERGENCY"], required_transport: null, region_id: emergency.region_id } }
        : { event_type: eventType, event_time: eventTime, request_id: Number(eventRequestId), status: eventStatus };
      const eventResponse = await fetch(`${API_URL}/api/plans/${plan.plan_id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(eventBody) });
      if (!eventResponse.ok) throw new Error(await eventResponse.text());
      const event = await eventResponse.json() as { event_id: number };
      const replanResponse = await fetch(`${API_URL}/api/plans/${plan.plan_id}/replan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_time: eventTime, event_id: event.event_id }) });
      if (!replanResponse.ok) throw new Error(await replanResponse.text());
      const replanned = await replanResponse.json() as Plan;
      const diffResponse = await fetch(`${API_URL}/api/plans/${replanned.plan_id}/diff`);
      const savedDiff = diffResponse.ok ? await diffResponse.json() as PlanDiff : replanned.diff ?? emptyDiff();
      const focusRequestId = eventType === "NEW_EMERGENCY" ? (eventBody.request as { id: number }).id : Number(eventRequestId);
      if (eventType === "NEW_EMERGENCY") {
        const newRequest = eventBody.request as RequestInput;
        setDataset((current) => ({ ...current, requests: current.requests.some((request) => request.id === newRequest.id) ? current.requests : [...current.requests, newRequest] }));
        setRequestStatuses((current) => ({ ...current, [newRequest.id]: "NEW" }));
      } else {
        setRequestStatuses((current) => ({ ...current, [Number(eventRequestId)]: eventStatus }));
      }
      const optimizedChild = { ...replanned, diff: savedDiff, event_id: event.event_id };
      setPreviousPlan(plan); setOptimizedPlan(optimizedChild); setPlan(optimizedChild); setViewMode("optimized"); setDiff(savedDiff); setEventOpen(false); setSelectedRequestId(focusRequestId); setExplanation(null);
      void loadExplanation(replanned.plan_id, focusRequestId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить replanning");
    } finally { setLoading(false); }
  }

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Dataset;
        if (!Array.isArray(parsed.requests) || !Array.isArray(parsed.teams)) throw new Error("Нужны массивы requests и teams");
         const loaded = { ...parsed, name: parsed.name || file.name };
         setDataset(loaded); setDatasetId("custom"); setPlan(null); setOptimizedPlan(null); setBaselinePlan(null); setViewMode("optimized"); setPreviousPlan(null); setDiff(emptyDiff()); setRequestStatuses({}); setEmergency((current) => ({ ...current, id: nextRequestId(loaded.requests), region_id: loaded.regions?.[0] ?? loaded.teams[0]?.region_id ?? "" })); setError("");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Некорректный JSON dataset"); }
    };
    reader.readAsText(file);
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">B</div><div><div className="eyebrow">BEELINE BUSINESS</div><h1>Route Control</h1></div></div>
      <div className="header-status"><span className="status-dot" /> C++ optimization core <span className="divider" /> Synthetic routing matrix</div>
    </header>
    <main>
      <section className="hero">
        <div><div className="eyebrow accent">OPERATIONS CONSOLE · MVP</div><h2>План на сегодня</h2><p>Соберите маршруты бригад, проверьте окна и разберите каждую остановку.</p></div>
        <div className="controls">
          <select value={datasetId} onChange={(event) => { if (event.target.value !== "custom") void loadDataset(event.target.value); }}>
            {datasetCatalog.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
            {datasetId === "custom" && <option value="custom">{dataset.name}</option>}
          </select>
          <label className="file-button">Загрузить JSON<input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && loadFile(event.target.files[0])} /></label>
          <button className="primary-button" onClick={buildPlan} disabled={loading}>{loading ? "Считаем…" : "Построить план"}<span>↗</span></button>
          <button className="secondary-button" onClick={openEventDialog} disabled={!plan || loading || viewMode !== "optimized"}>Добавить событие{viewMode === "baseline" ? " · только optimized" : ""}</button>
        </div>
      </section>
      {error && <div className="error-banner">{error}</div>}
      {eventOpen && plan && <EventDialog eventType={eventType} setEventType={setEventType} eventTime={eventTime} setEventTime={setEventTime} eventRequestId={eventRequestId} setEventRequestId={setEventRequestId} eventStatus={eventStatus} setEventStatus={setEventStatus} emergency={emergency} setEmergency={setEmergency} dataset={dataset} onCancel={() => setEventOpen(false)} onSubmit={submitEvent} loading={loading} />}
      {plan ? <>
        <div className={`verification-badge ${plan.verified ? "verified" : "failed"}`}>verified = {String(plan.verified)}</div>
        {baselinePlan && optimizedPlan && <SolverComparison baseline={baselinePlan} optimized={optimizedPlan} selected={viewMode} onSelect={switchView} />}
        {previousPlan && viewMode === "optimized" && <PlanComparison before={previousPlan} after={plan} diff={diff} />}
        <section className="kpi-grid">
          <Kpi label="Выполнено заявок" value={`${plan.metrics.assigned ?? 0}`} detail={`из ${dataset.requests.length}`} tone="yellow" />
          <Kpi label="Неназначено" value={`${plan.metrics.unassigned ?? plan.unassigned_requests.length}`} detail={plan.unassigned_requests.length ? "нужна проверка" : "всё покрыто"} tone="red" />
          <Kpi label="Задействовано бригад" value={`${plan.metrics.used_teams ?? plan.routes.length}`} detail="активных маршрутов" tone="purple" />
          <Kpi label="Travel time" value={`${plan.metrics.total_travel_minutes ?? 0} мин`} detail="в пути" tone="blue" />
          <Kpi label="Пробег" value={`${plan.metrics.total_distance_km ?? 0} км`} detail="по маршрутам" tone="green" />
          <Kpi label="Время расчёта" value={`${plan.metrics.runtime_ms ?? 0} мс`} detail="C++ solver" tone="orange" />
        </section>
        <section className="workspace-grid">
          <aside className="routes-panel panel">
            <div className="panel-heading"><div><div className="eyebrow">DISPATCH</div><h3>Бригады и маршруты</h3></div><span className="count-pill">{plan.routes.length}</span></div>
            <div className="route-list">{plan.routes.map((route, index) => <RouteCard key={route.team_id} route={route} team={teamMap.get(route.team_id)} color={COLORS[index % COLORS.length]} selectedRequestId={selectedRequestId} onSelect={selectRequest} requestMap={requestMap} diff={diff} requestStatuses={requestStatuses} />)}</div>
            {plan.unassigned_requests.length > 0 && <div className="unassigned-block"><div className="section-label">НЕНАЗНАЧЕННЫЕ · {plan.unassigned_requests.length}</div>{plan.unassigned_requests.map((id) => <button className="unassigned-item" key={id} onClick={() => selectRequest(id)}><span className="warning-icon">!</span><span><strong>Заявка #{id}</strong><small>{requestMap.get(id)?.address ?? "Причина доступна в объяснении"}</small></span><span>›</span></button>)}</div>}
          </aside>
          <section className="map-panel panel"><MapView dataset={dataset} plan={plan} selectedRequestId={selectedRequestId} onSelect={selectRequest} teamMap={teamMap} requestMap={requestMap} diff={diff} /></section>
          <aside className="details-panel panel">{selectedRequestId !== null ? <RequestDetails request={requestMap.get(selectedRequestId)} explanation={explanation} /> : <EmptyDetails />}</aside>
        </section>
      </> : <EmptyState />}
    </main>
  </div>;
}

function Kpi({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <div className={`kpi-card ${tone}`}><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div><div className="kpi-detail">{detail}</div></div>; }

function requestDiffLabels(requestId: number, diff: PlanDiff) {
  const labels: string[] = [];
  if (diff.new_request_ids.includes(requestId)) labels.push("NEW");
  if (diff.reassigned_request_ids.includes(requestId)) labels.push("REASSIGNED");
  if (diff.time_changed_request_ids.includes(requestId)) labels.push("TIME");
  if (diff.cancelled_request_ids.includes(requestId)) labels.push("CANCELLED");
  return labels;
}

function RouteCard({ route, team, color, selectedRequestId, onSelect, requestMap, diff, requestStatuses }: { route: Route; team?: TeamInput; color: string; selectedRequestId: number | null; onSelect: (id: number) => void; requestMap: Map<number, RequestInput>; diff: PlanDiff; requestStatuses: Record<number, RequestStatus> }) {
  const routeChanged = diff.route_changed_team_ids.includes(route.team_id);
  return <article className={`route-card ${routeChanged ? "route-changed" : ""}`}><div className="route-title"><span className="route-color" style={{ background: color }} /><div><strong>{team?.name ?? `Бригада ${route.team_id}`}</strong><small>{route.request_ids.length} остановок · {route.distance_km.toFixed(1)} км</small></div><span className="team-id">#{route.team_id}</span>{routeChanged && <span className="diff-badge route-badge">ROUTE CHANGED</span>}</div><div className="stops">{route.stops.map((stop) => { const labels = requestDiffLabels(stop.request_id, diff); const fixed = isFixedStatus(requestStatuses[stop.request_id]); return <button className={`stop-row ${selectedRequestId === stop.request_id ? "selected" : ""} ${labels.length ? "stop-changed" : ""} ${fixed ? "stop-fixed" : ""}`} key={stop.request_id} onClick={() => onSelect(stop.request_id)}><span className="stop-number">{route.request_ids.indexOf(stop.request_id) + 1}</span><span className="stop-main"><strong>Заявка #{stop.request_id} {fixed && <span className="fixed-badge">FIXED</span>}</strong><small>{requestMap.get(stop.request_id)?.address ?? "Адрес не указан"}</small>{labels.length > 0 && <span className="diff-tags">{labels.map((label) => <em key={label}>{label}</em>)}</span>}</span><span className="stop-times"><b>{formatMinutes(stop.start)}</b><small>{formatMinutes(stop.finish)}</small></span></button>; })}</div></article>;
}

function MapView({ dataset, plan, selectedRequestId, onSelect, teamMap, requestMap, diff }: { dataset: Dataset; plan: Plan; selectedRequestId: number | null; onSelect: (id: number) => void; teamMap: Map<number, TeamInput>; requestMap: Map<number, RequestInput>; diff: PlanDiff }) {
  const points = [...dataset.requests.map((item) => ({ lat: item.lat, lon: item.lon })), ...dataset.teams.map((item) => ({ lat: item.start_lat, lon: item.start_lon }))];
  const minLat = Math.min(...points.map((point) => point.lat)) - 0.004, maxLat = Math.max(...points.map((point) => point.lat)) + 0.004;
  const minLon = Math.min(...points.map((point) => point.lon)) - 0.004, maxLon = Math.max(...points.map((point) => point.lon)) + 0.004;
  const project = (lat: number, lon: number) => ({ x: 5 + ((lon - minLon) / (maxLon - minLon)) * 90, y: 8 + (1 - (lat - minLat) / (maxLat - minLat)) * 84 });
  return <><div className="map-heading"><div><div className="eyebrow">LIVE MAP</div><h3>География маршрутов</h3></div><div className="map-legend">{plan.routes.map((route, index) => <span key={route.team_id}><i style={{ background: COLORS[index % COLORS.length] }} />#{route.team_id}</span>)}</div></div><div className="map-canvas"><div className="map-grid-lines" /> <svg viewBox="0 0 100 100" preserveAspectRatio="none">{plan.routes.map((route, index) => { const team = teamMap.get(route.team_id); const line = [team && project(team.start_lat, team.start_lon), ...route.request_ids.map((id) => { const item = requestMap.get(id); return item && project(item.lat, item.lon); })].filter(Boolean) as { x: number; y: number }[]; return <polyline key={route.team_id} points={line.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={COLORS[index % COLORS.length]} strokeWidth={diff.route_changed_team_ids.includes(route.team_id) ? "1.5" : "0.8"} strokeLinecap="round" strokeLinejoin="round" />; })}{dataset.teams.map((team) => { const point = project(team.start_lat, team.start_lon); return <rect key={`team-${team.id}`} x={point.x - 1} y={point.y - 1} width="2" height="2" rx="0.4" fill="#f4f5f8" />; })}{dataset.requests.map((request) => { const point = project(request.lat, request.lon); const routeIndex = plan.routes.findIndex((route) => route.request_ids.includes(request.id)); const color = routeIndex >= 0 ? COLORS[routeIndex % COLORS.length] : "#64708b"; const changed = requestDiffLabels(request.id, diff).length > 0; return <g key={request.id} className="map-point" onClick={() => onSelect(request.id)}><circle cx={point.x} cy={point.y} r={selectedRequestId === request.id ? 2.6 : 1.8} fill={color} stroke={changed ? "#ffc72c" : selectedRequestId === request.id ? "#fff" : "#101728"} strokeWidth={changed ? "1.2" : "0.7"} /><text x={point.x + 2.5} y={point.y + 1} fill="#dce2f0" fontSize="2.3">{request.id}</text></g>; })}</svg><div className="map-scale">synthetic coordinates · Haversine fallback</div></div></>;
}

function solverMetric(plan: Plan, key: "assigned" | "unassigned" | "used_teams" | "travel" | "distance" | "runtime") {
  if (key === "travel") return plan.metrics.total_travel_minutes ?? 0;
  if (key === "distance") return plan.metrics.total_distance_km ?? 0;
  if (key === "runtime") return plan.metrics.runtime_ms ?? 0;
  if (key === "unassigned") return plan.metrics.unassigned ?? plan.unassigned_requests.length;
  return plan.metrics[key] ?? (key === "used_teams" ? plan.routes.length : 0);
}

function improvementText(baseline: number, optimized: number, higherIsBetter: boolean, unit: string) {
  const rawChange = optimized - baseline;
  const improvement = higherIsBetter ? rawChange : baseline - optimized;
  const percentage = baseline === 0 ? 0 : (improvement / Math.abs(baseline)) * 100;
  const raw = `${rawChange > 0 ? "+" : rawChange < 0 ? "−" : ""}${Math.abs(rawChange)} ${unit}`;
  const score = `${improvement > 0 ? "+" : improvement < 0 ? "−" : ""}${Math.abs(percentage).toFixed(1)}% ${improvement >= 0 ? "улучшение" : "ухудшение"}`;
  return `${raw} · ${score}`;
}

function SolverComparison({ baseline, optimized, selected, onSelect }: { baseline: Plan; optimized: Plan; selected: SolverViewMode; onSelect: (mode: SolverViewMode) => void }) {
  const rows: { key: "assigned" | "unassigned" | "used_teams" | "travel" | "distance" | "runtime"; label: string; unit: string; higherIsBetter: boolean }[] = [
    { key: "assigned", label: "Назначено заявок", unit: "заявок", higherIsBetter: true },
    { key: "unassigned", label: "Неназначено", unit: "заявок", higherIsBetter: false },
    { key: "used_teams", label: "Задействовано бригад", unit: "бригад", higherIsBetter: false },
    { key: "travel", label: "Travel time", unit: "мин", higherIsBetter: false },
    { key: "distance", label: "Distance", unit: "км", higherIsBetter: false },
    { key: "runtime", label: "Runtime", unit: "мс", higherIsBetter: false },
  ];
  return <section className="solver-comparison"><div className="solver-comparison-heading"><div><div className="eyebrow accent">SOLVER COMPARISON</div><h3>Baseline vs Оптимизированный</h3><p>Оба решения построены через один API и прошли независимый verifier.</p></div><div className="view-switch"><button className={selected === "baseline" ? "active" : ""} onClick={() => onSelect("baseline")}>Baseline</button><button className={selected === "optimized" ? "active" : ""} onClick={() => onSelect("optimized")}>Оптимизированный</button></div></div><div className="solver-status"><span className="solver-card"><small>BASELINE</small><b>{baseline.verified ? "verified" : "not verified"}</b><em>{baseline.plan_id.slice(0, 8)}</em></span><span className="solver-card optimized-card"><small>OPTIMIZED · C++</small><b>{optimized.verified ? "verified" : "not verified"}</b><em>{optimized.plan_id.slice(0, 8)}</em></span></div><div className="comparison-table"><div className="comparison-table-head"><span>Метрика</span><span>Baseline</span><span>Optimized</span><span>Улучшение</span></div>{rows.map((row) => { const before = solverMetric(baseline, row.key); const after = solverMetric(optimized, row.key); return <div className="comparison-row" key={row.key}><span>{row.label}</span><b>{before} {row.unit}</b><b>{after} {row.unit}</b><small className={after === before ? "neutral" : after > before === row.higherIsBetter ? "positive" : "negative"}>{improvementText(before, after, row.higherIsBetter, row.unit)}</small></div>; })}</div></section>;
}

function PlanComparison({ before, after, diff }: { before: Plan; after: Plan; diff: PlanDiff }) {
  const changedRequests = new Set([...diff.reassigned_request_ids, ...diff.time_changed_request_ids, ...diff.new_request_ids, ...diff.cancelled_request_ids]).size;
  return <section className="comparison-panel"><div><div className="eyebrow accent">REPLANNING DIFF</div><h3>Новый дочерний план</h3><p>Родительский план <code>{before.plan_id.slice(0, 8)}</code> сохранён. Новый план <code>{after.plan_id.slice(0, 8)}</code>.</p></div><div className="comparison-metrics"><CompareMetric label="Заявки" before={`${before.metrics.assigned ?? 0}`} after={`${after.metrics.assigned ?? 0}`} /><CompareMetric label="Бригады" before={`${before.metrics.used_teams ?? before.routes.length}`} after={`${after.metrics.used_teams ?? after.routes.length}`} /><CompareMetric label="Travel time" before={`${before.metrics.total_travel_minutes ?? 0} мин`} after={`${after.metrics.total_travel_minutes ?? 0} мин`} /><CompareMetric label="Пробег" before={`${before.metrics.total_distance_km ?? 0} км`} after={`${after.metrics.total_distance_km ?? 0} км`} /><CompareMetric label="Runtime" before={`${before.metrics.runtime_ms ?? 0} мс`} after={`${after.metrics.runtime_ms ?? 0} мс`} /></div><div className="diff-summary"><span>{changedRequests} заявок изменено</span><span>{diff.reassigned_request_ids.length} переназначено</span><span>{diff.time_changed_request_ids.length} по времени</span><span>{diff.route_changed_team_ids.length} маршрутов</span><span>{diff.new_request_ids.length} новых</span><span>{diff.cancelled_request_ids.length} отменено</span></div></section>;
}

function CompareMetric({ label, before, after }: { label: string; before: string; after: string }) {
  return <div className="compare-metric"><small>{label}</small><span>{before}</span><b>→ {after}</b></div>;
}

function EventDialog({ eventType, setEventType, eventTime, setEventTime, eventRequestId, setEventRequestId, eventStatus, setEventStatus, emergency, setEmergency, dataset, onCancel, onSubmit, loading }: { eventType: EventType; setEventType: (value: EventType) => void; eventTime: string; setEventTime: (value: string) => void; eventRequestId: number | ""; setEventRequestId: (value: number | "") => void; eventStatus: RequestStatus; setEventStatus: (value: RequestStatus) => void; emergency: EmergencyDraft; setEmergency: (value: EmergencyDraft) => void; dataset: Dataset; onCancel: () => void; onSubmit: () => void; loading: boolean }) {
  const updateEmergency = (field: keyof EmergencyDraft, value: string) => setEmergency({ ...emergency, [field]: field === "id" || field === "lat" || field === "lon" ? Number(value) : value });
  const regions = dataset.regions?.length ? dataset.regions : [...new Set(dataset.teams.map((team) => team.region_id).filter(Boolean))];
  return <div className="modal-backdrop"><section className="event-dialog"><div className="modal-heading"><div><div className="eyebrow accent">EVENT STREAM</div><h3>Добавить событие</h3><p>Событие будет сохранено и отправлено в replanning API.</p></div><button className="icon-button" onClick={onCancel}>×</button></div><div className="event-form"><label>Тип события<select value={eventType} onChange={(event) => setEventType(event.target.value as EventType)}><option value="NEW_EMERGENCY">Новая аварийная заявка</option><option value="STATUS_CHANGED">Изменение статуса</option></select></label><label>Время события<input type="time" value={eventTime} onChange={(event) => setEventTime(event.target.value)} /></label>{eventType === "STATUS_CHANGED" ? <><label>Заявка<select value={eventRequestId} onChange={(event) => setEventRequestId(event.target.value ? Number(event.target.value) : "")}><option value="">Выберите заявку</option>{dataset.requests.map((request) => <option value={request.id} key={request.id}>#{request.id} · {request.address}</option>)}</select></label><label>Новый статус<select value={eventStatus} onChange={(event) => setEventStatus(event.target.value as RequestStatus)}><option value="CANCELLED">CANCELLED · отменить</option><option value="ON_THE_WAY">ON_THE_WAY · в пути</option><option value="IN_PROGRESS">IN_PROGRESS · выполняется</option><option value="COMPLETED">COMPLETED · выполнено</option></select></label></> : <><label>ID заявки<input type="number" value={emergency.id} onChange={(event) => updateEmergency("id", event.target.value)} /></label><label>Адрес<input value={emergency.address} onChange={(event) => updateEmergency("address", event.target.value)} placeholder="Адрес аварии" /></label><div className="form-row"><label>Широта<input type="number" step="0.0001" value={emergency.lat} onChange={(event) => updateEmergency("lat", event.target.value)} /></label><label>Долгота<input type="number" step="0.0001" value={emergency.lon} onChange={(event) => updateEmergency("lon", event.target.value)} /></label></div><div className="form-row"><label>Окно с<input type="time" value={emergency.window_start} onChange={(event) => updateEmergency("window_start", event.target.value)} /></label><label>Окно до<input type="time" value={emergency.window_end} onChange={(event) => updateEmergency("window_end", event.target.value)} /></label></div><label>Регион<select value={emergency.region_id} onChange={(event) => updateEmergency("region_id", event.target.value)}>{regions.map((region) => <option value={region} key={region}>{region}</option>)}</select></label><div className="emergency-note">Авария: 80 минут работы на месте; 100 минут — официальный норматив вместе с 20 минутами дороги.</div></>}</div><div className="modal-actions"><button className="secondary-button" onClick={onCancel}>Отмена</button><button className="primary-button" onClick={onSubmit} disabled={loading}>{loading ? "Перепланируем…" : "Перепланировать"}<span>↗</span></button></div></section></div>;
}

function RequestDetails({ request, explanation }: { request?: RequestInput; explanation: Explanation | null }) { return <div className="details-content"><div className="eyebrow">REQUEST INSPECTOR</div><h3>Заявка #{request?.id}</h3><p className="address">{request?.address}</p>{explanation ? <><div className="detail-status"><span className="status-dot" /> {explanation.team_id ? `Назначена бригаде #${explanation.team_id}` : "Не назначена"}</div><div className="reason-box"><strong>Почему</strong><p>{explanation.reason}</p>{explanation.replanning_reason && <p className="replan-note">{explanation.replanning_reason}</p>}</div><div className="time-strip"><div><small>ARRIVAL</small><b>{explanation.arrival ?? "—"}</b></div><div><small>START</small><b>{explanation.start ?? "—"}</b></div><div><small>FINISH</small><b>{explanation.finish ?? "—"}</b></div></div><div className="constraints"><div className="section-label">HARD CONSTRAINTS</div>{explanation.hard_constraints.map((constraint) => <div className="constraint-row" key={constraint.code}><span className={constraint.passed ? "check" : "cross"}>{constraint.passed ? "✓" : "×"}</span><span>{constraint.code}</span>{constraint.reason_code && <small>{constraint.reason_code}</small>}</div>)}</div><div className="constraints"><div className="section-label">АЛЬТЕРНАТИВЫ</div>{explanation.alternatives.map((alternative) => <div className="alternative-row" key={alternative.team_id}><span>#{alternative.team_id}</span><small className={alternative.rejected_reason ? "rejected" : "feasible"}>{alternative.rejected_reason ?? alternative.status}</small></div>)}</div></> : <div className="loading-detail">Загружаем объяснение…</div>}</div>; }
function EmptyDetails() { return <div className="empty-details"><div className="empty-icon">⌖</div><h3>Выберите заявку</h3><p>Кликните остановку в маршруте или точку на карте, чтобы увидеть расписание и объяснение решения.</p></div>; }
function EmptyState() { return <section className="empty-state"><div className="empty-orb">✦</div><h3>План ещё не построен</h3><p>Выберите dataset и запустите C++ solver, чтобы увидеть маршруты бригад.</p></section>; }

export default App;
