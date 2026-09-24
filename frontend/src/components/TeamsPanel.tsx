import { formatClock, formatDistance, sectionValue, workTypeLabel } from "../lib/presentation";
import type { Dataset, Plan, PlanDiff, RequestStatus } from "../types";
import { TEAM_COLORS } from "./RouteMap";

type TeamsPanelProps = {
  dataset: Dataset;
  plan: Plan;
  selectedTeamId: number | null;
  selectedRequestId: number | null;
  statuses: Record<number, RequestStatus>;
  diff: PlanDiff | null;
  onSelectTeam: (id: number | null) => void;
  onSelectRequest: (id: number) => void;
};

export function TeamsPanel({ dataset, plan, selectedTeamId, selectedRequestId, statuses, diff, onSelectTeam, onSelectRequest }: TeamsPanelProps) {
  const teams = new Map(dataset.teams.map((team) => [team.id, team]));
  const requests = new Map(dataset.requests.map((request) => [request.id, request]));

  return <aside className="teams-panel"><div className="panel-title-row teams-heading"><div><span className="section-kicker">ИСПОЛНИТЕЛИ</span><h2>Бригады</h2></div><span className="panel-count">{plan.routes.length}</span></div><div className="team-list">{plan.routes.map((route, routeIndex) => {
    const team = teams.get(route.team_id);
    if (!team) return null;
    const active = selectedTeamId === route.team_id;
    const changed = diff?.route_changed_team_ids.includes(route.team_id) ?? false;
    return <article key={route.team_id} className={`team-card ${active ? "active" : ""} ${changed ? "changed" : ""}`} style={{ "--team-color": TEAM_COLORS[routeIndex % TEAM_COLORS.length] } as React.CSSProperties}>
      <button type="button" className="team-card-head" onClick={() => onSelectTeam(active ? null : route.team_id)}><span className="team-color" /><div><strong>{team.name || `Бригада ${team.id}`}</strong><small>Участок: {sectionValue(team) || "не указан"}{team.district ? ` · Район: ${team.district}` : ""} · {formatClock(Number(team.shift_start?.split(":")[0]) * 60 + Number(team.shift_start?.split(":")[1]))}–{team.shift_end}</small></div><span className="team-card-total">{route.request_ids.length}<small>заявок</small></span></button>
      <div className="team-meta"><span>{team.transport || "Без транспорта"}</span>{team.skills.map((skill) => <span key={skill}>{skill}</span>)}{(team.equipment?.length ? team.equipment : ["Без спецоборудования"]).map((item) => <span key={item}>{item}</span>)}</div>
      <div className="route-overview"><span>Маршрут</span><strong>{formatDistance(route.distance_km)} км</strong>{changed && <em>изменён</em>}</div>
      <div className="route-timeline"><div className="office-stop"><span className="timeline-dot office" /><div><strong>Офис · {team.shift_start}</strong><small>Старт маршрута</small></div></div>{route.stops.map((stop, stopIndex) => {
        const request = requests.get(stop.request_id);
        if (!request) return null;
        const fixed = ["COMPLETED", "IN_PROGRESS", "ON_THE_WAY"].includes(statuses[stop.request_id] ?? "");
        const changedStop = diff?.reassigned_request_ids.includes(stop.request_id) || diff?.time_changed_request_ids.includes(stop.request_id) || diff?.new_request_ids.includes(stop.request_id);
        return <button type="button" key={stop.request_id} className={`timeline-stop ${selectedRequestId === stop.request_id ? "selected" : ""} ${changedStop ? "changed" : ""}`} onClick={() => onSelectRequest(stop.request_id)}><span className="timeline-index">{stopIndex + 1}</span><div className="timeline-copy"><strong>{workTypeLabel(request.work_type)} · #{request.id}</strong><small>{request.address}</small><span>Окно {request.window_start}–{request.window_end}</span>{fixed && <em>Зафиксирована</em>}</div><time>{formatClock(stop.start)}–{formatClock(stop.finish)}</time></button>;
      })}</div>
    </article>;
  })}</div></aside>;
}
