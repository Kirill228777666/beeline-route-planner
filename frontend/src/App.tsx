import { useEffect, useMemo, useState } from "react";

import { createPlanEvent, getExplanation, getPlanDiff, loadBundledDataset, optimize, replan } from "./api";
import { ControlBar } from "./components/ControlBar";
import { EventDialog, type EventSubmission } from "./components/EventDialog";
import { OperationsPanel } from "./components/OperationsPanel";
import { PlanHistory } from "./components/PlanHistory";
import { PlanSummary } from "./components/PlanSummary";
import { RequestDrawer } from "./components/RequestDrawer";
import { RouteMap } from "./components/RouteMap";
import { sectionValue, validateDataset } from "./lib/presentation";
import type { Dataset, DatasetOption, Explanation, Plan, PlanDiff, RequestStatus, SolverViewMode } from "./types";

const datasets: DatasetOption[] = [
  { id: "zone_1", label: "Участок zone_1", file: "/datasets/zone_1.json" },
  { id: "zone_2", label: "Участок zone_2", file: "/datasets/zone_2.json" },
  { id: "zone_3", label: "Участок zone_3", file: "/datasets/zone_3.json" },
  { id: "combined", label: "Объединённый набор", file: "/datasets/combined.json" },
  { id: "demo_showcase", label: "Демонстрация ограничений", file: "/datasets/demo_showcase.json" },
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
  const [selectedMapSectionId, setSelectedMapSectionId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState("");
  const [eventOpen, setEventOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [error, setError] = useState("");

  const activePlan = mode === "optimized" ? optimizedPlan : baselinePlan;
  const requestMap = useMemo(() => new Map(dataset.requests.map((request) => [request.id, request])), [dataset.requests]);
  const teamMap = useMemo(() => new Map(dataset.teams.map((team) => [team.id, team])), [dataset.teams]);
  const assignedRequestIds = useMemo(() => new Set(activePlan?.routes.flatMap((route) => route.request_ids) ?? []), [activePlan]);
  const requestsInActivePlan = useMemo(() => new Set([...(activePlan?.routes.flatMap((route) => route.request_ids) ?? []), ...(activePlan?.unassigned_requests ?? [])]), [activePlan]);
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
    setSelectedMapSectionId(null);
    setSelectedTeamId(null);
    setSelectedRequestId(null);
    setExplanation(null);
    setExplanationError("");
    setMode("optimized");
  }

  async function loadDataset(id: string) {
    const option = datasets.find((item) => item.id === id);
    if (!option) return;
    setLoading(true);
    setLoadingStep("Загружаем набор данных");
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
      setLoadingStep("");
    }
  }

  useEffect(() => { void loadDataset("zone_1"); }, []);

  async function buildPlans() {
    setLoading(true);
    setError("");
    setSelectedRequestId(null);
    setExplanation(null);
    try {
      setLoadingStep("Проверяем данные");
      const checkedDataset = validateDataset(dataset);
      if (!checkedDataset.requests.length || !checkedDataset.teams.length) throw new Error("Dataset должен содержать заявки и бригады");
      setLoadingStep("Строим baseline");
      const baseline = await optimize(checkedDataset, "baseline");
      setLoadingStep("Оптимизируем маршруты");
      const optimized = await optimize(checkedDataset, "cpp");
      setLoadingStep("Проверяем результаты");
      setBaselinePlan(baseline);
      setOptimizedPlan(optimized);
      setPreviousPlan(null);
      setDiff(emptyDiff());
      setMode("optimized");
      setStatuses(Object.fromEntries(checkedDataset.requests.map((request) => [request.id, request.status ?? "NEW"])) as Record<number, RequestStatus>);
      setSelectedMapSectionId(null);
      setSelectedTeamId(null);
      setSelectedRequestId(null);
      setExplanation(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось построить планы");
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  }

  async function loadExplanation(planId: string, requestId: number) {
    setExplanation(null);
    setExplanationError("");
    setExplanationLoading(true);
    try {
      setExplanation(await getExplanation(planId, requestId));
    } catch (cause) {
      setExplanationError(cause instanceof Error ? cause.message : "Не удалось загрузить объяснение");
    } finally {
      setExplanationLoading(false);
    }
  }

  async function selectRequest(requestId: number) {
    if (!activePlan) return;
    if (selectedRequestId === requestId) {
      setSelectedTeamId(null);
      clearSelectedRequest();
      return;
    }
    setSelectedRequestId(requestId);
    const request = requestMap.get(requestId);
    if (request && selectedMapSectionId && sectionValue(request) !== selectedMapSectionId) setSelectedMapSectionId(sectionValue(request) || null);
    const route = activePlan.routes.find((item) => item.request_ids.includes(requestId));
    setSelectedTeamId(route?.team_id ?? null);
    await loadExplanation(activePlan.plan_id, requestId);
  }

  function clearSelectedRequest() {
    setSelectedRequestId(null);
    setExplanation(null);
    setExplanationError("");
  }

  function selectTeam(teamId: number | null) {
    if (teamId !== null && teamId === selectedTeamId) {
      setSelectedTeamId(null);
      clearSelectedRequest();
      return;
    }
    if (teamId !== null) {
      const team = teamMap.get(teamId);
      if (team && selectedMapSectionId && sectionValue(team) !== selectedMapSectionId) setSelectedMapSectionId(sectionValue(team) || null);
      if (selectedRequestId !== null) {
        const requestRoute = activePlan?.routes.find((route) => route.request_ids.includes(selectedRequestId));
        if (requestRoute?.team_id !== teamId) clearSelectedRequest();
      }
    }
    setSelectedTeamId(teamId);
  }

  function selectMapSection(sectionId: string | null) {
    setSelectedMapSectionId(sectionId);
    if (sectionId === null) {
      setSelectedTeamId(null);
      clearSelectedRequest();
      return;
    }
    const focusedTeam = selectedTeamId === null ? undefined : teamMap.get(selectedTeamId);
    if (focusedTeam && sectionValue(focusedTeam) !== sectionId) setSelectedTeamId(null);
    const focusedRequest = selectedRequestId === null ? undefined : requestMap.get(selectedRequestId);
    if (focusedRequest && sectionValue(focusedRequest) !== sectionId) clearSelectedRequest();
  }

  function switchMode(nextMode: SolverViewMode) {
    if ((nextMode === "optimized" && !optimizedPlan) || (nextMode === "baseline" && !baselinePlan)) return;
    setMode(nextMode);
    setSelectedMapSectionId(null);
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
    if (!optimizedPlan || loading) return;
    setLoading(true);
    setError("");
    try {
      const parent = optimizedPlan;
      setLoadingStep("Сохраняем событие для текущего плана");
      const event = await createPlanEvent(parent.plan_id, submission.payload);
      setLoadingStep("Перепланируем будущие заявки");
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
      const changedRequest = submission.newRequest ?? requestMap.get(submission.focusRequestId);
      setSelectedMapSectionId(changedRequest ? sectionValue(changedRequest) || null : null);
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
      setLoadingStep("");
    }
  }

  const currentName = datasetId === "combined" ? "Комбинированный набор" : datasetId === "custom" ? dataset.name : `Участок ${datasetId}`;
  const activeRequest = selectedRequestId === null ? undefined : requestMap.get(selectedRequestId);
  const selectedRequestStatus = selectedRequestId === null ? "NEW" : statuses[selectedRequestId] ?? activeRequest?.status ?? (assignedRequestIds.has(selectedRequestId) ? "ASSIGNED" : "NEW");

  return <div className="app-shell">
    <ControlBar datasetId={datasetId} datasetName={currentName} datasets={datasets} mode={mode} loading={loading} loadingStep={loadingStep} hasPlan={Boolean(activePlan)} onDatasetChange={(id) => void loadDataset(id)} onFile={(file) => void loadFile(file)} onBuild={() => void buildPlans()} onModeChange={switchMode} onOpenEvent={() => setEventOpen(true)} />
    {loading && <div className="loading-status" role="status"><span className="spinner" />{loadingStep || "Выполняется операция"}</div>}
    <main className="dashboard-main">
      {error && <div className="global-error" role="alert"><span>!</span><div><strong>Операция не выполнена</strong><p>{error}</p></div><button type="button" aria-label="Закрыть ошибку" onClick={() => setError("")}>×</button></div>}
      {!activePlan ? <section className="dashboard-empty"><div className="empty-graphic"><span>1</span><span>2</span><span>3</span><svg viewBox="0 0 300 100"><path d="M18 74 C82 6 120 90 188 28 S260 48 284 16" /></svg></div><span className="section-kicker">ГОТОВО К РАСЧЁТУ</span><h1>Постройте план выездов на сегодня</h1><p>Выберите участок или загрузите JSON. Построим базовый и оптимизированный планы, затем проверим ограничения.</p><button type="button" className="build-button" disabled={loading || !dataset.requests.length} onClick={() => void buildPlans()}>{loading ? loadingStep || "Загрузка…" : "Построить план"}</button><div className="empty-features"><span>Квалификация</span><span>Транспорт</span><span>Оборудование</span><span>Проверка ограничений</span></div></section> : <>
        <PlanSummary plan={activePlan} baseline={baselinePlan} comparisonPlan={optimizedPlan} datasetSize={dataset.requests.length} mode={mode} />
        {previousPlan && mode === "optimized" && <PlanHistory before={previousPlan} after={activePlan} diff={diff} statuses={statuses} />}
        <section className="operations-grid" aria-label="Оперативная обстановка">
          <RouteMap dataset={dataset} plan={activePlan} selectedSectionId={selectedMapSectionId} selectedTeamId={selectedTeamId} selectedRequestId={selectedRequestId} onSelectTeam={selectTeam} onSelectRequest={(id) => id === null ? clearSelectedRequest() : void selectRequest(id)} onSectionChange={selectMapSection} />
          <OperationsPanel dataset={dataset} plan={activePlan} selectedTeamId={selectedTeamId} selectedRequestId={selectedRequestId} statuses={statuses} diff={mode === "optimized" ? diff : null} onSelectTeam={selectTeam} onSelectRequest={(id) => void selectRequest(id)} />
        </section>
    <footer className="dashboard-footer"><details className="technical-details"><summary>Технические детали</summary><div><span>Solver: {activePlan.solver_version || String(activePlan.metrics.solver_engine ?? (mode === "optimized" ? "C++" : "baseline"))}</span><span>Маршрутизация: {activePlan.routing_source || "Синтетические координаты / Haversine"}</span><span>Время расчёта: {String(activePlan.metrics.runtime_ms ?? "—")} мс</span><span className={activePlan.verified ? "footer-ok" : "footer-fail"}>{activePlan.verified ? "Независимая проверка ограничений: пройдена" : "Независимая проверка ограничений: не пройдена"}</span></div></details></footer>
      </>}
    </main>
    {selectedRequestId !== null && activePlan && <RequestDrawer request={activeRequest} stop={selectedAssignment?.stop} team={selectedAssignment?.team} explanation={explanation} loading={explanationLoading} error={explanationError} assigned={assignedRequestIds.has(selectedRequestId)} includedInPlan={requestsInActivePlan.has(selectedRequestId)} status={selectedRequestStatus === "NEW" && assignedRequestIds.has(selectedRequestId) ? "ASSIGNED" : selectedRequestStatus} onRetry={() => void loadExplanation(activePlan.plan_id, selectedRequestId)} onClose={clearSelectedRequest} />}
    {eventOpen && optimizedPlan && <EventDialog dataset={dataset} selectedRequestId={selectedRequestId} loading={loading} onClose={() => setEventOpen(false)} onSubmit={(submission) => void submitEvent(submission)} />}
  </div>;
}

export default App;
