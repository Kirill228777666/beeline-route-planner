import type { Dataset, Explanation, Plan, PlanDiff } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      message = parsed.detail ?? body;
    } catch {
      message = body;
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return await response.json() as T;
}

function postJson<T>(url: string, body: unknown) {
  return requestJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function optimize(dataset: Dataset, solver: "baseline" | "cpp") {
  return postJson<Plan>(`${API_URL}/api/optimize`, { ...dataset, solver });
}

export function getExplanation(planId: string, requestId: number) {
  return requestJson<Explanation>(`${API_URL}/api/plans/${planId}/requests/${requestId}/explanation`);
}

export function createPlanEvent(planId: string, payload: object) {
  return postJson<{ event_id: number; event_time: number }>(`${API_URL}/api/plans/${planId}/events`, payload);
}

export function replan(planId: string, eventId: number, currentTime: string) {
  return postJson<Plan>(`${API_URL}/api/plans/${planId}/replan`, { event_id: eventId, current_time: currentTime });
}

export function getPlanDiff(planId: string) {
  return requestJson<PlanDiff>(`${API_URL}/api/plans/${planId}/diff`);
}

export async function loadBundledDataset(file: string) {
  return requestJson<Dataset>(file);
}
