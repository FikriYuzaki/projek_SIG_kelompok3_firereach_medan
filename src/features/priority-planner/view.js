import L from "leaflet";
import { renderStatePanel } from "../../components/state-panel.js";
import {
  DEFAULT_PRIORITY_WEIGHTS,
  PRIORITY_TIER_CONFIG,
  filterPriorityZones,
  loadPriorityPlannerData,
  recalculatePriorityScores,
  validateWeights
} from "./service.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getTierMeta(tierLabel) {
  return (
    PRIORITY_TIER_CONFIG[tierLabel] || {
      rank: 0,
      label: tierLabel || "Parsial",
      fillColor: "#6E7A7D",
      strokeColor: "#202A2D"
    }
  );
}

export async function renderPriorityPlanner({ container, services, manifest }) {
  let currentCleanup = null;
  let outerMounted = true;

  async function mountWorkspace() {
    if (typeof document !== "undefined" && typeof container.replaceChildren === "function") {
      container.replaceChildren(
        renderStatePanel({
          variant: "loading",
          title: "Memuat analisis Fire Service Priority Planner",
          message: "Menggabungkan data agregat kebakaran 2023, kepadatan penduduk BPS 2025, dan gap jangkauan layanan..."
        })
      );
    }

    let dataset = null;
    try {
      dataset = await loadPriorityPlannerData(services);
    } catch (err) {
      if (!outerMounted) return;
      container.replaceChildren(
        renderStatePanel({
          variant: "error",
          title: "Data Fire Service Priority Planner gagal dimuat",
          message: err.message || "Terjadi kesalahan saat membaca dataset prioritas wilayah.",
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
    const baseWeights = analysis.weights || DEFAULT_PRIORITY_WEIGHTS;
    const multiZones = Array.isArray(dataset.zonesMultiStation) && dataset.zonesMultiStation.length === 21
      ? dataset.zonesMultiStation
      : null;

    const state = {
      tier: "semua",
      search: "",
      scenarioMode: "baseline",
      activeWeights: { ...baseWeights },
      isSimulation: false,
      activeZones: [...(dataset.zones || [])],
      selectedCode: dataset.zones?.[0]?.area_code || null
    };

    const indAvail = analysis.indicator_availability || {};
    const statusBadgeClass = "status-badge--active";
    const statusBadgeText = `${dataset.dataLabel} (21 Kecamatan | ${escapeHtml(analysis.method_version || "priority-v2.0")})`;
    const noticeClass = "notice-banner";

    container.innerHTML = `
      <div class="priority-workspace">
        <section class="page-header">
          <div>
            <h1>${escapeHtml(manifest.title)}</h1>
            <p class="page-lead">
              Indeks komposit terpadu (21 kecamatan <code class="mono">12.71.01</code> - <code class="mono">12.71.21</code>) yang mengintegrasikan beban kebakaran resmi 2023, overlap zona KDE eksploratif, gap layanan jaringan jalan 5 km, dan paparan penduduk BPS 2025.
            </p>
          </div>
          <div class="priority-header-badges">
            <span class="status-badge ${statusBadgeClass}" id="priority-status-badge" data-status-mode="provisional">${escapeHtml(statusBadgeText)}</span>
            <span class="status-badge status-badge--dev" id="priority-sim-badge" hidden>Simulasi What-If Aktif</span>
          </div>
        </section>

        <div class="${noticeClass}" id="priority-notice-banner" role="region" aria-label="Status data prioritas layanan">
          <strong>ANALISIS PRIORITAS TERINTEGRASI (${escapeHtml(dataset.dataLabel)}):</strong> ${escapeHtml(dataset.notice)}
        </div>

        <section class="priority-metrics" aria-label="Ringkasan indikator prioritas wilayah">
          <div class="metric-box">
            <div class="metric-label">Unit Analisis Kecamatan</div>
            <div class="metric-value">${services.format.number(state.activeZones.length)} Unit</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Prioritas #1 Saat Ini</div>
            <div class="metric-value metric-value--meta" id="priority-top-district">${escapeHtml(state.activeZones[0]?.area_name || "-")}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Bobot Aktif (Kebakaran / Gap / Penduduk)</div>
            <div class="metric-value metric-value--meta" id="priority-active-weights-text">40% / 35% / 25%</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Versi Metode</div>
            <div class="metric-value metric-value--meta">${escapeHtml(analysis.method_version || "priority-v1.0-provisional")}</div>
          </div>
        </section>

        <section class="panel" aria-label="Filter dan simulasi bobot what-if">
          <div class="priority-filter-bar">
            <div class="field">
              <label for="priority-scenario-select">Basis Gap Jangkauan (5 km)</label>
              <select id="priority-scenario-select" ${multiZones ? "" : "disabled"}>
                <option value="baseline">Baseline Resmi (1 Pos: Mako 0.0)</option>
                ${multiZones ? `<option value="multi_station">Skenario 5 Pos Berkoordinat OSM (Eksploratif)</option>` : ""}
              </select>
            </div>
            <div class="field">
              <label for="priority-tier-select">Filter Tier Prioritas</label>
              <select id="priority-tier-select">
                <option value="semua">Semua Tier Prioritas</option>
                <option value="Sangat Tinggi">Sangat Tinggi</option>
                <option value="Tinggi">Tinggi</option>
                <option value="Sedang">Sedang</option>
                <option value="Rendah">Rendah</option>
              </select>
            </div>
            <div class="field">
              <label for="priority-search-input">Cari Kecamatan atau Kode BPS</label>
              <input id="priority-search-input" type="search" placeholder="Contoh: Medan Belawan atau 12.71.08" />
            </div>
            <div>
              <button type="button" class="btn btn-secondary" id="priority-filter-reset">Reset Filter</button>
            </div>
          </div>

          <hr style="border: 0; border-top: 1px solid var(--color-border); margin: var(--space-4) 0;" />

          <div>
            <h2 style="font-size: var(--text-base); margin-bottom: var(--space-1);">Simulasi Bobot What-If (Total Wajib 100%)</h2>
            <p style="font-size: var(--text-xs); color: var(--color-ink-muted); margin-bottom: var(--space-3);">
              Uji sensitivitas peringkat dengan mengubah persentase bobot. Perubahan hanya berlaku untuk simulasi sesi ini dan tidak mengubah bobot standar metode (${Math.round(baseWeights.hotspot_intensity * 100)}% / ${Math.round(baseWeights.coverage_gap * 100)}% / ${Math.round(baseWeights.population_exposure * 100)}%).
            </p>
            <div class="priority-weights-grid">
              <div class="field">
                <label for="weight-hotspot-input">Bobot Kebakaran (%)</label>
                <input id="weight-hotspot-input" type="number" min="0" max="100" step="5" value="${Math.round(baseWeights.hotspot_intensity * 100)}" />
              </div>
              <div class="field">
                <label for="weight-gap-input">Bobot Gap Layanan (%)</label>
                <input id="weight-gap-input" type="number" min="0" max="100" step="5" value="${Math.round(baseWeights.coverage_gap * 100)}" />
              </div>
              <div class="field">
                <label for="weight-pop-input">Bobot Paparan Penduduk (%)</label>
                <input id="weight-pop-input" type="number" min="0" max="100" step="5" value="${Math.round(baseWeights.population_exposure * 100)}" />
              </div>
              <div>
                <button type="button" class="btn btn-primary" id="priority-apply-weights">Hitung Ulang Skor</button>
              </div>
              <div>
                <button type="button" class="btn btn-secondary" id="priority-reset-weights">Reset Bobot Standar</button>
              </div>
            </div>
            <p id="priority-weight-feedback" style="font-size: var(--text-xs); margin-top: var(--space-2); margin-bottom: 0; color: var(--color-ink-muted);"></p>
          </div>
        </section>

        <div class="split-layout split-layout--map-lead">
          <section class="panel map-card">
            <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2);">
              <h2>Peta Choropleth Prioritas 21 Kecamatan (${escapeHtml(dataset.dataLabel)})</h2>
              <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">CRS Web: EPSG:4326</span>
            </div>
            <div class="map-canvas" id="priority-map" role="region" aria-label="Peta prioritas layanan pemadam kebakaran 21 kecamatan"></div>
            <div class="map-legend">
              <span class="legend-item"><span class="legend-swatch" style="background: #7F1D1D;"></span> Sangat Tinggi</span>
              <span class="legend-item"><span class="legend-swatch" style="background: #C8523B;"></span> Tinggi</span>
              <span class="legend-item"><span class="legend-swatch" style="background: #E79E4F;"></span> Sedang</span>
              <span class="legend-item"><span class="legend-swatch" style="background: #E9C46A;"></span> Rendah</span>
            </div>
            <div class="provenance-bar">
              <span>Batas kecamatan: OpenStreetMap Nominatim (&copy; OpenStreetMap contributors, ODbL)</span>
              <span>Agregat 2023 bukan KDE; gap 5 km provisional dari Mako 0.0</span>
            </div>
          </section>

          <aside style="display: flex; flex-direction: column; gap: var(--space-4);">
            <section class="panel" aria-live="polite">
              <h2>Detail Skor Kecamatan</h2>
              <p style="font-size: var(--text-sm); color: var(--color-ink-muted); margin-bottom: var(--space-2);">
                Klik poligon di peta atau baris pada tabel peringkat untuk memeriksa kontribusi tiap faktor.
              </p>
              <dl class="detail-kv" id="priority-zone-detail"></dl>
              <div class="detail-qa-note" id="priority-zone-reason"></div>
            </section>

            <section class="panel">
              <h3 style="margin-bottom: var(--space-2);">Metodologi, Sumber &amp; Batasan</h3>
              <dl class="detail-kv">
                <dt>Rumus Standar</dt><dd class="mono">${escapeHtml(analysis.composite_formula || "-")}</dd>
                <dt>Normalisasi</dt><dd>${escapeHtml(analysis.normalization_method || "-")}</dd>
                <dt>Periode Data</dt><dd>${escapeHtml(analysis.period_label || "-")}</dd>
                <dt>Status Data</dt><dd>${escapeHtml(analysis.data_status || dataset.dataLabel)}</dd>
                <dt>Ketersediaan Indikator</dt>
                <dd style="display: flex; flex-wrap: wrap; gap: 0.25rem;">
                  <span class="status-badge ${indAvail.official_fire_2023 !== false ? "status-badge--active" : "status-badge--warn"}">Kebakaran 2023</span>
                  <span class="status-badge ${indAvail.exploratory_kde_public ? "status-badge--dev" : "status-badge--soon"}">KDE Publik 22 Titik</span>
                  <span class="status-badge ${indAvail.verified_station_coverage_5km ? "status-badge--active" : "status-badge--warn"}">Gap 5 km Mako</span>
                  <span class="status-badge ${indAvail.multi_station_coverage_5km ? "status-badge--dev" : "status-badge--soon"}">Gap 5 km 5 Pos</span>
                  <span class="status-badge ${indAvail.bps_population_2025 !== false ? "status-badge--active" : "status-badge--warn"}">BPS 2025</span>
                </dd>
              </dl>
              <div style="font-size: var(--text-xs); color: var(--color-ink-muted);">
                <strong>Batasan &amp; Catatan Sumber:</strong>
                <ul style="padding-left: 1.1rem; margin: var(--space-1) 0 0;">
                  ${(analysis.limitations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                </ul>
              </div>
            </section>
          </aside>
        </div>

        <section class="panel">
          <h2>Kontribusi Skor Tiga Faktor per Kecamatan</h2>
          <p class="chart-empty-note" id="priority-chart-empty" hidden>
            Tidak ada kecamatan yang cocok dengan filter aktif.
          </p>
          <div class="chart-frame" id="priority-chart-frame" style="height: 330px;">
            <canvas id="priority-chart" aria-label="Grafik kontribusi faktor skor prioritas kecamatan"></canvas>
          </div>
        </section>

        <section class="panel">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-3);">
            <h2>Peringkat Prioritas 21 Kecamatan (${escapeHtml(dataset.dataLabel)})</h2>
            <span class="mono" id="priority-table-count" style="font-size: var(--text-xs); color: var(--color-ink-muted);"></span>
          </div>
          <div id="priority-table-wrap"></div>
        </section>
      </div>
    `;

    const scenarioSel = container.querySelector("#priority-scenario-select");
    const tierSel = container.querySelector("#priority-tier-select");
    const searchInput = container.querySelector("#priority-search-input");
    const resetFilterBtn = container.querySelector("#priority-filter-reset");
    const wHotspotInput = container.querySelector("#weight-hotspot-input");
    const wGapInput = container.querySelector("#weight-gap-input");
    const wPopInput = container.querySelector("#weight-pop-input");
    const applyWeightsBtn = container.querySelector("#priority-apply-weights");
    const resetWeightsBtn = container.querySelector("#priority-reset-weights");
    const weightFeedbackEl = container.querySelector("#priority-weight-feedback");
    const simBadgeEl = container.querySelector("#priority-sim-badge");
    const topDistrictEl = container.querySelector("#priority-top-district");
    const activeWeightsTextEl = container.querySelector("#priority-active-weights-text");
    const detailEl = container.querySelector("#priority-zone-detail");
    const reasonEl = container.querySelector("#priority-zone-reason");
    const chartEmptyEl = container.querySelector("#priority-chart-empty");
    const chartFrameEl = container.querySelector("#priority-chart-frame");
    const chartCanvas = container.querySelector("#priority-chart");
    const tableCountEl = container.querySelector("#priority-table-count");
    const tableWrapEl = container.querySelector("#priority-table-wrap");

    const mapHandle = services.maps.createMap(container.querySelector("#priority-map"));
    const districtLayerGroup = L.layerGroup().addTo(mapHandle.map);
    let chartHandle = null;
    let choroplethLayer = null;

    function updateDetail(zone) {
      if (!zone) {
        detailEl.innerHTML = `<dt>Status</dt><dd>Tidak ada kecamatan terpilih</dd>`;
        reasonEl.textContent = "Pilih salah satu kecamatan untuk melihat alasan prioritas.";
        return;
      }
      const tierMeta = getTierMeta(zone.priority_tier);
      const kdePct = typeof zone.kde_exploratory_coverage_pct === "number" ? zone.kde_exploratory_coverage_pct.toFixed(1) : "0.0";
      const kdeRank = Number(zone.kde_exploratory_max_rank || 0);
      detailEl.innerHTML = `
        <dt>Kecamatan</dt><dd><strong>${escapeHtml(zone.area_name)}</strong> (${escapeHtml(zone.area_code)})</dd>
        <dt>Peringkat &amp; Tier</dt><dd>#${escapeHtml(zone.priority_rank ?? "-")} <span class="priority-tier-pill" style="--tier-color: ${tierMeta.fillColor};">${escapeHtml(zone.priority_tier)}</span></dd>
        <dt>Skor Komposit</dt><dd class="mono tabular">${zone.composite_score !== null ? Number(zone.composite_score).toFixed(3) : "Parsial"}</dd>
        <dt>Skor Beban Kebakaran (2023)</dt><dd class="mono tabular">${Number(zone.hotspot_score).toFixed(3)} (${services.format.number(zone.incidents_2023)} kejadian)</dd>
        <dt>Overlay KDE Eksploratif (22 Titik)</dt><dd class="mono tabular">${kdePct}% wilayah (${kdeRank > 0 ? `maks kelas ${kdeRank}/4` : "di luar poligon KDE"})</dd>
        <dt>Skor Gap Jangkauan (5 km)</dt><dd class="mono tabular">${zone.coverage_gap_score !== null ? Number(zone.coverage_gap_score).toFixed(3) : "Tidak tersedia"} (${Number(zone.network_5km_coverage_pct ?? 0).toFixed(1)}% terjangkau)</dd>
        <dt>Skor Paparan Penduduk (2025)</dt><dd class="mono tabular">${Number(zone.population_exposure_score).toFixed(3)} (${services.format.number(zone.density_km2_2025)} /km²)</dd>
      `;
      reasonEl.innerHTML = `<strong>Alasan Prioritas:</strong> ${escapeHtml(zone.priority_reason)}`;
    }

    function selectDistrict(areaCode) {
      state.selectedCode = areaCode;
      const found = state.activeZones.find((z) => z.area_code === areaCode) || null;
      updateDetail(found);

      tableWrapEl.querySelectorAll("tr[data-area-code]").forEach((tr) => {
        tr.classList.toggle("is-selected", tr.getAttribute("data-area-code") === areaCode);
      });

      if (choroplethLayer) {
        const zoneMap = new Map(state.activeZones.map((z) => [z.area_code, z]));
        choroplethLayer.setStyle((feat) => {
          const code = feat?.properties?.area_code;
          const z = zoneMap.get(code);
          const meta = getTierMeta(z?.priority_tier);
          const isSelected = code === areaCode;
          return {
            color: isSelected ? "#202A2D" : meta.strokeColor,
            weight: isSelected ? 3 : 1.3,
            fillColor: meta.fillColor,
            fillOpacity: isSelected ? 0.85 : 0.65
          };
        });
      }
    }

    function renderMap(filteredZones, fitExtent = false) {
      districtLayerGroup.clearLayers();
      choroplethLayer = null;
      if (!dataset.districtsGeoJson) return;

      const visibleCodes = new Set(filteredZones.map((z) => z.area_code));
      const zoneMap = new Map(state.activeZones.map((z) => [z.area_code, z]));

      choroplethLayer = L.geoJSON(dataset.districtsGeoJson, {
        style: (feat) => {
          const code = feat?.properties?.area_code;
          const z = zoneMap.get(code);
          const isVisible = visibleCodes.has(code);
          if (!z || !isVisible) {
            return { color: "#D9DEDA", weight: 1, fillColor: "#ECEAE2", fillOpacity: 0.25 };
          }
          const meta = getTierMeta(z.priority_tier);
          const isSelected = code === state.selectedCode;
          return {
            color: isSelected ? "#202A2D" : meta.strokeColor,
            weight: isSelected ? 3 : 1.3,
            fillColor: meta.fillColor,
            fillOpacity: isSelected ? 0.85 : 0.65
          };
        },
        onEachFeature: (feat, layer) => {
          const code = feat?.properties?.area_code;
          const z = zoneMap.get(code);
          if (z) {
            layer.bindPopup(
              `<strong>#${escapeHtml(z.priority_rank ?? "-")} ${escapeHtml(z.area_name)}</strong> (${escapeHtml(code)})<br/>` +
                `Tier: ${escapeHtml(z.priority_tier)}<br/>` +
                `Skor Komposit: ${z.composite_score !== null ? Number(z.composite_score).toFixed(3) : "Parsial"}<br/>` +
                `Kebakaran 2023: ${services.format.number(z.incidents_2023)} kejadian`
            );
            layer.on("click", () => selectDistrict(code));
          }
        }
      }).addTo(districtLayerGroup);

      if (fitExtent) {
        services.maps.fitBounds(mapHandle.map, choroplethLayer);
      }
    }

    function renderChart(filteredZones) {
      if (chartHandle) {
        chartHandle.destroy();
        chartHandle = null;
      }
      if (!filteredZones.length) {
        chartEmptyEl.hidden = false;
        chartFrameEl.hidden = true;
        return;
      }
      chartEmptyEl.hidden = true;
      chartFrameEl.hidden = false;

      const w = state.activeWeights;
      chartHandle = services.charts.createChart(chartCanvas, {
        type: "bar",
        data: {
          labels: filteredZones.map((z) => z.area_name.replace("Medan ", "M. ")),
          datasets: [
            {
              label: `Kebakaran 2023 (${Math.round(w.hotspot_intensity * 100)}%)`,
              data: filteredZones.map((z) => Number((w.hotspot_intensity * Number(z.hotspot_score || 0)).toFixed(4))),
              backgroundColor: "#B84A35"
            },
            {
              label: `Gap Jangkauan 5 km (${Math.round(w.coverage_gap * 100)}%)`,
              data: filteredZones.map((z) => Number((w.coverage_gap * Number(z.coverage_gap_score || 0)).toFixed(4))),
              backgroundColor: "#356067"
            },
            {
              label: `Paparan Penduduk 2025 (${Math.round(w.population_exposure * 100)}%)`,
              data: filteredZones.map((z) => Number((w.population_exposure * Number(z.population_exposure_score || 0)).toFixed(4))),
              backgroundColor: "#D58A43"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { stacked: true },
            y: { stacked: true, beginAtZero: true, max: 1.0, title: { display: true, text: "Kontribusi Skor (0-1)" } }
          }
        }
      });
    }

    function renderTable(filteredZones) {
      tableCountEl.textContent = `${filteredZones.length} dari ${state.activeZones.length} kecamatan`;
      if (!filteredZones.length) {
        if (typeof document !== "undefined") {
          tableWrapEl.replaceChildren(
            renderStatePanel({
              variant: "empty",
              title: "Tidak ada kecamatan yang cocok dengan filter",
              message: "Ubah filter tier prioritas atau kata kunci pencarian.",
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
                <th>Peringkat</th>
                <th>Kode</th>
                <th>Kecamatan</th>
                <th>Tier Prioritas</th>
                <th>Skor Komposit</th>
                <th>Kebakaran 2023</th>
                <th>Overlay KDE Eksploratif</th>
                <th>Gap Jaringan 5 km</th>
                <th>Paparan Penduduk</th>
              </tr>
            </thead>
            <tbody>
              ${filteredZones
                .map((z) => {
                  const meta = getTierMeta(z.priority_tier);
                  const kdePctText = typeof z.kde_exploratory_coverage_pct === "number"
                    ? `${z.kde_exploratory_coverage_pct.toFixed(1)}%`
                    : "0.0%";
                  return `
                <tr data-interactive="true" data-area-code="${escapeHtml(z.area_code)}" tabindex="0" class="${state.selectedCode === z.area_code ? "is-selected" : ""}">
                  <td class="mono tabular"><strong>#${escapeHtml(z.priority_rank ?? "-")}</strong></td>
                  <td class="mono">${escapeHtml(z.area_code)}</td>
                  <td><strong>${escapeHtml(z.area_name)}</strong></td>
                  <td><span class="priority-tier-pill" style="--tier-color: ${meta.fillColor};">${escapeHtml(z.priority_tier)}</span></td>
                  <td class="mono tabular"><strong>${z.composite_score !== null ? Number(z.composite_score).toFixed(3) : "Parsial"}</strong></td>
                  <td class="mono tabular">${Number(z.hotspot_score).toFixed(3)} (${services.format.number(z.incidents_2023)})</td>
                  <td class="mono tabular">${kdePctText}${Number(z.kde_exploratory_max_rank || 0) > 0 ? ` (K${z.kde_exploratory_max_rank})` : ""}</td>
                  <td class="mono tabular">${z.coverage_gap_score !== null ? Number(z.coverage_gap_score).toFixed(3) : "-"}</td>
                  <td class="mono tabular">${Number(z.population_exposure_score).toFixed(3)}</td>
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

    function syncView(fitExtent = false) {
      const w = state.activeWeights;
      activeWeightsTextEl.textContent = `${Math.round(w.hotspot_intensity * 100)}% / ${Math.round(w.coverage_gap * 100)}% / ${Math.round(w.population_exposure * 100)}%`;
      topDistrictEl.textContent = state.activeZones[0]
        ? `${state.activeZones[0].area_name} (${Number(state.activeZones[0].composite_score || 0).toFixed(3)})`
        : "-";
      simBadgeEl.hidden = !state.isSimulation;

      const filtered = filterPriorityZones(state.activeZones, {
        tier: state.tier,
        search: state.search
      });
      if (!state.selectedCode || !filtered.some((z) => z.area_code === state.selectedCode)) {
        state.selectedCode = filtered[0]?.area_code || null;
      }
      const selected = filtered.find((z) => z.area_code === state.selectedCode) || null;
      renderMap(filtered, fitExtent);
      renderChart(filtered);
      renderTable(filtered);
      updateDetail(selected);
    }

    function getBaseScenarioZones() {
      return state.scenarioMode === "multi_station" && multiZones ? multiZones : dataset.zones || [];
    }

    function applyWhatIfWeights() {
      const candidate = {
        hotspot_intensity: Number(wHotspotInput.value) / 100,
        coverage_gap: Number(wGapInput.value) / 100,
        population_exposure: Number(wPopInput.value) / 100
      };
      try {
        const valid = validateWeights(candidate);
        state.activeWeights = valid;
        state.activeZones = recalculatePriorityScores(getBaseScenarioZones(), valid);
        state.isSimulation =
          Math.abs(valid.hotspot_intensity - baseWeights.hotspot_intensity) > 1e-4 ||
          Math.abs(valid.coverage_gap - baseWeights.coverage_gap) > 1e-4 ||
          Math.abs(valid.population_exposure - baseWeights.population_exposure) > 1e-4;
        weightFeedbackEl.style.color = "var(--color-river-text)";
        weightFeedbackEl.textContent = state.isSimulation
          ? "Simulasi what-if diterapkan. Peringkat diperbarui tanpa mengubah bobot standar metode."
          : "Menggunakan bobot standar metode (40% / 35% / 25%).";
        syncView(false);
      } catch (err) {
        weightFeedbackEl.style.color = "var(--color-ember-hover)";
        weightFeedbackEl.textContent = err.message;
      }
    }

    function resetWeights() {
      wHotspotInput.value = String(Math.round(baseWeights.hotspot_intensity * 100));
      wGapInput.value = String(Math.round(baseWeights.coverage_gap * 100));
      wPopInput.value = String(Math.round(baseWeights.population_exposure * 100));
      state.activeWeights = { ...baseWeights };
      state.activeZones = [...getBaseScenarioZones()];
      state.isSimulation = false;
      weightFeedbackEl.style.color = "var(--color-ink-muted)";
      weightFeedbackEl.textContent = "Bobot dikembalikan ke standar metode (40% / 35% / 25%).";
      syncView(false);
    }

    function resetFilters() {
      state.scenarioMode = "baseline";
      state.tier = "semua";
      state.search = "";
      if (scenarioSel) scenarioSel.value = "baseline";
      tierSel.value = "semua";
      searchInput.value = "";
      state.activeZones = recalculatePriorityScores(getBaseScenarioZones(), state.activeWeights);
      syncView(true);
    }

    if (scenarioSel) {
      scenarioSel.addEventListener("change", () => {
        state.scenarioMode = scenarioSel.value === "multi_station" && multiZones ? "multi_station" : "baseline";
        state.activeZones = state.isSimulation
          ? recalculatePriorityScores(getBaseScenarioZones(), state.activeWeights)
          : [...getBaseScenarioZones()];
        syncView(false);
      }, { signal: ac.signal });
    }
    tierSel.addEventListener("change", () => {
      state.tier = tierSel.value;
      syncView(false);
    }, { signal: ac.signal });
    searchInput.addEventListener("input", () => {
      state.search = searchInput.value;
      syncView(false);
    }, { signal: ac.signal });
    resetFilterBtn.addEventListener("click", resetFilters, { signal: ac.signal });
    applyWeightsBtn.addEventListener("click", applyWhatIfWeights, { signal: ac.signal });
    resetWeightsBtn.addEventListener("click", resetWeights, { signal: ac.signal });

    syncView(true);

    currentCleanup = async function cleanupWorkspace() {
      ac.abort();
      districtLayerGroup.clearLayers();
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

export const renderPriorityPlannerPlaceholder = renderPriorityPlanner;
