import { formatClock, formatDistance, metricNumber } from "../lib/presentation";
import type { Plan, PlanDiff } from "../types";

export function PlanHistory({ before, after, diff }: { before: Plan; after: Plan; diff: PlanDiff }) {
  const beforeAssigned = metricNumber(before.metrics, "assigned");
  const afterAssigned = metricNumber(after.metrics, "assigned");
  const beforeTeams = metricNumber(before.metrics, "used_teams", before.routes.length);
  const afterTeams = metricNumber(after.metrics, "used_teams", after.routes.length);
  const beforeTravel = metricNumber(before.metrics, "total_travel_minutes");
  const afterTravel = metricNumber(after.metrics, "total_travel_minutes");
  const beforeDistance = metricNumber(before.metrics, "total_distance_km");
  const afterDistance = metricNumber(after.metrics, "total_distance_km");
  return <section className="history-card"><div className="history-title"><span className="section-kicker">ИСТОРИЯ ПЛАНА</span><h2>Что изменилось после события</h2></div><div className="history-flow"><div><span>01</span><strong>Исходный план</strong><small>{beforeAssigned} заявок · {beforeTeams} бригад</small></div><i aria-hidden="true">→</i><div className="history-event"><span>{formatClock(after.event_time)}</span><strong>Событие</strong><small>Обновление оперативного плана</small></div><i aria-hidden="true">→</i><div><span>02</span><strong>Перепланированный план</strong><small>{afterAssigned} заявок · {afterTeams} бригад</small></div></div><div className="history-metrics"><span>Выполнено {beforeAssigned} → {afterAssigned}</span><span>Бригад {beforeTeams} → {afterTeams}</span><span>В пути {formatDistance(beforeTravel)} → {formatDistance(afterTravel)} мин</span><span>Пробег {formatDistance(beforeDistance)} → {formatDistance(afterDistance)} км</span></div><div className="diff-chips"><span>Переназначено: {diff.reassigned_request_ids.length}</span><span>Время изменено: {diff.time_changed_request_ids.length}</span><span>Маршрутов изменено: {diff.route_changed_team_ids.length}</span><span>Новых: {diff.new_request_ids.length}</span><span>Отменено: {diff.cancelled_request_ids.length}</span></div></section>;
}
