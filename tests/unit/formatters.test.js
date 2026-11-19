import { describe, expect, it } from "vitest";
import { formatDate, formatDistance, formatNumber } from "../../src/core/formatters.js";

describe("formatters", () => {
  it("formats numbers, distances, and invalid inputs gracefully", () => {
    expect(formatNumber(2498293)).toContain("2");
    expect(formatNumber(null)).toBe("-");
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(3500)).toContain("km");
    expect(formatDate("2024-06-14T14:20:00+07:00")).toContain("2024");
    expect(formatDate("")).toBe("-");
  });
});
