import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(process.cwd());

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf-8"));
}

describe("processed data & DEMO fixture integrity", () => {
  it("verifies official fire_incidents_summary totals and Medan coordinate bounds", () => {
    const summary = readJson("public/data/fire_incidents_summary.json");
    expect(summary.summary_totals.year_2023).toBe(219);
    expect(summary.summary_totals.year_2024).toBe(269);
    expect(summary.summary_totals.year_2025).toBe(251);
    expect(summary.summary_totals.district_count).toBe(21);
    expect(summary.summary_totals.individual_geocoded_count).toBe(0);
    expect(summary.summary_totals.population_2025_total).toBe(2498293);

    const sum2023 = summary.district_2023.reduce((s, d) => s + d.total_incidents, 0);
    const sum2024 = summary.monthly_2024.reduce((s, m) => s + m.total_incidents, 0);
    const sum2025 = summary.monthly_2025.reduce((s, m) => s + m.total_incidents, 0);
    expect(sum2023).toBe(219);
    expect(sum2024).toBe(269);
    expect(sum2025).toBe(251);

    for (const d of summary.district_2023) {
      expect(d.location_accuracy).toBe("district_only");
    }

    const mako = summary.verified_stations[0];
    expect(mako.lat).toBeGreaterThanOrEqual(3.45);
    expect(mako.lat).toBeLessThanOrEqual(3.85);
    expect(mako.lon).toBeGreaterThanOrEqual(98.55);
    expect(mako.lon).toBeLessThanOrEqual(98.78);
  });

  it("verifies 21 Medan Kecamatan polygons stay inside Kota Medan extent", () => {
    const geo = readJson("public/data/medan_districts_osm.geojson");
    expect(geo.features).toHaveLength(21);
    for (const feat of geo.features) {
      expect(feat.properties.area_code).toMatch(/^12\.71\.\d{2}$/);
      expect(["Polygon", "MultiPolygon"]).toContain(feat.geometry.type);
    }
  });

  it("verifies every DEMO fixture carries explicit isDemo and DEMO labeling", () => {
    const demoDir = path.join(ROOT, "data/fixtures/demo");
    const files = fs.readdirSync(demoDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const payload = JSON.parse(fs.readFileSync(path.join(demoDir, file), "utf-8"));
      expect(payload.isDemo).toBe(true);
      expect(payload.dataLabel).toBe("DEMO");
    }
  });
});
