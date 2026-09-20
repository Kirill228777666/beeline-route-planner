import { formatDistance, metricComparison, metricNumber } from "../lib/presentation";
import type { Plan, SolverViewMode } from "../types";

type PlanSummaryProps = {
  plan: Plan;
  baseline: Plan | null;
  datasetSize: number;
  mode: SolverViewMode;
};

type KpiProps = {
  label: string;
  value: string;
  detail: string;
  icon: string;
  tone: string;
};

function Kpi({ label, value, detail, icon, tone }: KpiProps) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-head"><span>{label}</span><i aria-hidden="true">{icon}</i></div><strong>{value}</strong><small>{detail}</small></article>;
}

function Delta({ label, before, after, higherIsBetter = false, suffix = "" }: { label: string; before: number; after: number; higherIsBetter?: boolean; suffix?: string }) {
  const comparison = metricComparison(before, after, higherIsBetter);
  const percent = comparison.percent === null ? "—" : `${Math.abs(comparison.percent).toFixed(1).replace(".", ",")}%`;
  const sign = comparison.delta > 0 ? "+" : comparison.delta < 0 ? "−" : "";
  return <div className="delta-item"><span>{label}</span><div><b>{formatDistance(before)}{suffix}</b><i aria-hidden="true">→</i><b>{formatDistance(after)}{suffix}</b></div><small className={comparison.delta === 0 ? "neutral" : comparison.improved ? "positive" : "negative"}>{comparison.delta === 0 ? "без изменений" : `${sign}${formatDistance(Math.abs(comparison.delta))}${suffix} · ${percent}`}</small></div>;
}

export function PlanSummary({ plan, baseline, datasetSize, mode }: PlanSummaryProps) {
  const assigned = metricNumber(plan.metrics, "assigned", datasetSize - plan.unassigned_requests.length);
  const usedTeams = metricNumber(plan.metrics, "used_teams", plan.routes.length);
  const distance = metricNumber(plan.metrics, "total_distance_km");
  const travel = metricNumber(plan.metrics, "total_travel_minutes");
  const runtime = metricNumber(plan.metrics, "runtime_ms");
  const unassigned = metricNumber(plan.metrics, "unassigned", plan.unassigned_requests.length);

  return <section className="summary-section" aria-label="Показатели плана">
    <div className="summary-heading"><div><span className="section-kicker">РЕЗУЛЬТАТ ПЛАНИРОВАНИЯ</span><h1>{mode === "optimized" ? "Оптимизированный план" : "Базовый план"}</h1></div><div className={`verifier-status ${plan.verified ? "ok" : "failed"}`}><span>{plan.verified ? "✓" : "!"}</span><div><strong>{plan.verified ? "План проверен" : "Проверка не пройдена"}</strong><small>Python verifier: {plan.verified ? "OK" : "FAILED"}</small></div></div></div>
    <div className="metrics-grid">
      <Kpi label="Выполнено" value={`${assigned}/${datasetSize}`} detail={`${Math.round(datasetSize ? assigned / datasetSize * 100 : 0)}% заявок назначено`} icon="✓" tone="coverage" />
      <Kpi label="Бригад" value={`${usedTeams}`} detail="задействовано исполнителей" icon="◉" tone="teams" />
      <Kpi label="Пробег" value={`${formatDistance(distance)} км`} detail="суммарно по маршрутам" icon="↗" tone="distance" />
      <Kpi label="Время в пути" value={`${formatDistance(travel)} мин`} detail="без сервисного времени" icon="◷" tone="travel" />
      <Kpi label="Неназначено" value={`${unassigned}`} detail={unassigned ? "требуют внимания" : "все заявки покрыты"} icon="!" tone={unassigned ? "warning" : "clean"} />
      <Kpi label="Расчёт" value={runtime < 1000 ? `${formatDistance(runtime)} мс` : `${formatDistance(runtime / 1000)} сек`} detail={String(plan.metrics.solver_engine ?? (mode === "optimized" ? "C++ solver" : "Baseline"))} icon="⚡" tone="runtime" />
    </div>
    {baseline && mode === "optimized" && <div className="comparison-strip"><div className="comparison-title"><span className="section-kicker">ЭФФЕКТ ОПТИМИЗАЦИИ</span><strong>Базовый → Оптимизированный</strong></div><Delta label="Выполнено" before={metricNumber(baseline.metrics, "assigned")} after={assigned} higherIsBetter /><Delta label="Бригад" before={metricNumber(baseline.metrics, "used_teams", baseline.routes.length)} after={usedTeams} /><Delta label="Пробег" before={metricNumber(baseline.metrics, "total_distance_km")} after={distance} suffix=" км" /><Delta label="В пути" before={metricNumber(baseline.metrics, "total_travel_minutes")} after={travel} suffix=" мин" /></div>}
  </section>;
}
