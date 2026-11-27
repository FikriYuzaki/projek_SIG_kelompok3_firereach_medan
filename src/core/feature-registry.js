export const FEATURE_STATUSES = Object.freeze({
  COMING_SOON: "coming-soon",
  IN_DEVELOPMENT: "in-development",
  READY_FOR_REVIEW: "ready-for-review",
  ACTIVE: "active",
  BLOCKED: "blocked"
});

export const FEATURE_STATUS_META = Object.freeze({
  "coming-soon": { label: "Arsip Terkunci", badgeClass: "status-badge--soon", marker: "active" },
  "in-development": { label: "Uji Integrasi", badgeClass: "status-badge--dev", marker: "dev" },
  "ready-for-review": { label: "Siap Tinjauan", badgeClass: "status-badge--dev", marker: "review" },
  active: { label: "Aktif", badgeClass: "status-badge--active", marker: "active" },
  blocked: { label: "Terhambat", badgeClass: "status-badge--warn", marker: "warn" }
});

export const FEATURE_REGISTRY = Object.freeze([
  {
    id: "incident-explorer",
    title: "Fire Incident Explorer",
    shortTitle: "Incident Explorer",
    owner: "Fikri",
    route: "/incident-explorer",
    status: FEATURE_STATUSES.ACTIVE,
    description:
      "Menjelajahi catatan kejadian kebakaran resmi 21 kecamatan, katalog 34 insiden terdokumentasi publik, tingkat ketelitian lokasi, dan daftar data unlocated.",
    plannedInputs: [
      "Rekapitulasi Kebakaran 2016-2025, 34 Insiden Publik (p2k.medan.go.id & media), serta 7 pos Damkarmat"
    ],
    plannedOutputs: [
      "Katalog terstandardisasi dengan filter multidimensi, peta sebaran jujur, simulasi rute, dan daftar unlocated"
    ],
    loader: () => import("../features/incident-explorer/index.js")
  },
  {
    id: "hotspot-analyzer",
    title: "Fire Hotspot Analyzer",
    shortTitle: "Hotspot Analyzer",
    owner: "Adeptri",
    route: "/hotspot-analyzer",
    status: FEATURE_STATUSES.ACTIVE,
    description:
      "Analisis konsentrasi spasial kejadian kebakaran berbasis Kernel Density Estimation (KDE EPSG:32647) yang memisahkan mode terverifikasi dan eksploratif publik.",
    plannedInputs: [
      "22 titik insiden publik berkoordinat OSM (eksploratif) & jalur kesiapan titik resmi Damkarmat"
    ],
    plannedOutputs: [
      "Zona KDE Quantile 4 kelas (EPSG:4326) beserta parameter kernel Quartic, bandwidth, dan transparansi data terkurasi"
    ],
    loader: () => import("../features/hotspot-analyzer/index.js")
  },
  {
    id: "station-coverage",
    title: "Fire Station Coverage",
    shortTitle: "Station Coverage",
    owner: "Adriel",
    route: "/station-coverage",
    status: FEATURE_STATUSES.ACTIVE,
    description:
      "Evaluasi jangkauan layanan pos Damkarmat per pos individual (MAKO-00 & UPT-01..06), partisi overlap 5 km jaringan jalan OSM, serta perbandingan buffer Euclidean.",
    plannedInputs: [
      "Koordinat Mako 0.0 (terverifikasi), 6 pos UPT (4 routable + 2 district_only), dan jaringan jalan OSM Medan"
    ],
    plannedOutputs: [
      "Poligon service area per pos, analisis overlap >=2 pos vs single-station vs uncovered, dan tabel komparasi"
    ],
    loader: () => import("../features/station-coverage/index.js")
  },
  {
    id: "priority-planner",
    title: "Fire Service Priority Planner",
    shortTitle: "Priority Planner",
    owner: "Olo",
    route: "/priority-planner",
    status: FEATURE_STATUSES.ACTIVE,
    description:
      "Indeks komposit 21 kecamatan (priority-v2.0-integrated) yang memadukan laju kebakaran 2023, eksposur zona KDE eksploratif, gap jangkauan 5 km, dan penduduk BPS 2025.",
    plannedInputs: [
      "Agregat kejadian 2023, overlap zona KDE eksploratif, rasio gap jaringan 5 km (baseline & 5 pos), dan BPS 2025"
    ],
    plannedOutputs: [
      "Peringkat prioritas kecamatan dengan simulasi bobot What-If, toggle baseline vs 5 pos, dan transparansi indikator"
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
