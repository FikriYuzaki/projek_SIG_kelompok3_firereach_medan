import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUNDLE_PATH = path.join(ROOT, "data", "processed", "supabase_staging_bundle.json");

const MEDAN_BOUNDS = { minLat: 3.45, maxLat: 3.85, minLon: 98.55, maxLon: 98.78 };
const DATA_SOURCE_CATEGORIES = new Set([
  "fire_incidents",
  "fire_stations",
  "admin_boundaries",
  "road_network",
  "population",
  "service_standards"
]);
const DATA_SOURCE_GRANULARITIES = new Set([
  "individual",
  "district_aggregate",
  "monthly_aggregate",
  "polygon",
  "network",
  "station_point",
  "policy_table"
]);
const STATION_TYPES = new Set(["mako", "upt", "pos_bantu"]);
const VERIFICATION_STATUSES = new Set(["verified", "needs_review", "unlocated"]);
const LOCATION_ACCURACIES = new Set([
  "exact_verified",
  "address_geocoded_verified",
  "approximate",
  "district_only",
  "unknown"
]);
const SNAPSHOT_STATUSES = new Set(["verified", "provisional", "fallback_osm", "unavailable"]);

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`Staging validation failed: ${msg}`);
  }
}

export function normalizeTextAssetBytes(input) {
  const text = Buffer.isBuffer(input) ? input.toString("utf-8") : String(input);
  return Buffer.from(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf-8");
}

export function computeTextAssetChecksum(absPath) {
  const normalized = normalizeTextAssetBytes(fs.readFileSync(absPath));
  return {
    sha256: crypto.createHash("sha256").update(normalized).digest("hex"),
    byteSize: normalized.length
  };
}

function isValidMedanPoint(geom) {
  if (!geom || typeof geom !== "object" || geom.type !== "Point" || !Array.isArray(geom.coordinates)) {
    return false;
  }
  const [lon, lat] = geom.coordinates;
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= MEDAN_BOUNDS.minLon &&
    lon <= MEDAN_BOUNDS.maxLon &&
    lat >= MEDAN_BOUNDS.minLat &&
    lat <= MEDAN_BOUNDS.maxLat
  );
}

export function validateStagingBundle(bundle, rootDir = ROOT) {
  assert(bundle && typeof bundle === "object", "Missing staging bundle object");
  assert(bundle.staging_only === true, "staging_only must remain true");
  assert(bundle.remote_db_modified === false, "remote_db_modified must remain false");
  const tables = bundle.tables;
  assert(tables && typeof tables === "object", "Missing tables block");

  // 1. data_sources
  const sourceCodes = new Set();
  for (const ds of tables.data_sources || []) {
    assert(ds.source_code && !sourceCodes.has(ds.source_code), `Duplicate/missing source_code: ${ds.source_code}`);
    sourceCodes.add(ds.source_code);
    assert(DATA_SOURCE_CATEGORIES.has(ds.category), `Invalid data_sources.category: ${ds.category}`);
    assert(DATA_SOURCE_GRANULARITIES.has(ds.granularity), `Invalid data_sources.granularity: ${ds.granularity}`);
    assert(typeof ds.source_url === "string" && ds.source_url.startsWith("https://"), `Invalid source_url: ${ds.source_url}`);
  }

  // 2. fire_incident_aggregates
  const aggKeys = new Set();
  for (const agg of tables.fire_incident_aggregates || []) {
    assert(agg.aggregate_key && !aggKeys.has(agg.aggregate_key), `Duplicate aggregate_key: ${agg.aggregate_key}`);
    assert(!agg.aggregate_key.startsWith("NONFIRE"), `Non-fire rescue row must not enter fire_incident_aggregates: ${agg.aggregate_key}`);
    aggKeys.add(agg.aggregate_key);
    assert(
      ["district_aggregate", "monthly_aggregate", "annual_aggregate"].includes(agg.aggregate_type),
      `Invalid aggregate_type: ${agg.aggregate_type}`
    );
    if (agg.aggregate_type === "district_aggregate") {
      assert(agg.area_code !== null && agg.period_month === null, `ck_aggregate_district_key failed on ${agg.aggregate_key}`);
    } else if (agg.aggregate_type === "monthly_aggregate") {
      assert(
        agg.area_code === null && Number.isInteger(agg.period_month) && agg.period_month >= 1 && agg.period_month <= 12,
        `ck_aggregate_district_key failed on ${agg.aggregate_key}`
      );
    } else {
      assert(agg.area_code === null && agg.period_month === null, `ck_aggregate_district_key failed on ${agg.aggregate_key}`);
    }
    assert(["district_only", "unknown"].includes(agg.location_accuracy), `Invalid aggregate location_accuracy on ${agg.aggregate_key}`);
    assert(["needs_review", "unlocated"].includes(agg.verification_status), `Invalid aggregate verification_status on ${agg.aggregate_key}`);
    assert(Number.isInteger(agg.total_incidents) && agg.total_incidents >= 0, `Invalid total_incidents on ${agg.aggregate_key}`);
  }

  // 3. fire_stations
  const stationCodes = new Set();
  for (const st of tables.fire_stations || []) {
    assert(st.station_code && !stationCodes.has(st.station_code), `Duplicate station_code: ${st.station_code}`);
    stationCodes.add(st.station_code);
    assert(STATION_TYPES.has(st.station_type), `Invalid station_type on ${st.station_code}`);
    assert(VERIFICATION_STATUSES.has(st.verification_status), `Invalid status on ${st.station_code}`);
    if (st.station_code === "MAKO-00") {
      assert(st.verification_status === "verified" && isValidMedanPoint(st.geom), "MAKO-00 must be verified with valid Point");
    } else {
      assert(st.verification_status === "needs_review" && st.verified_at === null, `Candidate station ${st.station_code} must stay needs_review`);
    }
    if (st.geom !== null) {
      assert(isValidMedanPoint(st.geom), `Station ${st.station_code} Point out of Kota Medan bounds`);
    }
  }

  // 4. fire_incidents
  const incPairs = new Set();
  for (const inc of tables.fire_incidents || []) {
    const pairKey = `${inc.source_name}::${inc.source_record_id}`;
    assert(!incPairs.has(pairKey), `Duplicate (source_name, source_record_id): ${pairKey}`);
    incPairs.add(pairKey);
    assert(LOCATION_ACCURACIES.has(inc.location_accuracy), `Invalid location_accuracy on ${inc.source_record_id}`);
    assert(VERIFICATION_STATUSES.has(inc.verification_status), `Invalid verification_status on ${inc.source_record_id}`);
    assert(inc.verification_status !== "verified", `Independent candidate ${inc.source_record_id} must stay needs_review`);
    assert(
      !["exact_verified", "address_geocoded_verified"].includes(inc.location_accuracy),
      `Independent candidate ${inc.source_record_id} cannot claim ${inc.location_accuracy}`
    );
    if (inc.occurred_at !== null) {
      assert(
        typeof inc.occurred_at === "string" &&
          !inc.occurred_at.includes("T00:00:00"),
        `Forbidden 00:00 fallback timestamp on ${inc.source_record_id}: ${inc.occurred_at}`
      );
    }
    if (inc.location_accuracy === "district_only") {
      assert(inc.geom === null, `district_only incident ${inc.source_record_id} must have geom=null`);
    } else if (inc.location_accuracy === "approximate") {
      assert(isValidMedanPoint(inc.geom), `approximate incident ${inc.source_record_id} must have bounded Point geom`);
    }
  }

  // 5. app_data_snapshots
  for (const snap of tables.app_data_snapshots || []) {
    assert(SNAPSHOT_STATUSES.has(snap.dataset_status), `Invalid snapshot status: ${snap.dataset_status}`);
    const absPath = path.join(rootDir, snap.public_file_path);
    assert(fs.existsSync(absPath), `Missing snapshot file: ${snap.public_file_path}`);
    const { sha256: actualSha, byteSize: actualByteSize } = computeTextAssetChecksum(absPath);
    assert(actualSha === snap.content_sha256, `SHA-256 mismatch for snapshot ${snap.snapshot_key}`);
    assert(
      actualByteSize === snap.byte_size,
      `Byte size mismatch for snapshot ${snap.snapshot_key}: expected ${snap.byte_size}, got ${actualByteSize}`
    );
  }

  return {
    data_sources: tables.data_sources.length,
    fire_incident_aggregates: tables.fire_incident_aggregates.length,
    fire_stations: tables.fire_stations.length,
    fire_incidents: tables.fire_incidents.length,
    app_data_snapshots: tables.app_data_snapshots.length,
    non_fire_rescues_separate: bundle.separated_non_fire_and_spm?.non_fire_rescues?.combined_total || 0,
    damkarmat_spm_separate: bundle.separated_non_fire_and_spm?.damkarmat_spm?.length || 0,
    schema_recommendations: (bundle.schema_recommendations || []).length
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const applyMode = args.includes("--apply") && !args.includes("--dry-run");
  if (!fs.existsSync(BUNDLE_PATH)) {
    throw new Error(`Staging bundle not found at ${BUNDLE_PATH}. Run 'python scripts/build_processed_data.py' first.`);
  }
  const bundle = JSON.parse(fs.readFileSync(BUNDLE_PATH, "utf-8"));
  const summary = validateStagingBundle(bundle, ROOT);

  console.log("=== FireReach Medan Supabase Staging Validator ===");
  console.log("Mode:", applyMode ? "APPLY (explicit env credentials required)" : "DRY-RUN (no remote writes)");
  console.log("Validated table row counts:", JSON.stringify(summary, null, 2));
  console.log("Schema recommendations (not auto-migrated):", (bundle.schema_recommendations || []).length);
  for (const rec of bundle.schema_recommendations || []) {
    console.log(` - ${rec.table}: ${rec.reason}`);
  }

  if (!applyMode) {
    console.log("DRY-RUN PASSED: Zero remote writes attempted.");
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Refusing --apply: server-side SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required (never use VITE_SUPABASE_PUBLISHABLE_KEY for writes)."
    );
  }
  if (serviceRoleKey === process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Refusing --apply: publishable key cannot perform curated server writes.");
  }

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const tables = bundle.tables;
  const steps = [
    ["data_sources", tables.data_sources, "source_code"],
    ["fire_incident_aggregates", tables.fire_incident_aggregates, "aggregate_key"],
    ["fire_stations", tables.fire_stations, "station_code"],
    ["fire_incidents", tables.fire_incidents, "source_name,source_record_id"]
  ];

  for (const [tableName, rows, onConflict] of steps) {
    const { error } = await client.from(tableName).upsert(rows, { onConflict });
    if (error) {
      throw new Error(`Upsert failed on ${tableName}: ${error.message}`);
    }
    console.log(`Upserted ${rows.length} rows into public.${tableName}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
