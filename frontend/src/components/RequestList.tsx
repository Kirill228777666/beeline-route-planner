import { useMemo, useState } from "react";

import { sectionValue, workTypeLabel } from "../lib/presentation";
import type { Dataset, Plan, RequestStatus } from "../types";

type RequestListProps = {
  dataset: Dataset;
  plan: Plan;
  statuses: Record<number, RequestStatus>;
  onSelect: (requestId: number) => void;
};

const statusLabels: Record<RequestStatus, string> = {
  NEW: "Новая",
  ASSIGNED: "Назначена",
  ON_THE_WAY: "В пути",
  IN_PROGRESS: "В работе",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
};

export function RequestList({ dataset, plan, statuses, onSelect }: RequestListProps) {
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("");
  const [workType, setWorkType] = useState("");
  const [status, setStatus] = useState("");
  const assignmentByRequest = useMemo(() => new Map(plan.routes.flatMap((route) => route.request_ids.map((id) => [id, route.team_id] as const))), [plan.routes]);
  const requestIdsInSnapshot = useMemo(() => new Set([...assignmentByRequest.keys(), ...plan.unassigned_requests]), [assignmentByRequest, plan.unassigned_requests]);
  const districts = useMemo(() => [...new Set(dataset.requests.map((request) => request.district).filter((value): value is string => Boolean(value)))].sort(), [dataset.requests]);
  const workTypes = useMemo(() => [...new Set(dataset.requests.map((request) => request.work_type))].sort(), [dataset.requests]);
  const visibleRequests = dataset.requests.filter((request) => {
    const normalizedQuery = query.trim().toLowerCase();
    const rawStatus = statuses[request.id] ?? request.status ?? "NEW";
    const actualStatus = rawStatus === "NEW" && assignmentByRequest.has(request.id) ? "ASSIGNED" : rawStatus;
    return (!normalizedQuery || String(request.id).includes(normalizedQuery) || request.address.toLowerCase().includes(normalizedQuery))
      && (!district || request.district === district)
      && (!workType || request.work_type === workType)
      && (!status || actualStatus === status);
  });

  return <div className="request-list-panel">
    <div className="request-filters">
      <label className="request-search"><span className="sr-only">Поиск заявок</span><input aria-label="Поиск заявок" type="search" placeholder="ID или адрес заявки" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label><span className="sr-only">Район</span><select aria-label="Фильтр по району" value={district} onChange={(event) => setDistrict(event.target.value)}><option value="">Все районы</option>{districts.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span className="sr-only">Тип работы</span><select aria-label="Фильтр по типу" value={workType} onChange={(event) => setWorkType(event.target.value)}><option value="">Все типы</option>{workTypes.map((value) => <option key={value} value={value}>{workTypeLabel(value)}</option>)}</select></label>
      <label><span className="sr-only">Статус</span><select aria-label="Фильтр по статусу" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Все статусы</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <div className="request-list" aria-live="polite">
      {visibleRequests.length === 0 ? <p className="panel-empty">Ничего не найдено по заданным фильтрам</p> : visibleRequests.map((request) => {
        const teamId = assignmentByRequest.get(request.id);
        const rawStatus = statuses[request.id] ?? request.status ?? "NEW";
        const requestStatus = rawStatus === "NEW" && teamId ? "ASSIGNED" : rawStatus;
        return <button type="button" className={`request-row ${request.work_type === "EMERGENCY" ? "is-emergency" : ""}`} key={request.id} onClick={() => onSelect(request.id)}>
          <span className="request-row-id">{request.work_type === "EMERGENCY" ? "!" : "#"}{request.id}</span>
          <span className="request-row-main"><strong>{workTypeLabel(request.work_type)} · {request.district || "Район не указан"}</strong><small>{request.address || "Адрес не указан"}</small><small>Участок: {sectionValue(request) || "—"} · окно {request.window_start}–{request.window_end}</small></span>
          <span className={`request-status status-${requestStatus.toLowerCase()}`}>{statusLabels[requestStatus]}</span>
          <span className="request-row-team">{teamId ? `Бригада ${teamId}` : requestIdsInSnapshot.has(request.id) ? "Не назначена" : "Не входит в снимок этого плана"}</span>
        </button>;
      })}
    </div>
  </div>;
}
