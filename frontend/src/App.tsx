import { useEffect, useMemo, useState } from "react";

import { createPlanEvent, getExplanation, getPlanDiff, loadBundledDataset, optimize, replan } from "./api";
import { ControlBar } from "./components/ControlBar";
import { EventDialog, type EventSubmission } from "./components/EventDialog";
import { PlanHistory } from "./components/PlanHistory";
import { PlanSummary } from "./components/PlanSummary";
import { RequestDrawer } from "./components/RequestDrawer";
import { RouteMap } from "./components/RouteMap";
import { TeamsPanel } from "./components/TeamsPanel";
import { UnassignedSection } from "./components/UnassignedSection";
import { metricNumber, validateDataset } from "./lib/presentation";
import type { Dataset, DatasetOption, Explanation, Plan, PlanDiff, RequestStatus, SolverViewMode } from "./types";

const datasets: DatasetOption[] = [
  { id: "zone_1", label: "zone_1 · 66 заявок", request_count: 66, team_count: 12, file: "/datasets/zone_1.json" },
  { id: "zone_2", label: "zone_2 · 83 заявки", request_count: 83, team_count: 12, file: "/datasets/zone_2.json" },
  { id: "zone_3", label: "zone_3 · 56 заявок", request_count: 56, team_count: 11, file: "/datasets/zone_3.json" },
  { id: "combined", label: "combined · 205 заявок", request_count: 205, team_count: 35, file: "/datasets/combined.json" },
];

const emptyDataset: Dataset = { name: "Загрузка…", requests: [], teams: [] };
const emptyDiff = (): PlanDiff => ({ reassigned_request_ids: [], time_changed_request_ids: [], route_changed_team_ids: [], cancelled_request_ids: [], new_request_ids: [] });

function App() {
  const [datasetId, setDatasetId] = useState("zone_1");
  const [dataset, setDataset] = useState<Dataset>(emptyDataset);
  const [optimizedPlan, setOptimizedPlan] = useState<Plan | null>(null);
  const [baselinePlan, setBaselinePlan] = useState<Plan | null>(null);
  const [mode, setMode] = useState<SolverViewMode>("optimized");
  const [previousPlan, setPreviousPlan] = useState<Plan | null>(null);
  const [diff, setDiff] = useState<PlanDiff>(emptyDiff());
  const [statuses, setStatuses] = useState<Record<number, RequestStatus>>({});
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState("");
  const [eventOpen, setEventOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activePlan = mode === "optimized" ? optimizedPlan : baselinePlan;
  const requestMap = useMemo(() => new Map(dataset.requests.map((request) => [request.id, request])), [dataset.requests]);
  const teamMap = useMemo(() => new Map(dataset.teams.map((team) => [team.id, team])), [dataset.teams]);
  const selectedAssignment = useMemo(() => {
    if (!activePlan || selectedRequestId === null) return null;
    for (const route of activePlan.routes) {
      const stop = route.stops.find((item) => item.request_id === selectedRequestId);
      if (stop) return { route, stop, team: teamMap.get(route.team_id) };
    }
    return null;
  }, [activePlan, selectedRequestId, teamMap]);

  function resetPlans() {
    setOptimizedPlan(null);
    setBaselinePlan(null);
    setPreviousPlan(null);
    setDiff(emptyDiff());
    setStatuses({});
    setSelectedTeamId(null);
    setSelectedRequestId(null);
    setExplanation(null);
    setMode("optimized");
  }

  async function loadDataset(id: string) {
    const option = datasets.find((item) => item.id === id);
    if (!option) return;
    setLoading(true);
    setError("");
    try {
      const loaded = validateDataset(await loadBundledDataset(option.file));
      setDataset(loaded);
      setDatasetId(id);
      resetPlans();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Не удалось загрузить ${id}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDataset("zone_1");
  }, []);

  async function buildPlans() {
    if (!dataset.requests.length || !dataset.teams.length) {
      setError("Dataset должен содержать заявки и бригады");
      return;
    }
    setLoading(true);
    setError("");
    setSelectedRequestId(null);
    setExplanation(null);
    try {
      const [baseline, optimized] = await Promise.all([optimize(dataset, "baseline"), optimize(dataset, "cpp")]);
      setBaselinePlan(baseline);
      setOptimizedPlan(optimized);
      setPreviousPlan(null);
      setDiff(emptyDiff());
      setMode("optimized");
      setStatuses(Object.fromEntries(dataset.requests.map((request) => [request.id, "NEW"])) as Record<number, RequestStatus>);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось построить планы");
    } finally {
      setLoading(false);
    }
  }

  async function selectRequest(requestId: number) {
    if (!activePlan) return;
    setSelectedRequestId(requestId);
    setExplanation(null);
    setExplanationError("");
    setExplanationLoading(true);
    const route = activePlan.routes.find((item) => item.request_ids.includes(requestId));
    if (route) setSelectedTeamId(route.team_id);
    try {
      setExplanation(await getExplanation(activePlan.plan_id, requestId));
    } catch (cause) {
      setExplanationError(cause instanceof Error ? cause.message : "Не удалось загрузить объяснение");
    } finally {
      setExplanationLoading(false);
    }
  }

  function switchMode(nextMode: SolverViewMode) {
    if (nextMode === "optimized" && !optimizedPlan) return;
    if (nextMode === "baseline" && !baselinePlan) return;
    setMode(nextMode);
    setSelectedRequestId(null);
    setSelectedTeamId(null);
    setExplanation(null);
    setExplanationError("");
  }

  async function loadFile(file: File) {
    setError("");
    try {
      const parsed = validateDataset(JSON.parse(await file.text()));
      setDataset({ ...parsed, name: parsed.name || file.name });
      setDatasetId("custom");
      resetPlans();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Некорректный JSON dataset");
    }
  }

  async function submitEvent(submission: EventSubmission) {
    if (!optimizedPlan) return;
    setLoading(true);
    setError("");
    try {
      const parent = optimizedPlan;
      const event = await createPlanEvent(parent.plan_id, submission.payload);
      const child = await replan(parent.plan_id, event.event_id, submission.eventTime);
      let childDiff = child.diff ?? emptyDiff();
      try {
        childDiff = await getPlanDiff(child.plan_id);
      } catch {
        childDiff = child.diff ?? emptyDiff();
      }
      if (submission.newRequest) {
        setDataset((current) => ({ ...current, requests: current.requests.some((request) => request.id === submission.newRequest?.id) ? current.requests : [...current.requests, submission.newRequest as NonNullable<EventSubmission["newRequest"]>] }));
        setStatuses((current) => ({ ...current, [submission.focusRequestId]: "NEW" }));
      }
      if (submission.status) setStatuses((current) => ({ ...current, [submission.focusRequestId]: submission.status as RequestStatus }));
      const enriched = { ...child, diff: childDiff, event_id: event.event_id };
      setPreviousPlan(parent);
      setOptimizedPlan(enriched);
      setDiff(childDiff);
      setMode("optimized");
      setEventOpen(false);
      setSelectedTeamId(null);
      setSelectedRequestId(submission.focusRequestId);
      setExplanation(null);
      setExplanationError("");
      setExplanationLoading(true);
      try {
        setExplanation(await getExplanation(child.plan_id, submission.focusRequestId));
      } catch (cause) {
        setExplanationError(cause instanceof Error ? cause.message : "Не удалось загрузить объяснение изменения");
      } finally {
        setExplanationLoading(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось перепланировать день");
    } finally {
      setLoading(false);
    }
  }

  return <div className="app-shell">
    <ControlBar datasetId={datasetId} datasetName={dataset.name} datasets={datasets} mode={mode} loading={loading} hasPlan={Boolean(activePlan)} onDatasetChange={(id) => void loadDataset(id)} onFile={(file) => void loadFile(file)} onBuild={() => void buildPlans()} onModeChange={switchMode} onOpenEvent={() => setEventOpen(true)} />
    <main className="dashboard-main">
      {error && <div className="global-error"><span>!</span><div><strong>Операция не выполнена</strong><p>{error}</p></div><button type="button" aria-label="Закрыть ошибку" onClick={() => setError("")}>×</button></div>}
      {!activePlan ? <section className="dashboard-empty"><div className="empty-graphic"><span>1</span><span>2</span><span>3</span><svg viewBox="0 0 300 100"><path d="M18 74 C82 6 120 90 188 28 S260 48 284 16" /></svg></div><span className="section-kicker">ГОТОВО К РАСЧЁТУ</span><h1>Постройте план выездов на сегодня</h1><p>Выберите участок или загрузите JSON. Система одновременно рассчитает baseline и оптимизированный план, затем проверит все ограничения.</p><button type="button" className="build-button" disabled={loading || !dataset.requests.length} onClick={() => void buildPlans()}>{loading ? "Загружаем данные…" : "Построить план"}</button><div className="empty-features"><span>✓ Skills</span><span>✓ Time windows</span><span>✓ Region</span><span>✓ Python verifier</span></div></section> : <>
        <PlanSummary plan={activePlan} baseline={previousPlan ? null : baselinePlan} datasetSize={dataset.requests.length} mode={mode} />
        {previousPlan && mode === "optimized" && <PlanHistory before={previousPlan} after={activePlan} diff={diff} />}
        <section className="operations-grid"><RouteMap dataset={dataset} plan={activePlan} selectedTeamId={selectedTeamId} selectedRequestId={selectedRequestId} onSelectTeam={setSelectedTeamId} onSelectRequest={(id) => void selectRequest(id)} /><TeamsPanel dataset={dataset} plan={activePlan} selectedTeamId={selectedTeamId} selectedRequestId={selectedRequestId} statuses={statuses} diff={mode === "optimized" ? diff : null} onSelectTeam={setSelectedTeamId} onSelectRequest={(id) => void selectRequest(id)} /></section>
        <UnassignedSection dataset={dataset} plan={activePlan} onSelect={(id) => void selectRequest(id)} />
        <footer className="dashboard-footer"><span>Solver: {activePlan.solver_version || String(activePlan.metrics.solver_engine ?? (mode === "optimized" ? "C++ v1.0.2" : "baseline-v1"))}</span><span>Routing: {activePlan.routing_source || "Haversine synthetic"}</span><span className={activePlan.verified ? "footer-ok" : "footer-fail"}>{activePlan.verified ? `${metricNumber(activePlan.metrics, "assigned", dataset.requests.length - activePlan.unassigned_requests.length)}/${dataset.requests.length} feasible · verifier OK` : "Verifier failed"}</span></footer>
      </>}
    </main>
    {selectedRequestId !== null && activePlan && <RequestDrawer request={requestMap.get(selectedRequestId)} stop={selectedAssignment?.stop} team={selectedAssignment?.team} explanation={explanation} loading={explanationLoading} error={explanationError} onClose={() => { setSelectedRequestId(null); setExplanation(null); setExplanationError(""); }} />}
    {eventOpen && optimizedPlan && <EventDialog dataset={dataset} selectedRequestId={selectedRequestId} loading={loading} onClose={() => setEventOpen(false)} onSubmit={(submission) => void submitEvent(submission)} />}
  </div>;
}

export default App;
