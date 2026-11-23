import L from "leaflet";
import { FEATURE_REGISTRY, FEATURE_STATUS_META } from "../core/feature-registry.js";
import { renderStatePanel } from "./state-panel.js";

export async function renderDashboard({ container, services, navigate }) {
  let manifestResp = await services.dataStatus.getManifest();
  if (!manifestResp.ok) {
    container.replaceChildren(
      renderStatePanel({
        variant: "error",
        title: "Manifest data tidak dapat dimuat",
        message: `${manifestResp.error}. Periksa ketersediaan berkas /data/manifest.json.`,
        actionLabel: "Muat Ulang Manifest",
        onAction: async () => {
          await services.dataStatus.refresh();
          navigate("/");
        }
      })
    );
    return async () => {};
  }

  let summary = null;
  let geojson = null;
  try {
    const manifestWasSupabase =
      services.dataStatus.getSnapshotStatus?.().snapshotSources?.manifest === "supabase";
    let reloadedManifest = false;
    const reloadLocalManifest = async () => {
      manifestResp = await services.dataStatus.getManifest();
      if (!manifestResp?.ok || !manifestResp.manifest) {
        throw new Error(manifestResp?.error || "Gagal memuat manifest data lokal.");
      }
      reloadedManifest = true;
    };

    summary = await services.dataStatus.fetchJson("fire_incidents_summary.json");
    const afterSummaryStatus = services.dataStatus.getSnapshotStatus?.();
    if (
      manifestWasSupabase &&
      (afterSummaryStatus?.isFallback || afterSummaryStatus?.isStaleFallback)
    ) {
      await reloadLocalManifest();
    }

    const summaryWasSupabase =
      services.dataStatus.getSnapshotStatus?.().snapshotSources?.fire_incidents_summary ===
      "supabase";
    geojson = await services.dataStatus.fetchJson("medan_districts_osm.geojson");
    const afterGeoStatus = services.dataStatus.getSnapshotStatus?.();
    if (afterGeoStatus?.isFallback || afterGeoStatus?.isStaleFallback) {
      if (manifestWasSupabase && !reloadedManifest) {
        await reloadLocalManifest();
      }
      if (summaryWasSupabase) {
        summary = await services.dataStatus.fetchJson("fire_incidents_summary.json");
      }
    }
  } catch (err) {
    container.replaceChildren(
      renderStatePanel({
        variant: "error",
        title: "Sebagian berkas spasial gagal dibaca",
        message: err.message,
        actionLabel: "Coba Lagi",
        onAction: () => navigate("/")
      })
    );
    return async () => {};
  }

  const totals = summary.summary_totals;
  const manifest = manifestResp.manifest;
  const spmList = summary.damkarmat_spm || [];
  const spmService = spmList.find((item) => item.unit === "%");
  const spmResponse = spmList.find((item) => item.unit === "menit");
  const spmServiceText = spmService
    ? `${spmService.realization_value}% (target ${spmService.target_value}%)`
    : "-";
  const spmResponseText = spmResponse
    ? `${spmResponse.realization_value.toFixed(2)} mnt (target ${spmResponse.target_value.toFixed(2)} mnt)`
    : typeof totals.spm_response_time_minutes === "number"
      ? `${totals.spm_response_time_minutes.toFixed(2)} mnt`
      : "-";

  container.innerHTML = `
    <section class="page-header">
      <div>
        <h1>Ringkasan Pemetaan Kebakaran Kota Medan</h1>
        <p class="page-lead">
          Fondasi Web GIS kelompok 3 untuk memantau rekapitulasi kejadian kebakaran resmi, kesiapan data spasial 21 kecamatan, serta status pengembangan empat modul analisis.
        </p>
      </div>
      <a href="/incident-explorer" class="btn btn-primary" data-nav="/incident-explorer">
        Buka Fire Incident Explorer
      </a>
    </section>

    <div class="split-layout split-layout--map-lead">
      <section class="panel map-card">
        <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2);">
          <h2>Peta Wilayah Studi &amp; Agregat Kecamatan 2023</h2>
          <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">
            21 Kecamatan | CRS: EPSG:4326
          </span>
        </div>
        <div class="map-canvas" id="dashboard-map" role="region" aria-label="Peta wilayah studi Kota Medan"></div>
        <div class="map-legend" aria-label="Legenda peta overview">
          <span class="legend-item">
            <span class="legend-swatch" style="background: #F9ECE8;"></span> 1 - 6 kejadian (2023)
          </span>
          <span class="legend-item">
            <span class="legend-swatch" style="background: #D58A43;"></span> 7 - 14 kejadian (2023)
          </span>
          <span class="legend-item">
            <span class="legend-swatch" style="background: #B84A35;"></span> 15 - 21 kejadian (2023)
          </span>
          <span class="legend-item">
            <span class="legend-swatch" style="background: #356067; border-radius: 50%;"></span> Mako 0.0 Damkarmat (Terverifikasi)
          </span>
        </div>
        <div class="provenance-bar">
          <span>Batas wilayah: OpenStreetMap Nominatim (&copy; OpenStreetMap contributors, ODbL)</span>
          <span>Data kejadian: Dinas Damkarmat via Satu Data Medan (agregat kecamatan 2023)</span>
        </div>
      </section>

      <aside style="display: flex; flex-direction: column; gap: var(--space-4);">
        <section class="panel">
          <h2>Ringkasan Data Terverifikasi</h2>
          <p style="font-size: var(--text-sm); color: var(--color-ink-muted);">
            Angka berikut berasal langsung dari arsip resmi yang berhasil diunduh dan divalidasi:
          </p>
          <dl style="display: grid; grid-template-columns: 1fr auto; gap: var(--space-2) var(--space-4); margin: 0;">
            <dt style="font-size: var(--text-sm);">Kejadian Tahun 2025 (agregat bulanan)</dt>
            <dd class="mono tabular" style="margin: 0; font-weight: 700;">${services.format.number(totals.year_2025)}</dd>

            <dt style="font-size: var(--text-sm);">Kejadian Tahun 2024 (agregat bulanan)</dt>
            <dd class="mono tabular" style="margin: 0; font-weight: 700;">${services.format.number(totals.year_2024)}</dd>

            <dt style="font-size: var(--text-sm);">Kejadian Tahun 2023 (21 kecamatan)</dt>
            <dd class="mono tabular" style="margin: 0; font-weight: 700;">${services.format.number(totals.year_2023)}</dd>

            <dt style="font-size: var(--text-sm);">Penduduk Kota Medan 2025 (BPS)</dt>
            <dd class="mono tabular" style="margin: 0; font-weight: 700;">${services.format.number(totals.population_2025_total)}</dd>

            <dt style="font-size: var(--text-sm);">Titik kejadian individual berkoordinat</dt>
            <dd class="mono tabular" style="margin: 0; font-weight: 700;">${services.format.number(totals.individual_geocoded_count)}</dd>

            <dt style="font-size: var(--text-sm);">SPM layanan penyelamatan &amp; evakuasi</dt>
            <dd class="mono tabular" style="margin: 0; font-weight: 700;">${spmServiceText}</dd>

            <dt style="font-size: var(--text-sm);">SPM waktu tanggap (target 15.00 mnt)</dt>
            <dd class="mono tabular" style="margin: 0; font-weight: 700;">${spmResponseText}</dd>

            <dt style="font-size: var(--text-sm);">Penyelamatan non-kebakaran (2023 - 2025, terpisah)</dt>
            <dd class="mono tabular" style="margin: 0; font-weight: 700;">${services.format.number(totals.non_fire_rescues_2023_2025_total || 0)}</dd>

            <dt style="font-size: var(--text-sm);">Kandidat media independen (perlu review, terpisah)</dt>
            <dd class="mono tabular" style="margin: 0; font-weight: 700;">${services.format.number(totals.independent_candidate_incidents_total || 0)} (${services.format.number(totals.independent_candidate_incidents_approximate || 0)} titik ruas)</dd>
          </dl>
        </section>

        <section class="panel-subtle">
          <h3>Catatan Granularitas &amp; Akses</h3>
          <p style="font-size: var(--text-sm); margin-bottom: var(--space-2);">
            Rekapitulasi resmi 2024 dan 2025 pada Satu Data Medan belum mencantumkan koordinat atau kolom kecamatan, sehingga peta di samping hanya menampilkan agregat kecamatan 2023 serta titik Mako 0.0. Enam kandidat pos UPT serta ${services.format.number(totals.independent_candidate_incidents_total || 0)} kandidat media independen berstatus needs_review disimpan terpisah di Fire Incident Explorer.
          </p>
          <p style="font-size: var(--text-xs); color: var(--color-ink-muted); margin-bottom: 0;">
            ${manifest.blockers.length} catatan pembatasan akses tercatat pada halaman <a href="/about" data-nav="/about">Tentang &amp; Sumber Data</a>.
          </p>
        </section>
      </aside>
    </div>

    <section class="panel">
      <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-3);">
        <h2>Status Pengembangan Empat Modul</h2>
        <span style="font-size: var(--text-xs); color: var(--color-ink-muted);">
          Registry modul mengontrol aktivasi fitur tanpa mengklaim modul yang belum selesai.
        </span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Modul</th>
              <th>Penanggung Jawab</th>
              <th>Status</th>
              <th>Fokus Tugas</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${FEATURE_REGISTRY.map((feat) => {
              const meta = FEATURE_STATUS_META[feat.status];
              return `
                <tr>
                  <td><strong>${feat.title}</strong></td>
                  <td>${feat.owner}</td>
                  <td>
                    <span class="status-badge ${meta.badgeClass}">
                      <span aria-hidden="true">${meta.marker}</span>
                      <span>${meta.label}</span>
                    </span>
                  </td>
                  <td>${feat.description}</td>
                  <td>
                    <a href="${feat.route}" class="btn btn-secondary btn-sm" data-nav="${feat.route}">
                      ${feat.status === "coming-soon" ? "Lihat Info" : "Buka Modul"}
                    </a>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;

  const mapContainer = container.querySelector("#dashboard-map");
  const mapHandle = services.maps.createMap(mapContainer);

  function districtColor(count) {
    if (count >= 15) return "#B84A35";
    if (count >= 7) return "#D58A43";
    return "#F9ECE8";
  }

  const districtLayer = services.maps.addGeoJson(mapHandle.map, geojson, {
    style: (feature) => {
      const count = feature?.properties?.incidents_2023 || 0;
      return {
        color: "#202A2D",
        weight: 1.2,
        fillColor: districtColor(count),
        fillOpacity: count >= 15 ? 0.68 : count >= 7 ? 0.58 : 0.65
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindPopup(
        `<strong>${p.district_name}</strong><br/>Kejadian 2023: ${services.format.number(p.incidents_2023)}<br/>Penduduk 2025: ${services.format.number(p.population_2025)}`
      );
    }
  });

  const stationLayer = L.layerGroup().addTo(mapHandle.map);
  for (const st of summary.verified_stations || []) {
    L.circleMarker([st.lat, st.lon], {
      radius: 8,
      color: "#FFFFFF",
      weight: 2,
      fillColor: "#356067",
      fillOpacity: 1
    })
      .bindPopup(`<strong>${st.name}</strong><br/>${st.address}<br/>Status: Terverifikasi`)
      .addTo(stationLayer);
  }

  services.maps.fitBounds(mapHandle.map, districtLayer);

  return async function unmount() {
    mapHandle.destroy();
  };
}
