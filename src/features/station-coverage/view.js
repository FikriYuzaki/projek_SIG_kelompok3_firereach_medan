import L from "leaflet";
import { renderStatePanel } from "../../components/state-panel.js";
import {
  filterDistrictCoverage,
  loadStationCoverageData
} from "./service.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getNetworkTierStyle(thresholdMeters, isDemo) {
  if (isDemo) {
    return { color: "#9A3B29", fillColor: "#B84A35", fillOpacity: 0.25, weight: 2, dashArray: "6 4" };
  }
  if (thresholdMeters <= 2000) {
    return { color: "#244449", fillColor: "#356067", fillOpacity: 0.42, weight: 1.8 };
  }
  if (thresholdMeters <= 3000) {
    return { color: "#356067", fillColor: "#477A82", fillOpacity: 0.28, weight: 1.5 };
  }
  return { color: "#8A5218", fillColor: "#D58A43", fillOpacity: 0.2, weight: 1.5 };
}

function getEuclideanTierStyle(thresholdMeters) {
  if (thresholdMeters <= 2000) return { color: "#202A2D", fillOpacity: 0, weight: 1.8, dashArray: "5 4" };
  if (thresholdMeters <= 3000) return { color: "#8A5218", fillOpacity: 0, weight: 1.8, dashArray: "5 4" };
  return { color: "#B84A35", fillOpacity: 0, weight: 1.8, dashArray: "6 4" };
}

export async function renderStationCoverage({ container, services, manifest }) {
  let currentCleanup = null;
  let outerMounted = true;

  async function mountWorkspace() {
    if (typeof document !== "undefined" && typeof container.replaceChildren === "function") {
      container.replaceChildren(
        renderStatePanel({
          variant: "loading",
          title: "Memuat analisis Fire Station Coverage",
          message: "Memuat koordinat pos Damkarmat terverifikasi, service area jaringan jalan OSM, dan perbandingan buffer Euclidean..."
        })
      );
    }

    let dataset = null;
    try {
      dataset = await loadStationCoverageData(services);
    } catch (err) {
      if (!outerMounted) return;
      container.replaceChildren(
        renderStatePanel({
          variant: "error",
          title: "Data Fire Station Coverage gagal dimuat",
          message: err.message || "Terjadi kesalahan saat membaca dataset jangkauan stasiun.",
          actionLabel: "Coba Muat Ulang",
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

    const ac = new AbortController();
    const analysis = dataset.analysis || {};
    const roadNet = dataset.roadNetwork || null;
    const isDemo = dataset.isDemo === true;
    const verifiedCount = dataset.verifiedStations?.length || 0;

    const state = {
      threshold: "semua",
      coverageBand: "semua",
      search: "",
      showNetwork: true,
      showEuclidean: !isDemo,
      showDistricts: true,
      selectedCode: dataset.districtCoverage?.[0]?.area_code || null
    };

    const statusBadgeClass = isDemo ? "status-badge--demo" : "status-badge--dev";
    const statusBadgeText = isDemo
      ? "[!] DATA DEMO"
      : `[!] PROVISIONAL (${verifiedCount} POS TERVERIFIKASI)`;
    const noticeClass = isDemo ? "notice-banner notice-banner--demo" : "notice-banner notice-banner--warn";

    const comp5km = (dataset.thresholdComparison || []).find((t) => Number(t.threshold_meters) === 5000);
    const net5KmArea = comp5km ? `${comp5km.network_area_km2.toFixed(2)} km²` : "-";
    const euc5KmArea = comp5km ? `${comp5km.euclidean_area_km2.toFixed(2)} km²` : "-";

    container.innerHTML = `
      <div class="coverage-workspace">
        <section class="page-header">
          <div>
            <h1>${escapeHtml(manifest.title)}</h1>
            <p class="page-lead">
              Evaluasi jangkauan layanan pos pemadam kebakaran menggunakan <strong>Service Area Jaringan Jalan OSM</strong> pada CRS metrik <code class="mono">EPSG:32647</code> dibandingkan dengan <strong>Buffer Jarak Lurus (Euclidean)</strong>.
            </p>
          </div>
          <div class="coverage-header-badges">
            <span class="status-badge status-badge--dev">[~] Dalam Pengembangan</span>
            <span class="status-badge ${statusBadgeClass}" id="coverage-status-badge" data-status-mode="${isDemo ? "demo" : "provisional"}">${escapeHtml(statusBadgeText)}</span>
          </div>
        </section>

        <div class="${noticeClass}" id="coverage-notice-banner" role="region" aria-label="Pemberitahuan status cakupan layanan">
          <strong>STATUS DATA (${escapeHtml(dataset.dataLabel)}):</strong> ${escapeHtml(dataset.notice)}
        </div>

        <div class="notice-banner" role="note">
          <strong>Catatan Skenario Waktu Tempuh:</strong> ${escapeHtml(analysis.disclaimer || "Estimasi menit dihitung dari asumsi kecepatan skenario, bukan waktu respons aktual Damkarmat.")}
        </div>

        ${
          dataset.provisionalLoadStatus === "rejected"
            ? `<div class="notice-banner notice-banner--warn" id="coverage-provisional-rejected" role="alert">
                <strong>Output provisional ditolak:</strong> Berkas <code>/data/station-coverage.provisional.json</code> tidak lolos validasi kontrak (${escapeHtml(
                  (dataset.provisionalValidationErrors || []).slice(0, 3).join("; ")
                )}). Menampilkan fixture DEMO.
              </div>`
            : ""
        }

        <section class="coverage-metrics" aria-label="Ringkasan jangkauan pos Damkarmat">
          <div class="metric-box">
            <div class="metric-label">Pos Terverifikasi Aktif</div>
            <div class="metric-value">${services.format.number(verifiedCount)} Pos (${verifiedCount === 1 ? "Mako 0.0" : "Terverifikasi"})</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Luas Jaringan 5 km (~${comp5km ? comp5km.scenario_minutes.toFixed(1) : "8.6"} mnt)</div>
            <div class="metric-value">${escapeHtml(net5KmArea)}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Luas Buffer Euclidean 5 km</div>
            <div class="metric-value">${escapeHtml(euc5KmArea)}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Jaringan Jalan OSM (EPSG:32647)</div>
            <div class="metric-value metric-value--meta">${roadNet ? `${services.format.number(roadNet.segment_count)} segmen (${services.format.number(roadNet.total_length_km)} km)` : "Fixture DEMO"}</div>
          </div>
        </section>

        <section class="panel" aria-label="Kontrol filter dan layer cakupan">
          <div class="coverage-filter-bar">
            <div class="field">
              <label for="coverage-threshold-select">Ambang Jarak Layanan</label>
              <select id="coverage-threshold-select">
                <option value="semua">Semua Ambang (2, 3, 5 km)</option>
                <option value="2000">2.000 m (Skenario ~3,4 mnt @ 35 km/j)</option>
                <option value="3000">3.000 m (Skenario ~5,1 mnt @ 35 km/j)</option>
                <option value="5000">5.000 m (Skenario ~8,6 mnt @ 35 km/j)</option>
              </select>
            </div>
            <div class="field">
              <label for="coverage-band-select">Filter Cakupan Kecamatan (5 km)</label>
              <select id="coverage-band-select">
                <option value="semua">Semua 21 Kecamatan</option>
                <option value="terjangkau">Terjangkau Sebagian / Penuh (&gt; 0%)</option>
                <option value="belum-terjangkau">Belum Terjangkau Mako 0.0 (0%)</option>
              </select>
            </div>
            <div class="field">
              <label for="coverage-search-input">Cari Kecamatan / Kode Area</label>
              <input id="coverage-search-input" type="search" placeholder="Contoh: Medan Petisah atau 12.71.19" />
            </div>
            <div>
              <button type="button" class="btn btn-secondary" id="coverage-reset-btn">Reset Filter</button>
            </div>
          </div>

          <div class="coverage-layer-toggles" style="margin-top: var(--space-3);">
            <label class="coverage-toggle-label">
              <input type="checkbox" id="coverage-toggle-network" checked />
              <span>Tampilkan Service Area Jaringan Jalan</span>
            </label>
            <label class="coverage-toggle-label">
              <input type="checkbox" id="coverage-toggle-euclidean" ${state.showEuclidean ? "checked" : ""} />
              <span>Tampilkan Buffer Euclidean (Garis Putus)</span>
            </label>
            <label class="coverage-toggle-label">
              <input type="checkbox" id="coverage-toggle-districts" checked />
              <span>Tampilkan Batas 21 Kecamatan (OSM)</span>
            </label>
          </div>
        </section>

        <div class="split-layout split-layout--map-lead">
          <section class="panel map-card">
            <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2);">
              <h2>Peta Jangkauan Pos Damkarmat (${escapeHtml(dataset.dataLabel)})</h2>
              <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">CRS Analisis: EPSG:32647 ke EPSG:4326</span>
            </div>
            <div class="map-canvas" id="coverage-map" role="region" aria-label="Peta jangkauan pos Damkarmat Kota Medan"></div>
            <div class="map-legend">
              <span class="legend-item"><span class="legend-swatch" style="background: #356067;"></span> Jaringan &lt;= 2 km</span>
              <span class="legend-item"><span class="legend-swatch" style="background: #477A82;"></span> Jaringan &lt;= 3 km</span>
              <span class="legend-item"><span class="legend-swatch" style="background: #D58A43;"></span> Jaringan &lt;= 5 km</span>
              <span class="legend-item"><span class="legend-swatch" style="background: transparent; border: 2px dashed #B84A35;"></span> Buffer Euclidean (2, 3, 5 km)</span>
              <span class="legend-item"><span class="legend-swatch" style="background: #B84A35; border-radius: 50%;"></span> Mako 0.0 Terverifikasi</span>
            </div>
            <div class="provenance-bar">
              <span>Jaringan jalan: Geofabrik Sumatra OSM (&copy; OpenStreetMap contributors, ODbL 1.0)</span>
              <span>Skenario kecepatan: ${escapeHtml(analysis.assumed_speed_kmh || 35)} km/jam (estimasi, bukan aktual)</span>
            </div>
          </section>

          <aside style="display: flex; flex-direction: column; gap: var(--space-4);">
            <section class="panel" aria-live="polite">
              <h2>Detail Cakupan Kecamatan</h2>
              <p style="font-size: var(--text-sm); color: var(--color-ink-muted); margin-bottom: var(--space-2);">
                Pilih baris kecamatan pada tabel atau klik wilayah pada peta.
              </p>
              <dl class="detail-kv" id="coverage-district-detail"></dl>
            </section>

            <section class="panel">
              <h3 style="margin-bottom: var(--space-2);">Metadata Jaringan Jalan &amp; Pos</h3>
              <dl class="detail-kv" id="coverage-metadata-kv">
                <dt>Status Analisis</dt><dd>${escapeHtml(dataset.dataLabel)}</dd>
                <dt>Pos Terverifikasi</dt><dd class="mono">${services.format.number(verifiedCount)} (Mako 0.0)</dd>
                <dt>Pos UPT Lainnya</dt><dd>Belum terverifikasi (p2k.medan.go.id HTTP 403)</dd>
                <dt>Ekstrak OSM</dt><dd class="mono">${escapeHtml(roadNet?.extract_date || analysis.road_extract_date || "-")}</dd>
                <dt>Segmen Jalan Drivable</dt><dd class="mono">${roadNet ? services.format.number(roadNet.segment_count) : "-"}</dd>
                <dt>Segmen Private Dikeluarkan</dt><dd class="mono">${roadNet ? services.format.number(roadNet.excluded_restricted_segments) : "-"}</dd>
                <dt>Asumsi Kecepatan</dt><dd class="mono">${escapeHtml(analysis.assumed_speed_kmh || 35)} km/jam (skenario)</dd>
              </dl>
              <div class="detail-qa-note">
                <strong>Keterbatasan Cakupan:</strong> Analisis saat ini baru mewakili satu pos terverifikasi (Mako 0.0 di Jl. Candi Borobudur No. 2) dan belum mencakup pos UPT Damkarmat lainnya.
              </div>
            </section>
          </aside>
        </div>

        <section class="panel">
          <h2>Perbandingan Luas Buffer Euclidean vs Service Area Jaringan Jalan (km²)</h2>
          <p class="chart-empty-note" id="coverage-chart-empty" hidden>
            Grafik perbandingan tersedia setelah hasil service area jaringan jalan dimuat.
          </p>
          <div class="chart-frame" id="coverage-chart-frame">
            <canvas id="coverage-chart" aria-label="Grafik perbandingan luas Euclidean dan jaringan jalan"></canvas>
          </div>
        </section>

        <section class="panel">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-3);">
            <h2>Daftar Cakupan Layanan per Kecamatan (${escapeHtml(dataset.dataLabel)})</h2>
            <span class="mono" id="coverage-table-count" style="font-size: var(--text-xs); color: var(--color-ink-muted);"></span>
          </div>
          <div id="coverage-table-wrap"></div>
        </section>
      </div>
    `;

    const threshSel = container.querySelector("#coverage-threshold-select");
    const bandSel = container.querySelector("#coverage-band-select");
    const searchInput = container.querySelector("#coverage-search-input");
    const resetBtn = container.querySelector("#coverage-reset-btn");
    const toggleNet = container.querySelector("#coverage-toggle-network");
    const toggleEuc = container.querySelector("#coverage-toggle-euclidean");
    const toggleDist = container.querySelector("#coverage-toggle-districts");
    const detailEl = container.querySelector("#coverage-district-detail");
    const chartEmptyEl = container.querySelector("#coverage-chart-empty");
    const chartFrameEl = container.querySelector("#coverage-chart-frame");
    const chartCanvas = container.querySelector("#coverage-chart");
    const tableCountEl = container.querySelector("#coverage-table-count");
    const tableWrapEl = container.querySelector("#coverage-table-wrap");

    const mapHandle = services.maps.createMap(container.querySelector("#coverage-map"));
    const districtLayerGroup = L.layerGroup().addTo(mapHandle.map);
    const euclideanLayerGroup = L.layerGroup().addTo(mapHandle.map);
    const networkLayerGroup = L.layerGroup().addTo(mapHandle.map);
    const stationLayerGroup = L.layerGroup().addTo(mapHandle.map);

    let chartHandle = null;

    function renderStations() {
      stationLayerGroup.clearLayers();
      for (const st of dataset.stations || []) {
        if (st.isDemoStation) {
          // Placeholder DEMO tidak pernah dicampur sebagai pos nyata
          L.circleMarker([st.lat, st.lon], {
            radius: 6,
            color: "#9A3B29",
            weight: 2,
            fillColor: "#F9ECE8",
            fillOpacity: 0.9
          })
            .bindPopup(`<strong>${escapeHtml(st.station_code)} (DEMO PLACEHOLDER)</strong><br/>${escapeHtml(st.name)}<br/><em>Tidak dipakai pada perhitungan nyata.</em>`)
            .addTo(stationLayerGroup);
          continue;
        }
        L.circleMarker([st.lat, st.lon], {
          radius: 8,
          color: "#FFFFFF",
          weight: 2,
          fillColor: "#B84A35",
          fillOpacity: 1
        })
          .bindPopup(
            `<strong>${escapeHtml(st.name)}</strong><br/>` +
              `Kode: ${escapeHtml(st.station_code)}<br/>` +
              `Alamat: ${escapeHtml(st.address)}<br/>` +
              `Status: Terverifikasi`
          )
          .addTo(stationLayerGroup);
      }
    }

    function renderCoverageLayers(fitExtent = false) {
      districtLayerGroup.clearLayers();
      euclideanLayerGroup.clearLayers();
      networkLayerGroup.clearLayers();

      let fitTarget = null;
      if (state.showDistricts && dataset.districtsGeoJson) {
        const dLayer = L.geoJSON(dataset.districtsGeoJson, {
          style: (feat) => {
            const code = feat?.properties?.area_code;
            const selected = code && code === state.selectedCode;
            return {
              color: selected ? "#202A2D" : "#6E7A7D",
              weight: selected ? 2.2 : 1,
              fillColor: selected ? "#EAF2F3" : "#ECEAE2",
              fillOpacity: selected ? 0.35 : 0.14
            };
          },
          onEachFeature: (feat, layer) => {
            const p = feat?.properties || {};
            if (p.district_name) {
              layer.bindTooltip(escapeHtml(`${p.district_name} (${p.area_code || ""})`), { sticky: true });
            }
            if (p.area_code) {
              layer.on("click", () => selectDistrict(p.area_code));
            }
          }
        }).addTo(districtLayerGroup);
        fitTarget = dLayer;
      }

      const selectedThresh = state.threshold === "semua" ? null : Number(state.threshold);
      const filterFeats = (fc) => ({
        type: "FeatureCollection",
        features: (fc?.features || []).filter(
          (f) => selectedThresh === null || Number(f.properties?.threshold_m) === selectedThresh
        )
      });

      if (state.showEuclidean && dataset.euclideanBuffersGeoJson?.features?.length) {
        const eLayer = L.geoJSON(filterFeats(dataset.euclideanBuffersGeoJson), {
          style: (f) => getEuclideanTierStyle(Number(f.properties?.threshold_m || 5000)),
          onEachFeature: (f, layer) => {
            const p = f.properties || {};
            layer.bindPopup(
              `<strong>${escapeHtml(p.coverage_tier || "Buffer Euclidean")}</strong><br/>` +
                `Luas di Kota Medan: ${Number(p.area_km2 || 0).toFixed(2)} km²<br/>` +
                `Metode: Jarak lurus (Euclidean, EPSG:32647)`
            );
          }
        }).addTo(euclideanLayerGroup);
        if (!fitTarget) fitTarget = eLayer;
      }

      if (state.showNetwork && dataset.networkServiceAreasGeoJson?.features?.length) {
        const netFc = filterFeats(dataset.networkServiceAreasGeoJson);
        // Urutkan agar radius terlebar digambar lebih dulu
        netFc.features.sort((a, b) => Number(b.properties?.threshold_m || 0) - Number(a.properties?.threshold_m || 0));
        const nLayer = L.geoJSON(netFc, {
          style: (f) => getNetworkTierStyle(Number(f.properties?.threshold_m || 5000), isDemo),
          onEachFeature: (f, layer) => {
            const p = f.properties || {};
            layer.bindPopup(
              `<strong>${escapeHtml(p.coverage_tier || "Service Area")}</strong><br/>` +
                `Luas tercakup: ${Number(p.area_km2 || 0).toFixed(2)} km²<br/>` +
                (p.road_length_km ? `Panjang ruas terjangkau: ${Number(p.road_length_km).toFixed(2)} km<br/>` : "") +
                `Status: ${escapeHtml(p.dataLabel || dataset.dataLabel)}`
            );
          }
        }).addTo(networkLayerGroup);
        if (!fitTarget) fitTarget = nLayer;
      }

      if (fitExtent && fitTarget) {
        services.maps.fitBounds(mapHandle.map, fitTarget);
      }
    }

    function renderChart() {
      if (chartHandle) {
        chartHandle.destroy();
        chartHandle = null;
      }
      const rows = dataset.thresholdComparison || [];
      if (!rows.length) {
        chartEmptyEl.hidden = false;
        chartFrameEl.hidden = true;
        return;
      }
      chartEmptyEl.hidden = true;
      chartFrameEl.hidden = false;

      chartHandle = services.charts.createChart(chartCanvas, {
        type: "bar",
        data: {
          labels: rows.map((r) => `${r.threshold_meters / 1000} km (~${r.scenario_minutes.toFixed(1)} mnt)`),
          datasets: [
            {
              label: "Buffer Euclidean (km²)",
              data: rows.map((r) => r.euclidean_area_km2),
              backgroundColor: "#D58A43",
              borderColor: "#8A5218",
              borderWidth: 1.5
            },
            {
              label: "Service Area Jaringan Jalan OSM (km²)",
              data: rows.map((r) => r.network_area_km2),
              backgroundColor: "#356067",
              borderColor: "#202A2D",
              borderWidth: 1.5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, title: { display: true, text: "Luas Cakupan (km²)" } }
          }
        }
      });
    }

    function updateDetail(row) {
      if (!row) {
        detailEl.innerHTML = `<dt>Status</dt><dd>${isDemo ? "Mode DEMO (belum ada ringkasan 21 kecamatan)" : "Tidak ada kecamatan terpilih"}</dd>`;
        return;
      }
      detailEl.innerHTML = `
        <dt>Kecamatan</dt><dd><strong>${escapeHtml(row.district_name)}</strong> (${escapeHtml(row.area_code)})</dd>
        <dt>Luas Wilayah</dt><dd class="mono tabular">${Number(row.district_area_km2).toFixed(2)} km²</dd>
        <dt>Cakupan Jaringan 3 km</dt><dd class="mono tabular">${Number(row.network_3km_coverage_pct).toFixed(2)}%</dd>
        <dt>Cakupan Jaringan 5 km</dt><dd class="mono tabular">${Number(row.network_5km_coverage_pct).toFixed(2)}%</dd>
        <dt>Cakupan Euclidean 5 km</dt><dd class="mono tabular">${Number(row.euclidean_5km_coverage_pct).toFixed(2)}%</dd>
        <dt>Gap Layanan 5 km</dt><dd class="mono tabular">${(Number(row.network_5km_gap_ratio) * 100).toFixed(2)}%</dd>
        <dt>Jarak Sentroid ke Mako 0.0</dt><dd class="mono tabular">${services.format.distance(row.centroid_distance_m_mako)}</dd>
      `;
    }

    function selectDistrict(areaCode) {
      state.selectedCode = areaCode;
      const found = (dataset.districtCoverage || []).find((r) => r.area_code === areaCode) || null;
      updateDetail(found);
      tableWrapEl.querySelectorAll("tr[data-area-code]").forEach((tr) => {
        tr.classList.toggle("is-selected", tr.getAttribute("data-area-code") === areaCode);
      });
      renderCoverageLayers(false);
    }

    function renderTable(filtered) {
      const total = (dataset.districtCoverage || []).length;
      if (!total) {
        tableCountEl.textContent = "0 kecamatan (DEMO)";
        if (typeof document !== "undefined") {
          tableWrapEl.replaceChildren(
            renderStatePanel({
              variant: "empty",
              title: "Belum ada tabel cakupan 21 kecamatan pada fixture DEMO",
              message: "Gunakan output provisional jaringan jalan OSM untuk melihat rincian per kecamatan."
            })
          );
        }
        return;
      }

      tableCountEl.textContent = `${filtered.length} dari ${total} kecamatan`;
      if (!filtered.length) {
        if (typeof document !== "undefined") {
          tableWrapEl.replaceChildren(
            renderStatePanel({
              variant: "empty",
              title: "Tidak ada kecamatan yang cocok dengan filter",
              message: "Ubah filter cakupan atau kata kunci pencarian.",
              actionLabel: "Reset Filter",
              onAction: resetFilters
            })
          );
        }
        return;
      }

      tableWrapEl.innerHTML = `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Kecamatan</th>
                <th>Jaringan 3 km</th>
                <th>Jaringan 5 km</th>
                <th>Euclidean 5 km</th>
                <th>Gap 5 km</th>
                <th>Jarak ke Mako 0.0</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map(
                  (r) => `
                <tr data-interactive="true" data-area-code="${escapeHtml(r.area_code)}" tabindex="0" class="${state.selectedCode === r.area_code ? "is-selected" : ""}">
                  <td class="mono">${escapeHtml(r.area_code)}</td>
                  <td><strong>${escapeHtml(r.district_name)}</strong></td>
                  <td class="mono tabular">${Number(r.network_3km_coverage_pct).toFixed(1)}%</td>
                  <td class="mono tabular">${Number(r.network_5km_coverage_pct).toFixed(1)}%</td>
                  <td class="mono tabular">${Number(r.euclidean_5km_coverage_pct).toFixed(1)}%</td>
                  <td class="mono tabular">${(Number(r.network_5km_gap_ratio) * 100).toFixed(1)}%</td>
                  <td class="mono tabular">${services.format.distance(r.centroid_distance_m_mako)}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;

      tableWrapEl.querySelectorAll("tr[data-area-code]").forEach((tr) => {
        const pick = () => selectDistrict(tr.getAttribute("data-area-code"));
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

    function syncView(fitExtent = false) {
      const filtered = filterDistrictCoverage(dataset.districtCoverage || [], {
        search: state.search,
        coverageBand: state.coverageBand
      });
      if (!state.selectedCode || !filtered.some((r) => r.area_code === state.selectedCode)) {
        state.selectedCode = filtered[0]?.area_code || null;
      }
      const selected = filtered.find((r) => r.area_code === state.selectedCode) || null;
      renderCoverageLayers(fitExtent);
      renderTable(filtered);
      updateDetail(selected);
    }

    function resetFilters() {
      state.threshold = "semua";
      state.coverageBand = "semua";
      state.search = "";
      state.showNetwork = true;
      state.showEuclidean = !isDemo;
      state.showDistricts = true;
      threshSel.value = "semua";
      bandSel.value = "semua";
      searchInput.value = "";
      toggleNet.checked = true;
      toggleEuc.checked = state.showEuclidean;
      toggleDist.checked = true;
      syncView(true);
    }

    threshSel.addEventListener("change", () => {
      state.threshold = threshSel.value;
      renderCoverageLayers(false);
    }, { signal: ac.signal });
    bandSel.addEventListener("change", () => {
      state.coverageBand = bandSel.value;
      syncView(false);
    }, { signal: ac.signal });
    searchInput.addEventListener("input", () => {
      state.search = searchInput.value;
      syncView(false);
    }, { signal: ac.signal });
    toggleNet.addEventListener("change", () => {
      state.showNetwork = toggleNet.checked;
      renderCoverageLayers(false);
    }, { signal: ac.signal });
    toggleEuc.addEventListener("change", () => {
      state.showEuclidean = toggleEuc.checked;
      renderCoverageLayers(false);
    }, { signal: ac.signal });
    toggleDist.addEventListener("change", () => {
      state.showDistricts = toggleDist.checked;
      renderCoverageLayers(false);
    }, { signal: ac.signal });
    resetBtn.addEventListener("click", resetFilters, { signal: ac.signal });

    renderStations();
    renderChart();
    syncView(true);

    currentCleanup = async function cleanupWorkspace() {
      ac.abort();
      districtLayerGroup.clearLayers();
      euclideanLayerGroup.clearLayers();
      networkLayerGroup.clearLayers();
      stationLayerGroup.clearLayers();
      if (chartHandle) {
        chartHandle.destroy();
        chartHandle = null;
      }
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

export const renderStationCoveragePlaceholder = renderStationCoverage;
