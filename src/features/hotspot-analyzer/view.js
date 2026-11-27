import L from "leaflet";
import { renderStatePanel } from "../../components/state-panel.js";
import {
  BOUNDARY_PROVENANCE,
  HOTSPOT_TIER_CONFIG,
  filterHotspotZones,
  getHotspotTierMeta,
  loadHotspotZones
} from "./service.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getStatusBadgeClass(sourceMode, dataLabel) {
  const normalizedLabel = String(dataLabel ?? "").trim().toUpperCase();
  if (sourceMode === "verified" || normalizedLabel === "TERVERIFIKASI") {
    return "status-badge--active";
  }
  return "status-badge--dev";
}

function formatQuantileSummary(classificationDetails) {
  const breaks = classificationDetails?.breaks;
  if (!breaks) return "";
  return `P25=${Number(breaks.p25).toExponential(2)}, P50=${Number(breaks.p50).toExponential(2)}, P75=${Number(breaks.p75).toExponential(2)}`;
}

export async function renderHotspotAnalyzer({ container, services, manifest }) {
  let currentCleanup = null;
  let outerMounted = true;

  async function mountWorkspace() {
    if (typeof document !== "undefined" && typeof container.replaceChildren === "function") {
      container.replaceChildren(
        renderStatePanel({
          variant: "loading",
          title: "Memuat analisis Fire Hotspot Analyzer",
          message: "Memeriksa ketersediaan output KDE terverifikasi dan batas administrasi Kota Medan..."
        })
      );
    }

    let dataset = null;
    try {
      dataset = await loadHotspotZones(services);
    } catch (err) {
      if (!outerMounted) return;
      container.replaceChildren(
        renderStatePanel({
          variant: "error",
          title: "Data Fire Hotspot Analyzer gagal dimuat",
          message: err.message || "Berkas data hotspot-analyzer tidak tersedia.",
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

    const ac = new AbortController();
    const analysis = dataset.analysis || {};
    const boundaryProv = dataset.boundaryProvenance || BOUNDARY_PROVENANCE;
    const state = {
      densityTier: "semua",
      search: "",
      selectedZoneId: dataset.zones[0]?.zone_id || null
    };

    const totalAreaKm2 = dataset.zones.reduce((sum, z) => sum + Number(z.area_km2 || 0), 0);
    const isVerified = dataset.sourceMode === "verified";
    const datasetBadgeClass = getStatusBadgeClass(dataset.sourceMode, dataset.dataLabel);
    const statusMode = isVerified ? "verified" : "exploratory";
    const statusBadgeText = isVerified
      ? `${dataset.dataLabel} (Data Resmi)`
      : `EKSPLORATIF (${services.format.number(analysis.incident_count_used || 22)} Titik OSM)`;
    const moduleBadgeText = isVerified
      ? "Output KDE Terverifikasi"
      : "Mode Eksploratif Aktif (Titik Resmi: 0)";
    const moduleBadgeClass = isVerified ? "status-badge--active" : "status-badge--dev";
    const noticeBannerClass = isVerified
      ? "notice-banner"
      : "notice-banner notice-banner--warn";
    const invalidCount = Array.isArray(dataset.invalidZones) ? dataset.invalidZones.length : 0;
    const rejectedOfficial = dataset.verifiedLoadStatus === "rejected";
    const quantileSummary = formatQuantileSummary(analysis.classification_details);
    const excludedCount = Number(analysis.excluded_count || 0);

    container.innerHTML = `
      <div class="hotspot-workspace">
        <section class="page-header">
          <div>
            <h1>${escapeHtml(manifest.title)}</h1>
            <p class="page-lead">
              Analisis konsentrasi spasial historis kejadian kebakaran Kota Medan menggunakan metode <strong>Kernel Density Estimation (KDE)</strong> pada CRS <code class="mono">EPSG:32647</code>. Memisahkan secara tegas <strong>Analisis Resmi Damkarmat (0 titik individual)</strong> dari <strong>Analisis Eksploratif Publik</strong>.
            </p>
          </div>
          <div class="hotspot-header-badges">
            <span class="status-badge ${moduleBadgeClass}">${escapeHtml(moduleBadgeText)}</span>
            <span class="status-badge ${datasetBadgeClass}" id="hotspot-data-status-badge" data-status-mode="${statusMode}">${escapeHtml(statusBadgeText)}</span>
          </div>
        </section>

        <div class="${noticeBannerClass}" id="hotspot-data-notice" role="region" aria-label="Pemberitahuan status data KDE">
          <strong>${isVerified ? "ANALISIS RESMI:" : "ANALISIS EKSPLORATIF PUBLIK (BUKAN DATA RESMI):"}</strong> ${escapeHtml(dataset.notice)}
          ${
            !isVerified && excludedCount > 0
              ? ` Sebanyak <strong>${services.format.number(excludedCount)}</strong> catatan insiden bergranularitas kecamatan (<code class="mono">district_only</code>) dikeluarkan secara eksplisit dari perhitungan KDE agar tidak menghasilkan titik buatan.`
              : ""
          }
        </div>

        ${
          !isVerified
            ? `<div class="notice-banner" role="note">
                <strong>Analisis Utama (Data Resmi Damkarmat):</strong> Jumlah titik individual terverifikasi resmi saat ini <strong class="mono">0 titik</strong> (arsip resmi tersedia dalam format agregat 21 kecamatan/bulanan). Peta di bawah menampilkan KDE eksploratif dari ${services.format.number(analysis.incident_count_used || 22)} lokasi ruas OSM terdokumentasi publik.
              </div>`
            : ""
        }

        ${
          rejectedOfficial
            ? `<div class="notice-banner notice-banner--warn" id="hotspot-verified-rejected-banner" data-verified-rejected="true" role="alert">
                <strong>Output resmi ditolak:</strong> Berkas <code>/data/hotspot-analyzer.verified.geojson</code> gagal memenuhi validasi kontrak (${escapeHtml(
                  (dataset.verifiedValidationErrors || []).slice(0, 3).join("; ")
                )}). Menampilkan layer eksploratif yang tervalidasi.
              </div>`
            : ""
        }

        ${
          dataset.boundaryError
            ? `<div class="notice-banner notice-banner--warn" role="alert">
                <strong>Validasi Batas Wilayah:</strong> ${escapeHtml(dataset.boundaryError)}
              </div>`
            : ""
        }

        ${
          invalidCount > 0
            ? `<div class="notice-banner notice-banner--warn" role="status">
                <strong>Validasi Kelas Kepadatan:</strong> ${invalidCount} fitur zona memiliki kelas kepadatan tidak dikenali dan dikeluarkan dari visualisasi.
              </div>`
            : ""
        }

        <section class="hotspot-metrics" aria-label="Ringkasan parameter dan hasil analisis KDE">
          <div class="metric-box">
            <div class="metric-label">Total Zona Teridentifikasi</div>
            <div class="metric-value">${services.format.number(dataset.zones.length)} Zona</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Total Luas Zona Hotspot</div>
            <div class="metric-value">${totalAreaKm2.toFixed(2)} km²</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Kernel &amp; Bandwidth KDE</div>
            <div class="metric-value metric-value--meta">${escapeHtml(analysis.kernel_method || "Quartic")} (${services.format.number(analysis.bandwidth_meters || 1000)} m, piksel ${services.format.number(analysis.pixel_size_meters || 100)} m)</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Titik Digunakan &amp; CRS</div>
            <div class="metric-value metric-value--meta">${services.format.number(analysis.incident_count_used || 0)} titik (${escapeHtml(analysis.working_crs || "EPSG:32647")} ke EPSG:4326)</div>
          </div>
        </section>

        <section class="panel" aria-label="Filter zona hotspot">
          <div class="hotspot-filter-bar">
            <div class="field">
              <label for="hotspot-filter-tier">Kelas Kepadatan Hotspot</label>
              <select id="hotspot-filter-tier">
                <option value="semua">Semua Kelas Kepadatan</option>
                <option value="very-high">Kepadatan Sangat Tinggi</option>
                <option value="high">Kepadatan Tinggi</option>
                <option value="medium">Kepadatan Sedang</option>
                <option value="low">Kepadatan Rendah</option>
              </select>
            </div>
            <div class="field">
              <label for="hotspot-filter-search">Cari ID atau Label Zona</label>
              <input id="hotspot-filter-search" type="search" placeholder="Contoh: hotspot-1 atau Tinggi" />
            </div>
            <div>
              <button type="button" class="btn btn-secondary" id="hotspot-filter-reset">Reset Filter</button>
            </div>
          </div>
        </section>

        <div class="split-layout split-layout--map-lead">
          <section class="panel map-card">
            <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2);">
              <h2>Peta Poligon Konsentrasi Hotspot (${escapeHtml(dataset.dataLabel)})</h2>
              <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">Output Web: EPSG:4326</span>
            </div>
            <div class="map-canvas" id="hotspot-map" role="region" aria-label="Peta zona hotspot kebakaran Kota Medan"></div>
            <div class="map-legend">
              <span class="legend-item"><span class="legend-swatch" style="background: ${HOTSPOT_TIER_CONFIG["very-high"].fillColor};"></span> Kepadatan Sangat Tinggi</span>
              <span class="legend-item"><span class="legend-swatch" style="background: ${HOTSPOT_TIER_CONFIG.high.fillColor};"></span> Kepadatan Tinggi</span>
              <span class="legend-item"><span class="legend-swatch" style="background: ${HOTSPOT_TIER_CONFIG.medium.fillColor};"></span> Kepadatan Sedang</span>
              <span class="legend-item"><span class="legend-swatch" style="background: ${HOTSPOT_TIER_CONFIG.low.fillColor};"></span> Kepadatan Rendah</span>
              <span class="legend-item"><span class="legend-swatch" style="background: transparent; border: 1.5px solid #6E7A7D;"></span> Batas Kecamatan Medan (OSM Fallback)</span>
            </div>
            <div class="provenance-bar">
              <span>Analisis Spasial: QGIS KDE (${escapeHtml(analysis.working_crs || "EPSG:32647")})</span>
              <span>Batas Wilayah: ${escapeHtml(boundaryProv.attribution)} (${escapeHtml(boundaryProv.license)}, fallback non-resmi)</span>
              <span>Konsentrasi historis (bukan prediksi masa depan)</span>
            </div>
          </section>

          <aside style="display: flex; flex-direction: column; gap: var(--space-4);">
            <section class="panel" aria-live="polite">
              <h2>Detail Zona Terpilih</h2>
              <p style="font-size: var(--text-sm); color: var(--color-ink-muted); margin-bottom: var(--space-2);">
                Klik poligon zona di peta atau baris pada tabel untuk melihat atribut spasialnya.
              </p>
              <dl class="detail-kv" id="hotspot-zone-detail"></dl>
            </section>

            <section class="panel">
              <h3 style="margin-bottom: var(--space-2);">Metadata &amp; Parameter KDE</h3>
              <dl class="detail-kv" id="hotspot-metadata-kv">
                <dt>Judul Analisis</dt><dd>${escapeHtml(analysis.title || "-")}</dd>
                <dt>Sumber Data</dt><dd>${escapeHtml(analysis.source || "-")}</dd>
                <dt>Periode Data</dt><dd class="mono">${escapeHtml(analysis.period_label || "-")}</dd>
                <dt>Metode &amp; Kernel</dt><dd class="mono">KDE (${escapeHtml(analysis.kernel_method || "Quartic")})</dd>
                <dt>Bandwidth</dt><dd class="mono">${services.format.number(analysis.bandwidth_meters || 1500)} meter</dd>
                <dt>Resolusi Piksel</dt><dd class="mono">${services.format.number(analysis.pixel_size_meters || 100)} meter</dd>
                <dt>CRS Pengolahan</dt><dd class="mono">${escapeHtml(analysis.working_crs || "EPSG:32647")} ke EPSG:4326</dd>
                <dt>Metode Klasifikasi</dt><dd>${escapeHtml(analysis.classification_method || "Quantile (4 kelas)")}</dd>
                ${quantileSummary ? `<dt>Ambang Quantile</dt><dd class="mono">${escapeHtml(quantileSummary)}</dd>` : ""}
                <dt>Titik Digunakan</dt><dd class="mono">${services.format.number(analysis.incident_count_used || 0)} titik</dd>
                ${excludedCount > 0 ? `<dt>Dikecualikan (district_only)</dt><dd class="mono">${services.format.number(excludedCount)} kejadian</dd>` : ""}
                <dt>Batas Wilayah</dt><dd>${escapeHtml(boundaryProv.source)} (bukan batas resmi Pemko Medan)</dd>
              </dl>
              <div class="detail-qa-note">
                <strong>Aturan Kualitas Data:</strong> Analisis resmi hanya menerima titik terverifikasi Damkarmat (<code class="mono">exact_verified</code> / <code class="mono">address_geocoded_verified</code>). Pada mode eksploratif publik, hanya titik berkoordinat ruas OSM di dalam poligon Kota Medan yang diproses, sedangkan insiden <code class="mono">district_only</code> tetap dipisahkan.
              </div>
            </section>
          </aside>
        </div>

        <section class="panel">
          <h2>Perbandingan Luas Area Zona Hotspot (km²)</h2>
          <p class="chart-empty-note" id="hotspot-chart-empty" hidden>
            Tidak ada zona hotspot yang cocok dengan filter aktif.
          </p>
          <div class="chart-frame" id="hotspot-chart-frame">
            <canvas id="hotspot-chart" aria-label="Grafik luas zona hotspot kebakaran"></canvas>
          </div>
        </section>

        <section class="panel">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-3);">
            <h2>Daftar Zona Konsentrasi Hotspot (${escapeHtml(dataset.dataLabel)})</h2>
            <span class="mono" id="hotspot-table-count" style="font-size: var(--text-xs); color: var(--color-ink-muted);"></span>
          </div>
          <div id="hotspot-table-wrap"></div>
        </section>
      </div>
    `;

    const tierSel = container.querySelector("#hotspot-filter-tier");
    const searchInput = container.querySelector("#hotspot-filter-search");
    const resetBtn = container.querySelector("#hotspot-filter-reset");
    const detailEl = container.querySelector("#hotspot-zone-detail");
    const chartEmptyEl = container.querySelector("#hotspot-chart-empty");
    const chartFrameEl = container.querySelector("#hotspot-chart-frame");
    const chartCanvas = container.querySelector("#hotspot-chart");
    const tableCountEl = container.querySelector("#hotspot-table-count");
    const tableWrapEl = container.querySelector("#hotspot-table-wrap");

    const mapHandle = services.maps.createMap(container.querySelector("#hotspot-map"));
    const boundaryLayerGroup = L.layerGroup().addTo(mapHandle.map);
    const hotspotLayerGroup = L.layerGroup().addTo(mapHandle.map);

    let chartHandle = null;
    let zonesGeoLayer = null;
    let activeZonesSnapshot = [];

    if (dataset.districtsGeoJson) {
      L.geoJSON(dataset.districtsGeoJson, {
        style: {
          color: "#6E7A7D",
          weight: 1,
          fillColor: "#ECEAE2",
          fillOpacity: 0.15
        },
        onEachFeature: (feature, layer) => {
          const distName = feature?.properties?.district_name;
          if (distName) {
            layer.bindTooltip(escapeHtml(distName), { sticky: true });
          }
        }
      }).addTo(boundaryLayerGroup);
    }

    function updateDetail(zone) {
      if (!zone) {
        detailEl.innerHTML = `<dt>Status</dt><dd>Tidak ada zona terpilih</dd>`;
        return;
      }
      const badgeClass = getStatusBadgeClass(dataset.sourceMode, zone.dataLabel);
      detailEl.innerHTML = `
        <dt>ID Zona</dt><dd class="mono">${escapeHtml(zone.zone_id)}</dd>
        <dt>Kelas Kepadatan</dt><dd><span class="hotspot-tier-pill" style="--tier-color: ${zone.tierMeta.fillColor};">${escapeHtml(zone.tierMeta.label)}</span> (${escapeHtml(zone.density_class)})</dd>
        <dt>Peringkat Kepadatan</dt><dd class="mono">${escapeHtml(zone.density_rank)} / 4</dd>
        <dt>Luas Area Poligon</dt><dd class="mono tabular">${zone.area_km2.toFixed(2)} km²</dd>
        <dt>Status Data</dt><dd><span class="status-badge ${badgeClass}">${escapeHtml(zone.dataLabel)}</span></dd>
        <dt>Interpretasi</dt><dd>Konsentrasi historis kejadian kebakaran (bukan prediksi)</dd>
      `;
    }

    function selectZone(zoneId) {
      state.selectedZoneId = zoneId;
      const found = activeZonesSnapshot.find((z) => z.zone_id === zoneId) || null;
      updateDetail(found);

      tableWrapEl.querySelectorAll("tr[data-zone-id]").forEach((tr) => {
        tr.classList.toggle("is-selected", tr.getAttribute("data-zone-id") === zoneId);
      });

      if (zonesGeoLayer) {
        zonesGeoLayer.setStyle((feature) => {
          const id = feature?.properties?.zone_id;
          const meta = getHotspotTierMeta(
            feature?.properties?.density_rank,
            feature?.properties?.density_class
          );
          const isSelected = id === zoneId;
          return {
            color: isSelected ? "#202A2D" : meta.strokeColor,
            weight: isSelected ? 3 : 1.5,
            fillColor: meta.fillColor,
            fillOpacity: isSelected ? 0.85 : 0.62
          };
        });
      }
    }

    function renderMapZones(filteredZones, fitExtent = false) {
      hotspotLayerGroup.clearLayers();
      zonesGeoLayer = null;

      if (!filteredZones.length) return;

      const featureCollection = {
        type: "FeatureCollection",
        features: filteredZones.map((z) => z.feature)
      };

      zonesGeoLayer = L.geoJSON(featureCollection, {
        style: (feature) => {
          const id = feature?.properties?.zone_id;
          const meta = getHotspotTierMeta(
            feature?.properties?.density_rank,
            feature?.properties?.density_class
          );
          const isSelected = id === state.selectedZoneId;
          return {
            color: isSelected ? "#202A2D" : meta.strokeColor,
            weight: isSelected ? 3 : 1.5,
            fillColor: meta.fillColor,
            fillOpacity: isSelected ? 0.85 : 0.62
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature?.properties || {};
          const zId = String(props.zone_id || "");
          const meta = getHotspotTierMeta(props.density_rank, props.density_class);
          layer.bindPopup(
            `<strong>${escapeHtml(zId)}</strong><br/>` +
              `Kelas: ${escapeHtml(meta.label)} (${escapeHtml(props.density_class || "-")})<br/>` +
              `Luas: ${Number(props.area_km2 || 0).toFixed(2)} km²<br/>` +
              `<em>Status: ${escapeHtml(props.dataLabel || dataset.dataLabel)}</em>`
          );
          layer.on("click", () => selectZone(zId));
        }
      }).addTo(hotspotLayerGroup);

      if (fitExtent) {
        services.maps.fitBounds(mapHandle.map, zonesGeoLayer);
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

      chartHandle = services.charts.createChart(chartCanvas, {
        type: "bar",
        data: {
          labels: filteredZones.map((z) => `${z.zone_id} (${z.tierMeta.label})`),
          datasets: [
            {
              label: "Luas Zona Hotspot (km²)",
              data: filteredZones.map((z) => z.area_km2),
              backgroundColor: filteredZones.map((z) => z.tierMeta.fillColor),
              borderColor: filteredZones.map((z) => z.tierMeta.strokeColor),
              borderWidth: 1.5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: "Luas (km²)" }
            }
          }
        }
      });
    }

    function renderTable(filteredZones) {
      tableCountEl.textContent = `${filteredZones.length} zona`;

      if (!filteredZones.length) {
        tableWrapEl.replaceChildren(
          renderStatePanel({
            variant: "empty",
            title: "Tidak ada zona hotspot yang cocok",
            message: "Ubah filter kelas kepadatan atau kata kunci pencarian.",
            actionLabel: "Reset Filter",
            onAction: resetFilters
          })
        );
        return;
      }

      tableWrapEl.innerHTML = `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID Zona</th>
                <th>Kelas Kepadatan</th>
                <th>Peringkat</th>
                <th>Luas Area (km²)</th>
                <th>CRS Output</th>
                <th>Status Data</th>
              </tr>
            </thead>
            <tbody>
              ${filteredZones
                .map((z) => {
                  const rowBadgeClass = getStatusBadgeClass(dataset.sourceMode, z.dataLabel);
                  return `
                <tr data-interactive="true" data-zone-id="${escapeHtml(z.zone_id)}" tabindex="0" class="${state.selectedZoneId === z.zone_id ? "is-selected" : ""}">
                  <td class="mono"><strong>${escapeHtml(z.zone_id)}</strong></td>
                  <td><span class="hotspot-tier-pill" style="--tier-color: ${z.tierMeta.fillColor};">${escapeHtml(z.tierMeta.label)}</span></td>
                  <td class="mono tabular">${escapeHtml(z.density_rank)}</td>
                  <td class="mono tabular">${z.area_km2.toFixed(2)}</td>
                  <td class="mono">EPSG:4326</td>
                  <td><span class="status-badge ${rowBadgeClass}">${escapeHtml(z.dataLabel)}</span></td>
                </tr>
              `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;

      tableWrapEl.querySelectorAll("tr[data-zone-id]").forEach((tr) => {
        const pick = () => selectZone(tr.getAttribute("data-zone-id"));
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
      const filtered = filterHotspotZones(dataset.zones, {
        densityTier: state.densityTier,
        search: state.search
      });
      activeZonesSnapshot = filtered;

      if (!state.selectedZoneId || !filtered.some((z) => z.zone_id === state.selectedZoneId)) {
        state.selectedZoneId = filtered[0]?.zone_id || null;
      }

      const selected = filtered.find((z) => z.zone_id === state.selectedZoneId) || null;
      renderMapZones(filtered, fitExtent);
      renderChart(filtered);
      renderTable(filtered);
      updateDetail(selected);
    }

    function resetFilters() {
      state.densityTier = "semua";
      state.search = "";
      tierSel.value = "semua";
      searchInput.value = "";
      syncView(true);
    }

    tierSel.addEventListener(
      "change",
      () => {
        state.densityTier = tierSel.value;
        syncView(true);
      },
      { signal: ac.signal }
    );

    searchInput.addEventListener(
      "input",
      () => {
        state.search = searchInput.value;
        syncView(false);
      },
      { signal: ac.signal }
    );

    resetBtn.addEventListener("click", resetFilters, { signal: ac.signal });

    syncView(true);

    currentCleanup = async function cleanupWorkspace() {
      ac.abort();
      boundaryLayerGroup.clearLayers();
      hotspotLayerGroup.clearLayers();
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

export const renderHotspotPlaceholder = renderHotspotAnalyzer;
