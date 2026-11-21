// Service & aturan metodologi SIG untuk modul Fire Hotspot Analyzer (Adeptri)

export const STRICT_KDE_ACCURACIES = Object.freeze([
  "exact_verified",
  "address_geocoded_verified"
]);

const FALLBACK_DEMO_FIXTURE = {
  isDemo: true,
  dataLabel: "DEMO",
  module: "hotspot-analyzer",
  owner: "Adeptri",
  notice:
    "DATA DEMO UNTUK PENGEMBANGAN UI: bukan hasil KDE resmi. Menunggu input titik kebakaran terverifikasi (exact_verified / address_geocoded_verified).",
  analysis: {
    title: "Demo KDE Kebakaran Kota Medan (Fixture Kontrak)",
    period_label: "DEMO 2024-2025",
    kernel_method: "Quartic",
    bandwidth_meters: 1000,
    pixel_size_meters: 100,
    working_crs: "EPSG:32647",
    classification_method: "Quantile (4 kelas)",
    incident_count_used: 0
  },
  zones: {
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "EPSG:4326" } },
    features: [
      {
        type: "Feature",
        properties: {
          isDemo: true,
          dataLabel: "DEMO",
          zone_id: "demo-hotspot-1",
          density_class: "Tinggi (DEMO)",
          density_rank: 3,
          area_km2: 2.4
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [98.665, 3.582],
              [98.685, 3.582],
              [98.685, 3.598],
              [98.665, 3.598],
              [98.665, 3.582]
            ]
          ]
        }
      },
      {
        type: "Feature",
        properties: {
          isDemo: true,
          dataLabel: "DEMO",
          zone_id: "demo-hotspot-2",
          density_class: "Sedang (DEMO)",
          density_rank: 2,
          area_km2: 3.1
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [98.69, 3.555],
              [98.712, 3.555],
              [98.712, 3.573],
              [98.69, 3.573],
              [98.69, 3.555]
            ]
          ]
        }
      }
    ]
  }
};

/**
 * Aturan wajib dari docs/tasks/adeptri.md:
 * Hanya menerima titik individual terverifikasi (exact_verified / address_geocoded_verified).
 * Data agregat kecamatan (district_only) ditolak agar tidak merusak akurasi KDE.
 */
export function filterKdeEligiblePoints(records = []) {
  return (records || []).filter((rec) => {
    if (!rec || typeof rec !== "object") return false;
    if (rec.isDemo || String(rec.dataLabel || "").toUpperCase() === "DEMO") return false;
    if (rec.verification_status !== "verified") return false;
    if (!STRICT_KDE_ACCURACIES.includes(String(rec.location_accuracy || ""))) return false;
    return Boolean(rec.geom || (typeof rec.lat === "number" && typeof rec.lon === "number"));
  });
}

export function getHotspotTierMeta(rank, densityClass = "") {
  const numRank = Number(rank || 0);
  const labelLower = String(densityClass || "").toLowerCase();

  if (numRank >= 3 || labelLower.includes("tinggi")) {
    return {
      tier: "high",
      label: "Tinggi",
      fillColor: "#B84A35",
      strokeColor: "#7F2D1E"
    };
  }
  if (numRank === 2 || labelLower.includes("sedang")) {
    return {
      tier: "medium",
      label: "Sedang",
      fillColor: "#D58A43",
      strokeColor: "#9A5B21"
    };
  }
  return {
    tier: "low",
    label: "Rendah",
    fillColor: "#E9C46A",
    strokeColor: "#9E7E2E"
  };
}

export async function loadHotspotZones(services) {
  let payload = null;
  let districtsGeoJson = null;

  if (services?.dataStatus?.fetchJson) {
    try {
      payload = await services.dataStatus.fetchJson("demo/hotspot-analyzer.demo.json");
    } catch {
      payload = FALLBACK_DEMO_FIXTURE;
    }

    try {
      districtsGeoJson = await services.dataStatus.fetchJson("medan_districts_osm.geojson");
    } catch {
      districtsGeoJson = null;
    }
  } else {
    payload = FALLBACK_DEMO_FIXTURE;
  }

  const zonesGeoJson = payload?.zones || { type: "FeatureCollection", features: [] };
  const zones = (zonesGeoJson.features || []).map((feature, index) => {
    const props = feature.properties || {};
    const tierMeta = getHotspotTierMeta(props.density_rank, props.density_class);
    return {
      zone_id: String(props.zone_id || `zone-${index + 1}`),
      density_class: String(props.density_class || tierMeta.label),
      density_rank: Number(props.density_rank || 1),
      area_km2: Number(props.area_km2 || 0),
      isDemo: Boolean(props.isDemo ?? payload?.isDemo),
      dataLabel: String(props.dataLabel || payload?.dataLabel || "DEMO"),
      tierMeta,
      feature
    };
  });

  return {
    isDemo: Boolean(payload?.isDemo),
    dataLabel: String(payload?.dataLabel || "DEMO"),
    fixturePath: "data/fixtures/demo/hotspot-analyzer.demo.json",
    notice: String(payload?.notice || ""),
    analysis: payload?.analysis || null,
    zones,
    zonesGeoJson,
    districtsGeoJson
  };
}

export function filterHotspotZones(zones = [], { densityTier = "semua", search = "" } = {}) {
  const query = String(search || "").trim().toLowerCase();
  return (zones || []).filter((item) => {
    if (densityTier !== "semua" && item.tierMeta.tier !== densityTier) {
      return false;
    }
    if (query) {
      const hay = `${item.zone_id} ${item.density_class} ${item.dataLabel}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}