export const CATEGORY_LABELS = Object.freeze({
  semua: "Semua Kategori Objek",
  rumah: "Rumah Tinggal",
  ruko: "Ruko / Komersial",
  travo_kabel: "Travo / Kabel Listrik",
  gudang_pabrik: "Gudang / Pabrik",
  kendaraan: "Kendaraan / Transportasi",
  lahan: "Lahan / Vegetasi",
  fasilitas_umum: "Fasilitas Umum",
  lain_lain: "Lain-Lain (Gas, Sampah, Pohon)"
});

export function getDominantCategory(categoriesObj = {}) {
  let topKey = "umum";
  let topVal = -1;
  for (const [key, val] of Object.entries(categoriesObj)) {
    if (Number(val) > topVal) {
      topVal = Number(val);
      topKey = key;
    }
  }
  return { key: topKey, count: Math.max(0, topVal) };
}

export async function loadExplorerDatasets(services) {
  const [summary, districtsGeoJson] = await Promise.all([
    services.dataStatus.fetchJson("fire_incidents_summary.json"),
    services.dataStatus.fetchJson("medan_districts_osm.geojson")
  ]);

  return {
    summary,
    districtsGeoJson
  };
}

export async function loadDemoContractFixture(services) {
  return services.dataStatus.fetchJson("demo/incident-explorer-sample.demo.json");
}

export function filterOfficialRows({ summary, period, district, category, search }) {
  const query = String(search || "").trim().toLowerCase();
  const isDistrictPeriod = period === "2023-kecamatan";
  const sourceRows = isDistrictPeriod
    ? summary.district_2023 || []
    : period === "2024-bulanan"
      ? summary.monthly_2024 || []
      : summary.monthly_2025 || [];

  const filtered = [];
  for (const row of sourceRows) {
    if (isDistrictPeriod && district !== "semua" && row.district_name !== district) {
      continue;
    }
    const labelText = isDistrictPeriod ? row.district_name : row.month_name;
    if (query && !labelText.toLowerCase().includes(query)) {
      continue;
    }
    const activeCount =
      category === "semua" ? row.total_incidents : Number(row.categories?.[category] || 0);
    if (category !== "semua" && activeCount === 0 && query) {
      continue;
    }
    filtered.push({
      ...row,
      displayLabel: labelText,
      filteredCount: activeCount
    });
  }

  return filtered;
}
