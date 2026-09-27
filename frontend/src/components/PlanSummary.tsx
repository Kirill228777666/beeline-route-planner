import { formatDistance, metricComparison, metricNumber } from "../lib/presentation";
import type { Plan, SolverViewMode } from "../types";

type PlanSummaryProps = {
  plan: Plan;
  baseline: Plan | null;
  comparisonPlan?: Plan | null;
  datasetSize: number;
  mode: SolverViewMode;
};

function Kpi({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: string; tone: string }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-head"><span>{label}</span><i aria-hidden="true">{icon}</i></div><strong>{value}</strong><small>{detail}</small></article>;
}

function Delta({ label, before, after, higherIsBetter = false, suffix = "" }: { label: string; before: number; after: number; higherIsBetter?: boolean; suffix?: string }) {
  const comparison = metricComparison(before, after, higherIsBetter);
  const percent = comparison.percent === null ? null : `${Math.abs(comparison.percent).toFixed(1).replace(".", ",")}%`;
  const sign = comparison.delta > 0 ? "+" : comparison.delta < 0 ? "−" : "";
  const outcome = comparison.delta === 0 ? "без изменений" : `${sign}${formatDistance(Math.abs(comparison.delta))}${suffix}${percent ? ` · ${percent}` : ""}`;
  return <div className="delta-item"><span>{label}</span><div><b>{formatDistance(before)}{suffix}</b><i aria-hidden="true">→</i><b>{formatDistance(after)}{suffix}</b></div><small className={comparison.delta === 0 ? "neutral" : comparison.improved ? "positive" : "negative"}>{outcome}</small></div>;
}

function duration(value: number) {
  return value >= 1000 ? `${formatDistance(value / 1000)} сек` : `${formatDistance(value)} мс`;
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
    <div className="summary-heading"><div><span className="section-kicker">РЕЗУЛЬТАТ ПЛАНИРОВАНИЯ</span><h1>{mode === "optimized" ? "Оптимизированный план" : "Базовый план"}</h1></div><div className={`verifier-status ${plan.verified ? "ok" : "failed"}`} role="status"><span>{plan.verified ? "✓" : "!"}</span><div><strong>{plan.verified ? "План проверен" : "Проверка не пройдена"}</strong><small>Python verifier: {plan.verified ? "OK" : "FAILED · план не подтверждён"}</small></div></div></div>
    <div className="metrics-grid">
      <Kpi label="Назначено" value={`${assigned}/${planRequestCount}`} detail={`${planRequestCount ? Math.round(assigned / planRequestCount * 100) : 0}% от входящих заявок`} icon="✓" tone="coverage" />
      <Kpi label="Бригады" value={`${usedTeams}`} detail="используются в плане" icon="◉" tone="teams" />
      <Kpi label="Пробег" value={`${formatDistance(distance)} км`} detail="метрика backend" icon="↗" tone="distance" />
      <Kpi label="Время в пути" value={`${formatDistance(travel)} мин`} detail="без сервисного времени" icon="◷" tone="travel" />
      <Kpi label="Неназначено" value={`${unassigned}`} detail={unassigned ? "требуют внимания" : "нет"} icon="!" tone={unassigned ? "warning" : "clean"} />
    </div>
    {baseline && optimized && <div className="comparison-strip" aria-label="Сравнение baseline и оптимизированного плана">
      <div className="comparison-title"><span className="section-kicker">СРАВНЕНИЕ РЕШЕНИЙ BACKEND</span><strong>Baseline → Оптимизированный</strong><small>Время расчёта — фактический runtime соответствующего запроса</small></div>
      <Delta label="Назначено" before={baselineAssigned} after={optimizedAssigned} higherIsBetter />
      <Delta label="Неназначено" before={metricNumber(baseline.metrics, "unassigned", baseline.unassigned_requests.length)} after={metricNumber(optimized.metrics, "unassigned", optimized.unassigned_requests.length)} />
      <Delta label="Бригад" before={metricNumber(baseline.metrics, "used_teams", baseline.routes.length)} after={metricNumber(optimized.metrics, "used_teams", optimized.routes.length)} />
      <Delta label="Время в пути" before={metricNumber(baseline.metrics, "total_travel_minutes")} after={metricNumber(optimized.metrics, "total_travel_minutes")} suffix=" мин" />
      <Delta label="Пробег" before={metricNumber(baseline.metrics, "total_distance_km")} after={metricNumber(optimized.metrics, "total_distance_km")} suffix=" км" />
      <Delta label="Время расчёта" before={metricNumber(baseline.metrics, "runtime_ms")} after={metricNumber(optimized.metrics, "runtime_ms")} suffix=" мс" />
    </div>}
  </section>;
}
