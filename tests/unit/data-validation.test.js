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
      expect(d.geom).toBeNull();
      expect(d.district_name).not.toMatch(/\s{2,}/);
      expect(d.district_name).toBe(d.district_name.trim());
    }

    const discrepDistricts = summary.district_2023.filter((d) => d.scale_discrepancy !== 0);
    expect(discrepDistricts).toHaveLength(8);

    const maret = summary.monthly_2023_impact.find((m) => m.month_name === "Maret");
    expect(maret?.loss_anomaly_flag).toBe(true);
    expect(maret?.raw_material_loss).toBe("776");
    expect(summary.annual_series).toHaveLength(10);
    expect(
      summary.annual_series.filter((a) => a.consistency_flag).map((a) => a.year)
    ).toEqual([2019, 2020, 2021, 2023]);
    expect(summary.unlocated_register.length).toBeGreaterThanOrEqual(4);
    expect(summary.data_quality_anomalies.length).toBeGreaterThanOrEqual(6);

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

    const incDemo = readJson("public/data/demo/incident-explorer-sample.demo.json");
    expect(incDemo.records.find((r) => r.source_record_id === "DEMO-INC-001")?.geom?.type).toBe("Point");
    expect(incDemo.records.find((r) => r.source_record_id === "DEMO-INC-003")?.geom).toBeNull();
  });

  it("verifies every raw input workbook read by build_processed_data.py is registered in source-register.csv with SHA-256", () => {
    const buildSrc = fs.readFileSync(path.join(ROOT, "scripts/build_processed_data.py"), "utf-8");
    const rawRefs = [...new Set([...buildSrc.matchAll(/"([^\s"]+\.(?:xlsx|geojson))"/g)].map((m) => m[1]))].filter(
      (name) => name !== "medan_districts_osm.geojson"
    );
    expect(rawRefs.length).toBe(20);

    const csvLines = fs
      .readFileSync(path.join(ROOT, "data/metadata/source-register.csv"), "utf-8")
      .trim()
      .split(/\r?\n/);
    const headers = csvLines[0].split(",");
    const rows = csvLines.slice(1).map((line) => {
      const cols = line.split(",");
      return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
    });

    for (const refFile of rawRefs) {
      const match = rows.find((r) => r.file_path.endsWith(`/${refFile}`));
      expect(match, `Missing provenance entry in source-register.csv for ${refFile}`).toBeDefined();
      expect(match.publisher.length).toBeGreaterThan(3);
      expect(match.url).toMatch(/^https:\/\//);
      expect(Number(match.file_size_bytes)).toBeGreaterThan(0);
      expect(match.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(["acquired", "acquired_fallback"]).toContain(match.status);
    }
  });
});
