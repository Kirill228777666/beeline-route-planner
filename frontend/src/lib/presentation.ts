import type { Dataset, MapPoint, PlanMetrics } from "../types";

export function formatClock(value: number | undefined | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  const normalized = Math.max(0, Math.round(value));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function formatDistance(value: number | undefined | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

export function percentageChange(before: number, after: number) {
  if (before === 0) return null;
  return ((after - before) / before) * 100;
}

export function metricComparison(before: number, after: number, higherIsBetter: boolean) {
  const delta = after - before;
  const percent = percentageChange(before, after);
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  return { delta, percent, improved };
}

export function metricNumber(metrics: PlanMetrics | undefined, key: string, fallback = 0) {
  const value = metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function workTypeLabel(workType: string | undefined) {
  const labels: Record<string, string> = {
    EMERGENCY: "Авария",
    CONNECTION: "Подключение",
    REPAIR: "Ремонт",
    ADD_ON: "Дозаказ",
  };
  return labels[String(workType ?? "").toUpperCase()] ?? workType ?? "Не указан";
}

export function validateDataset(value: unknown): Dataset {
  if (!value || typeof value !== "object") throw new Error("JSON должен содержать объект dataset");
  const candidate = value as Partial<Dataset>;
  if (!Array.isArray(candidate.requests)) throw new Error("Dataset должен содержать массив requests");
  if (!Array.isArray(candidate.teams)) throw new Error("Dataset должен содержать массив teams");
  return {
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : "Пользовательский dataset",
    requests: candidate.requests,
    teams: candidate.teams,
    regions: Array.isArray(candidate.regions) ? candidate.regions : undefined,
  };
}

export function normalizeMapPoints(points: Array<{ id: number; lat: number; lon: number }>): MapPoint[] {
  if (!points.length) return [];
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latSpan = Math.max(maxLat - minLat, 0.001);
  const lonSpan = Math.max(maxLon - minLon, 0.001);
  const occurrences = new Map<string, number>();

  return points.map((point) => {
    const key = `${point.lat.toFixed(6)}:${point.lon.toFixed(6)}`;
    const duplicateIndex = occurrences.get(key) ?? 0;
    occurrences.set(key, duplicateIndex + 1);
    const angle = duplicateIndex * 2.399963;
    const radius = duplicateIndex === 0 ? 0 : 7 + Math.floor(duplicateIndex / 6) * 4;
    const x = 7 + ((point.lon - minLon) / lonSpan) * 86 + Math.cos(angle) * radius * 0.12;
    const y = 93 - ((point.lat - minLat) / latSpan) * 86 + Math.sin(angle) * radius * 0.12;
    return { id: point.id, x: Math.min(96, Math.max(4, x)), y: Math.min(96, Math.max(4, y)) };
  });
}
