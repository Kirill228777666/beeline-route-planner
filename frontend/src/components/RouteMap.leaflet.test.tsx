import * as L from "leaflet";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Dataset, Plan } from "../types";
import { RouteMap } from "./RouteMap";

const dataset: Dataset = {
  name: "combined",
  requests: [
    { id: 21, address: "Улица 1", lat: 55.7, lon: 37.6, window_start: "09:00", window_end: "12:00", service_duration: 70, work_type: "CONNECTION", required_skills: ["CONNECTION"], section_id: "zone_1", district: "Район А" },
    { id: 22, address: "Улица 2", lat: 55.71, lon: 37.61, window_start: "12:00", window_end: "15:00", service_duration: 30, work_type: "REPAIR", required_skills: ["REPAIR"], section_id: "zone_1", district: "Район Б" },
    { id: 23, address: "Улица 3", lat: 55.72, lon: 37.62, window_start: "09:00", window_end: "12:00", service_duration: 80, work_type: "EMERGENCY", required_skills: ["EMERGENCY"], section_id: "zone_2", district: "Район В" },
    { id: 24, address: "Улица 4", lat: 55.705, lon: 37.605, window_start: "09:00", window_end: "12:00", service_duration: 70, work_type: "CONNECTION", required_skills: ["CONNECTION"], section_id: "zone_1", district: "Район Г" },
    { id: 25, address: "Улица 5", lat: 55.73, lon: 37.63, window_start: "10:00", window_end: "13:00", service_duration: 30, work_type: "REPAIR", required_skills: ["REPAIR"], region_id: "zone_2", district: "Район Д" },
  ],
  teams: [
    { id: 101, name: "Бригада 101", start_lat: 55.69, start_lon: 37.59, shift_start: "09:00", shift_end: "18:00", skills: ["CONNECTION", "REPAIR"], transport: "CAR", equipment: [], section_id: "zone_1", district: "Район А" },
    { id: 201, name: "Бригада 201", start_lat: 55.715, start_lon: 37.615, shift_start: "09:00", shift_end: "18:00", skills: ["EMERGENCY"], transport: "CAR", equipment: [], section_id: "zone_2", district: "Район В" },
    { id: 301, name: "Бригада 301", start_lat: 55.725, start_lon: 37.625, shift_start: "09:00", shift_end: "18:00", skills: ["REPAIR"], transport: "CAR", equipment: [], region_id: "zone_2", district: "Район Е" },
  ],
};

const plan: Plan = {
  plan_id: "combined-plan",
  verified: true,
  metrics: { assigned: 4, unassigned: 1, used_teams: 3 },
  routes: [
    { team_id: 101, request_ids: [21, 22], distance_km: 18.4, stops: [
      { request_id: 21, arrival: 568, start: 568, finish: 638, travel_time: 28, travel_distance: 8.2, waiting: 0 },
      { request_id: 22, arrival: 650, start: 720, finish: 750, travel_time: 12, travel_distance: 4.2, waiting: 70 },
    ] },
    { team_id: 201, request_ids: [23], distance_km: 9.5, stops: [
      { request_id: 23, arrival: 570, start: 570, finish: 650, travel_time: 30, travel_distance: 9.5, waiting: 0 },
    ] },
    { team_id: 301, request_ids: [25], distance_km: 4.5, stops: [
      { request_id: 25, arrival: 600, start: 600, finish: 630, travel_time: 10, travel_distance: 4.5, waiting: 0 },
    ] },
  ],
  unassigned_requests: [24],
};

function mount(overrides: Partial<React.ComponentProps<typeof RouteMap>> = {}) {
  const props = {
    dataset, plan, selectedSectionId: null, selectedTeamId: null, selectedRequestId: null,
    onSelectTeam: vi.fn(), onSelectRequest: vi.fn(), onSectionChange: vi.fn(), ...overrides,
  };
  return { props, ...render(<RouteMap {...props} />) };
}

function activeRoutes(map: L.Map) {
  const routes: L.Polyline[] = [];
  map.eachLayer((layer) => {
    if (layer instanceof L.Polyline && layer.options.className?.includes("route-line")) routes.push(layer);
  });
  return routes;
}

afterEach(() => vi.restoreAllMocks());

describe("Leaflet route map", () => {
  it("mounts a real map with compact request, emergency, unassigned and office layers", () => {
    const addLayer = vi.spyOn(L.Map.prototype, "addLayer");
    const { container } = mount();
    const map = addLayer.mock.instances[0] as L.Map;

    expect(container.querySelector(".leaflet-container")).toBeInTheDocument();
    expect(activeRoutes(map)).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Заявка 21" })).toHaveClass("map-pin--request");
    expect(screen.getByRole("button", { name: "Заявка 23" })).toHaveClass("map-pin--emergency");
    expect(screen.getByRole("button", { name: "Заявка 24 не назначена" })).toHaveClass("map-pin--unassigned");
    expect(screen.getByRole("button", { name: "Офис бригады 101" })).toHaveClass("map-pin--office");
    expect(container.querySelectorAll(".map-pin__number")).toHaveLength(0);
    const ordinaryMarker = addLayer.mock.calls.map(([layer]) => layer)
      .find((layer): layer is L.Marker => layer instanceof L.Marker && layer.options.title === "Заявка 21");
    expect((ordinaryMarker?.options.icon as L.DivIcon).options.iconSize).toEqual([12, 12]);
    expect(screen.getByText("О карте")).toBeInTheDocument();
    expect(screen.getByText(/Координаты демонстрационные/).closest("details")).not.toHaveAttribute("open");
  });

  it("passes unchanged dataset coordinates to Leaflet route and marker layers", () => {
    const addLayer = vi.spyOn(L.Map.prototype, "addLayer");
    mount();

    const layers = addLayer.mock.calls.map(([layer]) => layer);
    const route = layers.find((layer): layer is L.Polyline => layer instanceof L.Polyline && layer.options.className?.includes("route-line--101") === true);
    const request = layers.find((layer): layer is L.Marker => layer instanceof L.Marker && layer.options.title === "Заявка 21");
    const office = layers.find((layer): layer is L.Marker => layer instanceof L.Marker && layer.options.title === "Офис бригады 101");

    expect(route).toBeDefined();
    expect((route!.getLatLngs() as L.LatLng[]).map(({ lat, lng }) => [lat, lng])).toEqual([[55.69, 37.59], [55.7, 37.6], [55.71, 37.61]]);
    expect(request?.getLatLng()).toMatchObject({ lat: 55.7, lng: 37.6 });
    expect(office?.getLatLng()).toMatchObject({ lat: 55.69, lng: 37.59 });
  });

  it("filters by section with region fallback while retaining different districts", () => {
    const addLayer = vi.spyOn(L.Map.prototype, "addLayer");
    const { rerender, props } = mount({ selectedSectionId: "zone_1" });
    const leafletMap = addLayer.mock.instances[0] as L.Map;
    const map = screen.getByRole("region", { name: "Карта маршрутов" });

    expect(within(map).getByRole("button", { name: "Заявка 21" })).toBeInTheDocument();
    expect(within(map).getByRole("button", { name: "Заявка 22" })).toBeInTheDocument();
    expect(within(map).getByRole("button", { name: "Заявка 24 не назначена" })).toBeInTheDocument();
    expect(within(map).queryByRole("button", { name: "Заявка 23" })).not.toBeInTheDocument();
    expect(activeRoutes(leafletMap)).toHaveLength(1);

    rerender(<RouteMap {...props} selectedSectionId="zone_2" />);
    expect(within(map).getByRole("button", { name: "Заявка 23" })).toBeInTheDocument();
    expect(within(map).getByRole("button", { name: "Заявка 25" })).toBeInTheDocument();
    expect(within(map).queryByRole("button", { name: "Заявка 21" })).not.toBeInTheDocument();
    expect(activeRoutes(leafletMap)).toHaveLength(2);
  });

  it("fits a selected route, numbers only its stops and keeps other routes and requests visible", () => {
    const addLayer = vi.spyOn(L.Map.prototype, "addLayer");
    const fitBounds = vi.spyOn(L.Map.prototype, "fitBounds");
    const { rerender, props } = mount();
    const leafletMap = addLayer.mock.instances[0] as L.Map;
    const before = fitBounds.mock.calls.length;
    rerender(<RouteMap {...props} selectedTeamId={101} />);

    expect(fitBounds.mock.calls.length).toBeGreaterThan(before);
    expect(activeRoutes(leafletMap).find((route) => route.options.className?.includes("route-line--101"))?.options.opacity).toBe(0.95);
    expect(activeRoutes(leafletMap).find((route) => route.options.className?.includes("route-line--201"))?.options.opacity).toBeGreaterThan(0.1);
    expect(screen.getByRole("button", { name: "Заявка 21" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Заявка 22" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Заявка 23" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Заявка 24 не назначена" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Офис бригады 201" })).toBeInTheDocument();
    expect(screen.queryByText("На карте: 5 заявок · 3 бригады")).not.toBeInTheDocument();

    const focusedCalls = fitBounds.mock.calls.length;
    rerender(<RouteMap {...props} selectedTeamId={101} plan={{ ...plan }} />);
    expect(fitBounds).toHaveBeenCalledTimes(focusedCalls);
  });

  it("centers a selected request, highlights it and opens its compact popup on click", async () => {
    const setView = vi.spyOn(L.Map.prototype, "setView");
    const onSelectRequest = vi.fn();
    const { rerender, props } = mount({ onSelectRequest, selectedSectionId: "zone_1" });

    rerender(<RouteMap {...props} selectedSectionId="zone_1" selectedTeamId={101} selectedRequestId={22} />);
    expect(setView.mock.calls.some(([center]) => Array.isArray(center) && center[0] === 55.71 && center[1] === 37.61)).toBe(true);
    expect(screen.getByRole("button", { name: "Заявка 22" })).toHaveClass("map-pin--selected");
    expect(screen.getByRole("button", { name: "Заявка 21" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Заявка 24 не назначена" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Заявка 22" }));
    expect(onSelectRequest).toHaveBeenCalledWith(22);
    await waitFor(() => expect(screen.getByText("Улица 2")).toBeInTheDocument());
  });

  it("keeps all section objects when a request is selected and offers an explicit reset", () => {
    const addLayer = vi.spyOn(L.Map.prototype, "addLayer");
    const onSelectTeam = vi.fn();
    const onSelectRequest = vi.fn();
    const onSectionChange = vi.fn();
    mount({ selectedRequestId: 21, selectedTeamId: 101, onSelectTeam, onSelectRequest, onSectionChange });
    const leafletMap = addLayer.mock.instances[0] as L.Map;

    expect(activeRoutes(leafletMap)).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Заявка 23" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Заявка 25" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Заявка 24 не назначена" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Заявка 21" })).toHaveClass("map-pin--selected");
    expect(screen.getByRole("button", { name: "Сбросить выбор" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Сбросить выбор" }));
    expect(onSelectTeam).toHaveBeenCalledWith(null);
    expect(onSelectRequest).toHaveBeenCalledWith(null);
    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it("keeps the section when returning to all routes and lets the user toggle route visibility", () => {
    const addLayer = vi.spyOn(L.Map.prototype, "addLayer");
    const onSelectTeam = vi.fn();
    const onSelectRequest = vi.fn();
    const onSectionChange = vi.fn();
    const { rerender, props } = mount({ selectedSectionId: "zone_1", selectedTeamId: 101, selectedRequestId: 21, onSelectTeam, onSelectRequest, onSectionChange });
    const leafletMap = addLayer.mock.instances[0] as L.Map;

    fireEvent.click(screen.getByRole("button", { name: "Все маршруты" }));
    expect(onSelectTeam).toHaveBeenCalledWith(null);
    expect(onSelectRequest).toHaveBeenCalledWith(null);
    expect(onSectionChange).not.toHaveBeenCalled();

    rerender(<RouteMap {...props} selectedSectionId="zone_1" selectedTeamId={null} selectedRequestId={null} />);
    expect(activeRoutes(leafletMap)).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Маршруты" }));
    expect(activeRoutes(leafletMap)).toHaveLength(0);
    rerender(<RouteMap {...props} selectedSectionId="zone_1" selectedTeamId={null} selectedRequestId={null} plan={{ ...plan, plan_id: "new-plan" }} />);
    expect(screen.getByRole("checkbox", { name: "Маршруты" })).not.toBeChecked();
  });

  it("reports tile failure without removing operational layers and releases its map on unmount", () => {
    const addLayer = vi.spyOn(L.Map.prototype, "addLayer");
    const remove = vi.spyOn(L.Map.prototype, "remove");
    const { unmount } = mount();
    const tileLayer = addLayer.mock.calls.map(([layer]) => layer).find((layer): layer is L.TileLayer => layer instanceof L.TileLayer);

    expect(tileLayer).toBeDefined();
    act(() => tileLayer?.fire("tileerror"));
    expect(screen.getByText(/Картографическая подложка недоступна/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Заявка 21" })).toBeInTheDocument();
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
