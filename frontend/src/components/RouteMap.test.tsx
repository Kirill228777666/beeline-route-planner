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

describe("RouteMap", () => {
  it("renders separately selectable duplicate points, numbered stops, and emergency state", () => {
    const selectRequest = vi.fn();
    render(<RouteMap dataset={dataset} plan={plan} selectedTeamId={10003} selectedRequestId={null} onSelectTeam={vi.fn()} onSelectRequest={selectRequest} />);
    const points = screen.getAllByRole("button", { name: /Заявка/ });
    expect(points).toHaveLength(2);
    expect(points[0]).toHaveAttribute("transform", expect.not.stringMatching(points[1].getAttribute("transform") ?? ""));
    expect(screen.getAllByText("Авария").length).toBeGreaterThan(0);
    expect(screen.getByText("Схематическая карта. Координаты демонстрационные.")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    fireEvent.click(points[0]);
    expect(selectRequest).toHaveBeenCalledWith(11);
  });
});

describe("TeamsPanel", () => {
  it("shows team capabilities and route timeline", () => {
    render(<TeamsPanel dataset={dataset} plan={plan} selectedTeamId={10003} selectedRequestId={null} statuses={{}} diff={null} onSelectTeam={vi.fn()} onSelectRequest={vi.fn()} />);
    expect(screen.getByText("Бригада 10003")).toBeInTheDocument();
    expect(screen.getByText("09:28–10:48")).toBeInTheDocument();
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
