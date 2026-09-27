import { formatClock, formatDistance, metricNumber } from "../lib/presentation";
import type { Plan, PlanDiff, RequestStatus } from "../types";

type PlanHistoryProps = {
  before: Plan;
  after: Plan;
  diff: PlanDiff;
  statuses?: Record<number, RequestStatus>;
};

function detail(label: string, ids: number[]) {
  if (!ids.length) return null;
  return <p><strong>{label}:</strong> {ids.map((id) => `#${id}`).join(", ")}</p>;
}

export function PlanHistory({ before, after, diff, statuses = {} }: PlanHistoryProps) {
  const beforeAssigned = metricNumber(before.metrics, "assigned");
  const afterAssigned = metricNumber(after.metrics, "assigned");
  const beforeTeams = metricNumber(before.metrics, "used_teams", before.routes.length);
  const afterTeams = metricNumber(after.metrics, "used_teams", after.routes.length);
  const beforeTravel = metricNumber(before.metrics, "total_travel_minutes");
  const afterTravel = metricNumber(after.metrics, "total_travel_minutes");
  const beforeDistance = metricNumber(before.metrics, "total_distance_km");
  const afterDistance = metricNumber(after.metrics, "total_distance_km");
  const fixedIds = Object.entries(statuses).filter(([, status]) => ["COMPLETED", "IN_PROGRESS", "ON_THE_WAY"].includes(status)).map(([id]) => Number(id)).sort((left, right) => left - right);

  return <section className="history-card" aria-label="Изменения после перепланирования">
    <div className="history-title"><span className="section-kicker">ИСТОРИЯ ПЛАНА</span><h2>Что изменилось после события</h2></div>
    <div className="history-flow">
      <div><span>01</span><strong>Исходный план</strong><small>{beforeAssigned} заявок · {beforeTeams} бригад</small></div><i aria-hidden="true">→</i>
      <div className="history-event"><span>{formatClock(after.event_time)}</span><strong>Оперативное событие</strong><small>Создан дочерний план</small></div><i aria-hidden="true">→</i>
      <div><span>02</span><strong>Новый план</strong><small>{afterAssigned} заявок · {afterTeams} бригад</small></div>
    </div>
    <div className="history-metrics"><span>Назначено {beforeAssigned} → {afterAssigned}</span><span>Бригад {beforeTeams} → {afterTeams}</span><span>Время в пути {formatDistance(beforeTravel)} → {formatDistance(afterTravel)} мин</span><span>Пробег {formatDistance(beforeDistance)} → {formatDistance(afterDistance)} км</span></div>
    <div className="diff-chips"><span>Переназначено: {diff.reassigned_request_ids.length}</span><span>Время изменено: {diff.time_changed_request_ids.length}</span><span>Маршрутов изменено: {diff.route_changed_team_ids.length}</span><span>Новых: {diff.new_request_ids.length}</span><span>Отменено: {diff.cancelled_request_ids.length}</span></div>
    {(diff.reassigned_request_ids.length > 0 || diff.time_changed_request_ids.length > 0 || diff.route_changed_team_ids.length > 0 || diff.new_request_ids.length > 0 || diff.cancelled_request_ids.length > 0) && <div className="diff-id-list" aria-label="Затронутые объекты">
      {detail("Переназначены", diff.reassigned_request_ids)}
      {detail("Изменено время", diff.time_changed_request_ids)}
      {detail("Изменены маршруты бригад", diff.route_changed_team_ids)}
      {detail("Новые заявки", diff.new_request_ids)}
      {detail("Отменённые заявки", diff.cancelled_request_ids)}
    </div>}
    {fixedIds.length > 0 && <p className="fixed-plan-note"><strong>Зафиксированы и остаются у своих бригад:</strong> {fixedIds.map((id) => `#${id}`).join(", ")}</p>}
  </section>;
}
