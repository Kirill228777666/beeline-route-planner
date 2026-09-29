import { useEffect, useMemo, useRef, useState } from "react";
import { divIcon, latLngBounds, type Map as LeafletMap } from "leaflet";
import { MapContainer, Marker, Pane, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { formatDistance, sectionValue, workTypeLabel } from "../lib/presentation";
import type { Dataset, Plan, RequestInput, Route, TeamInput } from "../types";

export const TEAM_COLORS = ["#a27800", "#7358ce", "#00866a", "#cf4962", "#1876bd", "#a34bb3", "#c56824", "#008799", "#8a6749", "#648a22", "#b34584", "#4f60bd"];
export function teamColor(teamId: number) { return TEAM_COLORS[Math.abs(Math.trunc(teamId)) % TEAM_COLORS.length]; }

type Coordinate = [number, number];
type MapFocus = { kind: "overview" | "route" | "request"; points: Coordinate[]; selected?: Coordinate };
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

function coordinate(lat: number, lon: number): Coordinate | null {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

function routeCoordinates(route: Route, teamMap: Map<number, TeamInput>, requestMap: Map<number, RequestInput>): Coordinate[] {
  const team = teamMap.get(route.team_id);
  const start = team ? coordinate(team.start_lat, team.start_lon) : null;
  return [start, ...route.request_ids.map((id) => {
    const request = requestMap.get(id);
    return request ? coordinate(request.lat, request.lon) : null;
  })].filter((point): point is Coordinate => point !== null);
}

function pluralize(count: number, one: string, few: string, many: string) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = count % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function pinIcon(kind: "request" | "emergency" | "unassigned" | "office", id: number, color: string, selected = false, number: number | null = null, offsetX = 0, muted = false) {
  const size = selected ? 32 : kind === "office" ? 22 : kind === "emergency" || kind === "unassigned" ? 18 : number !== null ? 26 : 12;
  const label = kind === "office" ? "Офис бригады " + id : "Заявка " + id + (kind === "unassigned" ? " не назначена" : "");
  const item = kind === "office" ? "team" : kind === "unassigned" ? "unassigned" : "request";
  const symbol = number !== null
    ? '<span class="map-pin__number" aria-hidden="true">' + number + "</span>"
    : '<span aria-hidden="true">' + (kind === "office" ? "⌂" : kind === "emergency" ? "!" : kind === "unassigned" ? "×" : "") + "</span>";
  const html = '<button type="button" class="map-pin map-pin--' + kind + (selected ? " map-pin--selected" : "") + (muted ? " map-pin--muted" : "") +
    '" aria-label="' + label + '" data-map-item="' + item + '" data-' + (kind === "office" ? "team" : "request") +
    '-id="' + id + '" style="--route-color:' + color + '">' + symbol + "</button>";
  return divIcon({
    className: "route-map-div-icon",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2 - offsetX, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function fitMap(map: LeafletMap, focus: MapFocus) {
  map.invalidateSize();
  if (focus.kind === "request" && focus.selected) {
    map.setView(focus.selected, Math.max(map.getZoom(), 15), { animate: false });
  } else if (focus.points.length > 1) {
    map.fitBounds(latLngBounds(focus.points), {
      padding: [40, 40],
      maxZoom: focus.kind === "route" ? 15 : 13,
      animate: false,
    });
  } else if (focus.points.length === 1) {
    map.setView(focus.points[0], focus.kind === "route" ? 14 : 13, { animate: false });
  }
}

function MapViewport({ focus, onZoom }: { focus: MapFocus; onZoom: (zoom: number) => void }) {
  const map = useMap();
  useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => { fitMap(map, focus); }, [map, focus]);
  return null;
}

function RequestPopup({ request, team, stopNumber }: { request: RequestInput; team?: TeamInput; stopNumber?: number }) {
  return <div className="map-popup">
    <strong>Заявка #{request.id}</strong>
    <span>{workTypeLabel(request.work_type)}</span>
    <p>{request.address || "Адрес не указан"}</p>
    <dl>
      <div><dt>Участок</dt><dd>{sectionValue(request) || "—"}</dd></div>
      {request.district && <div><dt>Район</dt><dd>{request.district}</dd></div>}
      <div><dt>Окно</dt><dd>{request.window_start}–{request.window_end}</dd></div>
      <div><dt>Бригада</dt><dd>{team?.name || "Не назначена"}</dd></div>
      {stopNumber !== undefined && <div><dt>Остановка</dt><dd>№{stopNumber}</dd></div>}
    </dl>
  </div>;
}

export function RouteMap({ dataset, plan, selectedSectionId, selectedTeamId, selectedRequestId, onSelectTeam, onSelectRequest, onSectionChange }: RouteMapProps) {
  const mapRef = useRef<LeafletMap | null>(null);
  const [zoomLevel, setZoomLevel] = useState(11);
  const [tileState, setTileState] = useState<"loading" | "ready" | "error">("loading");
  const [showRoutes, setShowRoutes] = useState(true);
  const [showEmergencies, setShowEmergencies] = useState(true);
  const [showUnassigned, setShowUnassigned] = useState(true);
  const tileHandlers = useMemo(() => ({
    tileload: () => setTileState("ready"),
    tileerror: () => setTileState((current) => current === "ready" ? current : "error"),
  }), []);
  const requestMap = useMemo(() => new Map(dataset.requests.map((request) => [request.id, request])), [dataset.requests]);
  const teamMap = useMemo(() => new Map(dataset.teams.map((team) => [team.id, team])), [dataset.teams]);
  const sectionIds = useMemo(() => [...new Set([...dataset.requests, ...dataset.teams].map(sectionValue).filter(Boolean))], [dataset.requests, dataset.teams]);
  const unassignedSet = useMemo(() => new Set(plan.unassigned_requests), [plan.unassigned_requests]);
  const allPlanRequestIds = useMemo(() => new Set([...plan.routes.flatMap((route) => route.request_ids), ...plan.unassigned_requests]), [plan.routes, plan.unassigned_requests]);
  const requestRouteMap = useMemo(() => {
    const result = new Map<number, Route>();
    plan.routes.forEach((route) => route.request_ids.forEach((id) => result.set(id, route)));
    return result;
  }, [plan.routes]);
  const routesInSection = useMemo(() => plan.routes.filter((route) => {
    const team = teamMap.get(route.team_id);
    return route.request_ids.length > 0 && Boolean(team) && (!selectedSectionId || sectionValue(team!) === selectedSectionId);
  }), [plan.routes, selectedSectionId, teamMap]);
  const sectionRequestIds = useMemo(() => [...allPlanRequestIds].filter((id) => {
    const request = requestMap.get(id);
    return Boolean(request) && (!selectedSectionId || sectionValue(request!) === selectedSectionId);
  }), [allPlanRequestIds, requestMap, selectedSectionId]);
  const selectedRequest = selectedRequestId === null ? undefined : requestMap.get(selectedRequestId);
  const focusedRequestId = selectedSectionId && (!selectedRequest || sectionValue(selectedRequest) !== selectedSectionId) ? null : selectedRequestId;
  const focusedRoute = focusedRequestId !== null
    ? requestRouteMap.get(focusedRequestId)
    : selectedTeamId === null ? undefined : routesInSection.find((route) => route.team_id === selectedTeamId);
  const focusedTeamId = focusedRoute?.team_id ?? null;
  const isRequestFocus = focusedRequestId !== null;
  const isTeamFocus = !isRequestFocus && focusedTeamId !== null;
  const visibleRequestIds = sectionRequestIds;
  const visibleRequestIdSet = useMemo(() => new Set(visibleRequestIds), [visibleRequestIds]);
  const routePoints = useMemo(() => new Map(plan.routes.map((route) => [route.team_id, routeCoordinates(route, teamMap, requestMap)])), [plan.routes, teamMap, requestMap]);
  const visibleTeams = useMemo(() => routesInSection.map((route) => teamMap.get(route.team_id)).filter((team): team is TeamInput =>
    Boolean(team)
  ), [routesInSection, teamMap]);
  const markerOffsets = useMemo(() => {
    const groups = new Map<string, number[]>();
    visibleRequestIds.forEach((id) => {
      const request = requestMap.get(id);
      if (!request || (request.work_type === "EMERGENCY" && !showEmergencies) || (unassignedSet.has(id) && !showUnassigned)) return;
      const key = String(request.lat) + ":" + String(request.lon);
      groups.set(key, [...(groups.get(key) ?? []), id]);
    });
    const offsets = new Map<number, number>();
    groups.forEach((ids) => ids.forEach((id, index) => offsets.set(id, (index - (ids.length - 1) / 2) * 18)));
    return offsets;
  }, [visibleRequestIds, requestMap, showEmergencies, showUnassigned, unassignedSet]);
  const focus = useMemo<MapFocus>(() => {
    if (focusedRequestId !== null && selectedRequest) {
      const selected = coordinate(selectedRequest.lat, selectedRequest.lon);
      return { kind: "request", points: selected ? [selected] : [], selected: selected ?? undefined };
    }
    if (focusedRoute) return { kind: "route", points: routePoints.get(focusedRoute.team_id) ?? [] };
    const points = [
      ...sectionRequestIds.map((id) => {
        const request = requestMap.get(id);
        return request ? coordinate(request.lat, request.lon) : null;
      }),
      ...routesInSection.map((route) => {
        const team = teamMap.get(route.team_id);
        return team ? coordinate(team.start_lat, team.start_lon) : null;
      }),
    ].filter((point): point is Coordinate => point !== null);
    return { kind: "overview", points };
  }, [plan.plan_id, selectedSectionId, focusedRequestId, selectedRequest, focusedRoute, sectionRequestIds, requestMap, routesInSection, routePoints, teamMap]);
  const initialCenter = focus.points[0] ?? coordinate(dataset.teams[0]?.start_lat, dataset.teams[0]?.start_lon) ?? [0, 0];

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
      ? "Заявка #" + focusedRequestId + " · не назначена"
      : "Заявка #" + focusedRequestId + " · маршрут " + (teamMap.get(focusedTeamId)?.name || "Бригада " + focusedTeamId)
    : isTeamFocus && focusedRoute
      ? (teamMap.get(focusedTeamId!)?.name || "Бригада " + focusedTeamId) + " · " + focusedRoute.request_ids.length + " " + pluralize(focusedRoute.request_ids.length, "заявка", "заявки", "заявок") + " · " + formatDistance(focusedRoute.distance_km) + " км"
      : null;
  return <section className="map-card" aria-label="Карта маршрутов">
    <div className="map-heading">
      <h2>{focusTitle ?? "Маршруты на сегодня"}</h2>
      <div className="map-actions">{(isTeamFocus || isRequestFocus) && <button type="button" onClick={showAllRoutes}>Сбросить выбор</button>}<button type="button" className={!isTeamFocus && !isRequestFocus ? "active" : ""} onClick={showAllRoutes}>Все маршруты</button></div>
    </div>
    <div className="map-view-toolbar">
      <nav className="map-section-filter" aria-label="Фильтр по участку">
        <button type="button" className={!selectedSectionId ? "active" : ""} aria-pressed={!selectedSectionId} onClick={() => chooseSection(null)}>Все</button>
        {sectionIds.map((sectionId) => <button key={sectionId} type="button" className={selectedSectionId === sectionId ? "active" : ""} aria-pressed={selectedSectionId === sectionId} onClick={() => chooseSection(sectionId)}>{sectionId}</button>)}
      </nav>
    </div>
    <div className="map-layer-bar" aria-label="Слои карты">
      <label><input type="checkbox" checked={showRoutes} onChange={(event) => setShowRoutes(event.target.checked)} /> Маршруты</label>
      <label><input type="checkbox" aria-label="Показывать аварии" checked={showEmergencies} onChange={(event) => setShowEmergencies(event.target.checked)} /> Аварии</label>
      <label><input type="checkbox" aria-label="Показывать неназначенные" checked={showUnassigned} onChange={(event) => setShowUnassigned(event.target.checked)} /> Неназначенные</label>
    </div>
    <div className="map-stage">
      <MapContainer ref={mapRef} className="leaflet-map" center={initialCenter} zoom={11} zoomControl={false} scrollWheelZoom>
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution={'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'} eventHandlers={tileHandlers} />
        <MapViewport focus={focus} onZoom={setZoomLevel} />
        <Pane name="route-lines" style={{ zIndex: 410 }}>
          {showRoutes && routesInSection.map((route) => {
            const points = routePoints.get(route.team_id) ?? [];
            if (points.length < 2) return null;
            const selected = focusedTeamId === route.team_id;
            const dimmed = focusedTeamId !== null && !selected;
            return <Polyline key={route.team_id} positions={points} pathOptions={{
              color: teamColor(route.team_id), weight: selected ? 4.5 : 1.6,
              opacity: selected ? 0.95 : dimmed ? 0.16 : selectedSectionId ? 0.37 : 0.25,
              className: "route-line route-line--" + route.team_id,
            }} eventHandlers={{ click: () => onSelectTeam(route.team_id) }} />;
          })}
        </Pane>
        <Pane name="office-markers" style={{ zIndex: 620 }}>
          {visibleTeams.map((team) => {
            const point = coordinate(team.start_lat, team.start_lon);
            if (!point) return null;
            return <Marker key={team.id} position={point} pane="office-markers" keyboard={false} title={"Офис бригады " + team.id}
              icon={pinIcon("office", team.id, teamColor(team.id), focusedTeamId === team.id, null, 0, focusedTeamId !== null && focusedTeamId !== team.id)}
              eventHandlers={{ click: () => onSelectTeam(team.id) }}>
              <Popup autoPan={false}><div className="map-popup"><strong>{team.name}</strong><p>Стартовая точка · участок {sectionValue(team) || "—"}</p></div></Popup>
            </Marker>;
          })}
        </Pane>
        <Pane name="request-markers" style={{ zIndex: 640 }}>
          {routesInSection.flatMap((route) => route.request_ids.map((id, index) => {
            const request = requestMap.get(id);
            const point = request ? coordinate(request.lat, request.lon) : null;
            if (!request || !point || !visibleRequestIdSet.has(id) || (request.work_type === "EMERGENCY" && !showEmergencies)) return null;
            const selected = focusedRequestId === id;
            const number = focusedTeamId === route.team_id ? index + 1 : null;
            return <Marker key={id} position={point} pane="request-markers" keyboard={false} title={"Заявка " + id}
              zIndexOffset={selected ? 1000 : focusedTeamId === route.team_id ? 300 : 0}
              icon={pinIcon(request.work_type === "EMERGENCY" ? "emergency" : "request", id, teamColor(route.team_id), selected, number, markerOffsets.get(id) ?? 0, focusedTeamId !== null && focusedTeamId !== route.team_id)}
              eventHandlers={{ click: () => onSelectRequest(id) }}>
              <Popup autoPan={false}><RequestPopup request={request} team={teamMap.get(route.team_id)} stopNumber={index + 1} /></Popup>
            </Marker>;
          }))}
          {showUnassigned && plan.unassigned_requests.filter((id) => visibleRequestIdSet.has(id)).map((id) => {
            const request = requestMap.get(id);
            const point = request ? coordinate(request.lat, request.lon) : null;
            if (!request || !point || request.work_type === "EMERGENCY" && !showEmergencies) return null;
            return <Marker key={"unassigned-" + id} position={point} pane="request-markers" keyboard={false} title={"Заявка " + id + " не назначена"}
              zIndexOffset={focusedRequestId === id ? 1000 : 100}
              icon={pinIcon("unassigned", id, "#d9304f", focusedRequestId === id, null, markerOffsets.get(id) ?? 0, focusedTeamId !== null)}
              eventHandlers={{ click: () => onSelectRequest(id) }}>
              <Popup autoPan={false}><RequestPopup request={request} /></Popup>
            </Marker>;
          })}
        </Pane>
      </MapContainer>
      {tileState !== "ready" && <div className={"map-tile-state" + (tileState === "error" ? " error" : "")} role={tileState === "error" ? "alert" : "status"}>
        {tileState === "error" ? "Картографическая подложка недоступна. Заявки и маршруты остаются на карте." : "Загружаем картографическую подложку…"}
      </div>}
      <details className="map-about"><summary>ⓘ <span>О карте</span></summary><p>Координаты демонстрационные. Маршруты используются для демонстрации работы планировщика и не являются дорожной навигацией.</p></details>
      <div className="map-zoom-controls" aria-label="Масштаб карты"><button type="button" aria-label="Увеличить карту" onClick={() => mapRef.current?.zoomIn()}>+</button><button type="button" aria-label="Уменьшить карту" onClick={() => mapRef.current?.zoomOut()}>−</button><button type="button" aria-label="Сбросить масштаб карты" onClick={() => { if (mapRef.current) fitMap(mapRef.current, focus); }}>По данным</button><span>z{zoomLevel}</span></div>
      <div className="map-legend"><div><i className="legend-office" />Офис</div><div><i className="legend-request" />Заявка</div><div><i className="legend-emergency" />Авария</div><div><i className="legend-unassigned" />Неназначенная</div><div><i className="legend-route" />Маршрут</div>{focusedTeamId !== null && <div className="map-legend-team">{teamMap.get(focusedTeamId)?.name || "Бригада " + focusedTeamId}</div>}</div>
    </div>
  </section>;
}
