import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const dataset = {
  name: "zone_1",
  regions: ["zone_1"],
  requests: [{ id: 11, address: "Тестовая улица, 1", lat: 55.75, lon: 37.61, window_start: "09:00", window_end: "12:00", service_duration: 80, work_type: "EMERGENCY", required_skills: ["EMERGENCY"], region_id: "zone_1" }],
  teams: [{ id: 10003, name: "Бригада 10003", start_lat: 55.74, start_lon: 37.60, shift_start: "09:00", shift_end: "18:00", skills: ["EMERGENCY"], transport: "CAR", equipment: [], region_id: "zone_1" }],
};

const makePlan = (id: string, usedTeams: number) => ({
  plan_id: id,
  verified: true,
  metrics: { assigned: 1, unassigned: 0, used_teams: usedTeams, total_distance_km: 8.2, total_travel_minutes: 28, runtime_ms: 20 },
  routes: [{ team_id: 10003, request_ids: [11], distance_km: 8.2, stops: [{ request_id: 11, arrival: 568, start: 568, finish: 648, travel_time: 28, travel_distance: 8.2, waiting: 0 }] }],
  unassigned_requests: [],
});

function jsonResponse(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }));
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/datasets/zone_1.json")) return jsonResponse(dataset);
      if (url.endsWith("/api/optimize")) {
        const payload = JSON.parse(String(init?.body));
        return jsonResponse(makePlan(payload.solver === "baseline" ? "baseline" : "optimized", payload.solver === "baseline" ? 2 : 1));
      }
      if (url.includes("/explanation")) return jsonResponse({ request_id: 11, team_id: 10003, reason: "Бригада соответствует ограничениям.", arrival: "09:28", start: "09:28", finish: "10:48", hard_constraints: [{ code: "REGION", passed: true }], alternatives: [] });
      return jsonResponse({}, 404);
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads zone_1 into the new dashboard shell", async () => {
    render(<App />);
    expect(await screen.findByText("Активный участок")).toBeInTheDocument();
    expect(screen.getByText("Район: zone_1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Построить план/ })).toHaveLength(2);
  });

  it("builds both plans, switches baseline, and opens a factual request drawer", async () => {
    render(<App />);
    await screen.findByText("Район: zone_1");
    fireEvent.click(screen.getAllByRole("button", { name: /Построить план/ })[0]);
    expect(await screen.findByText("Оптимизированный план")).toBeInTheDocument();
    expect(screen.getByText("Python verifier: OK")).toBeInTheDocument();
    expect(screen.getByText("1/1 feasible · verifier OK")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Базовый" }));
    expect(screen.getByText("Базовый план")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Событие в течение дня" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Оптимизированный" }));
    fireEvent.click(screen.getByRole("button", { name: "Заявка 11" }));
    expect(await screen.findByText("ПОЧЕМУ НАЗНАЧЕНА СЮДА?")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Бригада соответствует ограничениям.")).toBeInTheDocument());
  });
});
