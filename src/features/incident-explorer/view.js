import L from "leaflet";
import { mountObjectSchematicPreview } from "../../components/three-preview.js";
import { renderStatePanel } from "../../components/state-panel.js";
import {
  CATEGORY_LABELS,
  classifyChoroplethTier,
  computeChoroplethBreaks,
  filterDemoRecords,
  filterOfficialRows,
  getDominantCategory,
  loadDemoContractFixture,
  loadExplorerDatasets
} from "./service.js";

const TIER_COLORS = Object.freeze({
  zero: "#F2F0EA",
  low: "#F9ECE8",
  mid: "#D58A43",
  high: "#B84A35"
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderBadge(status) {
  if (status === "verified") {
    return `<span class="status-badge status-badge--active">[+] verified</span>`;
  }
  if (status === "needs_review") {
    return `<span class="status-badge status-badge--dev">[~] needs_review</span>`;
  }
  return `<span class="status-badge status-badge--demo">[!] ${escapeHtml(status || "unlocated")}</span>`;
}

function getRowKey(row, isDemoMode) {
  if (!row) return null;
  return isDemoMode ? row.source_record_id : row.displayLabel;
}

function buildDetailHtml({ row, state, format, categoryLabels }) {
  if (!row) {
    return { html: `<dt>Status</dt><dd>Belum ada baris terpilih</dd>`, qaNote: "", previewType: "umum" };
  }

  if (state.demoMode) {
    const hasCoords = typeof row.lat === "number" && typeof row.lon === "number";
    return {
      html: `
        <dt>ID Record (DEMO)</dt><dd class="mono">${escapeHtml(row.source_record_id)}</dd>
        <dt>Kecamatan</dt><dd>${escapeHtml(row.district_name || "-")}</dd>
        <dt>Alamat Perkiraan</dt><dd>${escapeHtml(row.address_text || "-")}</dd>
        <dt>Objek</dt><dd>${escapeHtml(row.object_type || "-")}</dd>
        <dt>Penyebab</dt><dd>${escapeHtml(row.cause_category || "Belum terverifikasi")}</dd>
        <dt>Akurasi Lokasi</dt><dd class="mono">${escapeHtml(row.location_accuracy)}</dd>
        <dt>Status</dt><dd>${renderBadge(`DEMO: ${row.verification_status}`)}</dd>
        <dt>Geometri</dt><dd class="mono">${hasCoords ? `${row.lat}, ${row.lon}` : "geom = null (unlocated)"}</dd>
        <dt>Sumber Data</dt><dd>${escapeHtml(row.source_name)}</dd>
      `,
      qaNote: "Fixture DEMO ini hanya menguji skema record individual; tidak termasuk statistik resmi Kota Medan.",
      previewType: row.object_type || "umum"
    };
  }

  if (state.period === "2023-dampak") {
    return {
      html: `
        <dt>Periode</dt><dd>${escapeHtml(row.month_name)} 2023</dd>
        <dt>Jumlah Kejadian</dt><dd class="mono tabular">${format.number(row.total_incidents)}</dd>
        <dt>Skala Bulanan (Besar / Kecil)</dt><dd class="mono tabular">${row.scale_besar_monthly} / ${row.scale_kecil_monthly}</dd>
        <dt>Korban Luka / Meninggal</dt><dd class="mono tabular">${row.injured} / ${row.fatalities}</dd>
        <dt>Kerugian (Mentah)</dt><dd class="mono tabular">${escapeHtml(row.raw_material_loss || "-")}</dd>
        <dt>Luas Bulanan (Mentah)</dt><dd class="mono tabular">${escapeHtml(row.raw_area_reported_monthly || "-")}</dd>
        <dt>Granularitas</dt><dd class="mono">${escapeHtml(row.granularity)}</dd>
        <dt>Geometri</dt><dd class="mono">geom = null (unknown)</dd>
        <dt>Sumber Data</dt><dd>${escapeHtml(row.source_name || "Satu Data Medan")}</dd>
      `,
      qaNote: row.loss_anomaly_flag ? row.loss_anomaly_note : row.loss_anomaly_note || "",
      previewType: "umum"
    };
  }

  if (state.period === "2016-2025-tahunan") {
    const outsideText =
      row.comparison_total_with_outside_medan !== null && row.comparison_total_with_outside_medan !== undefined
        ? format.number(row.comparison_total_with_outside_medan)
        : "Tidak ada arsip pembanding";
    const rekapText =
      row.comparison_rekap_total !== null && row.comparison_rekap_total !== undefined
        ? format.number(row.comparison_rekap_total)
        : "-";
    return {
      html: `
        <dt>Tahun</dt><dd class="mono">${escapeHtml(row.year)}</dd>
        <dt>Kejadian Kota Medan</dt><dd class="mono tabular">${format.number(row.total_incidents)}</dd>
        <dt>Medan + Luar Kota</dt><dd class="mono tabular">${outsideText}</dd>
        <dt>Pembanding Rekap Bulanan</dt><dd class="mono tabular">${rekapText}</dd>
        <dt>Granularitas</dt><dd class="mono">${escapeHtml(row.granularity)}</dd>
        <dt>Akurasi &amp; Status</dt><dd class="mono">${escapeHtml(row.location_accuracy)} / ${escapeHtml(row.verification_status)}</dd>
        <dt>Geometri</dt><dd class="mono">${row.year === 2023 ? "Poligon kecamatan (titik = null)" : "geom = null"}</dd>
        <dt>Arsip Sumber</dt><dd>${escapeHtml(row.source_file)}</dd>
      `,
      qaNote: row.consistency_flag ? row.consistency_note : "",
      previewType: "umum"
    };
  }

  const cats = row.categories || {};
  const dom = getDominantCategory(cats);
  const chosenCat = state.category === "semua" ? dom.key : state.category;
  const isDist = state.period === "2023-kecamatan";
  const qaNotes = [];
  if (isDist && row.scale_discrepancy) {
    qaNotes.push(
      `Selisih lintas tabel 2023: rekap objek ${row.total_incidents} vs skala ${row.scale_total} (${row.scale_discrepancy > 0 ? `+${row.scale_discrepancy}` : row.scale_discrepancy}).`
    );
  }
  if (isDist && row.area_anomaly_flag && row.area_anomaly_note) {
    qaNotes.push(row.area_anomaly_note);
  }

  return {
    html: `
      <dt>${isDist ? "Kecamatan" : "Bulan"}</dt>
      <dd>${escapeHtml(row.displayLabel)}${isDist ? ` <span class="mono">(${escapeHtml(row.area_code)})</span>` : ` (${row.period_year})`}</dd>
      <dt>Kejadian (${escapeHtml(categoryLabels[state.category])})</dt>
      <dd class="mono tabular">${format.number(row.filteredCount)}</dd>
      <dt>Total Seluruh Kategori</dt>
      <dd class="mono tabular">${format.number(row.total_incidents)}</dd>
      ${
        isDist
          ? `<dt>Skala (Besar / Kecil)</dt><dd class="mono tabular">${row.scale_besar} / ${row.scale_kecil}</dd>
             <dt>Luas Mentah Dilaporkan</dt><dd class="mono tabular">${escapeHtml(row.raw_area_reported)}</dd>
             <dt>Penduduk 2025 (BPS)</dt><dd class="mono tabular">${format.number(row.population_2025)}</dd>`
          : ""
      }
      <dt>Kategori Dominan</dt>
      <dd>${escapeHtml(categoryLabels[dom.key])} (${dom.count})</dd>
      <dt>Akurasi &amp; Status</dt>
      <dd>${escapeHtml(row.location_accuracy)} / ${renderBadge(row.verification_status)}</dd>
      <dt>Geometri</dt>
      <dd class="mono">${isDist ? "Poligon kecamatan (titik = null)" : "geom = null"}</dd>
      <dt>Sumber Data</dt>
      <dd>${escapeHtml(row.source_name || "Satu Data Medan")}</dd>
    `,
    qaNote: qaNotes.join(" "),
    previewType: chosenCat
  };
}

function buildOfficialTableMarkup({ rows, state, format }) {
  const isDist = state.period === "2023-kecamatan";
  if (state.period === "2023-dampak") {
    return {
      title: "Rekapitulasi Bulanan Dampak & Kerugian Kebakaran (2023)",
      count: `${rows.length} baris`,
      html: `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Bulan</th>
                <th>Kejadian</th>
                <th>Skala (Besar/Kecil)</th>
                <th>Luka</th>
                <th>Meninggal</th>
                <th>Kerugian (Mentah)</th>
                <th>Status</th>
                <th>Catatan QA</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr data-interactive="true" data-row-key="${escapeHtml(r.displayLabel)}" tabindex="0" class="${state.selectedKey === r.displayLabel ? "is-selected" : ""}">
                  <td><strong>${escapeHtml(r.displayLabel)}</strong></td>
                  <td class="mono tabular"><strong>${format.number(r.filteredCount)}</strong></td>
                  <td class="mono tabular">${r.scale_besar_monthly} / ${r.scale_kecil_monthly}</td>
                  <td class="mono tabular">${r.injured}</td>
                  <td class="mono tabular">${r.fatalities}</td>
                  <td class="mono tabular">${escapeHtml(r.raw_material_loss)}</td>
                  <td>${renderBadge(r.verification_status)}</td>
                  <td>${r.loss_anomaly_flag ? "Outlier format ('776')" : "Tanpa satuan mata uang"}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
    };
  }

  if (state.period === "2016-2025-tahunan") {
    return {
      title: "Deret Historis Kejadian Kebakaran Kota Medan (2016 - 2025)",
      count: `${rows.length} tahun`,
      html: `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tahun</th>
                <th>Kejadian (Medan)</th>
                <th>Medan + Luar Kota</th>
                <th>Pembanding Bulanan</th>
                <th>Granularitas</th>
                <th>Status</th>
                <th>Catatan Konsistensi</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr data-interactive="true" data-row-key="${escapeHtml(r.displayLabel)}" tabindex="0" class="${state.selectedKey === r.displayLabel ? "is-selected" : ""}">
                  <td class="mono"><strong>${escapeHtml(r.year)}</strong></td>
                  <td class="mono tabular"><strong>${format.number(r.total_incidents)}</strong></td>
                  <td class="mono tabular">${r.comparison_total_with_outside_medan !== null && r.comparison_total_with_outside_medan !== undefined ? format.number(r.comparison_total_with_outside_medan) : "-"}</td>
                  <td class="mono tabular">${r.comparison_rekap_total !== null && r.comparison_rekap_total !== undefined ? format.number(r.comparison_rekap_total) : "-"}</td>
                  <td class="mono">${escapeHtml(r.granularity)}</td>
                  <td>${renderBadge(r.verification_status)}</td>
                  <td>${escapeHtml(r.consistency_note || "Konsisten antar file sumber")}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
    };
  }

  return {
    title: isDist
      ? "Rekapitulasi Kejadian Kebakaran per Kecamatan (2023)"
      : `Rekapitulasi Bulanan Kejadian Kebakaran (${state.period === "2024-bulanan" ? "2024" : "2025"})`,
    count: `${rows.length} baris`,
    html: `
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>${isDist ? "Kecamatan" : "Bulan"}</th>
              <th>Terfilter</th>
              <th>Total</th>
              <th>Rumah</th>
              <th>Ruko</th>
              <th>Listrik</th>
              <th>Gudang</th>
              <th>Kendaraan</th>
              <th>Lahan</th>
              <th>Fas. Umum</th>
              <th>Lain-Lain</th>
              <th>Akurasi</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((r) => {
                const rowKey = r.displayLabel;
                return `
                  <tr data-interactive="true" data-row-key="${escapeHtml(rowKey)}" tabindex="0" class="${state.selectedKey === rowKey ? "is-selected" : ""}">
                    <td><strong>${escapeHtml(rowKey)}</strong></td>
                    <td class="mono tabular"><strong>${format.number(r.filteredCount)}</strong></td>
                    <td class="mono tabular">${format.number(r.total_incidents)}</td>
                    <td class="mono tabular">${r.categories.rumah}</td>
                    <td class="mono tabular">${r.categories.ruko}</td>
                    <td class="mono tabular">${r.categories.travo_kabel}</td>
                    <td class="mono tabular">${r.categories.gudang_pabrik}</td>
                    <td class="mono tabular">${r.categories.kendaraan}</td>
                    <td class="mono tabular">${r.categories.lahan}</td>
                    <td class="mono tabular">${r.categories.fasilitas_umum}</td>
                    <td class="mono tabular">${r.categories.lain_lain}</td>
                    <td class="mono">${escapeHtml(r.location_accuracy)}</td>
                    <td>${renderBadge(r.verification_status)}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `
  };
}

/**
 * Mounts the Fire Incident Explorer inside `container` and returns an async cleanup handle.
 */
export async function renderIncidentExplorer({ container, services, manifest }) {
  let currentCleanup = null;
  let outerMounted = true;

  async function mountWorkspace() {
    let datasets = null;
    try {
      datasets = await loadExplorerDatasets(services);
    } catch (err) {
      if (!outerMounted) return;
      container.replaceChildren(
        renderStatePanel({
          variant: "error",
          title: "Dataset Fire Incident Explorer gagal dimuat",
          message: err.message || "Berkas /data/fire_incidents_summary.json tidak tersedia.",
          actionLabel: "Muat Ulang",
          onAction: async () => {
            if (!outerMounted) return;
            await mountWorkspace();
          }
        })
      );
      currentCleanup = async () => {};
      return;
    }

    if (!outerMounted) return;

    const { summary, districtsGeoJson, supabaseStatus } = datasets;
    const districtNames = (summary.district_2023 || []).map((d) => d.district_name).sort();
    const ac = new AbortController();

    const state = {
      activeTab: "verified",
      period: "2023-kecamatan",
      district: "semua",
      category: "semua",
      search: "",
      sortBy: "default",
      selectedKey: null,
      demoMode: false,
      demoFixture: null,
      unlocatedFilter: "semua"
    };

    const supabaseBadgeText = supabaseStatus.active
      ? `[+] Supabase Aktif (${supabaseStatus.partitioned.verifiedLocated.length} titik)`
      : supabaseStatus.source === "local_fallback"
        ? "[!] Fallback Lokal (Supabase gagal)"
        : "[ ] Mode Lokal (Arsip Resmi)";

    container.innerHTML = `
      <section class="page-header">
        <div>
          <h1>${escapeHtml(manifest.title)}</h1>
          <p class="page-lead">
            Eksplorasi data kejadian kebakaran Kota Medan resmi (2023 kecamatan &amp; dampak bulanan, 2024-2025 bulanan, serta deret historis 2016-2025) beserta pemisahan data yang belum terlokasi.
          </p>
        </div>
        <div class="explorer-header-actions">
          <span class="status-badge status-badge--dev">[~] Dalam Pengembangan</span>
          <span class="status-badge status-badge--local" id="explorer-source-mode">${escapeHtml(supabaseBadgeText)}</span>
          <button type="button" class="btn btn-secondary btn-sm" id="toggle-demo-mode" aria-pressed="false">
            Pratinjau Kontrak Individual (DEMO)
          </button>
        </div>
      </section>

      <div class="notice-banner" id="explorer-granularity-banner" role="region" aria-label="Informasi granularitas data"></div>

      <div class="tab-bar" role="tablist" aria-label="Tampilan data Fire Incident Explorer">
        <button type="button" class="tab-btn" role="tab" id="tab-verified" aria-selected="true" aria-controls="explorer-tab-verified" data-tab="verified">
          Data Resmi Terverifikasi
        </button>
        <button type="button" class="tab-btn" role="tab" id="tab-unlocated" aria-selected="false" aria-controls="explorer-tab-unlocated" data-tab="unlocated">
          Belum Terlokasi &amp; Perlu Review (${summary.unlocated_register.length} batch)
        </button>
      </div>

      <div id="explorer-tab-verified" role="tabpanel" aria-labelledby="tab-verified">
        <section class="panel" aria-label="Filter data kejadian">
          <div class="explorer-filter-bar">
            <div class="field">
              <label for="filter-period">Periode &amp; Granularitas</label>
              <select id="filter-period">
                <option value="2023-kecamatan">2023 (Agregat 21 Kecamatan)</option>
                <option value="2023-dampak">2023 (Bulanan Korban &amp; Kerugian)</option>
                <option value="2024-bulanan">2024 (Agregat Bulanan)</option>
                <option value="2025-bulanan">2025 (Agregat Bulanan)</option>
                <option value="2016-2025-tahunan">2016 - 2025 (Tren Historis Tahunan)</option>
              </select>
            </div>
            <div class="field">
              <label for="filter-district">Kecamatan</label>
              <select id="filter-district">
                <option value="semua">Semua 21 Kecamatan</option>
                ${districtNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="filter-category">Kategori Objek Kebakaran</label>
              <select id="filter-category">
                ${Object.entries(CATEGORY_LABELS)
                  .map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`)
                  .join("")}
              </select>
            </div>
            <div class="field">
              <label for="filter-search">Cari Wilayah / Periode</label>
              <input id="filter-search" type="search" placeholder="Contoh: Belawan, Juli, atau 2020" />
            </div>
            <div class="field">
              <label for="filter-sort">Urutkan Hasil</label>
              <select id="filter-sort">
                <option value="default">Urutan Asli Sumber</option>
                <option value="desc">Kejadian Terbanyak</option>
                <option value="asc">Kejadian Tersedikit</option>
                <option value="name">Nama / Tahun (A - Z)</option>
              </select>
            </div>
            <div>
              <button type="button" class="btn btn-secondary" id="filter-reset">Reset Filter</button>
            </div>
          </div>
          <p class="explorer-source-note" id="explorer-supabase-note">${escapeHtml(supabaseStatus.note)}</p>
        </section>

        <section class="explorer-metrics" id="explorer-metrics" aria-label="Ringkasan hasil filter" style="margin-top: var(--space-4);"></section>

        <div class="split-layout split-layout--map-lead" style="margin-top: var(--space-4);">
          <section class="panel map-card">
            <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2);">
              <h2 id="explorer-map-title">Peta Kejadian per Kecamatan (Tahun 2023)</h2>
              <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">EPSG:4326</span>
            </div>
            <div class="map-canvas" id="explorer-map" role="region" aria-label="Peta interaktif kejadian kebakaran Kota Medan"></div>
            <div class="map-legend" id="explorer-map-legend"></div>
            <div class="provenance-bar" id="explorer-map-provenance"></div>
          </section>

          <aside style="display: flex; flex-direction: column; gap: var(--space-4);">
            <section class="panel" id="explorer-detail" aria-live="polite">
              <h2>Detail Baris Terpilih</h2>
              <p style="font-size: var(--text-sm); color: var(--color-ink-muted);">
                Pilih baris pada tabel atau klik wilayah di peta untuk memeriksa rincian data, akurasi lokasi, dan catatan QA.
              </p>
              <dl class="detail-kv" id="detail-kv"></dl>
              <div class="detail-qa-note" id="detail-qa-note" hidden></div>
            </section>

            <section class="panel">
              <h3 style="margin-bottom: var(--space-1);">Pratinjau Skematis Objek</h3>
              <p style="font-size: var(--text-xs); color: var(--color-ink-muted); margin-bottom: var(--space-2);">
                Visualisasi pendukung kategori objek dominan pada pilihan aktif (bukan peta kota 3D).
              </p>
              <div id="explorer-three-slot"></div>
            </section>
          </aside>
        </div>

        <section class="panel" style="margin-top: var(--space-4);">
          <h2 id="explorer-chart-title">Distribusi Kejadian Kebakaran per Kecamatan (2023)</h2>
          <p class="chart-empty-note" id="explorer-chart-empty" hidden>
            Tidak ada data pada filter aktif untuk ditampilkan pada grafik.
          </p>
          <div class="chart-frame" id="explorer-chart-frame">
            <canvas id="explorer-chart" aria-label="Grafik kejadian kebakaran"></canvas>
          </div>
        </section>

        <section class="panel" style="margin-top: var(--space-4);">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-3);">
            <h2 id="explorer-table-title">Tabel Rekapitulasi Resmi</h2>
            <span class="mono" id="explorer-table-count" style="font-size: var(--text-xs); color: var(--color-ink-muted);"></span>
          </div>
          <div id="explorer-table-wrap"></div>
        </section>
      </div>

      <div id="explorer-tab-unlocated" role="tabpanel" aria-labelledby="tab-unlocated" hidden></div>
    `;

    const bannerEl = container.querySelector("#explorer-granularity-banner");
    const demoBtn = container.querySelector("#toggle-demo-mode");
    const tabVerifiedBtn = container.querySelector("#tab-verified");
    const tabUnlocatedBtn = container.querySelector("#tab-unlocated");
    const tabVerifiedPanel = container.querySelector("#explorer-tab-verified");
    const tabUnlocatedPanel = container.querySelector("#explorer-tab-unlocated");

    const periodSel = container.querySelector("#filter-period");
    const districtSel = container.querySelector("#filter-district");
    const categorySel = container.querySelector("#filter-category");
    const searchInput = container.querySelector("#filter-search");
    const sortSel = container.querySelector("#filter-sort");
    const resetBtn = container.querySelector("#filter-reset");

    const metricsEl = container.querySelector("#explorer-metrics");
    const mapTitleEl = container.querySelector("#explorer-map-title");
    const legendEl = container.querySelector("#explorer-map-legend");
    const provenanceEl = container.querySelector("#explorer-map-provenance");
    const detailKvEl = container.querySelector("#detail-kv");
    const detailQaEl = container.querySelector("#detail-qa-note");
    const chartTitleEl = container.querySelector("#explorer-chart-title");
    const chartEmptyEl = container.querySelector("#explorer-chart-empty");
    const chartFrameEl = container.querySelector("#explorer-chart-frame");
    const chartCanvas = container.querySelector("#explorer-chart");
    const tableTitleEl = container.querySelector("#explorer-table-title");
    const tableCountEl = container.querySelector("#explorer-table-count");
    const tableWrapEl = container.querySelector("#explorer-table-wrap");

    const previewHandle = mountObjectSchematicPreview(
      container.querySelector("#explorer-three-slot"),
      "rumah"
    );
    const mapHandle = services.maps.createMap(container.querySelector("#explorer-map"));
    const dynamicOverlay = L.layerGroup().addTo(mapHandle.map);

    let districtGeoLayer = null;
    let activeBreaks = null;
    let activeRowMap = new Map();
    let lastMapViewKey = "";
    let activeRowsSnapshot = [];
    let chartHandle = null;
    let invalidateTimer = null;
    let isMounted = true;

    function getMapViewKey() {
      return `${state.demoMode}|${state.period}|${state.district}|${state.category}|${state.search}|${state.sortBy}`;
    }

    function computeDistrictFeatureStyle(feature) {
      const name = feature.properties.district_name;
      if (state.period !== "2023-kecamatan") {
        return { color: "#556164", weight: 1, fillColor: "#ECEAE2", fillOpacity: 0.45 };
      }
      const matched = activeRowMap.get(name);
      if (!matched) {
        return { color: "#6E7A7D", weight: 0.8, fillColor: "#ECEAE2", fillOpacity: 0.2 };
      }
      const tier = classifyChoroplethTier(matched.filteredCount, activeBreaks);
      const selected = state.selectedKey === name;
      return {
        color: selected ? "#202A2D" : "#356067",
        weight: selected ? 2.8 : 1.2,
        fillColor: TIER_COLORS[tier],
        fillOpacity: selected ? 0.88 : tier === "zero" ? 0.45 : 0.68
      };
    }

    function updateDetail(row) {
      const result = buildDetailHtml({
        row,
        state,
        format: services.format,
        categoryLabels: CATEGORY_LABELS
      });
      detailKvEl.innerHTML = result.html;
      if (result.qaNote) {
        detailQaEl.hidden = false;
        detailQaEl.textContent = result.qaNote;
      } else {
        detailQaEl.hidden = true;
        detailQaEl.textContent = "";
      }
      previewHandle.setObjectType(result.previewType);
    }

    function applySelectionUiOnly(selectedKey) {
      state.selectedKey = selectedKey;
      const found = activeRowsSnapshot.find((item) => getRowKey(item, state.demoMode) === selectedKey);
      updateDetail(found);

      const rows = tableWrapEl.querySelectorAll("tr[data-row-key]");
      rows.forEach((tr) => {
        tr.classList.toggle("is-selected", tr.getAttribute("data-row-key") === selectedKey);
      });

      if (!state.demoMode && districtGeoLayer) {
        districtGeoLayer.setStyle((feature) => computeDistrictFeatureStyle(feature));
      }
    }

    function renderUnlocatedRows() {
      const tbody = tabUnlocatedPanel.querySelector("#unlocated-batch-tbody");
      const countBadge = tabUnlocatedPanel.querySelector("#unlocated-filtered-count");
      if (!tbody) return;

      const filtered = summary.unlocated_register.filter(
        (u) => state.unlocatedFilter === "semua" || u.verification_status === state.unlocatedFilter
      );
      if (countBadge) {
        countBadge.textContent = `${filtered.length} dari ${summary.unlocated_register.length} batch`;
      }

      tbody.innerHTML = filtered
        .map(
          (u) => `
          <tr>
            <td class="mono">${escapeHtml(u.batch_id)}</td>
            <td>${escapeHtml(u.period_label)}</td>
            <td class="mono tabular">${services.format.number(u.record_count)}</td>
            <td><code class="mono">${escapeHtml(u.granularity)}</code></td>
            <td><code class="mono">${escapeHtml(u.location_accuracy)}</code></td>
            <td class="mono">null</td>
            <td>${renderBadge(u.verification_status)}</td>
            <td>${escapeHtml(u.reason)}</td>
          </tr>
        `
        )
        .join("");

      tabUnlocatedPanel.querySelectorAll("[data-unloc-filter]").forEach((btn) => {
        btn.setAttribute(
          "aria-pressed",
          String(btn.getAttribute("data-unloc-filter") === state.unlocatedFilter)
        );
      });
    }

    function renderUnlocatedTab() {
      const discrepRows = (summary.district_2023 || []).filter((r) => r.scale_discrepancy !== 0);
      const anomalyRows = summary.data_quality_anomalies || [];

      tabUnlocatedPanel.innerHTML = `
        <section class="panel">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2);">
            <h2>Rekapitulasi Data yang Belum Terpetakan sebagai Titik Individual</h2>
            <span class="mono" id="unlocated-filtered-count" style="font-size: var(--text-xs); color: var(--color-ink-muted);"></span>
          </div>
          <p class="page-lead" style="font-size: var(--text-sm); margin-bottom: var(--space-3);">
            Sesuai aturan kejujuran data, catatan agregat bulanan, tahunan, dan kecamatan tidak pernah dipecah menjadi koordinat palsu (<code>geom = null</code>).
          </p>
          <div class="qa-filter-row" role="group" aria-label="Filter status verifikasi batch">
            <button type="button" class="qa-filter-btn" data-unloc-filter="semua" aria-pressed="true">Semua Status</button>
            <button type="button" class="qa-filter-btn" data-unloc-filter="unlocated" aria-pressed="false">unlocated</button>
            <button type="button" class="qa-filter-btn" data-unloc-filter="needs_review" aria-pressed="false">needs_review</button>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ID Batch</th>
                  <th>Periode</th>
                  <th>Jumlah Kejadian</th>
                  <th>Granularitas</th>
                  <th>Akurasi Lokasi</th>
                  <th>Geometri</th>
                  <th>Status</th>
                  <th>Alasan &amp; Catatan</th>
                </tr>
              </thead>
              <tbody id="unlocated-batch-tbody"></tbody>
            </table>
          </div>
        </section>

        <section class="panel" style="margin-top: var(--space-4);">
          <h2>Temuan QA Konsistensi Tabel Tahun 2023 (${discrepRows.length} Kecamatan Selisih +/-1)</h2>
          <p style="font-size: var(--text-sm); color: var(--color-ink-muted);">
            Total kota pada kedua arsip resmi 2023 sama-sama berjumlah 219 kejadian, namun delapan kecamatan berbeda +/-1 antara file <em>Rekapitulasi Objek</em> dan file <em>Skala dan Kecamatan</em>.
          </p>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Kecamatan</th>
                  <th>Total File Kategori</th>
                  <th>Total File Skala (Besar + Kecil)</th>
                  <th>Selisih</th>
                  <th>Luas Mentah Dilaporkan</th>
                </tr>
              </thead>
              <tbody>
                ${discrepRows
                  .map(
                    (d) => `
                  <tr>
                    <td><strong>${escapeHtml(d.district_name)}</strong></td>
                    <td class="mono tabular">${d.total_incidents}</td>
                    <td class="mono tabular">${d.scale_total} (${d.scale_besar} + ${d.scale_kecil})</td>
                    <td class="mono tabular">${d.scale_discrepancy > 0 ? `+${d.scale_discrepancy}` : d.scale_discrepancy}</td>
                    <td class="mono tabular">${escapeHtml(d.raw_area_reported)}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" style="margin-top: var(--space-4);">
          <h2>Log Anomali Kualitas Data Resmi (${anomalyRows.length} Temuan Terdokumentasi)</h2>
          <p style="font-size: var(--text-sm); color: var(--color-ink-muted);">
            Seluruh transformasi nama wilayah, selisih antar-tabel, dan kejanggalan format angka sumber dicatat apa adanya tanpa pengubahan nilai mentah secara diam-diam.
          </p>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ID QA</th>
                  <th>Periode</th>
                  <th>Kategori</th>
                  <th>Temuan Sumber Asli</th>
                  <th>Penanganan</th>
                </tr>
              </thead>
              <tbody>
                ${anomalyRows
                  .map(
                    (a) => `
                  <tr>
                    <td class="mono">${escapeHtml(a.anomaly_id)}</td>
                    <td class="mono">${escapeHtml(a.period)}</td>
                    <td><span class="status-badge status-badge--dev">${escapeHtml(a.severity)}</span></td>
                    <td>${escapeHtml(a.summary)}</td>
                    <td>${escapeHtml(a.resolution)}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;

      renderUnlocatedRows();
      tabUnlocatedPanel.querySelectorAll("[data-unloc-filter]").forEach((btn) => {
        btn.addEventListener(
          "click",
          () => {
            state.unlocatedFilter = btn.getAttribute("data-unloc-filter") || "semua";
            renderUnlocatedRows();
          },
          { signal: ac.signal }
        );
      });
    }

    function updateBanner() {
      if (state.demoMode && state.demoFixture) {
        bannerEl.className = "notice-banner notice-banner--demo";
        bannerEl.innerHTML = `
          <strong>DATA DEMO AKTIF:</strong> ${escapeHtml(state.demoFixture.notice)}
          Menampilkan ${state.demoFixture.records.length} contoh kontrak record individual untuk pengujian skema UI.
        `;
        return;
      }

      if (state.period === "2023-kecamatan") {
        bannerEl.className = "notice-banner";
        bannerEl.innerHTML = `
          <strong>Sumber Resmi (Agregat 21 Kecamatan 2023):</strong> Data tersedia hingga level Kecamatan (<code>district_only</code>). Titik individual belum tersedia pada file resmi, sehingga peta menampilkan choropleth agregat kecamatan dan lokasi Mako 0.0 terverifikasi.
        `;
      } else if (state.period === "2023-dampak") {
        bannerEl.className = "notice-banner notice-banner--warn";
        bannerEl.innerHTML = `
          <strong>Catatan Granularitas Dampak &amp; Kerugian 2023:</strong> Berisi rekap bulanan korban luka (17), meninggal (14), serta kerugian material mentah (<code>geom = null</code>). Nilai Maret tercatat <code>776</code> tanpa akhiran ribuan pada spreadsheet sumber.
        `;
      } else if (state.period === "2016-2025-tahunan") {
        bannerEl.className = "notice-banner notice-banner--warn";
        bannerEl.innerHTML = `
          <strong>Catatan Seri Historis 2016 - 2025:</strong> Data 2016-2022 tersedia pada level agregat tahunan/bulanan kota (<code>geom = null</code>) dengan perbedaan cakupan luar kota pada arsip 2019, 2020, dan 2021.
        `;
      } else {
        const yr = state.period === "2024-bulanan" ? "2024" : "2025";
        bannerEl.className = "notice-banner notice-banner--warn";
        bannerEl.innerHTML = `
          <strong>Catatan Granularitas Tahun ${yr}:</strong> File resmi Satu Data Medan Tahun ${yr} bergranularitas agregat bulanan menurut 8 kategori objek tanpa kolom kecamatan atau koordinat titik (<code>geom = null</code>). Peta mempertahankan batas wilayah Kota Medan tanpa memplot titik palsu.
        `;
      }
    }

    function renderChart(rows) {
      if (chartHandle) {
        chartHandle.destroy();
        chartHandle = null;
      }

      if (!rows.length) {
        chartEmptyEl.hidden = false;
        chartFrameEl.hidden = true;
        return;
      }

      chartEmptyEl.hidden = true;
      chartFrameEl.hidden = false;

      if (state.demoMode && state.demoFixture) {
        chartTitleEl.textContent = "Contoh Sebaran Record Kontrak (DATA DEMO)";
        const counts = {};
        for (const r of rows) {
          const d = r.district_name || "Tidak Tercatat";
          counts[d] = (counts[d] || 0) + 1;
        }
        chartHandle = services.charts.createChart(chartCanvas, {
          type: "bar",
          data: {
            labels: Object.keys(counts),
            datasets: [{ label: "Record DEMO", data: Object.values(counts), backgroundColor: "#B84A35" }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
          }
        });
        return;
      }

      if (state.period === "2023-dampak") {
        chartTitleEl.textContent = "Bagaimana tren bulanan kejadian & korban kebakaran Tahun 2023?";
        chartHandle = services.charts.createChart(chartCanvas, {
          type: "bar",
          data: {
            labels: rows.map((r) => r.displayLabel),
            datasets: [
              {
                label: "Kejadian (2023)",
                data: rows.map((r) => r.filteredCount),
                backgroundColor: "#B84A35"
              },
              {
                label: "Korban Luka",
                data: rows.map((r) => Number(r.injured || 0)),
                backgroundColor: "#D58A43"
              },
              {
                label: "Meninggal",
                data: rows.map((r) => Number(r.fatalities || 0)),
                backgroundColor: "#356067"
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
          }
        });
        return;
      }

      if (state.period === "2016-2025-tahunan") {
        chartTitleEl.textContent = "Bagaimana tren tahunan kebakaran Kota Medan (2016 - 2025)?";
        chartHandle = services.charts.createChart(chartCanvas, {
          type: "line",
          data: {
            labels: rows.map((r) => r.displayLabel),
            datasets: [
              {
                label: "Kejadian Kota Medan (sumber utama)",
                data: rows.map((r) => r.filteredCount),
                borderColor: "#B84A35",
                backgroundColor: "rgba(184, 74, 53, 0.18)",
                borderWidth: 2,
                tension: 0.2,
                fill: true
              },
              {
                label: "Arsip penanggulangan (+luar kota, 2016-2022)",
                data: rows.map((r) => r.comparison_total_with_outside_medan),
                borderColor: "#356067",
                backgroundColor: "rgba(53, 96, 103, 0.08)",
                borderDash: [5, 4],
                borderWidth: 2,
                tension: 0.2,
                spanGaps: false
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
          }
        });
        return;
      }

      const catLabel = CATEGORY_LABELS[state.category];
      if (state.period === "2023-kecamatan") {
        chartTitleEl.textContent = `Berapa jumlah kejadian (${catLabel}) per Kecamatan pada Tahun 2023?`;
      } else {
        const yr = state.period === "2024-bulanan" ? "2024" : "2025";
        chartTitleEl.textContent = `Bagaimana tren bulanan kejadian (${catLabel}) sepanjang Tahun ${yr}?`;
      }

      chartHandle = services.charts.createChart(chartCanvas, {
        type: state.period === "2023-kecamatan" ? "bar" : "line",
        data: {
          labels: rows.map((r) => r.displayLabel),
          datasets: [
            {
              label: `${catLabel} (kejadian)`,
              data: rows.map((r) => r.filteredCount),
              backgroundColor: state.period === "2023-kecamatan" ? "#B84A35" : "rgba(184, 74, 53, 0.2)",
              borderColor: "#B84A35",
              borderWidth: 2,
              tension: 0.2,
              fill: state.period !== "2023-kecamatan"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
      });
    }

    function renderMapAndLegend(rows) {
      dynamicOverlay.clearLayers();
      districtGeoLayer = null;

      if (state.demoMode && state.demoFixture) {
        mapTitleEl.textContent = "Peta Kontrak Titik Individual (DATA DEMO)";
        legendEl.innerHTML = `
          <span class="legend-item"><span class="legend-swatch" style="background: #B84A35; border-radius: 50%;"></span> Titik perkiraan DEMO</span>
          <span class="legend-item"><span class="legend-swatch" style="background: #356067; border-radius: 50%;"></span> Mako 0.0 Terverifikasi</span>
        `;
        provenanceEl.innerHTML = `<span>Sumber: Fixture kontrak DEMO (bukan data resmi) &amp; batas OSM (&copy; OpenStreetMap contributors)</span>`;

        const boundary = L.geoJSON(districtsGeoJson, {
          style: { color: "#6E7A7D", weight: 1, fillOpacity: 0.08 }
        }).addTo(dynamicOverlay);

        for (const r of rows) {
          if (typeof r.lat === "number" && typeof r.lon === "number") {
            L.circleMarker([r.lat, r.lon], {
              radius: 9,
              color: "#202A2D",
              weight: 2,
              fillColor: "#B84A35",
              fillOpacity: 0.9
            })
              .bindPopup(
                `<strong>${escapeHtml(r.source_record_id)} (DEMO)</strong><br/>${escapeHtml(r.address_text)}<br/>Objek: ${escapeHtml(r.object_type)}`
              )
              .on("click", () => applySelectionUiOnly(r.source_record_id))
              .addTo(dynamicOverlay);
          }
        }
        services.maps.fitBounds(mapHandle.map, boundary);
        return;
      }

      activeRowMap = new Map(rows.map((r) => [r.district_name, r]));
      const isDist = state.period === "2023-kecamatan";

      if (isDist) {
        activeBreaks = computeChoroplethBreaks(rows.map((r) => r.filteredCount));
        mapTitleEl.textContent = `Peta Kejadian 2023 per Kecamatan (${CATEGORY_LABELS[state.category]})`;
        const legendParts = [
          `<span class="legend-item"><span class="legend-swatch" style="background: ${TIER_COLORS.zero};"></span> ${activeBreaks.zeroLabel}</span>`
        ];
        if (activeBreaks.lowLabel) {
          legendParts.push(
            `<span class="legend-item"><span class="legend-swatch" style="background: ${TIER_COLORS.low};"></span> Rendah (${activeBreaks.lowLabel})</span>`
          );
        }
        if (activeBreaks.midLabel) {
          legendParts.push(
            `<span class="legend-item"><span class="legend-swatch" style="background: ${TIER_COLORS.mid};"></span> Menengah (${activeBreaks.midLabel})</span>`
          );
        }
        if (activeBreaks.highLabel) {
          legendParts.push(
            `<span class="legend-item"><span class="legend-swatch" style="background: ${TIER_COLORS.high};"></span> Tinggi (${escapeHtml(activeBreaks.highLabel)})</span>`
          );
        }
        legendParts.push(
          `<span class="legend-item"><span class="legend-swatch" style="background: #356067; border-radius: 50%;"></span> Mako 0.0 Damkarmat</span>`
        );
        legendEl.innerHTML = legendParts.join("");
      } else {
        activeBreaks = null;
        const periodLabel =
          state.period === "2024-bulanan"
            ? "Agregat Bulanan 2024"
            : state.period === "2025-bulanan"
              ? "Agregat Bulanan 2025"
              : state.period === "2023-dampak"
                ? "Dampak Bulanan 2023"
                : "Seri Tahunan 2016 - 2025";
        mapTitleEl.textContent = `Batas Wilayah Kota Medan (${periodLabel})`;
        legendEl.innerHTML = `
          <span class="legend-item"><span class="legend-swatch" style="background: #ECEAE2;"></span> Data pada mode ini tidak memiliki atribut koordinat individual (geom = null)</span>
          <span class="legend-item"><span class="legend-swatch" style="background: #356067; border-radius: 50%;"></span> Mako 0.0 Damkarmat</span>
        `;
      }

      const supabasePoints = supabaseStatus.partitioned.verifiedLocated || [];
      if (supabasePoints.length > 0) {
        legendEl.innerHTML += `<span class="legend-item"><span class="legend-swatch" style="background: #202A2D; border-radius: 50%;"></span> Titik Kejadian Terverifikasi (${supabasePoints.length})</span>`;
      }

      provenanceEl.innerHTML = `
        <span>Batas: OpenStreetMap Nominatim (&copy; OpenStreetMap contributors, ODbL)</span>
        <span>Data: Dinas Damkarmat Kota Medan via Satu Data Medan</span>
      `;

      districtGeoLayer = L.geoJSON(districtsGeoJson, {
        style: (feature) => computeDistrictFeatureStyle(feature),
        onEachFeature: (feature, layer) => {
          const name = feature.properties.district_name;
          const matched = activeRowMap.get(name);
          const countText =
            isDist && matched
              ? `${matched.filteredCount} kejadian`
              : "Data kecamatan tidak dirinci pada mode periode ini";
          layer.bindPopup(`<strong>${escapeHtml(name)}</strong><br/>${escapeHtml(countText)}`);
          layer.on("click", () => {
            if (isDist && matched) {
              applySelectionUiOnly(name);
            }
          });
        }
      }).addTo(dynamicOverlay);

      for (const st of summary.verified_stations || []) {
        L.circleMarker([st.lat, st.lon], {
          radius: 8,
          color: "#FFFFFF",
          weight: 2,
          fillColor: "#356067",
          fillOpacity: 1
        })
          .bindPopup(`<strong>${escapeHtml(st.name)}</strong><br/>${escapeHtml(st.address)}`)
          .addTo(dynamicOverlay);
      }

      for (const pt of supabasePoints) {
        L.circleMarker([pt.lat, pt.lon], {
          radius: 6,
          color: "#FFFFFF",
          weight: 1.5,
          fillColor: "#202A2D",
          fillOpacity: 0.9
        })
          .bindPopup(
            `<strong>${escapeHtml(pt.source_record_id)}</strong><br/>${escapeHtml(pt.address_text || pt.district_name || "-")}<br/>Akurasi: ${escapeHtml(pt.location_accuracy)}`
          )
          .addTo(dynamicOverlay);
      }

      services.maps.fitBounds(mapHandle.map, districtGeoLayer);
    }

    function renderTable(rows) {
      if (!rows.length) {
        tableCountEl.textContent = "0 baris";
        tableWrapEl.replaceChildren(
          renderStatePanel({
            variant: "empty",
            title: "Tidak ada data yang cocok dengan filter",
            message: "Ubah kata kunci pencarian atau pilih ulang kecamatan, periode, dan kategori objek.",
            actionLabel: "Reset Filter",
            onAction: resetFilters
          })
        );
        return;
      }

      if (state.demoMode && state.demoFixture) {
        tableTitleEl.textContent = "Tabel Kontrak Record Individual (DATA DEMO)";
        tableCountEl.textContent = `${rows.length} record DEMO`;
        tableWrapEl.innerHTML = `
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ID Record</th>
                  <th>Tanggal</th>
                  <th>Kecamatan</th>
                  <th>Alamat Perkiraan</th>
                  <th>Objek</th>
                  <th>Akurasi</th>
                  <th>Geometri</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (r) => `
                  <tr data-interactive="true" data-row-key="${escapeHtml(r.source_record_id)}" tabindex="0" class="${state.selectedKey === r.source_record_id ? "is-selected" : ""}">
                    <td class="mono">${escapeHtml(r.source_record_id)}</td>
                    <td class="mono">${services.format.date(r.occurred_at)}</td>
                    <td><strong>${escapeHtml(r.district_name || "-")}</strong></td>
                    <td>${escapeHtml(r.address_text || "-")}</td>
                    <td>${escapeHtml(r.object_type || "-")}</td>
                    <td class="mono">${escapeHtml(r.location_accuracy)}</td>
                    <td class="mono">${typeof r.lat === "number" ? "Point" : "null"}</td>
                    <td><span class="status-badge status-badge--demo">DEMO (${escapeHtml(r.verification_status)})</span></td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
      } else {
        const view = buildOfficialTableMarkup({ rows, state, format: services.format });
        tableTitleEl.textContent = view.title;
        tableCountEl.textContent = view.count;
        tableWrapEl.innerHTML = view.html;
      }

      const rowEls = tableWrapEl.querySelectorAll("tr[data-row-key]");
      rowEls.forEach((tr) => {
        const pick = () => applySelectionUiOnly(tr.getAttribute("data-row-key"));
        tr.addEventListener("click", pick, { signal: ac.signal });
        tr.addEventListener(
          "keydown",
          (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pick();
            }
          },
          { signal: ac.signal }
        );
      });
    }

    function renderMetrics(rows) {
      if (state.demoMode && state.demoFixture) {
        const located = rows.filter((r) => typeof r.lat === "number").length;
        metricsEl.innerHTML = `
          <div class="metric-box"><div class="metric-label">Record DEMO Ditampilkan</div><div class="metric-value">${rows.length}</div></div>
          <div class="metric-box"><div class="metric-label">Memiliki Koordinat Perkiraan</div><div class="metric-value">${located}</div></div>
          <div class="metric-box"><div class="metric-label">Belum Terlokasi (DEMO)</div><div class="metric-value">${rows.length - located}</div></div>
          <div class="metric-box"><div class="metric-label">Label Status</div><div class="metric-value">DEMO</div></div>
        `;
        return;
      }

      const totalFiltered = rows.reduce((sum, r) => sum + Number(r.filteredCount || 0), 0);
      const totalAll = rows.reduce((sum, r) => sum + Number(r.total_incidents || 0), 0);
      const unitLabel =
        state.period === "2023-kecamatan"
          ? "Kecamatan"
          : state.period === "2016-2025-tahunan"
            ? "Tahun"
            : "Bulan";
      const granularityText =
        state.period === "2023-kecamatan"
          ? "district_aggregate"
          : state.period === "2016-2025-tahunan"
            ? "multi_year_aggregate"
            : "monthly_aggregate";

      metricsEl.innerHTML = `
        <div class="metric-box"><div class="metric-label">Kejadian Sesuai Filter</div><div class="metric-value">${services.format.number(totalFiltered)}</div></div>
        <div class="metric-box"><div class="metric-label">Total Periode Aktif</div><div class="metric-value">${services.format.number(totalAll)}</div></div>
        <div class="metric-box"><div class="metric-label">Baris ${unitLabel} Terfilter</div><div class="metric-value">${services.format.number(rows.length)}</div></div>
        <div class="metric-box"><div class="metric-label">Granularitas Sumber</div><div class="metric-value metric-value--meta">${granularityText}</div></div>
      `;
    }

    function syncView() {
      const isDist = state.period === "2023-kecamatan" && !state.demoMode;
      const supportsCategory =
        !state.demoMode &&
        (state.period === "2023-kecamatan" ||
          state.period === "2024-bulanan" ||
          state.period === "2025-bulanan");

      districtSel.disabled = !isDist;
      periodSel.disabled = state.demoMode;
      categorySel.disabled = !supportsCategory;
      sortSel.disabled = state.demoMode;

      updateBanner();

      const activeRows = state.demoMode && state.demoFixture
        ? filterDemoRecords(state.demoFixture.records, {
            search: state.search
          })
        : filterOfficialRows({
            summary,
            period: state.period,
            district: state.district,
            category: state.category,
            search: state.search,
            sortBy: state.sortBy
          });

      activeRowsSnapshot = activeRows;

      if (!state.selectedKey || !activeRows.some((r) => getRowKey(r, state.demoMode) === state.selectedKey)) {
        state.selectedKey = activeRows[0] ? getRowKey(activeRows[0], state.demoMode) : null;
      }

      const selectedRow = activeRows.find((r) => getRowKey(r, state.demoMode) === state.selectedKey);

      renderMetrics(activeRows);
      const nextMapKey = getMapViewKey();
      if (nextMapKey !== lastMapViewKey) {
        lastMapViewKey = nextMapKey;
        renderMapAndLegend(activeRows);
      } else if (!state.demoMode && districtGeoLayer) {
        districtGeoLayer.setStyle((feature) => computeDistrictFeatureStyle(feature));
      }
      renderChart(activeRows);
      renderTable(activeRows);
      updateDetail(selectedRow);
    }

    function resetFilters() {
      state.period = "2023-kecamatan";
      state.district = "semua";
      state.category = "semua";
      state.search = "";
      state.sortBy = "default";
      state.selectedKey = null;
      periodSel.value = state.period;
      districtSel.value = state.district;
      categorySel.value = state.category;
      searchInput.value = "";
      sortSel.value = state.sortBy;
      syncView();
    }

    function switchTab(nextTab) {
      state.activeTab = nextTab;
      const showVerified = nextTab === "verified";
      tabVerifiedBtn.setAttribute("aria-selected", String(showVerified));
      tabUnlocatedBtn.setAttribute("aria-selected", String(!showVerified));
      tabVerifiedPanel.hidden = !showVerified;
      tabUnlocatedPanel.hidden = showVerified;
      if (showVerified) {
        if (invalidateTimer) clearTimeout(invalidateTimer);
        invalidateTimer = setTimeout(() => {
          invalidateTimer = null;
          if (isMounted && mapHandle.map._mapPane) {
            mapHandle.map.invalidateSize({ animate: false });
          }
        }, 0);
      }
    }

    periodSel.addEventListener(
      "change",
      () => {
        state.period = periodSel.value;
        if (state.period !== "2023-kecamatan") {
          state.district = "semua";
          districtSel.value = "semua";
        }
        if (state.period === "2023-dampak" || state.period === "2016-2025-tahunan") {
          state.category = "semua";
          categorySel.value = "semua";
        }
        state.selectedKey = null;
        syncView();
      },
      { signal: ac.signal }
    );

    districtSel.addEventListener(
      "change",
      () => {
        state.district = districtSel.value;
        state.selectedKey = null;
        syncView();
      },
      { signal: ac.signal }
    );

    categorySel.addEventListener(
      "change",
      () => {
        state.category = categorySel.value;
        syncView();
      },
      { signal: ac.signal }
    );

    searchInput.addEventListener(
      "input",
      () => {
        state.search = searchInput.value;
        syncView();
      },
      { signal: ac.signal }
    );

    sortSel.addEventListener(
      "change",
      () => {
        state.sortBy = sortSel.value;
        syncView();
      },
      { signal: ac.signal }
    );

    resetBtn.addEventListener("click", resetFilters, { signal: ac.signal });
    tabVerifiedBtn.addEventListener("click", () => switchTab("verified"), { signal: ac.signal });
    tabUnlocatedBtn.addEventListener("click", () => switchTab("unlocated"), { signal: ac.signal });

    const handleTabKey = (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const nextTab = state.activeTab === "verified" ? "unlocated" : "verified";
        switchTab(nextTab);
        (nextTab === "verified" ? tabVerifiedBtn : tabUnlocatedBtn).focus();
      }
    };
    tabVerifiedBtn.addEventListener("keydown", handleTabKey, { signal: ac.signal });
    tabUnlocatedBtn.addEventListener("keydown", handleTabKey, { signal: ac.signal });

    demoBtn.addEventListener(
      "click",
      async () => {
        if (!state.demoMode) {
          demoBtn.disabled = true;
          demoBtn.setAttribute("aria-busy", "true");
          try {
            if (!state.demoFixture) {
              const loaded = await loadDemoContractFixture(services);
              if (!isMounted) return;
              state.demoFixture = loaded;
            }
            state.demoMode = true;
            state.selectedKey = null;
            demoBtn.textContent = "Kembali ke Data Resmi";
            demoBtn.setAttribute("aria-pressed", "true");
            switchTab("verified");
            syncView();
          } catch (err) {
            if (isMounted) services.notify.show(err.message, "error");
          } finally {
            if (isMounted) {
              demoBtn.disabled = false;
              demoBtn.removeAttribute("aria-busy");
            }
          }
        } else {
          state.demoMode = false;
          state.selectedKey = null;
          demoBtn.textContent = "Pratinjau Kontrak Individual (DEMO)";
          demoBtn.setAttribute("aria-pressed", "false");
          syncView();
        }
      },
      { signal: ac.signal }
    );

    renderUnlocatedTab();
    syncView();

    currentCleanup = async function cleanupWorkspace() {
      isMounted = false;
      ac.abort();
      if (invalidateTimer) {
        clearTimeout(invalidateTimer);
        invalidateTimer = null;
      }
      dynamicOverlay.clearLayers();
      if (chartHandle) {
        chartHandle.destroy();
        chartHandle = null;
      }
      previewHandle.destroy();
      mapHandle.destroy();
    };
  }

  await mountWorkspace();

  return async function unmount() {
    outerMounted = false;
    if (typeof currentCleanup === "function") {
      await currentCleanup();
      currentCleanup = null;
    }
  };
}
