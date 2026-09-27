import { sectionValue, workTypeLabel } from "../lib/presentation";
import type { Dataset, Plan } from "../types";

export function UnassignedPanel({ dataset, plan, onSelect }: { dataset: Dataset; plan: Plan; onSelect: (requestId: number) => void }) {
  const requests = new Map(dataset.requests.map((request) => [request.id, request]));
  if (plan.unassigned_requests.length === 0) return <div className="unassigned-empty panel-empty-state"><span>✓</span><div><strong>Неназначенных заявок нет</strong><small>Результат распределения сформирован backend и проверен verifier.</small></div></div>;

  return <div className="unassigned-list">{plan.unassigned_requests.map((id) => {
    const request = requests.get(id);
    return <button type="button" key={id} onClick={() => onSelect(id)}>
      <span className="unassigned-icon">!</span>
      <span><strong>Заявка #{id} · {workTypeLabel(request?.work_type)}</strong><small>Участок: {request ? sectionValue(request) || "—" : "—"} · район: {request?.district || "—"}</small><small>Причину и проверенные альтернативы откроет explanation API.</small></span>
      <span aria-hidden="true">→</span>
    </button>;
  })}</div>;
}
