import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      if (url.includes("/explanation")) return jsonResponse({ request_id: 11, team_id: 10003, reason: "Бригада соответствует ограничениям.", arrival: "09:28", start: "09:28", finish: "10:48", hard_constraints: [{ code: "SECTION", passed: true }], alternatives: [] });
      return jsonResponse({ detail: `unexpected API call ${init?.method ?? "GET"} ${url}` }, 404);
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads zone_1 into the new dashboard shell", async () => {
    render(<App />);
    expect(await screen.findByText("Текущий набор")).toBeInTheDocument();
    expect(screen.getByText("Участок: zone_1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Построить план/ })).toHaveLength(2);
  });

  it("builds both plans, switches baseline, and opens a factual request drawer", async () => {
    render(<App />);
    await screen.findByText("Участок: zone_1");
    fireEvent.click(screen.getAllByRole("button", { name: /Построить план/ })[0]);
    expect(await screen.findByText("Оптимизированный план")).toBeInTheDocument();
    expect(screen.getByText("Python verifier: OK")).toBeInTheDocument();
    expect(screen.getByText("1/1 назначено · независимая проверка Python пройдена")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Базовый" }));
    expect(screen.getByText("Базовый план")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Событие в течение дня" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Оптимизированный" }));
    fireEvent.click(screen.getByRole("button", { name: "Заявка 11" }));
    expect(await screen.findByText("ПОЧЕМУ НАЗНАЧЕНА СЮДА?")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Бригада соответствует ограничениям.")).toBeInTheDocument());
  });

  it("shows linked request and unassigned tabs with a display-only request search", async () => {
    render(<App />);
    await screen.findByText("Участок: zone_1");
    fireEvent.click(screen.getAllByRole("button", { name: /Построить план/ })[0]);
    await screen.findByText("Оптимизированный план");

    expect(screen.getByRole("tab", { name: /Бригады 1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Заявки 1/ }));
    expect(screen.getByRole("searchbox", { name: "Поиск заявок" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /!11Авария/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск заявок" }), { target: { value: "нет такого ID" } });
    expect(screen.getByText("Ничего не найдено по заданным фильтрам")).toBeInTheDocument();
    expect(screen.getByText("1/1 назначено · независимая проверка Python пройдена")).toBeInTheDocument();
  });

  it("offers map zoom, pan guidance, and independently toggleable operational layers", async () => {
    render(<App />);
    await screen.findByText("Участок: zone_1");
    fireEvent.click(screen.getAllByRole("button", { name: /Построить план/ })[0]);
    await screen.findByText("Оптимизированный план");

    expect(screen.getByRole("button", { name: "Увеличить карту" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Уменьшить карту" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сбросить масштаб карты" })).toBeInTheDocument();
    const svg = screen.getByRole("img", { name: "Схематическая карта маршрутов бригад" });
    expect(svg).toHaveAttribute("viewBox", "0 0 1000 620");
    fireEvent.click(screen.getByRole("button", { name: "Увеличить карту" }));
    expect(svg).not.toHaveAttribute("viewBox", "0 0 1000 620");
    expect(screen.getByRole("checkbox", { name: "Показывать аварии" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Показывать аварии" }));
    expect(screen.getByRole("checkbox", { name: "Показывать аварии" })).not.toBeChecked();
    expect(screen.getByText("Схематическая карта · координаты демонстрационные")).toBeInTheDocument();
  });

  it("keeps map focus synchronized from team to request, preserves team focus on drawer close, and returns to all routes", async () => {
    render(<App />);
    await screen.findByText("Участок: zone_1");
    fireEvent.click(screen.getAllByRole("button", { name: /Построить план/ })[0]);
    await screen.findByText("Оптимизированный план");

    fireEvent.click(screen.getByRole("button", { name: /^Бригада 10003/ }));
    expect(screen.getByText("Бригада 10003 · 1 заявка · 8,2 км")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Заявка 11" }));
    expect(screen.getByText("Заявка #11 · маршрут Бригада 10003")).toBeInTheDocument();
    expect(await screen.findByText("ПОЧЕМУ НАЗНАЧЕНА СЮДА?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Закрыть карточку" }));
    expect(screen.getByText("Бригада 10003 · 1 заявка · 8,2 км")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Все маршруты" }));
    expect(screen.getByText("Все участки · 1 заявка · 1 бригада")).toBeInTheDocument();
  });

  it("clears a team and request focus when switching to another section", async () => {
    const combinedDataset = {
      name: "combined",
      requests: [dataset.requests[0], { ...dataset.requests[0], id: 22, address: "Вторая зона", work_type: "REPAIR", required_skills: ["REPAIR"], region_id: "zone_2" }],
      teams: [dataset.teams[0], { ...dataset.teams[0], id: 20003, name: "Бригада 20003", skills: ["REPAIR"], region_id: "zone_2" }],
    };
    const combinedPlan = (solver: string) => ({
      plan_id: `${solver}-combined`,
      verified: true,
      metrics: { assigned: 2, unassigned: 0, used_teams: 2, total_distance_km: 16, total_travel_minutes: 56, runtime_ms: 20 },
      routes: [
        { team_id: 10003, request_ids: [11], distance_km: 8.2, stops: [{ request_id: 11, arrival: 568, start: 568, finish: 648, travel_time: 28, travel_distance: 8.2, waiting: 0 }] },
        { team_id: 20003, request_ids: [22], distance_km: 7.8, stops: [{ request_id: 22, arrival: 570, start: 570, finish: 600, travel_time: 28, travel_distance: 7.8, waiting: 0 }] },
      ],
      unassigned_requests: [],
    });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/datasets/zone_1.json")) return jsonResponse(dataset);
      if (url.endsWith("/datasets/combined.json")) return jsonResponse(combinedDataset);
      if (url.endsWith("/api/optimize")) return jsonResponse(combinedPlan(JSON.parse(String(init?.body)).solver));
      if (url.includes("/explanation")) return jsonResponse({ request_id: 11, team_id: 10003, reason: "Подтверждено backend.", arrival: "09:28", start: "09:28", finish: "10:48", hard_constraints: [], alternatives: [] });
      return jsonResponse({ detail: `unexpected API call ${init?.method ?? "GET"} ${url}` }, 404);
    }));

    render(<App />);
    await screen.findByText("Участок: zone_1");
    fireEvent.change(screen.getByRole("combobox", { name: "Набор данных" }), { target: { value: "combined" } });
    await screen.findByText("Объединённый набор");
    fireEvent.click(screen.getAllByRole("button", { name: /Построить план/ })[0]);
    await screen.findByText("Оптимизированный план");
    fireEvent.click(screen.getByRole("button", { name: /^Бригада 10003/ }));
    fireEvent.click(screen.getByRole("button", { name: "Заявка 11" }));
    expect(await screen.findByRole("complementary", { name: "Карточка заявки 11" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "zone_2" }));

    expect(screen.queryByRole("complementary", { name: "Карточка заявки 11" })).not.toBeInTheDocument();
    expect(screen.getByText("Участок zone_2 · 1 заявка · 1 бригада")).toBeInTheDocument();
    const map = screen.getByRole("region", { name: "Карта маршрутов" });
    expect(within(map).getAllByRole("button", { name: /^Заявка/ })).toHaveLength(1);
    expect(within(map).getByRole("button", { name: "Заявка 22" })).toBeInTheDocument();

    fireEvent.click(within(map).getByRole("button", { name: "Все маршруты" }));
    expect(screen.getByText("Все участки · 2 заявки · 2 бригады")).toBeInTheDocument();
    expect(within(map).getAllByRole("button", { name: /^Заявка/ })).toHaveLength(2);
  });

  it("keeps request details visible and lets the operator retry a failed explanation request", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/datasets/zone_1.json")) return jsonResponse(dataset);
      if (url.endsWith("/api/optimize")) {
        const payload = JSON.parse(String(init?.body));
        return jsonResponse(makePlan(payload.solver, payload.solver === "baseline" ? 2 : 1));
      }
      if (url.includes("/explanation")) {
        attempts += 1;
        return attempts === 1 ? jsonResponse({ detail: "Сервис объяснений временно недоступен" }, 503) : jsonResponse({ request_id: 11, team_id: 10003, reason: "Повторная проверка ограничений прошла.", arrival: "09:28", start: "09:28", finish: "10:48", hard_constraints: [], alternatives: [] });
      }
      return jsonResponse({ detail: `unexpected API call ${init?.method ?? "GET"} ${url}` }, 404);
    }));

    render(<App />);
    await screen.findByText("Участок: zone_1");
    fireEvent.click(screen.getAllByRole("button", { name: /Построить план/ })[0]);
    await screen.findByText("Оптимизированный план");
    fireEvent.click(screen.getByRole("button", { name: "Заявка 11" }));
    expect(await screen.findByText("Сервис объяснений временно недоступен")).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "Карточка заявки 11" })).getByText("Тестовая улица, 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Повторная проверка ограничений прошла.")).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("replans through the event and diff APIs without discarding the baseline plan", async () => {
    const child = {
      plan_id: "child",
      parent_plan_id: "cpp",
      event_time: 797,
      verified: true,
      metrics: { assigned: 2, unassigned: 0, used_teams: 1, total_distance_km: 12.1, total_travel_minutes: 41, runtime_ms: 30 },
      routes: [{ team_id: 10003, request_ids: [11, 12], distance_km: 12.1, stops: [
        { request_id: 11, arrival: 568, start: 568, finish: 648, travel_time: 28, travel_distance: 8.2, waiting: 0 },
        { request_id: 12, arrival: 660, start: 660, finish: 740, travel_time: 12, travel_distance: 3.9, waiting: 0 },
      ] }],
      unassigned_requests: [],
    };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/datasets/zone_1.json")) return jsonResponse(dataset);
      if (url.endsWith("/api/optimize")) {
        const payload = JSON.parse(String(init?.body));
        return jsonResponse(makePlan(payload.solver, payload.solver === "baseline" ? 2 : 1));
      }
      if (url.endsWith("/api/plans/cpp/events")) return jsonResponse({ event_id: 7, event_time: 797 });
      if (url.endsWith("/api/plans/cpp/replan")) return jsonResponse(child);
      if (url.endsWith("/api/plans/child/diff")) return jsonResponse({ plan_id: "child", event_id: 7, reassigned_request_ids: [], time_changed_request_ids: [], route_changed_team_ids: [10003], cancelled_request_ids: [], new_request_ids: [12] });
      if (url.includes("/requests/12/explanation")) return jsonResponse({ request_id: 12, team_id: 10003, reason: "Назначено после повторной проверки.", arrival: "11:00", start: "11:00", finish: "12:20", hard_constraints: [{ code: "SECTION", passed: true }], alternatives: [] });
      if (url.includes("/explanation")) return jsonResponse({ request_id: 11, team_id: 10003, reason: "Бригада соответствует ограничениям.", arrival: "09:28", start: "09:28", finish: "10:48", hard_constraints: [], alternatives: [] });
      return jsonResponse({ detail: `unexpected API call ${init?.method ?? "GET"} ${url}` }, 404);
    }));

    render(<App />);
    await screen.findByText("Участок: zone_1");
    fireEvent.click(screen.getAllByRole("button", { name: /Построить план/ })[0]);
    await screen.findByText("Оптимизированный план");
    fireEvent.click(screen.getByRole("button", { name: "Событие в течение дня" }));
    fireEvent.change(screen.getByPlaceholderText("Адрес новой аварийной заявки"), { target: { value: "Новая авария, 5" } });
    fireEvent.click(screen.getByRole("button", { name: "Перестроить план" }));

    expect(await screen.findByText("Что изменилось после события")).toBeInTheDocument();
    expect(await screen.findByText("Назначено после повторной проверки.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Оптимизированный" })).toHaveClass("active");
    expect(screen.getByText("Новых: 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Базовый" }));
    expect(screen.getByRole("heading", { name: "Базовый план" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Оптимизированный" }));
    expect(screen.getByRole("heading", { name: "Оптимизированный план" })).toBeInTheDocument();
  });
});
