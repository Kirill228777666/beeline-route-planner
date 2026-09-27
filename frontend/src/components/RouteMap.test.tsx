import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Dataset, Plan } from "../types";
import { RouteMap } from "./RouteMap";
import { TeamsPanel } from "./TeamsPanel";
import { UnassignedSection } from "./UnassignedSection";

const dataset: Dataset = {
  name: "zone_1",
  requests: [
    { id: 11, address: "ул. Первая, 1", lat: 55.75, lon: 37.61, window_start: "09:00", window_end: "12:00", service_duration: 80, work_type: "EMERGENCY", required_skills: ["EMERGENCY"], region_id: "zone_1" },
    { id: 12, address: "ул. Вторая, 2", lat: 55.75, lon: 37.61, window_start: "10:00", window_end: "14:00", service_duration: 70, work_type: "CONNECTION", required_skills: ["CONNECTION"], region_id: "zone_1" },
  ],
  teams: [
    { id: 10003, name: "Бригада 10003", start_lat: 55.74, start_lon: 37.60, shift_start: "09:00", shift_end: "18:00", skills: ["EMERGENCY", "CONNECTION"], transport: "CAR", equipment: ["LADDER"], region_id: "zone_1" },
  ],
};

const plan: Plan = {
  plan_id: "plan",
  verified: true,
  metrics: { assigned: 2, used_teams: 1 },
  routes: [{ team_id: 10003, request_ids: [11, 12], distance_km: 12.4, stops: [
    { request_id: 11, arrival: 568, start: 568, finish: 648, travel_time: 28, travel_distance: 8.2, waiting: 0 },
    { request_id: 12, arrival: 662, start: 662, finish: 732, travel_time: 14, travel_distance: 4.2, waiting: 0 },
  ] }],
  unassigned_requests: [],
};

const sectionDataset: Dataset = {
  name: "combined",
  sections: ["zone_1", "zone_2"],
  requests: [
    { id: 21, address: "Улица 1", lat: 55.7, lon: 37.6, window_start: "09:00", window_end: "12:00", service_duration: 70, work_type: "CONNECTION", required_skills: ["CONNECTION"], section_id: "zone_1", district: "Район А" },
    { id: 22, address: "Улица 2", lat: 55.71, lon: 37.61, window_start: "12:00", window_end: "15:00", service_duration: 30, work_type: "REPAIR", required_skills: ["REPAIR"], section_id: "zone_1", district: "Район Б" },
    { id: 23, address: "Улица 3", lat: 55.72, lon: 37.62, window_start: "09:00", window_end: "12:00", service_duration: 80, work_type: "EMERGENCY", required_skills: ["EMERGENCY"], section_id: "zone_2", district: "Район В" },
  ],
  teams: [
    { id: 101, name: "Бригада 101", start_lat: 55.69, start_lon: 37.59, shift_start: "09:00", shift_end: "18:00", skills: ["CONNECTION", "REPAIR"], transport: "CAR", equipment: [], section_id: "zone_1", district: "Район А" },
    { id: 201, name: "Бригада 201", start_lat: 55.73, start_lon: 37.63, shift_start: "09:00", shift_end: "18:00", skills: ["EMERGENCY"], transport: "CAR", equipment: [], section_id: "zone_2", district: "Район В" },
  ],
};

const sectionPlan: Plan = {
  plan_id: "section-plan",
  verified: true,
  metrics: { assigned: 3, unassigned: 0, used_teams: 2 },
  routes: [
    { team_id: 101, request_ids: [21, 22], distance_km: 18.4, stops: [
      { request_id: 21, arrival: 568, start: 568, finish: 638, travel_time: 28, travel_distance: 8.2, waiting: 0 },
      { request_id: 22, arrival: 650, start: 720, finish: 750, travel_time: 12, travel_distance: 4.2, waiting: 70 },
    ] },
    { team_id: 201, request_ids: [23], distance_km: 9.5, stops: [
      { request_id: 23, arrival: 570, start: 570, finish: 650, travel_time: 30, travel_distance: 9.5, waiting: 0 },
    ] },
  ],
  unassigned_requests: [],
};

describe("RouteMap", () => {
  it("renders separately selectable duplicate points, numbered stops, and emergency state", () => {
    const selectRequest = vi.fn();
    render(<RouteMap dataset={dataset} plan={plan} selectedSectionId={null} selectedTeamId={10003} selectedRequestId={null} onSelectTeam={vi.fn()} onSelectRequest={selectRequest} onSectionChange={vi.fn()} />);
    const points = screen.getAllByRole("button", { name: /Заявка/ });
    expect(points).toHaveLength(2);
    expect(points[0]).toHaveAttribute("transform", expect.not.stringMatching(points[1].getAttribute("transform") ?? ""));
    expect(screen.getAllByText("Авария").length).toBeGreaterThan(0);
    expect(screen.getByText("Схематическая карта · координаты демонстрационные")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    fireEvent.click(points[0]);
    expect(selectRequest).toHaveBeenCalledWith(11);
  });

  it("filters map elements by section without filtering districts and uses plan counts", () => {
    const onSectionChange = vi.fn();
    const props = { dataset: sectionDataset, plan: sectionPlan, selectedSectionId: null, selectedTeamId: null, selectedRequestId: null, onSelectTeam: vi.fn(), onSelectRequest: vi.fn(), onSectionChange };
    const { container, rerender } = render(<RouteMap {...props} />);
    const allRoutes = container.querySelectorAll('[data-map-item="route"]');
    expect(allRoutes[0]).toHaveAttribute("stroke-width", "2.2");
    expect(allRoutes[0]).toHaveAttribute("opacity", "0.24");

    fireEvent.click(screen.getByRole("button", { name: "zone_1" }));
    expect(onSectionChange).toHaveBeenCalledWith("zone_1");
    rerender(<RouteMap {...props} selectedSectionId="zone_1" />);

    expect(screen.getAllByRole("button", { name: /^Заявка/ })).toHaveLength(2);
    expect(container.querySelectorAll('[data-map-item="route"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-map-item="team"]')).toHaveLength(1);
    expect(screen.getByText("Участок zone_1 · 2 заявки · 1 бригада")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Заявка 23" })).not.toBeInTheDocument();
  });

  it("focuses the selected team route and retains the selected request focus", () => {
    const { container, rerender } = render(<RouteMap dataset={sectionDataset} plan={sectionPlan} selectedSectionId={null} selectedTeamId={101} selectedRequestId={null} onSelectTeam={vi.fn()} onSelectRequest={vi.fn()} onSectionChange={vi.fn()} />);

    expect(screen.getByText("Бригада 101 · 2 заявки · 18,4 км")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-map-item="request"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-map-item="team"]')).toHaveLength(1);
    expect(container.querySelector('[data-map-item="route"][data-team-id="101"]')).toHaveAttribute("opacity", "0.95");
    expect(container.querySelector('[data-map-item="route"][data-team-id="201"]')).toHaveAttribute("opacity", "0.045");

    rerender(<RouteMap dataset={sectionDataset} plan={sectionPlan} selectedSectionId={null} selectedTeamId={101} selectedRequestId={22} onSelectTeam={vi.fn()} onSelectRequest={vi.fn()} onSectionChange={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Заявка #22 · маршрут Бригада 101" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Заявка 22" })).toHaveClass("selected");
    expect(screen.getByRole("button", { name: "Заявка 21" })).toHaveAttribute("opacity", "0.64");
    expect(container.querySelectorAll('[data-map-item="request"]')).toHaveLength(2);
  });
});

describe("TeamsPanel", () => {
  it("shows team capabilities and route timeline", () => {
    render(<TeamsPanel dataset={dataset} plan={plan} selectedTeamId={10003} selectedRequestId={null} statuses={{}} diff={null} onSelectTeam={vi.fn()} onSelectRequest={vi.fn()} />);
    expect(screen.getByText("Бригада 10003")).toBeInTheDocument();
    expect(screen.getByText(/ID 10003/)).toBeInTheDocument();
    expect(screen.getByText("Прибытие 09:28")).toBeInTheDocument();
    expect(screen.getByText("Окончание 10:48")).toBeInTheDocument();
    expect(screen.getByText("LADDER")).toBeInTheDocument();
    expect(screen.getByText("Офис · 09:00")).toBeInTheDocument();
  });
});

describe("UnassignedSection", () => {
  it("renders a clear zero state", () => {
    render(<UnassignedSection dataset={dataset} plan={plan} onSelect={vi.fn()} />);
    expect(screen.getByText("Все заявки распределены")).toBeInTheDocument();
  });

  it("renders unassigned request details", () => {
    render(<UnassignedSection dataset={dataset} plan={{ ...plan, unassigned_requests: [12] }} onSelect={vi.fn()} />);
    expect(screen.getByText("Заявка #12")).toBeInTheDocument();
    expect(screen.getByText(/Подключение/)).toBeInTheDocument();
  });
});
