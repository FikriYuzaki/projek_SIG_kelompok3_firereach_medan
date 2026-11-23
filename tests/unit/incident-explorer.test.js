import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const ROOT = path.resolve(process.cwd());
const summary = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/data/fire_incidents_summary.json"), "utf-8")
);
const districtsGeo = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/data/medan_districts_osm.geojson"), "utf-8")
);

const mockOverlayClear = vi.fn();
vi.mock("leaflet", () => ({
  default: {
    layerGroup: () => ({ addTo: () => ({ clearLayers: mockOverlayClear }) }),
    geoJSON: () => ({
      addTo: () => ({ setStyle: vi.fn() }),
      setStyle: vi.fn()
    }),
    circleMarker: () => ({
      bindPopup: function () {
        return this;
      },
      on: function () {
        return this;
      },
      addTo: function () {
        return this;
      }
    })
  }
}));

const mockPreviewDestroy = vi.fn();
vi.mock("../../src/components/three-preview.js", () => ({
  mountObjectSchematicPreview: () => ({
    setObjectType: vi.fn(),
    destroy: mockPreviewDestroy
  })
}));

let lastErrorAction = null;
vi.mock("../../src/components/state-panel.js", () => ({
  renderStatePanel: ({ variant, title, onAction }) => {
    if (variant === "error") lastErrorAction = onAction;
    return { variant, title };
  }
}));

import {
  classifyChoroplethTier,
  computeChoroplethBreaks,
  extractValidPointCoordinates,
  fetchSupabaseIncidents,
  filterDemoRecords,
  filterIndependentCandidates,
  filterOfficialRows,
  filterSupabasePoints,
  isRecordKdeEligible,
  matchObjectTypeToCategory,
  normalizeDistrictName,
  normalizeIncidentRecord,
  partitionIncidentRecords,
  shouldResetMapExtent
} from "../../src/features/incident-explorer/service.js";
import { manifest, mount } from "../../src/features/incident-explorer/index.js";

function makeStubElement() {
  const listeners = new Map();
  const el = {
    value: "",
    checked: true,
    textContent: "",
    innerHTML: "",
    disabled: false,
    hidden: false,
    className: "",
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    getAttribute: vi.fn(() => "semua"),
    addEventListener: vi.fn((type, fn, opts) => {
      if (opts?.signal) {
        opts.signal.addEventListener("abort", () => listeners.delete(type));
      }
      listeners.set(type, fn);
    }),
    focus: vi.fn(),
    querySelector: () => makeStubElement(),
    querySelectorAll: () => [],
    replaceChildren: vi.fn()
  };
  return el;
}

function makeStubContainer() {
  const bySelector = new Map();
  const root = {
    innerHTML: "",
    replaceChildren: vi.fn(),
    querySelector(sel) {
      if (!bySelector.has(sel)) {
        const stub = makeStubElement();
        if (sel === "#filter-period") stub.value = "2023-kecamatan";
        if (sel === "#filter-district") stub.value = "semua";
        if (sel === "#filter-category") stub.value = "semua";
        if (sel === "#filter-sort") stub.value = "default";
        bySelector.set(sel, stub);
      }
      return bySelector.get(sel);
    },
    querySelectorAll: () => []
  };
  return root;
}

function makePaginatedSupabaseClient(allRows, { failOnCall = null, rejectOnCall = null } = {}) {
  let callCount = 0;
  return {
    getCalls: () => callCount,
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => ({
            range: async (from, to) => {
              callCount += 1;
              if (rejectOnCall && callCount === rejectOnCall) {
                throw new Error(`Network drop at page ${callCount}`);
              }
              if (failOnCall && callCount === failOnCall) {
                return { data: null, error: { message: `Query failed at page ${callCount}` } };
              }
              return { data: allRows.slice(from, to + 1), error: null };
            }
          })
        })
      })
    })
  };
}

describe("incident-explorer service helpers", () => {
  it("normalizes whitespace and casing in district names", () => {
    expect(normalizeDistrictName("Medan  Kota")).toBe("Medan Kota");
    expect(normalizeDistrictName("  MEDAN\u00a0  DENAI  ")).toBe("Medan Denai");
    expect(normalizeDistrictName("")).toBe("");
    expect(normalizeDistrictName(null)).toBe("");
  });

  it("enforces geom = null for district_only, unknown, or out-of-bounds coordinates", () => {
    expect(
      extractValidPointCoordinates({
        location_accuracy: "district_only",
        lat: 3.5895,
        lon: 98.6714
      })
    ).toBeNull();

    expect(
      extractValidPointCoordinates({
        location_accuracy: "unknown",
        geom: { type: "Point", coordinates: [98.6714, 3.5895] }
      })
    ).toBeNull();

    expect(
      extractValidPointCoordinates({
        location_accuracy: "exact_verified",
        lat: -6.2,
        lon: 106.8
      })
    ).toBeNull();

    const valid = extractValidPointCoordinates({
      location_accuracy: "address_geocoded_verified",
      geom: { type: "Point", coordinates: [98.6714, 3.5895] }
    });
    expect(valid).toEqual({
      lat: 3.5895,
      lon: 98.6714,
      geom: { type: "Point", coordinates: [98.6714, 3.5895] }
    });
  });

  it("excludes approximate points from kde_eligible unless explicitly approved and documented", () => {
    const exactRec = normalizeIncidentRecord({
      source_record_id: "KDE-EXACT",
      location_accuracy: "exact_verified",
      verification_status: "verified",
      lat: 3.5895,
      lon: 98.6714
    });
    const addrRec = normalizeIncidentRecord({
      source_record_id: "KDE-ADDR",
      location_accuracy: "address_geocoded_verified",
      verification_status: "verified",
      lat: 3.591,
      lon: 98.672
    });
    const approxRecDefault = normalizeIncidentRecord({
      source_record_id: "MAP-APPROX",
      location_accuracy: "approximate",
      verification_status: "verified",
      lat: 3.595,
      lon: 98.68
    });

    expect(exactRec.kde_eligible).toBe(true);
    expect(addrRec.kde_eligible).toBe(true);
    expect(approxRecDefault.map_point_eligible).toBe(true);
    expect(approxRecDefault.kde_eligible).toBe(false);

    // Explicitly passing includeApprovedApproximate without documented note stays false
    expect(isRecordKdeEligible(approxRecDefault, { includeApprovedApproximate: true, approximateApprovalNote: "   " })).toBe(false);
    // Documented approval allows approximate
    expect(isRecordKdeEligible(approxRecDefault, { includeApprovedApproximate: true, approximateApprovalNote: "Disetujui Adeptri untuk analisis sensitivitas KDE" })).toBe(true);
    // Never allows district_only, unknown, needs_review, or DEMO even with approval flag
    expect(
      isRecordKdeEligible(
        { location_accuracy: "district_only", verification_status: "verified", geom: { type: "Point", coordinates: [98.67, 3.58] }, isDemo: false },
        { includeApprovedApproximate: true, approximateApprovalNote: "Approved" }
      )
    ).toBe(false);
    expect(
      isRecordKdeEligible(
        { ...exactRec, isDemo: true },
        { includeApprovedApproximate: true, approximateApprovalNote: "Approved" }
      )
    ).toBe(false);

    const partitioned = partitionIncidentRecords([exactRec, addrRec, approxRecDefault]);
    expect(partitioned.verifiedLocated).toHaveLength(3);
    expect(partitioned.kdeEligible.map((r) => r.source_record_id)).toEqual(["KDE-EXACT", "KDE-ADDR"]);
  });

  it("rejects malformed geometries, out-of-Medan coordinates, DEMO/unverified states, and unapproved approximate records in isRecordKdeEligible", () => {
    const validPoint = { type: "Point", coordinates: [98.6714, 3.5895] };
    const baseVerified = {
      location_accuracy: "exact_verified",
      verification_status: "verified",
      isDemo: false
    };

    // Malformed geometries (all must return false even when truthy)
    expect(isRecordKdeEligible({ ...baseVerified, geom: {} })).toBe(false);
    expect(isRecordKdeEligible({ ...baseVerified, geom: true })).toBe(false);
    expect(isRecordKdeEligible({ ...baseVerified, geom: "invalid-wkt" })).toBe(false);
    expect(
      isRecordKdeEligible({
        ...baseVerified,
        geom: { type: "Polygon", coordinates: [[[98.66, 3.58], [98.68, 3.58], [98.68, 3.6], [98.66, 3.58]]] }
      })
    ).toBe(false);
    expect(isRecordKdeEligible({ ...baseVerified, geom: { type: "Point", coordinates: [98.6714] } })).toBe(false);
    expect(
      isRecordKdeEligible({ ...baseVerified, geom: { type: "Point", coordinates: [98.6714, 3.5895, "bad-alt"] } })
    ).toBe(false);
    expect(
      isRecordKdeEligible({ ...baseVerified, geom: { type: "Point", coordinates: [Number.NaN, 3.5895] } })
    ).toBe(false);
    expect(isRecordKdeEligible({ ...baseVerified, geom: { type: "Point", coordinates: [true, 3.5895] } })).toBe(false);
    expect(isRecordKdeEligible({ ...baseVerified, geom: "POINT(98.6714)" })).toBe(false);

    // Out-of-Medan coordinates
    expect(isRecordKdeEligible({ ...baseVerified, geom: { type: "Point", coordinates: [106.8456, -6.2088] } })).toBe(
      false
    );
    expect(isRecordKdeEligible({ ...baseVerified, geom: { type: "Point", coordinates: [3.5895, 98.6714] } })).toBe(
      false
    );
    expect(isRecordKdeEligible({ ...baseVerified, geom: "POINT(106.8456 -6.2088)" })).toBe(false);

    // Valid Point geometries inside MEDAN_BOUNDS
    expect(isRecordKdeEligible({ ...baseVerified, geom: validPoint })).toBe(true);
    expect(isRecordKdeEligible({ ...baseVerified, geom: "POINT(98.6714 3.5895)" })).toBe(true);
    expect(isRecordKdeEligible({ ...baseVerified, geom: { type: "Point", coordinates: [98.6714, 3.5895, 25] } })).toBe(
      true
    );

    // Status & DEMO guards
    expect(isRecordKdeEligible({ ...baseVerified, verification_status: "needs_review", geom: validPoint })).toBe(false);
    expect(isRecordKdeEligible({ ...baseVerified, verification_status: "unlocated", geom: validPoint })).toBe(false);
    expect(isRecordKdeEligible({ ...baseVerified, isDemo: true, geom: validPoint })).toBe(false);
    expect(isRecordKdeEligible({ ...baseVerified, dataLabel: "DEMO", geom: validPoint })).toBe(false);

    // Approximate approval hardening
    const approxValid = { ...baseVerified, location_accuracy: "approximate", geom: validPoint };
    expect(isRecordKdeEligible(approxValid)).toBe(false);
    expect(
      isRecordKdeEligible(approxValid, { includeApprovedApproximate: "yes", approximateApprovalNote: "Approved" })
    ).toBe(false);
    expect(isRecordKdeEligible(approxValid, { includeApprovedApproximate: true, approximateApprovalNote: {} })).toBe(
      false
    );
    expect(isRecordKdeEligible(approxValid, { includeApprovedApproximate: true, approximateApprovalNote: "   " })).toBe(
      false
    );
    expect(
      isRecordKdeEligible(approxValid, {
        includeApprovedApproximate: true,
        approximateApprovalNote: "Disetujui untuk uji sensitivitas KDE"
      })
    ).toBe(true);
    expect(
      isRecordKdeEligible(
        { ...baseVerified, location_accuracy: "approximate", geom: {} },
        { includeApprovedApproximate: true, approximateApprovalNote: "Approved" }
      )
    ).toBe(false);
    expect(
      isRecordKdeEligible(
        { ...baseVerified, location_accuracy: "approximate", geom: { type: "Point", coordinates: [106.8456, -6.2088] } },
        { includeApprovedApproximate: true, approximateApprovalNote: "Approved" }
      )
    ).toBe(false);
    expect(
      isRecordKdeEligible(
        { ...approxValid, isDemo: true },
        { includeApprovedApproximate: true, approximateApprovalNote: "Approved" }
      )
    ).toBe(false);
    expect(isRecordKdeEligible(null, null)).toBe(false);
  });

  it("downgrades invalid verified rows when geom is null and partitions DEMO strictly", () => {
    const aggRec = normalizeIncidentRecord({
      source_record_id: "ROW-AGG-1",
      period_year: 2023,
      district_name: "Medan  Kota",
      location_accuracy: "district_only",
      verification_status: "verified",
      lat: 3.58,
      lon: 98.67
    });
    expect(aggRec.district_name).toBe("Medan Kota");
    expect(aggRec.geom).toBeNull();
    expect(aggRec.verification_status).toBe("needs_review");
    expect(aggRec.kde_eligible).toBe(false);

    const partitioned = partitionIncidentRecords([
      {
        source_record_id: "OFF-POINT-1",
        period_year: 2024,
        district_name: "Medan Petisah",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        lat: 3.5895,
        lon: 98.6714
      },
      aggRec,
      {
        source_record_id: "OFF-UNLOC-1",
        period_year: 2025,
        location_accuracy: "unknown",
        verification_status: "unlocated"
      },
      {
        source_record_id: "DEMO-POINT-1",
        period_year: 2024,
        location_accuracy: "exact_verified",
        verification_status: "verified",
        lat: 3.55,
        lon: 98.68,
        isDemo: true
      }
    ]);

    expect(partitioned.verifiedLocated).toHaveLength(1);
    expect(partitioned.kdeEligible).toHaveLength(1);
    expect(partitioned.needsReview).toHaveLength(1);
    expect(partitioned.unlocated).toHaveLength(1);
    expect(partitioned.demoRecords).toHaveLength(1);
    expect(partitioned.kdeEligible.every((r) => !r.isDemo)).toBe(true);
  });

  it("classifies dataLabel DEMO variants consistently through normalizeIncidentRecord and partitionIncidentRecords", () => {
    const rawLabelOnly = {
      source_record_id: "DEMO-LABEL-UPPER",
      period_year: 2024,
      district_name: "Medan Petisah",
      location_accuracy: "exact_verified",
      verification_status: "verified",
      dataLabel: "DEMO",
      lat: 3.5895,
      lon: 98.6714
    };
    const rawLabelWhitespace = {
      source_record_id: "DEMO-LABEL-SPACE",
      period_year: 2024,
      district_name: "Medan Barat",
      location_accuracy: "address_geocoded_verified",
      verification_status: "verified",
      isDemo: false,
      dataLabel: " demo ",
      geom: { type: "Point", coordinates: [98.6714, 3.5895] }
    };
    const rawFlaggedDemo = {
      source_record_id: "DEMO-FLAG-TRUE",
      period_year: 2024,
      district_name: "Medan Kota",
      location_accuracy: "exact_verified",
      verification_status: "verified",
      isDemo: true,
      lat: 3.5895,
      lon: 98.6714
    };
    const rawOfficial = {
      source_record_id: "OFFICIAL-VALID-1",
      period_year: 2024,
      district_name: "Medan Baru",
      location_accuracy: "exact_verified",
      verification_status: "verified",
      lat: 3.5895,
      lon: 98.6714
    };
    const rawOfficialLabeled = {
      source_record_id: "OFFICIAL-VALID-2",
      period_year: 2024,
      district_name: "Medan Polonia",
      location_accuracy: "address_geocoded_verified",
      verification_status: "verified",
      dataLabel: "OFFICIAL",
      geom: { type: "Point", coordinates: [98.6714, 3.5895] }
    };

    const normLabelOnly = normalizeIncidentRecord(rawLabelOnly);
    const normLabelWhitespace = normalizeIncidentRecord(rawLabelWhitespace);
    const normLabelWithApproxOpt = normalizeIncidentRecord(rawLabelOnly, {
      includeApprovedApproximate: true,
      approximateApprovalNote: "Approved"
    });
    const normFlaggedDemo = normalizeIncidentRecord(rawFlaggedDemo);
    const normOfficial = normalizeIncidentRecord(rawOfficial);
    const normOfficialLabeled = normalizeIncidentRecord(rawOfficialLabeled);

    expect(normLabelOnly.isDemo).toBe(true);
    expect(normLabelOnly.map_point_eligible).toBe(true);
    expect(normLabelOnly.kde_eligible).toBe(false);

    expect(normLabelWhitespace.isDemo).toBe(true);
    expect(normLabelWhitespace.map_point_eligible).toBe(true);
    expect(normLabelWhitespace.kde_eligible).toBe(false);

    expect(normLabelWithApproxOpt.isDemo).toBe(true);
    expect(normLabelWithApproxOpt.kde_eligible).toBe(false);

    expect(normFlaggedDemo.isDemo).toBe(true);
    expect(normFlaggedDemo.kde_eligible).toBe(false);

    expect(normOfficial.isDemo).toBe(false);
    expect(normOfficial.kde_eligible).toBe(true);
    expect(normOfficialLabeled.isDemo).toBe(false);
    expect(normOfficialLabeled.kde_eligible).toBe(true);

    const partitioned = partitionIncidentRecords([
      rawLabelOnly,
      rawLabelWhitespace,
      rawFlaggedDemo,
      rawOfficial,
      rawOfficialLabeled
    ]);

    expect(partitioned.demoRecords.map((r) => r.source_record_id)).toEqual([
      "DEMO-LABEL-UPPER",
      "DEMO-LABEL-SPACE",
      "DEMO-FLAG-TRUE"
    ]);
    expect(partitioned.verifiedLocated.map((r) => r.source_record_id)).toEqual([
      "OFFICIAL-VALID-1",
      "OFFICIAL-VALID-2"
    ]);
    expect(partitioned.kdeEligible.map((r) => r.source_record_id)).toEqual([
      "OFFICIAL-VALID-1",
      "OFFICIAL-VALID-2"
    ]);
    expect(partitioned.demoRecords.every((r) => r.isDemo && !r.kde_eligible)).toBe(true);
    expect(
      filterSupabasePoints([normLabelOnly, normOfficial], { period: "2024-bulanan" }).map((r) => r.source_record_id)
    ).toEqual(["OFFICIAL-VALID-1"]);
  });

  it("filters Supabase points strictly by period, district, category, and search", () => {
    expect(matchObjectTypeToCategory("Rumah Tinggal")).toBe("rumah");
    expect(matchObjectTypeToCategory("Travo Listrik")).toBe("travo_kabel");
    expect(matchObjectTypeToCategory("Ruko 2 lantai")).toBe("ruko");

    const pts = [
      normalizeIncidentRecord({
        source_record_id: "PT-2023-KOTA",
        period_year: 2023,
        district_name: "Medan  Kota",
        address_text: "Jl. Sisingamangaraja",
        object_type: "Rumah",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        lat: 3.58,
        lon: 98.68
      }),
      normalizeIncidentRecord({
        source_record_id: "PT-2024-BELAWAN",
        occurred_at: "2024-08-12T10:00:00+07:00",
        district_name: "Medan Belawan",
        address_text: "Pelabuhan Belawan",
        object_type: "Gudang / Pabrik",
        location_accuracy: "address_geocoded_verified",
        verification_status: "verified",
        lat: 3.77,
        lon: 98.68
      }),
      normalizeIncidentRecord({
        source_record_id: "PT-2025-JOHOR",
        period_year: 2025,
        district_name: "Medan Johor",
        address_text: "Jl. Karya Wisata",
        object_type: "Ruko",
        location_accuracy: "approximate",
        verification_status: "verified",
        lat: 3.53,
        lon: 98.67
      })
    ];

    expect(filterSupabasePoints(pts, { period: "2023-kecamatan" }).map((p) => p.source_record_id)).toEqual([
      "PT-2023-KOTA"
    ]);
    expect(filterSupabasePoints(pts, { period: "2024-bulanan" }).map((p) => p.source_record_id)).toEqual([
      "PT-2024-BELAWAN"
    ]);
    expect(filterSupabasePoints(pts, { period: "2025-bulanan" }).map((p) => p.source_record_id)).toEqual([
      "PT-2025-JOHOR"
    ]);
    expect(filterSupabasePoints(pts, { period: "2016-2025-tahunan" })).toHaveLength(3);
    expect(
      filterSupabasePoints(pts, { period: "2016-2025-tahunan", district: "Medan Belawan", category: "gudang_pabrik" }).map((p) => p.source_record_id)
    ).toEqual(["PT-2024-BELAWAN"]);
    expect(
      filterSupabasePoints(pts, { period: "2016-2025-tahunan", search: "Karya Wisata" }).map((p) => p.source_record_id)
    ).toEqual(["PT-2025-JOHOR"]);
  });

  it("paginates all available Supabase records cleanly and handles empty/cap/error pages without infinite loops", async () => {
    const localRes = await fetchSupabaseIncidents({ isConfigured: false, client: null, note: "Mode Lokal" });
    expect(localRes.active).toBe(false);
    expect(localRes.source).toBe("local");

    const sampleRows = [1, 2, 3, 4, 5].map((i) => ({
      id: `uuid-${i}`,
      source_record_id: `SUPA-${i}`,
      period_year: 2024,
      district_name: "Medan Kota",
      location_accuracy: i === 5 ? "approximate" : "exact_verified",
      verification_status: "verified",
      lat: 3.589 + i * 0.001,
      lon: 98.671,
      source_name: "Damkarmat"
    }));

    // Multi-page load (> 1 page: 5 records across pageSize=2 -> 3 pages)
    const multiClient = makePaginatedSupabaseClient(sampleRows);
    const multiRes = await fetchSupabaseIncidents(
      { isConfigured: true, client: multiClient },
      { pageSize: 2, maxRecords: 100, maxPages: 10 }
    );
    expect(multiRes.active).toBe(true);
    expect(multiRes.source).toBe("supabase");
    expect(multiRes.records).toHaveLength(5);
    expect(multiRes.pagesLoaded).toBe(3);
    expect(multiRes.truncated).toBe(false);
    expect(multiRes.partitioned.verifiedLocated).toHaveLength(5);
    expect(multiRes.partitioned.kdeEligible).toHaveLength(4); // PT-5 is approximate

    // Exact multiple maxRecords cap (4 of 5 rows with pageSize=2) probes & marks truncated
    const cappedClient = makePaginatedSupabaseClient(sampleRows);
    const cappedRes = await fetchSupabaseIncidents(
      { isConfigured: true, client: cappedClient },
      { pageSize: 2, maxRecords: 4, maxPages: 10 }
    );
    expect(cappedRes.records).toHaveLength(4);
    expect(cappedRes.truncated).toBe(true);
    expect(cappedRes.note).toContain("batas maksimum");

    // Empty dataset terminates in 1 call cleanly
    const emptyClient = makePaginatedSupabaseClient([]);
    const emptyRes = await fetchSupabaseIncidents({ isConfigured: true, client: emptyClient }, { pageSize: 2 });
    expect(emptyRes.active).toBe(true);
    expect(emptyRes.records).toHaveLength(0);
    expect(emptyClient.getCalls()).toBe(1);

    // Page-1 error falls back to local cleanly
    const page1ErrClient = makePaginatedSupabaseClient(sampleRows, { failOnCall: 1 });
    const page1ErrRes = await fetchSupabaseIncidents(
      { isConfigured: true, client: page1ErrClient },
      { pageSize: 2 }
    );
    expect(page1ErrRes.active).toBe(false);
    expect(page1ErrRes.source).toBe("local_fallback");
    expect(page1ErrRes.error).toContain("page 1");

    // Page-2 error preserves page 1 safely without infinite loop
    const page2ErrClient = makePaginatedSupabaseClient(sampleRows, { rejectOnCall: 2 });
    const page2ErrRes = await fetchSupabaseIncidents(
      { isConfigured: true, client: page2ErrClient },
      { pageSize: 2 }
    );
    expect(page2ErrRes.active).toBe(true);
    expect(page2ErrRes.source).toBe("supabase_partial");
    expect(page2ErrRes.partialLoad).toBe(true);
    expect(page2ErrRes.records).toHaveLength(2);
    expect(page2ErrClient.getCalls()).toBe(2);
  });

  it("keeps map zoom/extent stable during sort, search, or category changes", () => {
    const base = { demoMode: false, period: "2023-kecamatan", district: "semua" };
    expect(shouldResetMapExtent(null, base)).toBe(true);
    expect(shouldResetMapExtent(base, { ...base })).toBe(false);
    expect(shouldResetMapExtent(base, { demoMode: true, period: "2023-kecamatan", district: "semua" })).toBe(true);
    expect(shouldResetMapExtent(base, { demoMode: false, period: "2024-bulanan", district: "semua" })).toBe(true);
    expect(shouldResetMapExtent(base, { demoMode: false, period: "2023-kecamatan", district: "Medan Kota" })).toBe(true);
  });

  it("filters and sorts official rows across all 5 periods accurately", () => {
    const distDesc = filterOfficialRows({
      summary,
      period: "2023-kecamatan",
      sortBy: "desc"
    });
    expect(distDesc).toHaveLength(21);
    expect(distDesc[0].district_name).toBe("Medan Belawan");
    expect(distDesc[0].filteredCount).toBe(21);

    const lahanNonZero = filterOfficialRows({
      summary,
      period: "2023-kecamatan",
      category: "lahan",
      excludeZero: true
    });
    expect(lahanNonZero.length).toBeLessThan(21);
    expect(lahanNonZero.every((r) => r.filteredCount > 0)).toBe(true);

    const impact2023 = filterOfficialRows({ summary, period: "2023-dampak" });
    expect(impact2023).toHaveLength(12);
    expect(impact2023.find((r) => r.month_name === "Maret")?.loss_anomaly_flag).toBe(true);

    const rows2024 = filterOfficialRows({ summary, period: "2024-bulanan", category: "rumah" });
    expect(rows2024).toHaveLength(12);
    expect(rows2024.reduce((s, r) => s + r.filteredCount, 0)).toBe(119);

    const rows2025 = filterOfficialRows({ summary, period: "2025-bulanan", search: "juli" });
    expect(rows2025).toHaveLength(1);
    expect(rows2025[0].total_incidents).toBe(40);

    const annual = filterOfficialRows({ summary, period: "2016-2025-tahunan" });
    expect(annual).toHaveLength(10);
    expect(annual.find((r) => r.year === 2019)?.consistency_flag).toBe(true);

    const monthlyHist = filterOfficialRows({ summary, period: "2016-2021-bulanan" });
    expect(monthlyHist).toHaveLength(72);
    expect(monthlyHist.reduce((s, r) => s + r.filteredCount, 0)).toBe(1372);

    const bpbd = filterOfficialRows({ summary, period: "bpbd-2021-2023", district: "Medan Belawan" });
    expect(bpbd).toHaveLength(1);
    expect(bpbd[0].fire_incidents).toBe(11);

    const bpbdMonthly = filterOfficialRows({ summary, period: "bpbd-2022-2023-bulanan" });
    expect(bpbdMonthly).toHaveLength(24);
    expect(bpbdMonthly.reduce((s, r) => s + r.filteredCount, 0)).toBe(225);
    expect(
      filterSupabasePoints(
        [{ isDemo: false, verification_status: "verified", geom: { coordinates: [98.67, 3.59] }, lat: 3.59, lon: 98.67 }],
        { period: "bpbd-2022-2023-bulanan" }
      )
    ).toEqual([]);

    const nonFire = filterOfficialRows({ summary, period: "non-kebakaran-2023-2025" });
    expect(nonFire).toHaveLength(36);
    expect(nonFire.reduce((s, r) => s + r.filteredCount, 0)).toBe(2218);

    const indFiltered = filterIndependentCandidates(summary.independent_incident_candidates?.records || [], {
      district: "Medan Deli"
    });
    expect(indFiltered).toHaveLength(2);
    expect(indFiltered.every((r) => r.verification_status === "needs_review" && r.kde_eligible === false)).toBe(true);
    expect(filterSupabasePoints(indFiltered, { period: "kandidat-independen" })).toEqual([]);
  });

  it("computes adaptive choropleth breaks even for sparse or zero categories", () => {
    const zeroBreaks = computeChoroplethBreaks([0, 0, 0]);
    expect(zeroBreaks.hasNonZero).toBe(false);
    expect(classifyChoroplethTier(0, zeroBreaks)).toBe("zero");

    const sparseBreaks = computeChoroplethBreaks([0, 1, 2, 3, 0]);
    expect(sparseBreaks.hasNonZero).toBe(true);
    expect(classifyChoroplethTier(0, sparseBreaks)).toBe("zero");
    expect(classifyChoroplethTier(1, sparseBreaks)).toBe("low");
    expect(classifyChoroplethTier(2, sparseBreaks)).toBe("mid");
    expect(classifyChoroplethTier(3, sparseBreaks)).toBe("high");
  });

  it("filters DEMO contract records safely without polluting official lists", () => {
    const demo = JSON.parse(
      fs.readFileSync(path.join(ROOT, "public/data/demo/incident-explorer-sample.demo.json"), "utf-8")
    );
    const filtered = filterDemoRecords(demo.records, { statusFilter: "unlocated" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].source_record_id).toBe("DEMO-INC-003");
    expect(filtered[0].geom).toBeNull();
  });
});

describe("incident-explorer mount & unmount lifecycle", () => {
  it("destroys map, chart, overlays, and preview cleanly including after error retry", async () => {
    expect(manifest.id).toBe("incident-explorer");

    const mapDestroy = vi.fn();
    const chartDestroy = vi.fn();
    let failFirst = true;

    const services = {
      supabase: { isConfigured: false, client: null, note: "Mode Lokal" },
      maps: {
        createMap: () => ({ map: { _mapPane: true, invalidateSize: vi.fn() }, destroy: mapDestroy }),
        fitBounds: vi.fn()
      },
      charts: {
        createChart: () => ({ chart: {}, destroy: chartDestroy })
      },
      notify: { show: vi.fn(), clear: vi.fn() },
      format: {
        number: (v) => String(v),
        date: (v) => String(v || "-")
      },
      dataStatus: {
        fetchJson: async (relPath) => {
          if (failFirst) {
            throw new Error("Simulated offline");
          }
          if (relPath === "fire_incidents_summary.json") return summary;
          if (relPath === "medan_districts_osm.geojson") return districtsGeo;
          throw new Error(`Unexpected path: ${relPath}`);
        }
      }
    };

    const container = makeStubContainer();
    const unmount = await mount({ container, services, params: {} });
    expect(typeof lastErrorAction).toBe("function");

    failFirst = false;
    await lastErrorAction();
    expect(chartDestroy).toHaveBeenCalledTimes(0);

    mockOverlayClear.mockClear();
    await unmount();
    expect(mockOverlayClear).toHaveBeenCalledTimes(2);
    expect(chartDestroy).toHaveBeenCalledTimes(1);
    expect(mockPreviewDestroy).toHaveBeenCalledTimes(1);
    expect(mapDestroy).toHaveBeenCalledTimes(1);
  });
});
