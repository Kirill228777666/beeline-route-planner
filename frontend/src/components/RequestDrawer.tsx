import { formatClock, sectionValue, workTypeLabel } from "../lib/presentation";
import type { Explanation, RequestInput, Stop, TeamInput } from "../types";

type RequestDrawerProps = {
  request: RequestInput | undefined;
  stop: Stop | undefined;
  team: TeamInput | undefined;
  explanation: Explanation | null;
  loading: boolean;
  error: string;
  assigned: boolean;
  includedInPlan: boolean;
  status: string;
  onRetry: () => void;
  onClose: () => void;
};

function displayTime(value: string | number | null | undefined) {
  if (typeof value === "number") return formatClock(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return formatClock(Number(value));
  return value || "—";
}

export function RequestDrawer({ request, stop, team, explanation, loading, error, assigned, includedInPlan, status, onRetry, onClose }: RequestDrawerProps) {
  if (!request) return null;
  const workType = request.work_type;
  const arrival = explanation?.arrival ?? (stop ? formatClock(stop.arrival) : "—");
  const start = explanation?.start ?? (stop ? formatClock(stop.start) : "—");
  const finish = explanation?.finish ?? (stop ? formatClock(stop.finish) : "—");

  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="request-drawer" aria-label={`Карточка заявки ${request.id}`}>
      <div className="drawer-head"><div><span className={`request-kind ${workType === "EMERGENCY" ? "emergency" : ""}`}>{workTypeLabel(workType)}</span><h2>Заявка #{request.id}</h2></div><button type="button" aria-label="Закрыть карточку" onClick={onClose}>×</button></div>
      <p className="drawer-address">{request.address || "Адрес не указан"}</p>
      <div className="request-facts">
        <Fact label="Приоритет" value={workType === "EMERGENCY" ? "Максимальный" : workType === "CONNECTION" ? "Высокий" : "Стандартный"} />
        <Fact label="Статус" value={status} />
        <Fact label="Участок" value={sectionValue(request) || "—"} />
        <Fact label="Район" value={request.district || "—"} />
        <Fact label="Окно клиента" value={`${request.window_start}–${request.window_end}`} />
        <Fact label="Поступила не ранее" value={displayTime(request.release_time)} />
        <Fact label="Нормативная длительность" value={`${request.service_duration} мин`} />
        <Fact label="Бригада" value={team?.name || (explanation?.team_id ? `#${explanation.team_id}` : "Не назначена")} />
        <Fact label="Прибытие" value={arrival} />
        <Fact label="Начало" value={start} />
        <Fact label="Окончание" value={finish} />
      </div>

      <section className="requirements-block"><span className="section-kicker">ТРЕБОВАНИЯ</span><div>
        {request.required_skills.map((skill) => <em key={skill}>{skill}</em>)}
        {request.required_transport && <em>{request.required_transport}</em>}
        {request.required_equipment?.map((item) => <em key={item}>{item}</em>)}
        {!request.required_skills.length && !request.required_transport && !request.required_equipment?.length && <em>Специальные требования не указаны</em>}
      </div></section>

      <section className="explanation-block"><span className="section-kicker">{!includedInPlan ? "ЗАЯВКИ НЕТ В СНИМКЕ ЭТОГО ПЛАНА" : assigned ? "ПОЧЕМУ НАЗНАЧЕНА СЮДА?" : "ПОЧЕМУ НЕ НАЗНАЧЕНА?"}</span>
        {loading && <p className="drawer-loading">Получаем фактические проверки из backend…</p>}
        {error && <div className="drawer-error"><p>{error}</p><button type="button" className="retry-button" onClick={onRetry} disabled={loading}>Повторить</button></div>}
        {explanation && <><p>{explanation.reason}</p>{explanation.replanning_reason && <div className="replan-reason">{explanation.replanning_reason}</div>}
          <div className="constraint-list">{explanation.hard_constraints.map((constraint) => <div key={constraint.code}><span className={constraint.passed ? "pass" : "fail"}>{constraint.passed ? "✓" : "×"}</span><strong>{constraint.code}</strong><small>{constraint.reason_code || (constraint.passed ? "Проверено" : "Не пройдено")}</small></div>)}</div>
        </>}
      </section>

      {explanation && <section className="alternatives-block"><span className="section-kicker">ДРУГИЕ БРИГАДЫ · ИЗ BACKEND</span>
        {explanation.alternatives.length === 0 ? <p>Другие бригады не возвращены API для этой заявки.</p> : explanation.alternatives.map((alternative) => <div key={alternative.team_id}><strong>#{alternative.team_id}</strong><span className={alternative.rejected_reason ? "rejected" : "available"}>{alternative.rejected_reason || alternative.status || "Подходит"}</span></div>)}
      </section>}
    </aside>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
