import { useMemo } from "react";

import { normalizeMapPoints } from "../lib/presentation";
import type { Dataset, Plan } from "../types";

export const TEAM_COLORS = ["#f7c600", "#7957ff", "#00a884", "#f5607b", "#1689e8", "#c665e8", "#ff8d3a", "#00a9bd", "#9a7b4f", "#77a835", "#d651a8", "#5269dd"];

type RouteMapProps = {
  dataset: Dataset;
  plan: Plan;
  selectedTeamId: number | null;
  selectedRequestId: number | null;
  onSelectTeam: (id: number | null) => void;
  onSelectRequest: (id: number) => void;
};

export function RouteMap({ dataset, plan, selectedTeamId, selectedRequestId, onSelectTeam, onSelectRequest }: RouteMapProps) {
  const requestMap = useMemo(() => new Map(dataset.requests.map((request) => [request.id, request])), [dataset.requests]);
  const teamMap = useMemo(() => new Map(dataset.teams.map((team) => [team.id, team])), [dataset.teams]);
  const pointMap = useMemo(() => {
    const source = [
      ...dataset.requests.map((request) => ({ id: request.id, lat: request.lat, lon: request.lon })),
      ...dataset.teams.map((team, index) => ({ id: -(index + 1), lat: team.start_lat, lon: team.start_lon })),
    ];
    const normalized = normalizeMapPoints(source);
    return {
      requests: new Map(normalized.slice(0, dataset.requests.length).map((point) => [point.id, point])),
      teams: new Map(dataset.teams.map((team, index) => [team.id, normalized[dataset.requests.length + index]])),
    };
  }, [dataset.requests, dataset.teams]);
  const unassigned = new Set(plan.unassigned_requests);

  return <section className="map-card" aria-label="Карта маршрутов">
    <div className="panel-title-row"><div><span className="section-kicker">ОПЕРАТИВНАЯ КАРТА</span><h2>Маршруты на сегодня</h2></div><div className="map-actions"><button type="button" className={selectedTeamId === null ? "active" : ""} onClick={() => onSelectTeam(null)}>Все маршруты</button>{selectedTeamId !== null && <button type="button" onClick={() => onSelectTeam(null)}>Сбросить фокус</button>}</div></div>
    <div className="map-stage">
      <svg viewBox="0 0 1000 620" role="img" aria-label="Схема маршрутов бригад">
        <defs><pattern id="map-grid" width="54" height="54" patternUnits="userSpaceOnUse"><path d="M 54 0 L 0 0 0 54" fill="none" stroke="#ccd2d6" strokeWidth="0.7" /></pattern><filter id="map-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity="0.2" /></filter></defs>
        <rect width="1000" height="620" fill="#f4f5f3" rx="18" />
        <rect width="1000" height="620" fill="url(#map-grid)" opacity="0.42" rx="18" />
        <path d="M0 160 C180 90 250 245 430 168 S700 70 1000 138" className="map-road major" />
        <path d="M90 620 C150 420 310 370 440 285 S760 205 930 0" className="map-road" />
        <path d="M0 440 C220 520 385 415 520 470 S785 565 1000 410" className="map-road" />
        {plan.routes.map((route, routeIndex) => {
          const team = teamMap.get(route.team_id);
          const office = pointMap.teams.get(route.team_id);
          if (!team || !office) return null;
          const points = [office, ...route.request_ids.map((id) => pointMap.requests.get(id)).filter(Boolean)].map((point) => `${(point?.x ?? 0) * 10},${(point?.y ?? 0) * 6.2}`).join(" ");
          const dimmed = selectedTeamId !== null && selectedTeamId !== route.team_id;
          return <polyline key={route.team_id} points={points} fill="none" stroke={TEAM_COLORS[routeIndex % TEAM_COLORS.length]} strokeWidth={dimmed ? 3 : 6} strokeLinecap="round" strokeLinejoin="round" opacity={dimmed ? 0.12 : 0.82} className="route-line" onClick={() => onSelectTeam(route.team_id)} />;
        })}
        {dataset.teams.filter((team) => plan.routes.some((route) => route.team_id === team.id)).map((team, index) => {
          const point = pointMap.teams.get(team.id);
          if (!point) return null;
          const dimmed = selectedTeamId !== null && selectedTeamId !== team.id;
          return <g key={team.id} transform={`translate(${point.x * 10} ${point.y * 6.2})`} opacity={dimmed ? 0.2 : 1} className="office-marker" onClick={() => onSelectTeam(team.id)}><circle r="15" fill="#111318" filter="url(#map-shadow)" /><path d="M-7 6V-4L0-10 7-4V6H2V0H-2V6Z" fill={TEAM_COLORS[index % TEAM_COLORS.length]} /><title>{`Офис бригады ${team.id}`}</title></g>;
        })}
        {plan.routes.flatMap((route, routeIndex) => route.request_ids.map((requestId, stopIndex) => ({ route, routeIndex, requestId, stopIndex }))).map(({ route, routeIndex, requestId, stopIndex }) => {
          const request = requestMap.get(requestId);
          const point = pointMap.requests.get(requestId);
          if (!request || !point) return null;
          const isEmergency = request.work_type === "EMERGENCY";
          const selected = selectedRequestId === requestId;
          const dimmed = selectedTeamId !== null && selectedTeamId !== route.team_id;
          return <g key={requestId} role="button" tabIndex={0} aria-label={`Заявка ${requestId}`} transform={`translate(${point.x * 10} ${point.y * 6.2})`} opacity={dimmed ? 0.18 : 1} className={`request-marker ${isEmergency ? "emergency" : ""} ${selected ? "selected" : ""}`} onClick={() => onSelectRequest(requestId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectRequest(requestId); }}>
            {isEmergency && <circle r="23" fill="none" stroke="#e64b5d" strokeWidth="2" opacity="0.45" />}
            <circle r={selected ? 18 : 15} fill={isEmergency ? "#e64b5d" : TEAM_COLORS[routeIndex % TEAM_COLORS.length]} stroke="#fff" strokeWidth={selected ? 5 : 3} filter="url(#map-shadow)" />
            <text textAnchor="middle" dominantBaseline="central" fill={isEmergency ? "#fff" : "#151515"} fontWeight="800" fontSize="12">{stopIndex + 1}</text>
          </g>;
        })}
        {plan.unassigned_requests.map((requestId) => {
          const point = pointMap.requests.get(requestId);
          if (!point) return null;
          return <g key={requestId} role="button" tabIndex={0} aria-label={`Заявка ${requestId} не назначена`} transform={`translate(${point.x * 10} ${point.y * 6.2})`} className="unassigned-marker" onClick={() => onSelectRequest(requestId)}><circle r="16" fill="#d9304f" stroke="#fff" strokeWidth="3" /><path d="M-6-6 6 6M6-6-6 6" stroke="#fff" strokeWidth="3" /></g>;
        })}
      </svg>
      <div className="map-legend"><div><i className="legend-office" />Офис</div><div><i className="legend-request" />Заявка</div><div><i className="legend-emergency" />Авария</div><div><i className="legend-unassigned" />Неназначенная</div></div>
      <div className="map-region">Участки: {dataset.sections?.join(" · ") || dataset.regions?.join(" · ") || dataset.name}</div>
      <div className="map-disclaimer">Схематическая карта. Координаты демонстрационные.</div>
      <span className="sr-only">Авария</span>
      {unassigned.size > 0 && <div className="map-alert">Неназначено: {unassigned.size}</div>}
    </div>
  </section>;
}
