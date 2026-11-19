export const FEATURE_STATUSES = Object.freeze({
  COMING_SOON: "coming-soon",
  IN_DEVELOPMENT: "in-development",
  READY_FOR_REVIEW: "ready-for-review",
  ACTIVE: "active",
  BLOCKED: "blocked"
});

export const FEATURE_STATUS_META = Object.freeze({
  "coming-soon": { label: "Coming Soon", badgeClass: "status-badge--soon", marker: "[ ]" },
  "in-development": { label: "Dalam Pengembangan", badgeClass: "status-badge--dev", marker: "[~]" },
  "ready-for-review": { label: "Siap Tinjauan", badgeClass: "status-badge--dev", marker: "[?]" },
  active: { label: "Aktif", badgeClass: "status-badge--active", marker: "[+]" },
  blocked: { label: "Terhambat", badgeClass: "status-badge--demo", marker: "[!]" }
});

export const FEATURE_REGISTRY = Object.freeze([
  {
    id: "incident-explorer",
    title: "Fire Incident Explorer",
    shortTitle: "Incident Explorer",
    owner: "Fikri",
    route: "/incident-explorer",
    status: FEATURE_STATUSES.IN_DEVELOPMENT,
    description:
      "Menjelajahi catatan kejadian kebakaran Kota Medan, sumber data, tingkat ketelitian lokasi, dan daftar data yang belum terpetakan.",
    plannedInputs: [
      "Rekapitulasi Kejadian Kebakaran 2023 (Kecamatan), 2024, dan 2025 (Bulanan)",
      "Koordinat Mako 0.0 dan batas 21 Kecamatan Kota Medan"
    ],
    plannedOutputs: [
      "Katalog kejadian terstandardisasi, peta sebaran/agregat jujur, dan daftar unlocated"
    ],
    loader: () => import("../features/incident-explorer/index.js")
  },
  {
    id: "hotspot-analyzer",
    title: "Fire Hotspot Analyzer",
    shortTitle: "Hotspot Analyzer",
    owner: "Adeptri",
    route: "/hotspot-analyzer",
    status: FEATURE_STATUSES.COMING_SOON,
    description:
      "Analisis konsentrasi spasial kejadian kebakaran historis berbasis Kernel Density Estimation (KDE) pada CRS EPSG:32647.",
    plannedInputs: [
      "Titik kejadian kebakaran dengan ketelitian exact_verified atau address_geocoded_verified"
    ],
    plannedOutputs: [
      "Zona kelas kepadatan historis (EPSG:4326) beserta parameter kernel, radius, dan pixel size"
    ],
    loader: () => import("../features/hotspot-analyzer/index.js")
  },
  {
    id: "station-coverage",
    title: "Fire Station Coverage",
    shortTitle: "Station Coverage",
    owner: "Adriel",
    route: "/station-coverage",
    status: FEATURE_STATUSES.COMING_SOON,
    description:
      "Evaluasi jangkauan layanan pos Damkarmat berbasis jaringan jalan Kota Medan dan perbandingannya dengan buffer jarak lurus.",
    plannedInputs: [
      "Koordinat terverifikasi Mako dan UPT pos Damkarmat serta jaringan jalan OSM Kota Medan"
    ],
    plannedOutputs: [
      "Poligon service area jaringan jalan dan catatan asumsi kecepatan skenario"
    ],
    loader: () => import("../features/station-coverage/index.js")
  },
  {
    id: "priority-planner",
    title: "Fire Service Priority Planner",
    shortTitle: "Priority Planner",
    owner: "Olo",
    route: "/priority-planner",
    status: FEATURE_STATUSES.COMING_SOON,
    description:
      "Penyusunan skor dan peringkat kecamatan prioritas peningkatan layanan berdasarkan hotspot historis, gap jangkauan, dan paparan penduduk.",
    plannedInputs: [
      "Skor kepadatan kebakaran, rasio wilayah belum terjangkau, dan data penduduk BPS 2025"
    ],
    plannedOutputs: [
      "Indeks komposit per kecamatan beserta bobot, metode normalisasi, dan alasan prioritas"
    ],
    loader: () => import("../features/priority-planner/index.js")
  }
]);

export function isModuleMountable(status) {
  return (
    status === FEATURE_STATUSES.IN_DEVELOPMENT ||
    status === FEATURE_STATUSES.READY_FOR_REVIEW ||
    status === FEATURE_STATUSES.ACTIVE
  );
}

export function getFeatureById(id) {
  return FEATURE_REGISTRY.find((item) => item.id === id) || null;
}

export function getFeatureByRoute(path) {
  return FEATURE_REGISTRY.find((item) => item.route === path) || null;
}
