import { useEffect, useMemo, useRef, useState } from "react";

import { formatDistance, normalizeMapPoints, sectionValue, workTypeLabel } from "../lib/presentation";
import type { Dataset, MapPoint, Plan } from "../types";

export const TEAM_COLORS = ["#a27800", "#7358ce", "#00866a", "#cf4962", "#1876bd", "#a34bb3", "#c56824", "#008799", "#8a6749", "#648a22", "#b34584", "#4f60bd"];
export function teamColor(teamId: number) { return TEAM_COLORS[Math.abs(Math.trunc(teamId)) % TEAM_COLORS.length]; }

type ViewBox = { x: number; y: number; width: number; height: number };
type RouteMapProps = {
  dataset: Dataset;
  plan: Plan;
  selectedSectionId: string | null;
  selectedTeamId: number | null;
  selectedRequestId: number | null;
  onSelectTeam: (id: number | null) => void;
  onSelectRequest: (id: number | null) => void;
  onSectionChange: (sectionId: string | null) => void;
};

const INITIAL_VIEW: ViewBox = { x: 0, y: 0, width: 1000, height: 620 };

function pluralize(count: number, one: string, few: string, many: string) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = count % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function fittedView(points: MapPoint[]): ViewBox {
  if (!points.length) return INITIAL_VIEW;
  const xs = points.map((point) => point.x * 10);
  const ys = points.map((point) => point.y * 6.2);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.min(1000, Math.max(420, Math.max((maxX - minX) * 1.5, (maxY - minY) * 1.5 * 1000 / 620)));
  const height = width * 0.62;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

export function RouteMap({ dataset, plan, selectedSectionId, selectedTeamId, selectedRequestId, onSelectTeam, onSelectRequest, onSectionChange }: RouteMapProps) {
  const [view, setView] = useState<ViewBox>(INITIAL_VIEW);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showEmergencies, setShowEmergencies] = useState(true);
  const [showUnassigned, setShowUnassigned] = useState(true);
  const drag = useRef<{ x: number; y: number; view: ViewBox } | null>(null);
  const priorFocusKey = useRef("");
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
  const sectionIds = useMemo(() => [...new Set([...dataset.requests, ...dataset.teams].map(sectionValue).filter(Boolean))], [dataset.requests, dataset.teams]);
  const allPlanRequestIds = useMemo(() => new Set([...plan.routes.flatMap((route) => route.request_ids), ...plan.unassigned_requests]), [plan]);
  const requestRouteMap = useMemo(() => {
    const result = new Map<number, Plan["routes"][number]>();
    plan.routes.forEach((route) => route.request_ids.forEach((requestId) => result.set(requestId, route)));
    return result;
  }, [plan.routes]);
  const routesInSection = useMemo(() => plan.routes.filter((route) => {
    const team = teamMap.get(route.team_id);
    return Boolean(team) && (!selectedSectionId || sectionValue(team!) === selectedSectionId);
  }), [plan.routes, selectedSectionId, teamMap]);
  const sectionRequestIds = useMemo(() => [...allPlanRequestIds].filter((requestId) => {
    const request = requestMap.get(requestId);
    return Boolean(request) && (!selectedSectionId || sectionValue(request!) === selectedSectionId);
  }), [allPlanRequestIds, requestMap, selectedSectionId]);
  const selectedRequest = selectedRequestId === null ? undefined : requestMap.get(selectedRequestId);
  const requestBelongsToSection = !selectedSectionId || (selectedRequest && sectionValue(selectedRequest) === selectedSectionId);
  const focusedRequestId = requestBelongsToSection ? selectedRequestId : null;
  const focusedRoute = focusedRequestId !== null
    ? requestRouteMap.get(focusedRequestId)
    : selectedTeamId === null ? undefined : plan.routes.find((route) => route.team_id === selectedTeamId);
  const focusedTeamId = focusedRoute?.team_id ?? null;
  const isRequestFocus = focusedRequestId !== null;
  const isTeamFocus = !isRequestFocus && focusedTeamId !== null;
  const focusRequestIds = useMemo(() => focusedRoute ? focusedRoute.request_ids : focusedRequestId === null ? [] : [focusedRequestId], [focusedRequestId, focusedRoute]);
  const visibleRequestIds = isRequestFocus || isTeamFocus ? focusRequestIds : sectionRequestIds;
  const visibleRequestIdSet = useMemo(() => new Set(visibleRequestIds), [visibleRequestIds]);
  const visibleRoutes = routesInSection;
  const visibleTeams = useMemo(() => isRequestFocus || isTeamFocus
    ? dataset.teams.filter((team) => team.id === focusedTeamId)
    : dataset.teams.filter((team) => !selectedSectionId || sectionValue(team) === selectedSectionId), [dataset.teams, focusedTeamId, isRequestFocus, isTeamFocus, selectedSectionId]);
  const visibleUsedTeams = visibleRoutes.filter((route) => route.request_ids.some((requestId) => visibleRequestIdSet.has(requestId))).length;
  const visibleRequestCount = visibleRequestIdSet.size;
  const focusPoints = useMemo(() => {
    if (isRequestFocus || isTeamFocus) {
      const teamPoint = focusedTeamId === null ? undefined : pointMap.teams.get(focusedTeamId);
      return [teamPoint, ...focusRequestIds.map((requestId) => pointMap.requests.get(requestId))].filter((point): point is MapPoint => Boolean(point));
    }
    if (selectedSectionId) {
      return [
        ...sectionRequestIds.map((requestId) => pointMap.requests.get(requestId)),
        ...visibleTeams.map((team) => pointMap.teams.get(team.id)),
      ].filter((point): point is MapPoint => Boolean(point));
    }
    return [];
  }, [focusedTeamId, focusRequestIds, isRequestFocus, isTeamFocus, pointMap, sectionRequestIds, selectedSectionId, visibleTeams]);

  const focusKey = `${plan.plan_id}:${selectedSectionId ?? "all"}:${focusedTeamId ?? "none"}:${focusedRequestId ?? "none"}`;
  useEffect(() => {
    if (priorFocusKey.current === focusKey) return;
    priorFocusKey.current = focusKey;
    setView(isRequestFocus || isTeamFocus || selectedSectionId ? fittedView(focusPoints) : INITIAL_VIEW);
  }, [focusKey, focusPoints, isRequestFocus, isTeamFocus, selectedSectionId]);

  function zoom(factor: number) {
    setView((current) => {
      const width = Math.min(1400, Math.max(420, current.width * factor));
      const height = width * 0.62;
      const centerX = current.x + current.width / 2;
      const centerY = current.y + current.height / 2;
      return { x: centerX - width / 2, y: centerY - height / 2, width, height };
    });
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if ((event.target as SVGElement).closest("[data-map-item]")) return;
    drag.current = { x: event.clientX, y: event.clientY, view };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const origin = drag.current;
    if (!origin) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    setView({ ...origin.view, x: origin.view.x - (event.clientX - origin.x) * origin.view.width / bounds.width, y: origin.view.y - (event.clientY - origin.y) * origin.view.height / bounds.height });
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 0.88 : 1.14);
  }

  function chooseSection(sectionId: string | null) {
    onSectionChange(sectionId);
    if (sectionId === null) {
      onSelectTeam(null);
      onSelectRequest(null);
    }
  }

  function showAllRoutes() {
    onSelectTeam(null);
    onSelectRequest(null);
  }

  const focusTitle = isRequestFocus
    ? focusedTeamId === null
      ? `Заявка #${focusedRequestId} · не назначена`
      : `Заявка #${focusedRequestId} · маршрут ${teamMap.get(focusedTeamId)?.name || `Бригада ${focusedTeamId}`}`
    : isTeamFocus && focusedRoute
      ? `${teamMap.get(focusedTeamId!)?.name || `Бригада ${focusedTeamId}`} · ${focusedRoute.request_ids.length} ${pluralize(focusedRoute.request_ids.length, "заявка", "заявки", "заявок")} · ${formatDistance(focusedRoute.distance_km)} км`
      : null;
  const summary = isRequestFocus
    ? `Фокус заявки #${focusedRequestId}`
    : isTeamFocus && focusedRoute
      ? `Маршрут · ${focusedRoute.request_ids.length} ${pluralize(focusedRoute.request_ids.length, "заявка", "заявки", "заявок")} · ${formatDistance(focusedRoute.distance_km)} км`
      : selectedSectionId
        ? `Участок ${selectedSectionId} · ${visibleRequestCount} ${pluralize(visibleRequestCount, "заявка", "заявки", "заявок")} · ${visibleUsedTeams} ${pluralize(visibleUsedTeams, "бригада", "бригады", "бригад")}`
        : `Все участки · ${visibleRequestCount} ${pluralize(visibleRequestCount, "заявка", "заявки", "заявок")} · ${visibleUsedTeams} ${pluralize(visibleUsedTeams, "бригада", "бригады", "бригад")}`;
  const plottedRequestCount = visibleRequestCount;
  const plottedTeamCount = isRequestFocus || isTeamFocus ? (focusedRoute ? 1 : 0) : visibleUsedTeams;

  return <section className="map-card" aria-label="Карта маршрутов">
    <div className="map-heading">
      <div><span className="section-kicker">ОПЕРАТИВНАЯ КАРТА</span><h2>{focusTitle ?? "Маршруты на сегодня"}</h2><p>{isRequestFocus ? "Заявка и связанный с ней маршрут выделены на схеме." : isTeamFocus ? "Показаны остановки и стартовая точка выбранной бригады." : "Выберите участок, бригаду или заявку, чтобы перейти от общей картины к деталям."}</p></div>
      <div className="map-actions"><button type="button" className={!selectedSectionId && !isTeamFocus && !isRequestFocus ? "active" : ""} onClick={showAllRoutes}>Все маршруты</button></div>
    </div>
    <div className="map-view-toolbar">
      <nav className="map-section-filter" aria-label="Фильтр по участку">
        <button type="button" className={!selectedSectionId ? "active" : ""} aria-pressed={!selectedSectionId} onClick={() => chooseSection(null)}>Все</button>
        {sectionIds.map((sectionId) => <button key={sectionId} type="button" className={selectedSectionId === sectionId ? "active" : ""} aria-pressed={selectedSectionId === sectionId} onClick={() => chooseSection(sectionId)}>{sectionId}</button>)}
      </nav>
      <span className="map-focus-summary">{summary}</span>
    </div>
    <div className="map-layer-bar" aria-label="Слои карты">
      <label><input type="checkbox" checked={showRoutes} onChange={(event) => setShowRoutes(event.target.checked)} /> Маршруты</label>
      <label><input type="checkbox" aria-label="Показывать аварии" checked={showEmergencies} onChange={(event) => setShowEmergencies(event.target.checked)} /> Аварии</label>
      <label><input type="checkbox" aria-label="Показывать неназначенные" checked={showUnassigned} onChange={(event) => setShowUnassigned(event.target.checked)} /> Неназначенные</label>
      <span className="map-object-count">На схеме: {plottedRequestCount} {pluralize(plottedRequestCount, "заявка", "заявки", "заявок")} · {plottedTeamCount} {pluralize(plottedTeamCount, "бригада", "бригады", "бригад")}</span>
    </div>
    <div className="map-stage">
      <svg viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="img" aria-label="Схематическая карта маршрутов бригад" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onWheel={handleWheel}>
        <defs>
          <pattern id="map-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#d9dedb" strokeWidth="1" /></pattern>
          <filter id="map-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.16" /></filter>
          {visibleRoutes.map((route) => {
            const focused = focusedTeamId === route.team_id;
            const opacity = focused ? 0.95 : (isRequestFocus || isTeamFocus) ? 0.045 : selectedSectionId ? 0.38 : 0.24;
            return <marker key={route.team_id} id={`route-arrow-${route.team_id}`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth" opacity={opacity}><path d="M0,0 L8,4 L0,8 Z" fill={teamColor(route.team_id)} /></marker>;
          })}
        </defs>
        <rect x="-500" y="-310" width="2000" height="1240" fill="#f4f6f3" data-map-background="true" />
        <rect x="-500" y="-310" width="2000" height="1240" fill="url(#map-grid)" opacity="0.72" pointerEvents="none" />
        {showRoutes && visibleRoutes.map((route) => {
          const office = pointMap.teams.get(route.team_id);
          if (!office || !route.request_ids.length) return null;
          const color = teamColor(route.team_id);
          const points = [office, ...route.request_ids.map((id) => pointMap.requests.get(id)).filter((point): point is NonNullable<typeof point> => Boolean(point))].map((point) => `${point.x * 10},${point.y * 6.2}`).join(" ");
          const focused = focusedTeamId === route.team_id;
          const dimmed = (isRequestFocus || isTeamFocus) && !focused;
          const opacity = focused ? 0.95 : dimmed ? 0.045 : selectedSectionId ? 0.38 : 0.24;
          return <polyline key={route.team_id} data-map-item="route" data-team-id={route.team_id} aria-label={`Маршрут бригады ${route.team_id}`} points={points} fill="none" stroke={color} strokeWidth={focused ? 6 : 2.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dimmed ? "4 9" : undefined} markerEnd={`url(#route-arrow-${route.team_id})`} opacity={opacity} className="route-line" onClick={() => onSelectTeam(route.team_id)}><title>Маршрут бригады {route.team_id}</title></polyline>;
        })}
        {visibleTeams.map((team) => {
          const point = pointMap.teams.get(team.id);
          if (!point) return null;
          const used = plan.routes.some((route) => route.team_id === team.id);
          const focused = focusedTeamId === team.id;
          return <g key={team.id} data-map-item="team" data-team-id={team.id} role={used ? "button" : undefined} tabIndex={used ? 0 : undefined} aria-label={used ? `Офис бригады ${team.id}` : undefined} transform={`translate(${point.x * 10} ${point.y * 6.2})`} opacity={focused || (!isRequestFocus && !isTeamFocus) ? used ? 1 : 0.55 : 1} className={`office-marker ${used ? "" : "unused"}`} onClick={() => { if (used) onSelectTeam(team.id); }} onKeyDown={(event) => { if (used && (event.key === "Enter" || event.key === " ")) onSelectTeam(team.id); }}><circle r="16" fill={used ? "#202421" : "#87918a"} filter="url(#map-shadow)" /><path d="M-8 7V-4L0-11 8-4V7H2V0H-2V7Z" fill={used ? teamColor(team.id) : "#e7ebe7"} /><title>{`Офис бригады ${team.id} · ${used ? "задействована" : "не задействована"}`}</title></g>;
        })}
        {visibleRoutes.flatMap((route) => route.request_ids.map((requestId, stopIndex) => ({ route, requestId, stopIndex }))).map(({ route, requestId, stopIndex }) => {
          const request = requestMap.get(requestId);
          const point = pointMap.requests.get(requestId);
          if (!request || !point || !visibleRequestIdSet.has(requestId) || ((isRequestFocus || isTeamFocus) && focusedTeamId !== route.team_id) || (request.work_type === "EMERGENCY" && !showEmergencies)) return null;
          const selected = focusedRequestId === requestId;
          const focused = focusedTeamId === route.team_id;
          const opacity = (isRequestFocus || isTeamFocus) && !focused ? 0.12 : isRequestFocus && !selected ? 0.64 : 1;
          const color = request.work_type === "EMERGENCY" ? "#d9304f" : teamColor(route.team_id);
          return <g key={requestId} data-map-item="request" data-request-id={requestId} role="button" tabIndex={0} aria-label={`Заявка ${requestId}`} transform={`translate(${point.x * 10} ${point.y * 6.2})`} opacity={opacity} className={`request-marker ${request.work_type === "EMERGENCY" ? "emergency" : ""} ${selected ? "selected" : ""}`} onClick={() => onSelectRequest(requestId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectRequest(requestId); }}>
            {request.work_type === "EMERGENCY" && <><circle r="24" fill="none" stroke="#d9304f" strokeWidth="3" opacity="0.35" /><path d="M0-34V-27" stroke="#d9304f" strokeWidth="4" strokeLinecap="round" /></>}
            <circle r={selected ? 21 : 16} fill={color} stroke={selected ? "#202421" : "#fff"} strokeWidth={selected ? 6 : 3} filter="url(#map-shadow)" />
            <text textAnchor="middle" dominantBaseline="central" fill={request.work_type === "EMERGENCY" ? "#fff" : "#151515"} fontWeight="800" fontSize="12">{stopIndex + 1}</text>
            <title>{`${workTypeLabel(request.work_type)} · заявка ${requestId} · остановка ${stopIndex + 1}`}</title>
          </g>;
        })}
        {showUnassigned && plan.unassigned_requests.filter((requestId) => visibleRequestIdSet.has(requestId) && (!isRequestFocus || focusedRequestId === requestId)).map((requestId) => {
          const point = pointMap.requests.get(requestId);
          const request = requestMap.get(requestId);
          if (!point || (request?.work_type === "EMERGENCY" && !showEmergencies)) return null;
          return <g key={requestId} data-map-item="unassigned" data-request-id={requestId} role="button" tabIndex={0} aria-label={`Заявка ${requestId} не назначена`} transform={`translate(${point.x * 10} ${point.y * 6.2})`} className="unassigned-marker" onClick={() => onSelectRequest(requestId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectRequest(requestId); }}><circle r="19" fill="#d9304f" stroke="#fff" strokeWidth="4" /><path d="M-6-6 6 6M6-6-6 6" stroke="#fff" strokeWidth="3" /><title>{`Неназначенная заявка ${requestId}`}</title></g>;
        })}
      </svg>
      <div className="map-zoom-controls" aria-label="Масштаб карты"><button type="button" aria-label="Увеличить карту" onClick={() => zoom(0.8)}>+</button><button type="button" aria-label="Уменьшить карту" onClick={() => zoom(1.25)}>−</button><button type="button" aria-label="Сбросить масштаб карты" onClick={() => setView(INITIAL_VIEW)}>Сбросить</button><span>{Math.round(1000 / view.width * 100)}%</span></div>
      <div className="map-legend"><div><i className="legend-office" />Офис</div><div><i className="legend-request" />Заявка</div><div><i className="legend-emergency" />Авария</div><div><i className="legend-unassigned" />Неназначенная</div><div><i className="legend-route">→</i>Маршрут</div></div>
    </div>
    <div className="map-caption"><span>Участки: {sectionIds.join(" · ") || dataset.name}</span><strong>Схематическая карта · координаты демонстрационные</strong><span>Масштаб условный · перетаскивайте карту мышью</span></div>
  </section>;
}
