import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeTextAssetChecksum,
  normalizeTextAssetBytes,
  validateStagingBundle
} from "../../scripts/import_supabase_staging.mjs";

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
    expect(rawRefs.length).toBe(30);

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

  it("verifies newly integrated official datasets (2016-2021 monthly, BPBD comparison, SPM, non-fire rescues) remain strictly separated", () => {
    const summary = readJson("public/data/fire_incidents_summary.json");
    expect(summary.summary_totals.monthly_2016_2021_total).toBe(1372);
    expect(summary.monthly_2016_2021).toHaveLength(72);
    expect(summary.monthly_2016_2021.reduce((s, r) => s + r.total_incidents, 0)).toBe(1372);

    expect(summary.bpbd_comparison.is_comparison_only).toBe(true);
    expect(summary.bpbd_comparison.district_2021).toHaveLength(21);
    expect(summary.bpbd_comparison.district_2021.reduce((s, r) => s + r.fire_incidents, 0)).toBe(108);
    expect(summary.bpbd_comparison.district_2022).toHaveLength(21);
    expect(summary.bpbd_comparison.district_2022.reduce((s, r) => s + r.fire_incidents, 0)).toBe(138);
    expect(summary.bpbd_comparison.monthly_2022.reduce((s, r) => s + r.fire_incidents, 0)).toBe(138);
    expect(summary.bpbd_comparison.monthly_2023.reduce((s, r) => s + r.fire_incidents, 0)).toBe(87);

    expect(summary.damkarmat_spm).toHaveLength(2);
    const spmResp = summary.damkarmat_spm.find((s) => s.unit === "menit");
    expect(spmResp?.target_value).toBe(15);
    expect(spmResp?.realization_value).toBe(13.1);

    expect(summary.non_fire_rescues.is_fire_incident).toBe(false);
    expect(summary.non_fire_rescues.combined_total).toBe(2218);
    expect(summary.non_fire_rescues.monthly_series).toHaveLength(36);
    expect(summary.non_fire_rescues.annual_totals.find((a) => a.year === 2023)?.total_rescues).toBe(449);
    expect(summary.non_fire_rescues.annual_totals.find((a) => a.year === 2024)?.total_rescues).toBe(691);
    expect(summary.non_fire_rescues.annual_totals.find((a) => a.year === 2025)?.total_rescues).toBe(1078);
    expect(summary.data_quality_anomalies.length).toBeGreaterThanOrEqual(9);
  });

  it("verifies independent candidates, station candidates, manifest preservation, and Supabase staging bundle", () => {
    const summary = readJson("public/data/fire_incidents_summary.json");
    const incCand = readJson("public/data/public_incident_candidates.json");
    const stCand = readJson("public/data/damkarmat_station_candidates.json");
    const manifest = readJson("public/data/manifest.json");
    const bundle = readJson("data/processed/supabase_staging_bundle.json");

    expect(incCand.isDemo).toBe(false);
    expect(incCand.records).toHaveLength(27);
    expect(incCand.summary.approximate_point_count).toBe(17);
    expect(incCand.summary.district_only_count).toBe(10);
    expect(incCand.summary.kde_eligible_count).toBe(0);
    expect(incCand.summary.verified_count).toBe(0);

    for (const rec of incCand.records) {
      expect(rec.verification_status).toBe("needs_review");
      expect(rec.kde_eligible).toBe(false);
      expect(["approximate", "district_only"]).toContain(rec.location_accuracy);
      expect(rec.source_url).toMatch(/^https:\/\//);
      expect(rec.occurred_time_wib).not.toBe("00:00");
      if (rec.occurred_at !== null) {
        expect(rec.occurred_at).not.toMatch(/T00:00:00/);
      }
      if (rec.location_accuracy === "approximate") {
        expect(rec.geom?.type).toBe("Point");
        expect(rec.lat).toBeGreaterThanOrEqual(3.45);
        expect(rec.lat).toBeLessThanOrEqual(3.85);
        expect(rec.lon).toBeGreaterThanOrEqual(98.55);
        expect(rec.lon).toBeLessThanOrEqual(98.78);
      } else {
        expect(rec.geom).toBeNull();
      }
    }

    expect(summary.verified_stations).toHaveLength(1);
    expect(stCand.stations).toHaveLength(6);
    expect(stCand.reference_articles.length).toBeGreaterThanOrEqual(2);
    for (const ref of stCand.reference_articles) {
      expect(String(ref.published_at)).not.toMatch(/T00:00:00/);
    }
    const antaraRef = stCand.reference_articles.find((r) => String(r.url).includes("560100"));
    expect(antaraRef?.event_date).toBe("2024-01-26");
    expect(antaraRef?.published_at).toBe("2024-01-27T00:32:42+07:00");
    const perwaliRef = stCand.reference_articles.find((r) => String(r.url).includes("perwali-kota-medan-no-25"));
    expect(perwaliRef?.published_at).toBe("2018-02-14");
    expect(perwaliRef?.promulgated_on).toBe("2018-02-14");
    expect(perwaliRef?.official_gazette).toBe("BD.2018/ No. 25");

    for (const st of stCand.stations) {
      expect(st.verification_status).toBe("needs_review");
    }
    expect(stCand.stations.filter((s) => s.geom !== null).map((s) => s.station_code)).toEqual([
      "UPT-01",
      "UPT-02",
      "UPT-05",
      "UPT-06"
    ]);
    expect(stCand.stations.filter((s) => s.geom === null).map((s) => s.station_code)).toEqual([
      "UPT-03",
      "UPT-04"
    ]);

    expect(manifest.verified_outputs?.["station-coverage"]?.status).toBe("provisional");
    expect(manifest.verified_outputs?.["priority-planner"]?.status).toBe("provisional");
    expect(manifest.datasets.some((d) => d.id === "medan-roads-osm")).toBe(true);
    expect(manifest.independent_enrichment?.datasets).toHaveLength(2);

    const validationCounts = validateStagingBundle(bundle, ROOT);
    expect(validationCounts.fire_incident_aggregates).toBe(193);
    expect(validationCounts.fire_stations).toBe(7);
    expect(validationCounts.fire_incidents).toBe(27);
    expect(bundle.schema_recommendations.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps snapshot and independent catalog JSON checksums deterministic across CRLF and LF line endings", () => {
    const manifest = readJson("public/data/manifest.json");
    const bundle = readJson("data/processed/supabase_staging_bundle.json");

    const sampleLf = '{"a":1,\n"b":2}\n';
    const sampleCrlf = '{"a":1,\r\n"b":2}\r\n';
    expect(normalizeTextAssetBytes(sampleLf)).toEqual(normalizeTextAssetBytes(sampleCrlf));

    expect(bundle.tables.app_data_snapshots).toHaveLength(5);
    for (const snap of bundle.tables.app_data_snapshots) {
      const absPath = path.join(ROOT, snap.public_file_path);
      const rawText = fs.readFileSync(absPath, "utf-8");
      const lfBuf = normalizeTextAssetBytes(rawText.replace(/\r?\n/g, "\n"));
      const crlfBuf = normalizeTextAssetBytes(rawText.replace(/\r?\n/g, "\r\n"));
      const direct = computeTextAssetChecksum(absPath);

      expect(direct.sha256).toBe(snap.content_sha256);
      expect(direct.byteSize).toBe(snap.byte_size);
      expect(crypto.createHash("sha256").update(lfBuf).digest("hex")).toBe(snap.content_sha256);
      expect(lfBuf.length).toBe(snap.byte_size);
      expect(crypto.createHash("sha256").update(crlfBuf).digest("hex")).toBe(snap.content_sha256);
      expect(crlfBuf.length).toBe(snap.byte_size);
    }

    for (const item of manifest.independent_enrichment.datasets) {
      const absPath = path.join(ROOT, "public", item.path.replace(/^\//, ""));
      expect(computeTextAssetChecksum(absPath).sha256).toBe(item.sha256);
    }
  });
});
