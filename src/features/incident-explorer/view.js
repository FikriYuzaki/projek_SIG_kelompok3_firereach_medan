import L from "leaflet";
import { mountObjectSchematicPreview } from "../../components/three-preview.js";
import { renderStatePanel } from "../../components/state-panel.js";
import {
  CATEGORY_LABELS,
  filterOfficialRows,
  getDominantCategory,
  loadDemoContractFixture,
  loadExplorerDatasets
} from "./service.js";

export async function renderIncidentExplorer({ container, services, manifest }) {
  let datasets = null;
  try {
    datasets = await loadExplorerDatasets(services);
  } catch (err) {
    container.replaceChildren(
      renderStatePanel({
        variant: "error",
        title: "Dataset Fire Incident Explorer gagal dimuat",
        message: err.message || "Berkas /data/fire_incidents_summary.json tidak tersedia.",
        actionLabel: "Muat Ulang",
        onAction: () => renderIncidentExplorer({ container, services, manifest })
      })
    );
    return async () => {};
  }

  const { summary, districtsGeoJson } = datasets;
  const districtNames = (summary.district_2023 || []).map((d) => d.district_name).sort();

  const state = {
    activeTab: "verified",
    period: "2023-kecamatan",
    district: "semua",
    category: "semua",
    search: "",
    selectedKey: null,
    demoMode: false,
    demoFixture: null
  };

  container.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${manifest.title}</h1>
        <p class="page-lead">
          Eksplorasi data kejadian kebakaran Kota Medan resmi (2023 tingkat kecamatan, 2024 dan 2025 tingkat bulanan) beserta pemisahan data yang belum terlokasi.
        </p>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center;">
        <span class="status-badge status-badge--dev">[~] Dalam Pengembangan</span>
        <button type="button" class="btn btn-secondary btn-sm" id="toggle-demo-mode" aria-pressed="false">
          Pratinjau Kontrak Individual (DEMO)
        </button>
      </div>
    </section>

    <div class="notice-banner" id="explorer-granularity-banner" role="region" aria-label="Informasi granularitas data"></div>

    <div class="tab-bar" role="tablist" aria-label="Tampilan data Fire Incident Explorer">
      <button type="button" class="tab-btn" role="tab" id="tab-verified" aria-selected="true" data-tab="verified">
        Data Resmi Terverifikasi
      </button>
      <button type="button" class="tab-btn" role="tab" id="tab-unlocated" aria-selected="false" data-tab="unlocated">
        Belum Terlokasi &amp; Perlu Review (${summary.unlocated_register.length} batch)
      </button>
    </div>

    <div id="explorer-tab-verified">
      <section class="panel" aria-label="Filter data kejadian">
        <div class="filter-bar">
          <div class="field">
            <label for="filter-period">Periode &amp; Granularitas</label>
            <select id="filter-period">
              <option value="2023-kecamatan">2023 (Agregat 21 Kecamatan)</option>
              <option value="2024-bulanan">2024 (Agregat Bulanan)</option>
              <option value="2025-bulanan">2025 (Agregat Bulanan)</option>
            </select>
          </div>
          <div class="field">
            <label for="filter-district">Kecamatan</label>
            <select id="filter-district">
              <option value="semua">Semua 21 Kecamatan</option>
              ${districtNames.map((name) => `<option value="${name}">${name}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="filter-category">Kategori Objek Kebakaran</label>
            <select id="filter-category">
              ${Object.entries(CATEGORY_LABELS)
                .map(([key, label]) => `<option value="${key}">${label}</option>`)
                .join("")}
            </select>
          </div>
          <div class="field">
            <label for="filter-search">Cari Wilayah / Bulan</label>
            <input id="filter-search" type="search" placeholder="Contoh: Belawan atau Juli" />
          </div>
          <div>
            <button type="button" class="btn btn-secondary" id="filter-reset">Reset Filter</button>
          </div>
        </div>
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
              Pilih baris pada tabel atau klik wilayah di peta untuk memeriksa rincian data.
            </p>
            <dl class="detail-kv" id="detail-kv"></dl>
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
        <div class="chart-frame">
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

    <div id="explorer-tab-unlocated" hidden></div>
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
  const resetBtn = container.querySelector("#filter-reset");

  const metricsEl = container.querySelector("#explorer-metrics");
  const mapTitleEl = container.querySelector("#explorer-map-title");
  const legendEl = container.querySelector("#explorer-map-legend");
  const provenanceEl = container.querySelector("#explorer-map-provenance");
  const detailKvEl = container.querySelector("#detail-kv");
  const chartTitleEl = container.querySelector("#explorer-chart-title");
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
  let chartHandle = null;
  let invalidateTimer = null;
  let isMounted = true;

  function renderUnlocatedTab() {
    const discrepRows = (summary.district_2023 || []).filter((r) => r.scale_discrepancy !== 0);
    tabUnlocatedPanel.innerHTML = `
      <section class="panel">
        <h2>Rekapitulasi Data yang Belum Terpetakan sebagai Titik Individual</h2>
        <p class="page-lead" style="font-size: var(--text-sm); margin-bottom: var(--space-4);">
          Sesuai aturan kejujuran data, catatan bulanan dan agregat kecamatan tidak pernah dipecah menjadi koordinat titik palsu. Seluruh batch tetap dicatat di bawah ini untuk penelusuran lanjutan atau geocoding terverifikasi.
        </p>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID Batch</th>
                <th>Periode</th>
                <th>Jumlah Kejadian</th>
                <th>Granularitas</th>
                <th>Akurasi Lokasi</th>
                <th>Status</th>
                <th>Alasan &amp; Catatan</th>
              </tr>
            </thead>
            <tbody>
              ${summary.unlocated_register
                .map(
                  (u) => `
                <tr>
                  <td class="mono">${u.batch_id}</td>
                  <td>${u.period_label}</td>
                  <td class="mono tabular">${services.format.number(u.record_count)}</td>
                  <td><code class="mono">${u.granularity}</code></td>
                  <td><code class="mono">${u.location_accuracy}</code></td>
                  <td>
                    <span class="status-badge ${u.verification_status === "unlocated" ? "status-badge--demo" : "status-badge--dev"}">
                      ${u.verification_status}
                    </span>
                  </td>
                  <td>${u.reason}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" style="margin-top: var(--space-4);">
        <h2>Temuan QA Konsistensi Tabel Tahun 2023 (${discrepRows.length} Kecamatan Selisih +/-1)</h2>
        <p style="font-size: var(--text-sm); color: var(--color-ink-muted);">
          Meskipun total kota sama-sama berjumlah 219 kejadian, lima kecamatan berbeda +/-1 antara file <em>Rekapitulasi Objek</em> dan file <em>Skala dan Kecamatan</em> pada portal Satu Data Medan.
        </p>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Kecamatan</th>
                <th>Total File Kategori</th>
                <th>Total File Skala (Besar + Kecil)</th>
                <th>Selisih</th>
              </tr>
            </thead>
            <tbody>
              ${discrepRows
                .map(
                  (d) => `
                <tr>
                  <td><strong>${d.district_name}</strong></td>
                  <td class="mono tabular">${d.total_incidents}</td>
                  <td class="mono tabular">${d.scale_total} (${d.scale_besar} + ${d.scale_kecil})</td>
                  <td class="mono tabular">${d.scale_discrepancy > 0 ? `+${d.scale_discrepancy}` : d.scale_discrepancy}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function updateBanner() {
    if (state.demoMode && state.demoFixture) {
      bannerEl.className = "notice-banner notice-banner--demo";
      bannerEl.innerHTML = `
        <strong>DATA DEMO AKTIF:</strong> ${state.demoFixture.notice}
        Menampilkan ${state.demoFixture.records.length} contoh kontrak record individual untuk pengujian skema UI.
      `;
      return;
    }

    if (state.period === "2023-kecamatan") {
      bannerEl.className = "notice-banner";
      bannerEl.innerHTML = `
        <strong>Sumber Resmi (Agregat 21 Kecamatan 2023):</strong> Data tersedia hingga level Kecamatan (<code>district_only</code>). Titik individual belum tersedia pada file resmi, sehingga peta menampilkan choropleth agregat kecamatan dan lokasi Mako 0.0 terverifikasi.
      `;
    } else {
      const yr = state.period === "2024-bulanan" ? "2024" : "2025";
      bannerEl.className = "notice-banner notice-banner--warn";
      bannerEl.innerHTML = `
        <strong>Catatan Granularitas Tahun ${yr}:</strong> File resmi Satu Data Medan Tahun ${yr} bergranularitas agregat bulanan menurut 8 kategori objek tanpa kolom kecamatan atau koordinat titik. Peta mempertahankan batas wilayah Kota Medan tanpa memplot titik palsu.
      `;
    }
  }

  function updateDetail(row) {
    if (!row) {
      detailKvEl.innerHTML = `<dt>Status</dt><dd>Belum ada baris terpilih</dd>`;
      return;
    }

    if (state.demoMode) {
      detailKvEl.innerHTML = `
        <dt>ID Record (DEMO)</dt><dd class="mono">${row.source_record_id}</dd>
        <dt>Kecamatan</dt><dd>${row.district_name}</dd>
        <dt>Alamat Perkiraan</dt><dd>${row.address_text}</dd>
        <dt>Objek</dt><dd>${row.object_type}</dd>
        <dt>Akurasi Lokasi</dt><dd class="mono">${row.location_accuracy}</dd>
        <dt>Koordinat</dt><dd class="mono">${row.lat ? `${row.lat}, ${row.lon}` : "Belum terlokasi"}</dd>
      `;
      previewHandle.setObjectType(row.object_type);
      return;
    }

    const cats = row.categories || {};
    const dom = getDominantCategory(cats);
    const chosenCat = state.category === "semua" ? dom.key : state.category;

    detailKvEl.innerHTML = `
      <dt>${state.period === "2023-kecamatan" ? "Kecamatan" : "Bulan"}</dt>
      <dd>${row.displayLabel}</dd>
      <dt>Kejadian (${CATEGORY_LABELS[state.category]})</dt>
      <dd class="mono tabular">${services.format.number(row.filteredCount)}</dd>
      <dt>Total Seluruh Kategori</dt>
      <dd class="mono tabular">${services.format.number(row.total_incidents)}</dd>
      ${
        state.period === "2023-kecamatan"
          ? `<dt>Skala (Besar / Kecil)</dt><dd class="mono tabular">${row.scale_besar} / ${row.scale_kecil}</dd>
             <dt>Penduduk 2025 (BPS)</dt><dd class="mono tabular">${services.format.number(row.population_2025)}</dd>`
          : ""
      }
      <dt>Kategori Dominan</dt>
      <dd>${CATEGORY_LABELS[dom.key]} (${dom.count})</dd>
      <dt>Akurasi Lokasi</dt>
      <dd class="mono">${row.location_accuracy}</dd>
    `;
    previewHandle.setObjectType(chosenCat);
  }

  function renderChart(rows) {
    if (chartHandle) {
      chartHandle.destroy();
      chartHandle = null;
    }

    if (state.demoMode && state.demoFixture) {
      chartTitleEl.textContent = "Contoh Sebaran Record Kontrak (DATA DEMO)";
      const counts = {};
      for (const r of rows) {
        counts[r.district_name] = (counts[r.district_name] || 0) + 1;
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
        plugins: {
          legend: { display: true }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  function renderMapAndLegend(rows) {
    dynamicOverlay.clearLayers();

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
            .bindPopup(`<strong>${r.source_record_id} (DEMO)</strong><br/>${r.address_text}<br/>Objek: ${r.object_type}`)
            .on("click", () => {
              state.selectedKey = r.source_record_id;
              updateDetail(r);
              renderTable(rows);
            })
            .addTo(dynamicOverlay);
        }
      }
      services.maps.fitBounds(mapHandle.map, boundary);
      return;
    }

    const rowMap = new Map(rows.map((r) => [r.district_name, r]));
    const isDist = state.period === "2023-kecamatan";

    if (isDist) {
      mapTitleEl.textContent = `Peta Kejadian 2023 per Kecamatan (${CATEGORY_LABELS[state.category]})`;
      legendEl.innerHTML = `
        <span class="legend-item"><span class="legend-swatch" style="background: #F9ECE8;"></span> Rendah (0 - 4)</span>
        <span class="legend-item"><span class="legend-swatch" style="background: #D58A43;"></span> Menengah (5 - 12)</span>
        <span class="legend-item"><span class="legend-swatch" style="background: #B84A35;"></span> Tinggi (&gt;= 13)</span>
        <span class="legend-item"><span class="legend-swatch" style="background: #356067; border-radius: 50%;"></span> Mako 0.0 Damkarmat</span>
      `;
    } else {
      const yr = state.period === "2024-bulanan" ? "2024" : "2025";
      mapTitleEl.textContent = `Batas Wilayah Kota Medan (Agregat Bulanan ${yr})`;
      legendEl.innerHTML = `
        <span class="legend-item"><span class="legend-swatch" style="background: #ECEAE2;"></span> Tidak ada atribut kecamatan pada arsip ${yr}</span>
        <span class="legend-item"><span class="legend-swatch" style="background: #356067; border-radius: 50%;"></span> Mako 0.0 Damkarmat</span>
      `;
    }

    provenanceEl.innerHTML = `
      <span>Batas: OpenStreetMap Nominatim (&copy; OpenStreetMap contributors, ODbL)</span>
      <span>Data: Dinas Damkarmat Kota Medan via Satu Data Medan</span>
    `;

    const distLayer = L.geoJSON(districtsGeoJson, {
      style: (feature) => {
        const name = feature.properties.district_name;
        const matched = rowMap.get(name);
        if (!isDist) {
          return { color: "#556164", weight: 1, fillColor: "#ECEAE2", fillOpacity: 0.45 };
        }
        if (!matched) {
          return { color: "#6E7A7D", weight: 0.8, fillColor: "#ECEAE2", fillOpacity: 0.2 };
        }
        const cnt = matched.filteredCount;
        const selected = state.selectedKey === name;
        const fill = cnt >= 13 ? "#B84A35" : cnt >= 5 ? "#D58A43" : "#F9ECE8";
        return {
          color: selected ? "#202A2D" : "#356067",
          weight: selected ? 2.6 : 1.2,
          fillColor: fill,
          fillOpacity: selected ? 0.85 : 0.65
        };
      },
      onEachFeature: (feature, layer) => {
        const name = feature.properties.district_name;
        const matched = rowMap.get(name);
        const countText = isDist && matched ? `${matched.filteredCount} kejadian` : "Agregat kecamatan 2024/2025 tidak tersedia";
        layer.bindPopup(`<strong>${name}</strong><br/>${countText}`);
        layer.on("click", () => {
          if (isDist && matched) {
            state.selectedKey = name;
            updateDetail(matched);
            renderTable(rows);
            renderMapAndLegend(rows);
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
        .bindPopup(`<strong>${st.name}</strong><br/>${st.address}`)
        .addTo(dynamicOverlay);
    }

    services.maps.fitBounds(mapHandle.map, distLayer);
  }

  function renderTable(rows) {
    if (!rows.length) {
      tableCountEl.textContent = "0 baris";
      tableWrapEl.replaceChildren(
        renderStatePanel({
          variant: "empty",
          title: "Tidak ada data yang cocok dengan filter",
          message: "Ubah kata kunci pencarian atau pilih ulang kecamatan dan kategori objek.",
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
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr data-interactive="true" data-row-key="${r.source_record_id}" tabindex="0" class="${state.selectedKey === r.source_record_id ? "is-selected" : ""}">
                  <td class="mono">${r.source_record_id}</td>
                  <td class="mono">${services.format.date(r.occurred_at)}</td>
                  <td><strong>${r.district_name}</strong></td>
                  <td>${r.address_text}</td>
                  <td>${r.object_type}</td>
                  <td class="mono">${r.location_accuracy}</td>
                  <td><span class="status-badge status-badge--demo">DEMO (${r.verification_status})</span></td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    } else {
      const isDist = state.period === "2023-kecamatan";
      tableTitleEl.textContent = isDist
        ? "Rekapitulasi Kejadian Kebakaran per Kecamatan (2023)"
        : `Rekapitulasi Bulanan Kejadian Kebakaran (${state.period === "2024-bulanan" ? "2024" : "2025"})`;
      tableCountEl.textContent = `${rows.length} baris`;

      tableWrapEl.innerHTML = `
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
                <th>Lahan</th>
                <th>Akurasi Lokasi</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map((r) => {
                  const rowKey = r.displayLabel;
                  return `
                    <tr data-interactive="true" data-row-key="${rowKey}" tabindex="0" class="${state.selectedKey === rowKey ? "is-selected" : ""}">
                      <td><strong>${r.displayLabel}</strong></td>
                      <td class="mono tabular"><strong>${services.format.number(r.filteredCount)}</strong></td>
                      <td class="mono tabular">${services.format.number(r.total_incidents)}</td>
                      <td class="mono tabular">${r.categories.rumah}</td>
                      <td class="mono tabular">${r.categories.ruko}</td>
                      <td class="mono tabular">${r.categories.travo_kabel}</td>
                      <td class="mono tabular">${r.categories.gudang_pabrik}</td>
                      <td class="mono tabular">${r.categories.lahan}</td>
                      <td class="mono">${r.location_accuracy}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    const rowEls = tableWrapEl.querySelectorAll("tr[data-row-key]");
    rowEls.forEach((tr) => {
      const pick = () => {
        const key = tr.getAttribute("data-row-key");
        state.selectedKey = key;
        const found = rows.find((item) => (state.demoMode ? item.source_record_id === key : item.displayLabel === key));
        updateDetail(found);
        renderTable(rows);
        if (!state.demoMode) renderMapAndLegend(rows);
      };
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      });
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
    const unitLabel = state.period === "2023-kecamatan" ? "Kecamatan" : "Bulan";
    const granularityText = state.period === "2023-kecamatan" ? "district_aggregate" : "monthly_aggregate";

    metricsEl.innerHTML = `
      <div class="metric-box"><div class="metric-label">Kejadian Sesuai Filter</div><div class="metric-value">${services.format.number(totalFiltered)}</div></div>
      <div class="metric-box"><div class="metric-label">Total Periode Aktif</div><div class="metric-value">${services.format.number(totalAll)}</div></div>
      <div class="metric-box"><div class="metric-label">Baris ${unitLabel} Terfilter</div><div class="metric-value">${services.format.number(rows.length)}</div></div>
      <div class="metric-box"><div class="metric-label">Granularitas Sumber</div><div class="metric-value" style="font-size: 0.95rem;">${granularityText}</div></div>
    `;
  }

  function syncView() {
    const isDistrict = state.period === "2023-kecamatan" && !state.demoMode;
    districtSel.disabled = !isDistrict;
    periodSel.disabled = state.demoMode;
    categorySel.disabled = state.demoMode;

    updateBanner();

    let activeRows = [];
    if (state.demoMode && state.demoFixture) {
      const q = state.search.trim().toLowerCase();
      activeRows = state.demoFixture.records.filter(
        (r) =>
          !q ||
          r.district_name.toLowerCase().includes(q) ||
          r.address_text.toLowerCase().includes(q) ||
          r.object_type.toLowerCase().includes(q)
      );
    } else {
      activeRows = filterOfficialRows({
        summary,
        period: state.period,
        district: state.district,
        category: state.category,
        search: state.search
      });
    }

    if (
      !state.selectedKey ||
      !activeRows.some((r) => (state.demoMode ? r.source_record_id === state.selectedKey : r.displayLabel === state.selectedKey))
    ) {
      state.selectedKey = activeRows[0]
        ? state.demoMode
          ? activeRows[0].source_record_id
          : activeRows[0].displayLabel
        : null;
    }

    const selectedRow = activeRows.find((r) =>
      state.demoMode ? r.source_record_id === state.selectedKey : r.displayLabel === state.selectedKey
    );

    renderMetrics(activeRows);
    renderMapAndLegend(activeRows);
    renderChart(activeRows);
    renderTable(activeRows);
    updateDetail(selectedRow);
  }

  function resetFilters() {
    state.period = "2023-kecamatan";
    state.district = "semua";
    state.category = "semua";
    state.search = "";
    state.selectedKey = null;
    periodSel.value = state.period;
    districtSel.value = state.district;
    categorySel.value = state.category;
    searchInput.value = "";
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

  periodSel.addEventListener("change", () => {
    state.period = periodSel.value;
    if (state.period !== "2023-kecamatan") {
      state.district = "semua";
      districtSel.value = "semua";
    }
    state.selectedKey = null;
    syncView();
  });

  districtSel.addEventListener("change", () => {
    state.district = districtSel.value;
    state.selectedKey = null;
    syncView();
  });

  categorySel.addEventListener("change", () => {
    state.category = categorySel.value;
    syncView();
  });

  searchInput.addEventListener("input", () => {
    state.search = searchInput.value;
    syncView();
  });

  resetBtn.addEventListener("click", resetFilters);
  tabVerifiedBtn.addEventListener("click", () => switchTab("verified"));
  tabUnlocatedBtn.addEventListener("click", () => switchTab("unlocated"));

  demoBtn.addEventListener("click", async () => {
    if (!state.demoMode) {
      try {
        if (!state.demoFixture) {
          state.demoFixture = await loadDemoContractFixture(services);
        }
        state.demoMode = true;
        state.selectedKey = null;
        demoBtn.textContent = "Kembali ke Data Resmi";
        demoBtn.setAttribute("aria-pressed", "true");
        switchTab("verified");
        syncView();
      } catch (err) {
        services.notify.show(err.message, "error");
      }
    } else {
      state.demoMode = false;
      state.selectedKey = null;
      demoBtn.textContent = "Pratinjau Kontrak Individual (DEMO)";
      demoBtn.setAttribute("aria-pressed", "false");
      syncView();
    }
  });

  renderUnlocatedTab();
  syncView();

  return async function unmount() {
    isMounted = false;
    if (invalidateTimer) {
      clearTimeout(invalidateTimer);
      invalidateTimer = null;
    }
    if (chartHandle) {
      chartHandle.destroy();
      chartHandle = null;
    }
    previewHandle.destroy();
    mapHandle.destroy();
  };
}
