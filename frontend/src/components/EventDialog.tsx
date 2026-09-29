import { useEffect, useState } from "react";

import { sectionValue } from "../lib/presentation";
import type { Dataset, EmergencyDraft, EventType, RequestInput, RequestStatus } from "../types";

export type EventSubmission = {
  eventTime: string;
  payload: object;
  focusRequestId: number | null;
  newRequest?: RequestInput;
  status?: RequestStatus;
};

type EventDialogProps = {
  dataset: Dataset;
  selectedRequestId: number | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (submission: EventSubmission) => void;
};

function nextRequestId(dataset: Dataset) {
  return dataset.requests.reduce((maximum, request) => Math.max(maximum, request.id), 0) + 1;
}

export function EventDialog({ dataset, selectedRequestId, loading, onClose, onSubmit }: EventDialogProps) {
  const [eventType, setEventType] = useState<EventType>("NEW_EMERGENCY");
  const [eventTime, setEventTime] = useState("13:17");
  const [requestId, setRequestId] = useState<number>(selectedRequestId ?? dataset.requests[0]?.id ?? 0);
  const [teamId, setTeamId] = useState<number>(dataset.teams[0]?.id ?? 0);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<RequestStatus>("CANCELLED");
  const [validation, setValidation] = useState("");
  const [emergency, setEmergency] = useState<EmergencyDraft>({ id: nextRequestId(dataset), address: "", lat: dataset.requests[0]?.lat ?? 55.75, lon: dataset.requests[0]?.lon ?? 37.62, window_start: "13:17", window_end: "18:00", section_id: dataset.sections?.[0] ?? dataset.regions?.[0] ?? sectionValue(dataset.teams[0] ?? {}) });

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [loading, onClose]);

  function submit() {
    setValidation("");
    if (eventType === "NEW_EMERGENCY") {
      if (!emergency.address.trim()) {
        setValidation("Укажите адрес аварийной заявки");
        return;
      }
      const request: RequestInput = { id: emergency.id, address: emergency.address.trim(), lat: Number(emergency.lat), lon: Number(emergency.lon), window_start: emergency.window_start, window_end: emergency.window_end, service_duration: 80, work_type: "EMERGENCY", required_skills: ["EMERGENCY"], required_transport: null, required_equipment: [], section_id: emergency.section_id, release_time: eventTime };
      onSubmit({ eventTime, focusRequestId: request.id, newRequest: request, payload: { event_type: "NEW_EMERGENCY", event_time: eventTime, request } });
      return;
    }
    if (!requestId) {
      setValidation("Выберите заявку");
      return;
    }
    if (eventType === "TEAM_UNAVAILABLE") {
      if (!teamId) {
        setValidation("Выберите бригаду");
        return;
      }
      onSubmit({ eventTime, focusRequestId: null, payload: { event_type: "TEAM_UNAVAILABLE", event_time: eventTime, team_id: teamId, reason: reason.trim() || null } });
      return;
    }
    onSubmit({ eventTime, focusRequestId: requestId, status, payload: { event_type: "STATUS_CHANGED", event_time: eventTime, request_id: requestId, status } });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) onClose();
    }}>
      <section className="event-dialog" role="dialog" aria-modal="true" aria-label="Событие в течение дня">
        <div className="dialog-head">
          <div><span className="section-kicker">ОПЕРАТИВНОЕ ИЗМЕНЕНИЕ</span><h2>Событие в течение дня</h2><p>Зафиксируйте событие и перестройте только будущую часть плана.</p></div>
          <button type="button" aria-label="Закрыть" disabled={loading} onClick={onClose}>×</button>
        </div>
        <div className="event-type-tabs">
          <button type="button" className={eventType === "NEW_EMERGENCY" ? "active" : ""} onClick={() => setEventType("NEW_EMERGENCY")}>Новая авария</button>
          <button type="button" className={eventType === "STATUS_CHANGED" ? "active" : ""} onClick={() => setEventType("STATUS_CHANGED")}>Статус / отмена</button>
          <button type="button" className={eventType === "TEAM_UNAVAILABLE" ? "active" : ""} onClick={() => setEventType("TEAM_UNAVAILABLE")}>Бригада недоступна</button>
        </div>
        <div className="event-form">
          <label><span>Время события</span><input type="time" value={eventTime} onChange={(event) => {
            setEventTime(event.target.value);
            setEmergency((current) => ({ ...current, window_start: event.target.value }));
          }} /></label>
          {eventType === "NEW_EMERGENCY" ? <>
            <label className="wide-field"><span>Адрес</span><input autoFocus value={emergency.address} placeholder="Адрес новой аварийной заявки" onChange={(event) => setEmergency((current) => ({ ...current, address: event.target.value }))} /></label>
            <label><span>Участок</span><select value={emergency.section_id} onChange={(event) => setEmergency((current) => ({ ...current, section_id: event.target.value }))}>
              {(dataset.sections?.length ? dataset.sections : dataset.regions?.length ? dataset.regions : Array.from(new Set(dataset.teams.map((team) => sectionValue(team))))).map((section) => <option key={section} value={section}>{section || "Без участка"}</option>)}
            </select></label>
            <label><span>Окно до</span><input type="time" value={emergency.window_end} onChange={(event) => setEmergency((current) => ({ ...current, window_end: event.target.value }))} /></label>
            <label><span>Широта</span><input type="number" step="0.0001" value={emergency.lat} onChange={(event) => setEmergency((current) => ({ ...current, lat: Number(event.target.value) }))} /></label>
            <label><span>Долгота</span><input type="number" step="0.0001" value={emergency.lon} onChange={(event) => setEmergency((current) => ({ ...current, lon: Number(event.target.value) }))} /></label>
            <div className="emergency-rule wide-field"><strong>Максимальный приоритет</strong><span>Работа на месте: 80 минут. Заявка не начнётся раньше {eventTime}.</span></div>
          </> : eventType === "TEAM_UNAVAILABLE" ? <>
            <label><span>Бригада</span><select value={teamId} onChange={(event) => setTeamId(Number(event.target.value))}>
              {dataset.teams.map((team) => <option key={team.id} value={team.id}>{team.name} · #{team.id}</option>)}
            </select></label>
            <label className="wide-field"><span>Причина</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Необязательно" /></label>
          </> : <>
            <label><span>Заявка</span><select value={requestId} onChange={(event) => setRequestId(Number(event.target.value))}>
              {dataset.requests.map((request) => <option key={request.id} value={request.id}>#{request.id} · {request.address}</option>)}
            </select></label>
            <label><span>Новый статус</span><select value={status} onChange={(event) => setStatus(event.target.value as RequestStatus)}>
              <option value="ON_THE_WAY">ON_THE_WAY</option><option value="IN_PROGRESS">IN_PROGRESS</option><option value="COMPLETED">COMPLETED</option><option value="CANCELLED">CANCELLED</option>
            </select></label>
          </>}
        </div>
        {validation && <div className="form-error">{validation}</div>}
        <div className="dialog-actions"><button type="button" className="ghost-button" disabled={loading} onClick={onClose}>Отмена</button><button type="button" className="build-button" disabled={loading} onClick={submit}>{loading ? "Перестраиваем…" : "Перестроить план"}</button></div>
      </section>
    </div>
  );
}
