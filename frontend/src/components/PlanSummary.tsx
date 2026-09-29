import { formatDistance, metricComparison, metricNumber } from "../lib/presentation";
import type { Plan, SolverViewMode } from "../types";

type PlanSummaryProps = {
  plan: Plan;
  baseline: Plan | null;
  comparisonPlan?: Plan | null;
  datasetSize: number;
  mode: SolverViewMode;
};

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-head"><span>{label}</span></div><strong>{value}</strong></article>;
}

function Delta({ label, before, after, higherIsBetter = false, suffix = "" }: { label: string; before: number; after: number; higherIsBetter?: boolean; suffix?: string }) {
  const comparison = metricComparison(before, after, higherIsBetter);
  const percent = comparison.percent === null ? null : `${Math.abs(comparison.percent).toFixed(1).replace(".", ",")}%`;
  const sign = comparison.delta > 0 ? "+" : comparison.delta < 0 ? "−" : "";
  const outcome = comparison.delta === 0 ? "без изменений" : `${sign}${formatDistance(Math.abs(comparison.delta))}${suffix}${percent ? ` · ${percent}` : ""}`;
  return <div className="delta-item"><span>{label}</span><div><b>{formatDistance(before)}{suffix}</b><i aria-hidden="true">→</i><b>{formatDistance(after)}{suffix}</b></div><small className={comparison.delta === 0 ? "neutral" : comparison.improved ? "positive" : "negative"}>{outcome}</small></div>;
}

export function PlanSummary({ plan, baseline, comparisonPlan, datasetSize, mode }: PlanSummaryProps) {
  const assigned = metricNumber(plan.metrics, "assigned");
  const usedTeams = metricNumber(plan.metrics, "used_teams", plan.routes.length);
  const distance = metricNumber(plan.metrics, "total_distance_km");
  const travel = metricNumber(plan.metrics, "total_travel_minutes");
  const unassigned = metricNumber(plan.metrics, "unassigned", plan.unassigned_requests.length);
  const planRequestCount = typeof plan.metrics.assigned === "number" && typeof plan.metrics.unassigned === "number" ? assigned + unassigned : datasetSize;
  const optimized = comparisonPlan ?? (mode === "optimized" ? plan : null);
  const baselineAssigned = baseline ? metricNumber(baseline.metrics, "assigned") : 0;
  const optimizedAssigned = optimized ? metricNumber(optimized.metrics, "assigned") : 0;

  return <section className="summary-section" aria-label="Показатели плана">
    <div className="summary-heading"><h1>{mode === "optimized" ? "Оптимизированный план" : "Базовый план"}</h1><div className={`verifier-status ${plan.verified ? "ok" : "failed"}`} role="status" title={plan.verified ? "Проверка ограничений выполнена" : "Проверка ограничений не пройдена"}>{plan.verified ? "✓ Проверен" : "! Проверка не пройдена"}</div></div>
    <div className="metrics-grid">
      <Kpi label="Назначено" value={`${assigned}/${planRequestCount}`} tone="coverage" />
      <Kpi label="Бригады" value={`${usedTeams}`} tone="teams" />
      <Kpi label="Пробег" value={`${formatDistance(distance)} км`} tone="distance" />
      <Kpi label="Время в пути" value={`${formatDistance(travel)} мин`} tone="travel" />
      <Kpi label="Неназначено" value={`${unassigned}`} tone={unassigned ? "warning" : "clean"} />
    </div>
    {baseline && optimized && <div className="comparison-strip" aria-label="Сравнение baseline и оптимизированного плана">
      <div className="comparison-title"><strong>Базовый → Оптимизированный</strong></div>
      <Delta label="Назначено" before={baselineAssigned} after={optimizedAssigned} higherIsBetter />
      <Delta label="Неназначено" before={metricNumber(baseline.metrics, "unassigned", baseline.unassigned_requests.length)} after={metricNumber(optimized.metrics, "unassigned", optimized.unassigned_requests.length)} />
      <Delta label="Бригад" before={metricNumber(baseline.metrics, "used_teams", baseline.routes.length)} after={metricNumber(optimized.metrics, "used_teams", optimized.routes.length)} />
      <Delta label="Время в пути" before={metricNumber(baseline.metrics, "total_travel_minutes")} after={metricNumber(optimized.metrics, "total_travel_minutes")} suffix=" мин" />
      <Delta label="Пробег" before={metricNumber(baseline.metrics, "total_distance_km")} after={metricNumber(optimized.metrics, "total_distance_km")} suffix=" км" />
    </div>}
  </section>;
}
