import { workTypeLabel } from "../lib/presentation";
import type { Explanation, RequestInput, Stop, TeamInput } from "../types";

type RequestDrawerProps = {
  request: RequestInput | undefined;
  stop: Stop | undefined;
  team: TeamInput | undefined;
  explanation: Explanation | null;
  loading: boolean;
  error: string;
  onClose: () => void;
};

export function RequestDrawer({ request, stop, team, explanation, loading, error, onClose }: RequestDrawerProps) {
  if (!request) return null;
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="request-drawer" aria-label={`Карточка заявки ${request.id}`}><div className="drawer-head"><div><span className={`request-kind ${request.work_type === "EMERGENCY" ? "emergency" : ""}`}>{workTypeLabel(request.work_type)}</span><h2>Заявка #{request.id}</h2></div><button type="button" aria-label="Закрыть карточку" onClick={onClose}>×</button></div><p className="drawer-address">{request.address || "Адрес не указан"}</p><div className="request-facts"><div><span>Приоритет</span><strong>{request.work_type === "EMERGENCY" ? "Максимальный" : request.work_type === "CONNECTION" ? "Высокий" : "Стандартный"}</strong></div><div><span>Регион</span><strong>{request.region_id || "—"}</strong></div><div><span>Окно клиента</span><strong>{request.window_start}–{request.window_end}</strong></div><div><span>Длительность</span><strong>{request.service_duration} мин</strong></div><div><span>Бригада</span><strong>{team?.name || (explanation?.team_id ? `#${explanation.team_id}` : "Не назначена")}</strong></div><div><span>Фактическое время</span><strong>{explanation?.start && explanation?.finish ? `${explanation.start}–${explanation.finish}` : stop ? `${stop.start}–${stop.finish}` : "—"}</strong></div></div><section className="requirements-block"><span className="section-kicker">ТРЕБОВАНИЯ</span><div>{request.required_skills.map((skill) => <em key={skill}>{skill}</em>)}{request.required_transport && <em>{request.required_transport}</em>}{request.required_equipment?.map((item) => <em key={item}>{item}</em>)}</div></section><section className="explanation-block"><span className="section-kicker">ПОЧЕМУ НАЗНАЧЕНА СЮДА?</span>{loading && <p className="drawer-loading">Проверяем фактические данные…</p>}{error && <p className="drawer-error">{error}</p>}{explanation && <><p>{explanation.reason}</p>{explanation.replanning_reason && <div className="replan-reason">{explanation.replanning_reason}</div>}<div className="constraint-list">{explanation.hard_constraints.map((constraint) => <div key={constraint.code}><span className={constraint.passed ? "pass" : "fail"}>{constraint.passed ? "✓" : "×"}</span><strong>{constraint.code}</strong><small>{constraint.reason_code || (constraint.passed ? "Проверено" : "Не пройдено")}</small></div>)}</div></>}</section>{explanation && <section className="alternatives-block"><span className="section-kicker">ДРУГИЕ БРИГАДЫ</span>{explanation.alternatives.slice(0, 8).map((alternative) => <div key={alternative.team_id}><strong>#{alternative.team_id}</strong><span className={alternative.rejected_reason ? "rejected" : "available"}>{alternative.rejected_reason || alternative.status || "Подходит"}</span></div>)}</section>}</aside></div>;
}
