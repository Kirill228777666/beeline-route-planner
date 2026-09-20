import { describe, expect, it } from "vitest";

import {
  formatClock,
  metricComparison,
  normalizeMapPoints,
  percentageChange,
  validateDataset,
  workTypeLabel,
} from "./presentation";

describe("presentation helpers", () => {
  it("formats minute values as a clock", () => {
    expect(formatClock(568)).toBe("09:28");
  });

  it("handles a zero comparison denominator", () => {
    expect(percentageChange(0, 7)).toBeNull();
  });

  it("translates official work types", () => {
    expect(workTypeLabel("EMERGENCY")).toBe("Авария");
  });

  it("rejects datasets without teams", () => {
    expect(() => validateDataset({ requests: [] })).toThrow("teams");
  });

  it("produces finite metric comparisons", () => {
    expect(metricComparison(0, 7, false)).toEqual({ delta: 7, percent: null, improved: false });
  });

  it("offsets points with identical coordinates", () => {
    const points = normalizeMapPoints([
      { id: 1, lat: 55.75, lon: 37.61 },
      { id: 2, lat: 55.75, lon: 37.61 },
    ]);
    expect(points[0]).not.toEqual(points[1]);
  });
});
