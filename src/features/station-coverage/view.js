import L from "leaflet";
import { renderStatePanel } from "../../components/state-panel.js";
import {
  filterDistrictCoverage,
  formatCoverageDelta,
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

function getNetworkTierStyle(thresholdMeters, isDemo, isCandidateScenario) {
  if (isDemo) {
    return { color: "#9A3B29", fillColor: "#B84A35", fillOpacity: 0.25, weight: 2, dashArray: "6 4" };
  }
  const dashArray = isCandidateScenario ? "6 4" : undefined;
  if (thresholdMeters <= 2000) {
    return { color: "#244449", fillColor: "#356067", fillOpacity: isCandidateScenario ? 0.34 : 0.42, weight: 1.8, dashArray };
  }
  if (thresholdMeters <= 3000) {
    return { color: "#356067", fillColor: "#477A82", fillOpacity: isCandidateScenario ? 0.24 : 0.28, weight: 1.5, dashArray };
  }
  return { color: "#8A5218", fillColor: "#D58A43", fillOpacity: isCandidateScenario ? 0.16 : 0.2, weight: 1.5, dashArray };
}

function getEuclideanTierStyle(thresholdMeters) {
  if (thresholdMeters <= 2000) return { color: "#202A2D", fillOpacity: 0, weight: 1.8, dashArray: "5 4" };
  if (thresholdMeters <= 3000) return { color: "#8A5218", fillOpacity: 0, weight: 1.8, dashArray: "5 4" };
  return { color: "#B84A35", fillOpacity: 0, weight: 1.8, dashArray: "6 4" };
}

function formatSourceLabel(url, index) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host.includes("portal.medan.go.id")) return `Pemko Medan (${index})`;
    if (host.includes("medanbelawan.medan.go.id")) return `Kec. Medan Belawan (${index})`;
    if (host.includes("peraturan.bpk.go.id")) return `JDIH BPK (${index})`;
    if (host.includes("antaranews.com")) return `ANTARA Sumut (${index})`;
    if (host.includes("metrorakyat.com")) return `Metro Rakyat (${index})`;
    if (host.includes("medanterkini.medan.go.id")) return `Satu Data Medan (${index})`;
    return `${host} (${index})`;
  } catch {
    return `Sumber (${index})`;
  }
}

function formatValidityBadge(record) {
  if (record.isDemoStation) {
    return `<span class="status-badge status-badge--demo">[!] DEMO</span>`;
  }
  if (record.verification_status === "verified") {
    return `<span class="status-badge status-badge--active">[+] Terverifikasi</span>`;
  }
  if (record.location_accuracy === "approximate") {
    return `<span class="status-badge status-badge--dev">[?] Kandidat: Perkiraan OSM</span>`;
  }
  return `<span class="status-badge status-badge--soon">[-] Kandidat: Kecamatan Saja</span>`;
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
          message:
            "Memuat pos Damkarmat terverifikasi, inventaris kandidat publik, service area jaringan jalan OSM, dan perbandingan buffer Euclidean..."
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
    const verifiedStations = dataset.verifiedStations || [];
    const candidateStations = dataset.candidateStations || [];
    const geolocatedCandidates = dataset.geolocatedCandidateStations || [];
    const districtOnlyCandidates = dataset.districtOnlyCandidateStations || [];
    const invSummary = dataset.stationInventorySummary || null;
    const scenario = !isDemo ? dataset.candidateCoverageScenario || null : null;

    const verifiedCount = verifiedStations.length;
    const candidateCount = candidateStations.length;
    const candGeoCount = geolocatedCandidates.length;
    const candNullCount = districtOnlyCandidates.length;

    const state = {
      analysisMode: "verified",
      threshold: "semua",
      coverageBand: "semua",
      search: "",
      showNetwork: true,
      showEuclidean: !isDemo,
      showDistricts: true,
      showCandidates: !isDemo && candGeoCount > 0,
      selectedCode: dataset.districtCoverage?.[0]?.area_code || null
    };

    const statusBadgeClass = isDemo ? "status-badge--demo" : "status-badge--dev";
    const statusBadgeText = isDemo
      ? "[!] DATA DEMO"
      : `[!] PROVISIONAL (${verifiedCount} POS TERVERIFIKASI)`;
    const candidateBadgeText = `[?] ${candidateCount} KANDIDAT PUBLIK (${candGeoCount} TITIK OSM, ${candNullCount} KECAMATAN)`;
    const noticeClass = isDemo ? "notice-banner notice-banner--demo" : "notice-banner notice-banner--warn";

    const comp5kmBase = (dataset.thresholdComparison || []).find((t) => Number(t.threshold_meters) === 5000);
    const net5KmBaseText = comp5kmBase ? `${comp5kmBase.network_area_km2.toFixed(2)} km²` : "-";

    const retrievedDateText = invSummary?.retrieved_at || "2026-11-23";
    const osmAuditNote =
      invSummary?.osm_fire_station_audit?.note ||
      "Overpass API OSM hanya menemukan 3 fitur (semuanya kompleks Mako 0.0 Jl. Candi Borobudur No. 2).";
    const blockers = Array.isArray(invSummary?.source_blockers) ? invSummary.source_blockers : [];

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
            ${
              !isDemo && candidateCount > 0
                ? `<span class="status-badge status-badge--soon" id="coverage-candidate-count-badge">${escapeHtml(candidateBadgeText)}</span>`
                : ""
            }
          </div>
        </section>

        <div class="${noticeClass}" id="coverage-notice-banner" role="region" aria-label="Pemberitahuan status cakupan layanan">
          <strong>STATUS DATA (${escapeHtml(dataset.dataLabel)}):</strong> ${escapeHtml(dataset.notice)}
        </div>

        <div class="notice-banner" role="note">
          <strong>Catatan Skenario Waktu Tempuh:</strong> ${escapeHtml(analysis.disclaimer || "Estimasi menit dihitung secara teoretis dari asumsi kecepatan skenario, bukan waktu respons operasional aktual Damkarmat.")}
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

        <div class="notice-banner notice-banner--warn" id="coverage-candidate-scenario-banner" role="alert" hidden>
          <strong>SKENARIO EKSPLORATIF KANDIDAT AKTIF (BUKAN CAKUPAN RESMI):</strong>
          Perhitungan ini menambahkan ${services.format.number(candGeoCount)} titik perkiraan ruas/landmark OSM (${escapeHtml(geolocatedCandidates.map((s) => s.station_code).join(", "))}) di luar Mako 0.0, dan mengecualikan ${escapeHtml(districtOnlyCandidates.map((s) => s.station_code).join(", "))} yang belum berkoordinat (<code class="mono">geom = null</code>). Baseline Priority Planner tetap memakai 1 pos terverifikasi, dan menit skenario bukan waktu respons aktual Damkarmat.
        </div>

        <section class="coverage-metrics" aria-label="Ringkasan inventaris pos dan jangkauan layanan">
          <div class="metric-box">
            <div class="metric-label">Pos Terverifikasi Resmi</div>
            <div class="metric-value" id="coverage-kpi-verified">${services.format.number(verifiedCount)} Pos</div>
            <div class="metric-sub">${verifiedCount === 1 ? "Mako 0.0 (Jl. Candi Borobudur)" : "Terkonfirmasi resmi"}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Kandidat Publik (Perlu Review)</div>
            <div class="metric-value" id="coverage-kpi-candidates">${isDemo ? "0 UPT" : `${services.format.number(candidateCount)} UPT`}</div>
            <div class="metric-sub">${isDemo ? "Fixture DEMO aktif" : `${candGeoCount} titik perkiraan OSM, ${candNullCount} kecamatan saja`}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label" id="coverage-kpi-net5-label">Luas Jaringan 5 km (~${comp5kmBase ? comp5kmBase.scenario_minutes.toFixed(1) : "8.6"} mnt)</div>
            <div class="metric-value" id="coverage-kpi-net5">${escapeHtml(net5KmBaseText)}</div>
            <div class="metric-sub" id="coverage-kpi-net5-sub">Baseline resmi (${services.format.number(verifiedCount)} pos terverifikasi)</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Jaringan Jalan OSM (EPSG:32647)</div>
            <div class="metric-value metric-value--meta">${roadNet ? `${services.format.number(roadNet.segment_count)} segmen` : "Fixture DEMO"}</div>
            <div class="metric-sub">${roadNet ? `${services.format.number(roadNet.total_length_km)} km drivable` : "Data jalan nyata tidak dimuat"}</div>
          </div>
        </section>

        <section class="panel" aria-label="Kontrol skenario, filter, dan layer cakupan">
          <div class="coverage-filter-bar">
            <div class="field">
              <label for="coverage-scenario-select">Mode Analisis Cakupan</label>
              <select id="coverage-scenario-select" ${scenario ? "" : "disabled"}>
                <option value="verified">Baseline Terverifikasi (${services.format.number(verifiedCount)} Pos: Mako 0.0)</option>
                ${
                  scenario
                    ? `<option value="candidate_scenario">Skenario Kandidat (1 Terverifikasi + ${services.format.number(candGeoCount)} Titik OSM, Non-Resmi)</option>`
                    : ""
                }
              </select>
            </div>
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
                <option value="belum-terjangkau">Belum Terjangkau (0%)</option>
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
            <label class="coverage-toggle-label">
              <input type="checkbox" id="coverage-toggle-candidates" ${state.showCandidates ? "checked" : ""} ${candGeoCount > 0 && !isDemo ? "" : "disabled"} />
              <span>Tampilkan Titik Kandidat Publik UPT (${services.format.number(candGeoCount)} Titik OSM, Perlu Review)</span>
            </label>
          </div>
        </section>

        <div class="split-layout split-layout--map-lead">
          <section class="panel map-card">
            <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2);">
              <h2 id="coverage-map-title">Peta Jangkauan Pos Damkarmat (${escapeHtml(dataset.dataLabel)})</h2>
              <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">CRS Analisis: EPSG:32647 ke EPSG:4326</span>
            </div>
            <div class="map-canvas" id="coverage-map" role="region" aria-label="Peta jangkauan pos Damkarmat Kota Medan"></div>
            <div class="map-legend">
              <span class="legend-item"><span class="legend-swatch" style="background: #356067;"></span> Jaringan &lt;= 2 km</span>
              <span class="legend-item"><span class="legend-swatch" style="background: #477A82;"></span> Jaringan &lt;= 3 km</span>
              <span class="legend-item"><span class="legend-swatch" style="background: #D58A43;"></span> Jaringan &lt;= 5 km</span>
              <span class="legend-item"><span class="legend-swatch" style="background: transparent; border: 2px dashed #B84A35;"></span> Buffer Euclidean (2, 3, 5 km)</span>
              <span class="legend-item"><span class="legend-swatch" style="background: #B84A35; border-radius: 50%;"></span> Pos Terverifikasi (Mako 0.0)</span>
              <span class="legend-item"><span class="legend-swatch coverage-legend-candidate"></span> Kandidat Publik UPT (Perlu Review)</span>
            </div>
            <div class="provenance-bar">
              <span>Jaringan jalan: Geofabrik Sumatra OSM (&copy; OpenStreetMap contributors, ODbL 1.0)</span>
              <span>Skenario kecepatan: ${escapeHtml(analysis.assumed_speed_kmh || 35)} km/jam (teoretis, bukan waktu respons aktual)</span>
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
                <dt>Status Analisis Resmi</dt><dd>${escapeHtml(dataset.dataLabel)}</dd>
                <dt>Pos Terverifikasi</dt><dd class="mono">${services.format.number(verifiedCount)} (Mako 0.0)</dd>
                <dt>Kandidat Publik UPT</dt><dd class="mono">${services.format.number(candidateCount)} (${candGeoCount} OSM, ${candNullCount} geom=null)</dd>
                <dt>Input Priority Planner</dt><dd>Tetap 1 pos terverifikasi</dd>
                <dt>Audit Overpass OSM</dt><dd>${escapeHtml(osmAuditNote)}</dd>
                <dt>Tanggal Pengambilan</dt><dd class="mono">${escapeHtml(retrievedDateText)}</dd>
                <dt>Ekstrak Jalan OSM</dt><dd class="mono">${escapeHtml(roadNet?.extract_date || analysis.road_extract_date || "-")}</dd>
                <dt>Segmen Jalan Drivable</dt><dd class="mono">${roadNet ? services.format.number(roadNet.segment_count) : "-"}</dd>
                <dt>Asumsi Kecepatan</dt><dd class="mono">${escapeHtml(analysis.assumed_speed_kmh || 35)} km/jam (skenario)</dd>
              </dl>
              <div class="detail-qa-note">
                <strong>Keterbatasan Data:</strong> Hanya Mako 0.0 (Jl. Candi Borobudur No. 2) yang memiliki koordinat resmi terverifikasi dari Satu Data Medan. Enam UPT wilayah I-VI masih berstatus kandidat <code class="mono">needs_review</code> karena portal <code class="mono">p2k.medan.go.id</code> mengembalikan HTTP 403 Cloudflare.
              </div>
            </section>
          </aside>
        </div>

        <section class="panel" id="coverage-stations-section" aria-label="Inventaris pos terverifikasi dan kandidat publik">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-2);">
            <h2>Inventaris Pos Damkarmat: Terverifikasi Resmi vs Kandidat Publik</h2>
            <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">
              ${services.format.number(verifiedCount)} verified | ${services.format.number(candidateCount)} kandidat (diambil ${escapeHtml(retrievedDateText)})
            </span>
          </div>
          <p style="font-size: var(--text-sm); color: var(--color-ink-muted); margin-bottom: var(--space-3);">
            Klik baris pos yang memiliki titik pada peta (<code class="mono">Mako 0.0</code> atau kandidat dengan titik perkiraan OSM) untuk memusatkan peta. Kandidat tanpa geometri jalan/bangunan di OSM (<code class="mono">UPT-03</code>, <code class="mono">UPT-04</code>) tetap dipertahankan dengan <code class="mono">geom = null</code> agar tidak memalsukan lokasi.
          </p>
          <div id="coverage-stations-table-wrap"></div>
          ${
            blockers.length > 0
              ? `<div class="coverage-blockers-box">
                  <strong>Kendala Sumber Resmi yang Ditemui Saat Pengambilan (${escapeHtml(retrievedDateText)}):</strong>
                  <ul>
                    ${blockers
                      .map(
                        (b) =>
                          `<li><strong>${escapeHtml(b.source)}:</strong> ${escapeHtml(b.note)} (<span class="mono">${escapeHtml(b.status)}</span>)</li>`
                      )
                      .join("")}
                  </ul>
                </div>`
              : ""
          }
        </section>

        <section class="panel">
          <h2 id="coverage-chart-title">Perbandingan Luas Buffer Euclidean vs Service Area Jaringan Jalan (km²)</h2>
          <p class="chart-empty-note" id="coverage-chart-empty" hidden>
            Grafik perbandingan tersedia setelah hasil service area jaringan jalan dimuat.
          </p>
          <div class="chart-frame" id="coverage-chart-frame">
            <canvas id="coverage-chart" aria-label="Grafik perbandingan luas Euclidean dan jaringan jalan"></canvas>
          </div>
        </section>

        <section class="panel">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-3);">
            <h2 id="coverage-table-title">Daftar Cakupan Layanan per Kecamatan (${escapeHtml(dataset.dataLabel)})</h2>
            <span class="mono" id="coverage-table-count" style="font-size: var(--text-xs); color: var(--color-ink-muted);"></span>
          </div>
          <div id="coverage-table-wrap"></div>
        </section>
      </div>
    `;

    const scenarioSel = container.querySelector("#coverage-scenario-select");
    const threshSel = container.querySelector("#coverage-threshold-select");
    const bandSel = container.querySelector("#coverage-band-select");
    const searchInput = container.querySelector("#coverage-search-input");
    const resetBtn = container.querySelector("#coverage-reset-btn");
    const toggleNet = container.querySelector("#coverage-toggle-network");
    const toggleEuc = container.querySelector("#coverage-toggle-euclidean");
    const toggleDist = container.querySelector("#coverage-toggle-districts");
    const toggleCand = container.querySelector("#coverage-toggle-candidates");
    const scenarioBanner = container.querySelector("#coverage-candidate-scenario-banner");
    const kpiNet5El = container.querySelector("#coverage-kpi-net5");
    const kpiNet5SubEl = container.querySelector("#coverage-kpi-net5-sub");
    const mapTitleEl = container.querySelector("#coverage-map-title");
    const chartTitleEl = container.querySelector("#coverage-chart-title");
    const tableTitleEl = container.querySelector("#coverage-table-title");
    const stationsWrapEl = container.querySelector("#coverage-stations-table-wrap");
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
    const candidateLayerGroup = L.layerGroup().addTo(mapHandle.map);

    const markerByStationCode = new Map();
    let chartHandle = null;

    function getActiveScenarioData() {
      const isCandMode = state.analysisMode === "candidate_scenario" && Boolean(scenario);
      return {
        isCandMode,
        thresholdComparison: isCandMode ? scenario.threshold_comparison : dataset.thresholdComparison || [],
        euclideanBuffersGeoJson: isCandMode ? scenario.euclidean_buffers : dataset.euclideanBuffersGeoJson,
        networkServiceAreasGeoJson: isCandMode ? scenario.network_service_areas : dataset.networkServiceAreasGeoJson,
        districtCoverage: isCandMode ? scenario.district_coverage : dataset.districtCoverage || []
      };
    }

    function renderStations() {
      stationLayerGroup.clearLayers();
      candidateLayerGroup.clearLayers();
      markerByStationCode.clear();

      for (const st of dataset.stations || []) {
        if (st.isDemoStation) {
          L.circleMarker([st.lat, st.lon], {
            radius: 6,
            color: "#9A3B29",
            weight: 2,
            fillColor: "#F9ECE8",
            fillOpacity: 0.9
          })
            .bindPopup(
              `<strong>${escapeHtml(st.station_code)} (DEMO PLACEHOLDER)</strong><br/>${escapeHtml(st.name)}<br/><em>Tidak dipakai pada perhitungan nyata.</em>`
            )
            .addTo(stationLayerGroup);
          continue;
        }
        const marker = L.circleMarker([st.lat, st.lon], {
          radius: 8,
          color: "#FFFFFF",
          weight: 2,
          fillColor: "#B84A35",
          fillOpacity: 1
        }).bindPopup(
          `<strong>${escapeHtml(st.name)}</strong><br/>` +
            `Kode: ${escapeHtml(st.station_code)}<br/>` +
            `Alamat: ${escapeHtml(st.address)}<br/>` +
            `Akurasi: Terverifikasi resmi (<span class="mono">${st.lat.toFixed(6)}, ${st.lon.toFixed(6)}</span>)<br/>` +
            `Sumber: ${escapeHtml(st.source_name || "Satu Data Medan")}`
        );
        marker.addTo(stationLayerGroup);
        if (st.station_code) {
          markerByStationCode.set(st.station_code, { marker, lat: st.lat, lon: st.lon, isCandidate: false });
        }
      }

      if (state.showCandidates && !isDemo) {
        for (const cand of geolocatedCandidates) {
          const popupHtml =
            `<strong>${escapeHtml(cand.name)}</strong><br/>` +
            `Kode: ${escapeHtml(cand.station_code)}<br/>` +
            `Status: <strong>Kandidat Publik (Perlu Review)</strong><br/>` +
            `Kategori: ${escapeHtml(cand.validity_category)} (${escapeHtml(cand.osm_ref || "OSM")})<br/>` +
            `Koordinat perkiraan: <span class="mono">${cand.lat.toFixed(6)}, ${cand.lon.toFixed(6)}</span><br/>` +
            `Diambil: ${escapeHtml(cand.retrieved_at)}<br/>` +
            `Keterbatasan: ${escapeHtml(cand.limitation_note)}`;

          const cMarker = L.circleMarker([cand.lat, cand.lon], {
            radius: 7,
            color: "#8A5218",
            weight: 2.5,
            dashArray: "4 3",
            fillColor: "#FDF6EC",
            fillOpacity: 0.95
          }).bindPopup(popupHtml);
          cMarker.addTo(candidateLayerGroup);
          markerByStationCode.set(cand.station_code, { marker: cMarker, lat: cand.lat, lon: cand.lon, isCandidate: true });
        }
      }
    }

    function renderStationInventoryTable() {
      if (!stationsWrapEl) return;
      const rows = [
        ...verifiedStations.map((st) => ({ ...st, isCandidateRow: false })),
        ...candidateStations.map((st) => ({ ...st, isCandidateRow: true }))
      ];
      if (!rows.length) {
        stationsWrapEl.innerHTML = "";
        return;
      }

      stationsWrapEl.innerHTML = `
        <div class="table-scroll">
          <table class="data-table coverage-inventory-table">
            <colgroup>
              <col class="cov-col-code" />
              <col class="cov-col-status" />
              <col class="cov-col-address" />
              <col class="cov-col-coords" />
              <col class="cov-col-source" />
              <col class="cov-col-date" />
              <col class="cov-col-note" />
            </colgroup>
            <thead>
              <tr>
                <th>Kode &amp; Nama Pos</th>
                <th>Status Validitas</th>
                <th>Alamat &amp; Kecamatan</th>
                <th>Akurasi &amp; Koordinat (WGS 84)</th>
                <th>Sumber &amp; Tautan</th>
                <th>Diambil</th>
                <th>Catatan &amp; Keterbatasan</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map((st) => {
                  const hasPoint = typeof st.lat === "number" && typeof st.lon === "number";
                  const urls = Array.isArray(st.evidence_urls) && st.evidence_urls.length
                    ? st.evidence_urls
                    : st.source_url
                      ? [st.source_url]
                      : [];
                  const linkHtml = urls.length
                    ? `<ul class="coverage-source-links">${urls
                        .map(
                          (u, i) =>
                            `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(formatSourceLabel(u, i + 1))}</a></li>`
                        )
                        .join("")}</ul>`
                    : "-";
                  const coordHtml = hasPoint
                    ? `<span class="coverage-station-coords mono tabular">${st.lat.toFixed(6)}, ${st.lon.toFixed(6)}</span>${
                        st.osm_ref ? `<div class="mono coverage-station-sub">${escapeHtml(st.osm_ref)}</div>` : ""
                      }`
                    : `<span class="coverage-station-coords mono">geom = null (kecamatan saja)</span>`;
                  const retrieved = st.retrieved_at || (st.isCandidateRow ? retrievedDateText : "2026-11-19");
                  const noteText = st.isCandidateRow
                    ? st.limitation_note
                    : "Terverifikasi resmi (Satu Data Medan Knowledge Damkarmat) dan terkonfirmasi OSM (3 fitur di Jl. Candi Borobudur No. 2).";

                  return `
                    <tr ${hasPoint ? `data-interactive="true" data-station-code="${escapeHtml(st.station_code)}" tabindex="0"` : ""}>
                      <td class="coverage-station-code-cell">
                        <strong class="mono">${escapeHtml(st.station_code)}</strong>
                        <div class="coverage-station-sub">${escapeHtml(st.name)}</div>
                      </td>
                      <td>${formatValidityBadge(st)}</td>
                      <td class="coverage-station-address-cell">
                        <strong>${escapeHtml(st.district_name || "Medan Petisah")}</strong>
                        <div class="coverage-station-sub">${escapeHtml(st.address || "-")}</div>
                      </td>
                      <td>${coordHtml}</td>
                      <td class="coverage-station-source-cell">
                        <div class="coverage-station-source-name">${escapeHtml(st.source_name || "-")}</div>
                        ${linkHtml}
                      </td>
                      <td class="mono coverage-station-date">${escapeHtml(retrieved)}</td>
                      <td class="coverage-station-note">${escapeHtml(noteText)}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;

      stationsWrapEl.querySelectorAll("tr[data-station-code]").forEach((tr) => {
        const focusStation = (e) => {
          if (e?.target?.closest?.("a")) return;
          const code = tr.getAttribute("data-station-code");
          const candMatch = geolocatedCandidates.find((c) => c.station_code === code);
          if (candMatch && !state.showCandidates) {
            state.showCandidates = true;
            if (toggleCand) toggleCand.checked = true;
            renderStations();
          }
          const entry = markerByStationCode.get(code);
          if (entry && mapHandle.map) {
            const targetZoom = typeof mapHandle.map.getZoom === "function" ? Math.max(mapHandle.map.getZoom(), 13) : 13;
            mapHandle.map.setView?.([entry.lat, entry.lon], targetZoom, { animate: false });
            entry.marker?.openPopup?.();
          }
        };
        tr.addEventListener("click", focusStation, { signal: ac.signal });
        tr.addEventListener(
          "keydown",
          (e) => {
            if (e.key === "Enter" || e.key === " ") {
              if (e.target?.closest?.("a")) return;
              e.preventDefault();
              focusStation(e);
            }
          },
          { signal: ac.signal }
        );
      });
    }

    function renderCoverageLayers(fitExtent = false) {
      districtLayerGroup.clearLayers();
      euclideanLayerGroup.clearLayers();
      networkLayerGroup.clearLayers();

      const active = getActiveScenarioData();
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

      if (state.showEuclidean && active.euclideanBuffersGeoJson?.features?.length) {
        const eLayer = L.geoJSON(filterFeats(active.euclideanBuffersGeoJson), {
          style: (f) => getEuclideanTierStyle(Number(f.properties?.threshold_m || 5000)),
          onEachFeature: (f, layer) => {
            const p = f.properties || {};
            layer.bindPopup(
              `<strong>${escapeHtml(p.coverage_tier || "Buffer Euclidean")}</strong><br/>` +
                `Luas di Kota Medan: ${Number(p.area_km2 || 0).toFixed(2)} km²<br/>` +
                `Mode: ${active.isCandMode ? "Skenario Kandidat (Non-Resmi)" : "Baseline Terverifikasi"}<br/>` +
                `Metode: Jarak lurus (Euclidean, EPSG:32647)`
            );
          }
        }).addTo(euclideanLayerGroup);
        if (!fitTarget) fitTarget = eLayer;
      }

      if (state.showNetwork && active.networkServiceAreasGeoJson?.features?.length) {
        const netFc = filterFeats(active.networkServiceAreasGeoJson);
        netFc.features.sort((a, b) => Number(b.properties?.threshold_m || 0) - Number(a.properties?.threshold_m || 0));
        const nLayer = L.geoJSON(netFc, {
          style: (f) => getNetworkTierStyle(Number(f.properties?.threshold_m || 5000), isDemo, active.isCandMode),
          onEachFeature: (f, layer) => {
            const p = f.properties || {};
            layer.bindPopup(
              `<strong>${escapeHtml(p.coverage_tier || "Service Area")}</strong><br/>` +
                `Luas tercakup: ${Number(p.area_km2 || 0).toFixed(2)} km²<br/>` +
                (p.road_length_km ? `Panjang ruas terjangkau: ${Number(p.road_length_km).toFixed(2)} km<br/>` : "") +
                `Status: ${escapeHtml(p.dataLabel || (active.isCandMode ? scenario.dataLabel : dataset.dataLabel))}`
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
      const active = getActiveScenarioData();
      const rows = active.thresholdComparison || [];
      if (!rows.length) {
        if (chartEmptyEl) chartEmptyEl.hidden = false;
        if (chartFrameEl) chartFrameEl.hidden = true;
        return;
      }
      if (chartEmptyEl) chartEmptyEl.hidden = true;
      if (chartFrameEl) chartFrameEl.hidden = false;

      if (chartTitleEl) {
        chartTitleEl.textContent = active.isCandMode
          ? "Perbandingan Luas Baseline Terverifikasi vs Skenario Kandidat UPT (km², Non-Resmi)"
          : "Perbandingan Luas Buffer Euclidean vs Service Area Jaringan Jalan (km²)";
      }

      const baseRows = dataset.thresholdComparison || [];
      const datasets = active.isCandMode
        ? [
            {
              label: "Service Area Terverifikasi (Mako 0.0)",
              data: baseRows.map((r) => r.network_area_km2),
              backgroundColor: "#356067",
              borderColor: "#202A2D",
              borderWidth: 1.5
            },
            {
              label: `Service Area Skenario Kandidat (${services.format.number(verifiedCount + candGeoCount)} Titik, Non-Resmi)`,
              data: rows.map((r) => r.network_area_km2),
              backgroundColor: "#477A82",
              borderColor: "#202A2D",
              borderWidth: 1.5
            },
            {
              label: "Buffer Euclidean Skenario Kandidat (km²)",
              data: rows.map((r) => r.euclidean_area_km2),
              backgroundColor: "#D58A43",
              borderColor: "#8A5218",
              borderWidth: 1.5
            }
          ]
        : [
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
          ];

      chartHandle = services.charts.createChart(chartCanvas, {
        type: "bar",
        data: {
          labels: rows.map((r) => `${r.threshold_meters / 1000} km (~${r.scenario_minutes.toFixed(1)} mnt)`),
          datasets
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

    function updateDetail(row, isCandMode) {
      if (!detailEl) return;
      if (!row) {
        detailEl.innerHTML = `<dt>Status</dt><dd>${isDemo ? "Mode DEMO (belum ada ringkasan 21 kecamatan)" : "Tidak ada kecamatan terpilih"}</dd>`;
        return;
      }
      const distLabel = isCandMode ? "Jarak ke Pos Terdekat (Skenario)" : "Jarak Sentroid ke Mako 0.0";
      const distValue =
        isCandMode && typeof row.nearest_station_distance_m === "number"
          ? `${services.format.distance(row.nearest_station_distance_m)} (${escapeHtml(row.nearest_station_code || "-")})`
          : services.format.distance(row.centroid_distance_m_mako);
      const detailDelta = formatCoverageDelta(row.delta_network_5km_pct, { decimals: 2, unit: " poin %" });

      detailEl.innerHTML = `
        <dt>Kecamatan</dt><dd><strong>${escapeHtml(row.district_name)}</strong> (${escapeHtml(row.area_code)})</dd>
        <dt>Mode Analisis</dt><dd>${isCandMode ? "Skenario Kandidat (Non-Resmi)" : "Baseline Terverifikasi"}</dd>
        <dt>Luas Wilayah</dt><dd class="mono tabular">${Number(row.district_area_km2).toFixed(2)} km²</dd>
        <dt>Cakupan Jaringan 3 km</dt><dd class="mono tabular">${Number(row.network_3km_coverage_pct).toFixed(2)}%</dd>
        <dt>Cakupan Jaringan 5 km</dt><dd class="mono tabular">${Number(row.network_5km_coverage_pct).toFixed(2)}%</dd>
        ${
          isCandMode && typeof row.delta_network_5km_pct === "number"
            ? `<dt>Selisih vs Baseline 5 km</dt><dd class="mono tabular ${detailDelta.className}">${detailDelta.text}</dd>`
            : ""
        }
        <dt>Cakupan Euclidean 5 km</dt><dd class="mono tabular">${Number(row.euclidean_5km_coverage_pct).toFixed(2)}%</dd>
        <dt>Gap Layanan 5 km</dt><dd class="mono tabular">${(Number(row.network_5km_gap_ratio) * 100).toFixed(2)}%</dd>
        <dt>${distLabel}</dt><dd class="mono tabular">${distValue}</dd>
      `;
    }

    function selectDistrict(areaCode) {
      state.selectedCode = areaCode;
      const active = getActiveScenarioData();
      const found = (active.districtCoverage || []).find((r) => r.area_code === areaCode) || null;
      updateDetail(found, active.isCandMode);
      tableWrapEl.querySelectorAll("tr[data-area-code]").forEach((tr) => {
        tr.classList.toggle("is-selected", tr.getAttribute("data-area-code") === areaCode);
      });
      renderCoverageLayers(false);
    }

    function renderTable(filtered, totalCount, isCandMode) {
      if (!totalCount) {
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

      tableCountEl.textContent = `${filtered.length} dari ${totalCount} kecamatan`;
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

      const distHeader = isCandMode ? "Pos Terdekat (Skenario)" : "Jarak ke Mako 0.0";
      tableWrapEl.innerHTML = `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Kecamatan</th>
                <th>Jaringan 3 km</th>
                <th>Jaringan 5 km</th>
                ${isCandMode ? "<th>Selisih vs Mako</th>" : ""}
                <th>Euclidean 5 km</th>
                <th>Gap 5 km</th>
                <th>${distHeader}</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map((r) => {
                  const distText =
                    isCandMode && typeof r.nearest_station_distance_m === "number"
                      ? `${services.format.distance(r.nearest_station_distance_m)} (${escapeHtml(r.nearest_station_code || "-")})`
                      : services.format.distance(r.centroid_distance_m_mako);
                  const rowDelta = formatCoverageDelta(r.delta_network_5km_pct, { decimals: 1, unit: "%" });
                  return `
                <tr data-interactive="true" data-area-code="${escapeHtml(r.area_code)}" tabindex="0" class="${state.selectedCode === r.area_code ? "is-selected" : ""}">
                  <td class="mono">${escapeHtml(r.area_code)}</td>
                  <td><strong>${escapeHtml(r.district_name)}</strong></td>
                  <td class="mono tabular">${Number(r.network_3km_coverage_pct).toFixed(1)}%</td>
                  <td class="mono tabular">${Number(r.network_5km_coverage_pct).toFixed(1)}%</td>
                  ${isCandMode ? `<td class="mono tabular ${rowDelta.className}">${rowDelta.text}</td>` : ""}
                  <td class="mono tabular">${Number(r.euclidean_5km_coverage_pct).toFixed(1)}%</td>
                  <td class="mono tabular">${(Number(r.network_5km_gap_ratio) * 100).toFixed(1)}%</td>
                  <td class="mono tabular">${distText}</td>
                </tr>
              `;
                })
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

    function syncModeIndicators() {
      const active = getActiveScenarioData();
      const comp5km = (active.thresholdComparison || []).find((t) => Number(t.threshold_meters) === 5000);
      if (scenarioBanner) scenarioBanner.hidden = !active.isCandMode;
      if (kpiNet5El) kpiNet5El.textContent = comp5km ? `${comp5km.network_area_km2.toFixed(2)} km²` : "-";
      if (kpiNet5SubEl) {
        const net5DeltaText = formatCoverageDelta(comp5km?.delta_network_area_km2 ?? 0, {
          decimals: 2,
          unit: " km²"
        }).text;
        kpiNet5SubEl.textContent = active.isCandMode
          ? `Skenario non-resmi (${net5DeltaText} vs Mako)`
          : isDemo
            ? "Fixture DEMO"
            : `Baseline resmi (${services.format.number(verifiedCount)} pos terverifikasi)`;
      }
      if (mapTitleEl) {
        mapTitleEl.textContent = active.isCandMode
          ? "Peta Skenario Kandidat UPT (Non-Resmi, Bukan Baseline Priority)"
          : `Peta Jangkauan Pos Damkarmat (${dataset.dataLabel})`;
      }
      if (tableTitleEl) {
        tableTitleEl.textContent = active.isCandMode
          ? "Daftar Cakupan Skenario Kandidat per Kecamatan (Non-Resmi)"
          : `Daftar Cakupan Layanan per Kecamatan (${dataset.dataLabel})`;
      }
    }

    function syncView(fitExtent = false, rebuildChart = false) {
      const active = getActiveScenarioData();
      const rows = active.districtCoverage || [];
      const filtered = filterDistrictCoverage(rows, {
        search: state.search,
        coverageBand: state.coverageBand
      });
      if (!state.selectedCode || !filtered.some((r) => r.area_code === state.selectedCode)) {
        state.selectedCode = filtered[0]?.area_code || null;
      }
      const selected = filtered.find((r) => r.area_code === state.selectedCode) || null;
      syncModeIndicators();
      renderCoverageLayers(fitExtent);
      if (rebuildChart) renderChart();
      renderTable(filtered, rows.length, active.isCandMode);
      updateDetail(selected, active.isCandMode);
    }

    function resetFilters() {
      state.analysisMode = "verified";
      state.threshold = "semua";
      state.coverageBand = "semua";
      state.search = "";
      state.showNetwork = true;
      state.showEuclidean = !isDemo;
      state.showDistricts = true;
      state.showCandidates = !isDemo && candGeoCount > 0;

      if (scenarioSel) scenarioSel.value = "verified";
      if (threshSel) threshSel.value = "semua";
      if (bandSel) bandSel.value = "semua";
      if (searchInput) searchInput.value = "";
      if (toggleNet) toggleNet.checked = true;
      if (toggleEuc) toggleEuc.checked = state.showEuclidean;
      if (toggleDist) toggleDist.checked = true;
      if (toggleCand) toggleCand.checked = state.showCandidates;

      renderStations();
      syncView(true, true);
    }

    if (scenarioSel) {
      scenarioSel.addEventListener(
        "change",
        () => {
          state.analysisMode = scenarioSel.value === "candidate_scenario" && scenario ? "candidate_scenario" : "verified";
          if (state.analysisMode === "candidate_scenario" && !state.showCandidates && candGeoCount > 0) {
            state.showCandidates = true;
            if (toggleCand) toggleCand.checked = true;
            renderStations();
          }
          syncView(false, true);
        },
        { signal: ac.signal }
      );
    }
    if (threshSel) {
      threshSel.addEventListener(
        "change",
        () => {
          state.threshold = threshSel.value;
          renderCoverageLayers(false);
        },
        { signal: ac.signal }
      );
    }
    if (bandSel) {
      bandSel.addEventListener(
        "change",
        () => {
          state.coverageBand = bandSel.value;
          syncView(false, false);
        },
        { signal: ac.signal }
      );
    }
    if (searchInput) {
      searchInput.addEventListener(
        "input",
        () => {
          state.search = searchInput.value;
          syncView(false, false);
        },
        { signal: ac.signal }
      );
    }
    if (toggleNet) {
      toggleNet.addEventListener(
        "change",
        () => {
          state.showNetwork = toggleNet.checked;
          renderCoverageLayers(false);
        },
        { signal: ac.signal }
      );
    }
    if (toggleEuc) {
      toggleEuc.addEventListener(
        "change",
        () => {
          state.showEuclidean = toggleEuc.checked;
          renderCoverageLayers(false);
        },
        { signal: ac.signal }
      );
    }
    if (toggleDist) {
      toggleDist.addEventListener(
        "change",
        () => {
          state.showDistricts = toggleDist.checked;
          renderCoverageLayers(false);
        },
        { signal: ac.signal }
      );
    }
    if (toggleCand) {
      toggleCand.addEventListener(
        "change",
        () => {
          state.showCandidates = toggleCand.checked;
          renderStations();
        },
        { signal: ac.signal }
      );
    }
    if (resetBtn) {
      resetBtn.addEventListener("click", resetFilters, { signal: ac.signal });
    }

    renderStations();
    renderStationInventoryTable();
    syncView(true, true);

    currentCleanup = async function cleanupWorkspace() {
      ac.abort();
      districtLayerGroup.clearLayers();
      euclideanLayerGroup.clearLayers();
      networkLayerGroup.clearLayers();
      stationLayerGroup.clearLayers();
      candidateLayerGroup.clearLayers();
      markerByStationCode.clear();
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
