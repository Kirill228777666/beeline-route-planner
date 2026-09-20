import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DatasetOption, Plan } from "../types";
import { ControlBar } from "./ControlBar";
import { PlanHistory } from "./PlanHistory";
import { PlanSummary } from "./PlanSummary";

const optimized: Plan = {
  plan_id: "optimized",
  verified: true,
  metrics: {
    assigned: 66,
    unassigned: 0,
    used_teams: 7,
    total_distance_km: 207.6,
    total_travel_minutes: 417,
    runtime_ms: 982,
  },
  routes: [],
  unassigned_requests: [],
};

const baseline: Plan = {
  plan_id: "baseline",
  verified: true,
  metrics: {
    assigned: 0,
    unassigned: 66,
    used_teams: 12,
    total_distance_km: 0,
    total_travel_minutes: 0,
    runtime_ms: 10,
  },
  routes: [],
  unassigned_requests: [],
};

const datasets: DatasetOption[] = [{ id: "zone_1", label: "zone_1 · 66 заявок", request_count: 66, team_count: 12, file: "/datasets/zone_1.json" }];

describe("PlanSummary", () => {
  it("shows coverage, verifier result, and finite comparison values", () => {
    render(<PlanSummary plan={optimized} baseline={baseline} datasetSize={66} mode="optimized" />);
    expect(screen.getByText("66/66")).toBeInTheDocument();
    expect(screen.getByText("Python verifier: OK")).toBeInTheDocument();
    expect(screen.getAllByText("207,6 км")).toHaveLength(2);
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
  });
});

describe("ControlBar", () => {
  it("identifies the active region and disables replanning in baseline mode", () => {
    const openEvent = vi.fn();
    render(<ControlBar datasetId="zone_1" datasetName="Север" datasets={datasets} mode="baseline" loading={false} hasPlan onDatasetChange={vi.fn()} onFile={vi.fn()} onBuild={vi.fn()} onModeChange={vi.fn()} onOpenEvent={openEvent} />);
    expect(screen.getByText("Район: zone_1")).toBeInTheDocument();
    const eventButton = screen.getByRole("button", { name: "Событие в течение дня" });
    expect(eventButton).toBeDisabled();
    fireEvent.click(eventButton);
    expect(openEvent).not.toHaveBeenCalled();
  });
});

describe("PlanHistory", () => {
  it("shows parent and child plans with changed routes", () => {
    const child = { ...optimized, plan_id: "child", parent_plan_id: "parent" };
    render(<PlanHistory before={baseline} after={child} diff={{ reassigned_request_ids: [10], time_changed_request_ids: [11], route_changed_team_ids: [10003], cancelled_request_ids: [], new_request_ids: [99] }} />);
    expect(screen.getByText("Исходный план")).toBeInTheDocument();
    expect(screen.getByText("Перепланированный план")).toBeInTheDocument();
    expect(screen.getByText("Маршрутов изменено: 1")).toBeInTheDocument();
  });
});
