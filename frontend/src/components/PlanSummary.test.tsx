import { fireEvent, render, screen, within } from "@testing-library/react";
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

const datasets: DatasetOption[] = [{ id: "zone_1", label: "Участок zone_1", file: "/datasets/zone_1.json" }];

describe("PlanSummary", () => {
  it("shows coverage, verifier result, and finite comparison values", () => {
    render(<PlanSummary plan={optimized} baseline={baseline} datasetSize={66} mode="optimized" />);
    expect(screen.getByText("66/66")).toBeInTheDocument();
    expect(screen.getByText("Python verifier: OK")).toBeInTheDocument();
    expect(within(screen.getByText("Бригады").closest("article")!).getByText("7")).toBeInTheDocument();
    expect(screen.getAllByText("207,6 км")).toHaveLength(2);
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
  });
});

describe("ControlBar", () => {
  it("identifies the active section and disables replanning in baseline mode", () => {
    const openEvent = vi.fn();
    render(<ControlBar datasetId="zone_1" datasetName="Север" datasets={datasets} mode="baseline" loading={false} loadingStep="" hasPlan onDatasetChange={vi.fn()} onFile={vi.fn()} onBuild={vi.fn()} onModeChange={vi.fn()} onOpenEvent={openEvent} />);
    expect(screen.getByText("Участок: zone_1")).toBeInTheDocument();
    const eventButton = screen.getByRole("button", { name: "Событие в течение дня" });
    expect(eventButton).toBeDisabled();
    fireEvent.click(eventButton);
    expect(openEvent).not.toHaveBeenCalled();
  });
});

describe("PlanHistory", () => {
  it("shows parent and child plans with changed routes", () => {
    const child = { ...optimized, plan_id: "child", parent_plan_id: "parent", event_time: 797 };
    render(<PlanHistory before={baseline} after={child} diff={{ reassigned_request_ids: [10], time_changed_request_ids: [11], route_changed_team_ids: [10003], cancelled_request_ids: [], new_request_ids: [99] }} />);
    expect(screen.getByText("Исходный план")).toBeInTheDocument();
    expect(screen.getByText("Новый план")).toBeInTheDocument();
    expect(screen.getByText("13:17")).toBeInTheDocument();
    expect(screen.getByText("Время в пути 0 → 417 мин")).toBeInTheDocument();
    expect(screen.getByText("Пробег 0 → 207,6 км")).toBeInTheDocument();
    expect(screen.getByText("Маршрутов изменено: 1")).toBeInTheDocument();
  });
});
