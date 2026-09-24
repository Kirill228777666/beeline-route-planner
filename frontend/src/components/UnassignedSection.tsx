import { sectionValue, workTypeLabel } from "../lib/presentation";
import type { Dataset, Plan } from "../types";

export function UnassignedSection({ dataset, plan, onSelect }: { dataset: Dataset; plan: Plan; onSelect: (id: number) => void }) {
  const requests = new Map(dataset.requests.map((request) => [request.id, request]));
  return <section className={`unassigned-section ${plan.unassigned_requests.length ? "has-items" : "empty"}`}><div className="unassigned-heading"><div><span className="section-kicker">КОНТРОЛЬ ИСКЛЮЧЕНИЙ</span><h2>Неназначенные заявки</h2></div><span className="unassigned-count">{plan.unassigned_requests.length}</span></div>{plan.unassigned_requests.length === 0 ? <div className="unassigned-empty"><span>✓</span><div><strong>Все заявки распределены</strong><small>Для каждой заявки найден допустимый исполнитель и временное окно.</small></div></div> : <div className="unassigned-grid">{plan.unassigned_requests.map((id) => { const request = requests.get(id); return <button type="button" key={id} onClick={() => onSelect(id)}><span>!</span><div><strong>Заявка #{id}</strong><small>{workTypeLabel(request?.work_type)} · Участок: {request ? sectionValue(request) || "не указан" : "не указан"}</small><p>{request?.address || "Адрес не указан"}</p></div><i aria-hidden="true">→</i></button>; })}</div>}</section>;
}
