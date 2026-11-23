import { FEATURE_REGISTRY, FEATURE_STATUS_META } from "../core/feature-registry.js";
import { describeActiveDataSource } from "../core/data-status.js";
import { renderStatePanel } from "./state-panel.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function renderAbout({ container, services, navigate }) {
  const manifestResp = await services.dataStatus.getManifest();
  if (!manifestResp.ok) {
    container.replaceChildren(
      renderStatePanel({
        variant: "error",
        title: "Gagal memuat katalog sumber data",
        message: manifestResp.error,
        actionLabel: "Coba Muat Ulang",
        onAction: async () => {
          await services.dataStatus.refresh();
          navigate("/about");
        }
      })
    );
    return async () => {};
  }

  const { manifest } = manifestResp;
  const snapshotStatus =
    services.dataStatus.getSnapshotStatus?.() || {
      mode: services.supabase.isConfigured ? "supabase_pending" : "local",
      isStaleFallback: false,
      reason: null
    };
  const sourceMeta = describeActiveDataSource(snapshotStatus);

  container.innerHTML = `
    <section class="page-header">
      <div>
        <h1>Tentang Proyek &amp; Sumber Data</h1>
        <p class="page-lead">
          FireReach Medan memetakan kejadian kebakaran dan mengevaluasi jangkauan layanan pemadam kebakaran di Kota Medan menggunakan data publik terverifikasi dan pemrosesan GIS terbuka.
        </p>
      </div>
      <div class="header-status-group">
        <span class="status-badge ${services.supabase.isConfigured ? "status-badge--active" : "status-badge--local"}">
          <span aria-hidden="true">${services.supabase.isConfigured ? "[+]" : "[o]"}</span>
          <span>Koneksi: ${escapeHtml(services.supabase.statusLabel)}</span>
        </span>
        <span
          class="status-badge ${sourceMeta.badgeClass}"
          id="about-data-source-badge"
          title="${escapeHtml(sourceMeta.title)}"
        >
          <span aria-hidden="true">${sourceMeta.marker}</span>
          <span>${escapeHtml(sourceMeta.label)}</span>
        </span>
      </div>
    </section>

    <div class="split-layout split-layout--balanced">
      <section class="panel">
        <h2>Pembagian Tanggung Jawab Tim</h2>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Anggota</th>
                <th>Modul</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${FEATURE_REGISTRY.map((feat) => {
                const meta = FEATURE_STATUS_META[feat.status];
                return `
                  <tr>
                    <td><strong>${feat.owner}</strong></td>
                    <td>${feat.title}</td>
                    <td>
                      <span class="status-badge ${meta.badgeClass}">
                        <span aria-hidden="true">${meta.marker}</span>
                        <span>${meta.label}</span>
                      </span>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel-subtle">
        <h2>Koneksi Basis Data &amp; Standar CRS</h2>
        <p style="font-size: var(--text-sm); margin-bottom: var(--space-2);">
          <strong>Status Koneksi Supabase:</strong> ${escapeHtml(services.supabase.note)}
        </p>
        <p style="font-size: var(--text-sm); margin-bottom: var(--space-2);" id="about-active-source-note">
          <strong>Sumber Data Aktif:</strong> ${escapeHtml(sourceMeta.label)}${(snapshotStatus.isStaleFallback || snapshotStatus.isFallback) && snapshotStatus.reason ? ` (${escapeHtml(snapshotStatus.reason)})` : ""}
        </p>
        <p style="font-size: var(--text-sm); margin-bottom: var(--space-2);">
          <strong>Standar CRS:</strong> Analisis jarak, luas, dan kepadatan metrik dijalankan pada <code class="mono">${manifest.crs_metric}</code> (UTM Zone 47N), sedangkan penyimpanan PostGIS dan pertukaran GeoJSON web memakai <code class="mono">${manifest.crs_web}</code>.
        </p>
        <p style="font-size: var(--text-sm); margin-bottom: 0;">
          <strong>Prinsip kejujuran data:</strong> Data agregat kecamatan atau bulanan tidak pernah diubah menjadi titik koordinat palsu. Fixture pengembangan ditandai eksplisit sebagai <code class="mono">DEMO</code>.
        </p>
      </section>
    </div>

    <section class="panel">
      <h2>Register Sumber Data Terverifikasi</h2>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Dataset</th>
              <th>Penerbit</th>
              <th>Periode</th>
              <th>Granularitas</th>
              <th>Jumlah</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${manifest.datasets
              .map(
                (ds) => `
              <tr>
                <td>
                  <strong>${escapeHtml(ds.title)}</strong>
                  <div class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted); overflow-wrap: anywhere;">
                    SHA-256: ${ds.sha256 ? escapeHtml(ds.sha256.slice(0, 14)) + "..." : "-"}
                    ${ds.url ? ` | <a href="${escapeHtml(ds.url)}" target="_blank" rel="noopener noreferrer">Sumber</a>` : ""}
                  </div>
                </td>
                <td>${escapeHtml(ds.publisher)}</td>
                <td>${escapeHtml(ds.period)}</td>
                <td><code class="mono">${escapeHtml(ds.granularity)}</code></td>
                <td class="mono tabular">${services.format.number(ds.record_count)}</td>
                  <td>
                    <span class="status-badge ${ds.status === "verified" ? "status-badge--active" : "status-badge--dev"}">
                      ${ds.status === "verified" ? "Terverifikasi" : "Fallback OSM"}
                    </span>
                  </td>
                </tr>
              `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>

    ${
      manifest.independent_enrichment
        ? `
      <section class="panel">
        <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-2);">
          <h2>Pengayaan Kandidat Independen (Belum Terverifikasi)</h2>
          <span class="status-badge status-badge--dev">[~] needs_review (Terpisah dari Statistik Resmi)</span>
        </div>
        <p style="font-size: var(--text-sm); color: var(--color-ink-muted);">
          ${escapeHtml(manifest.independent_enrichment.scope_note)}
          <a href="/incident-explorer" data-nav="/incident-explorer">Tinjau di Fire Incident Explorer</a>.
        </p>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Kandidat Dataset</th>
                <th>Sumber &amp; Metode</th>
                <th>Periode</th>
                <th>Jumlah</th>
                <th>Akurasi / KDE</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${(manifest.independent_enrichment.datasets || [])
                .map(
                  (item) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(item.title)}</strong>
                    <div class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">
                      SHA-256: ${item.sha256 ? escapeHtml(item.sha256.slice(0, 14)) + "..." : "-"}
                    </div>
                  </td>
                  <td>${escapeHtml(item.publisher)}</td>
                  <td>${escapeHtml(item.period)}</td>
                  <td class="mono tabular">${services.format.number(item.record_count)}</td>
                  <td><code class="mono">${escapeHtml(item.accuracy_summary)}</code></td>
                  <td><span class="status-badge status-badge--dev">[~] ${escapeHtml(item.status)}</span></td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `
        : ""
    }

    <section class="panel">
      <h2>Catatan Pembatasan Akses &amp; Blocker Sumber</h2>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Sumber</th>
              <th>URL</th>
              <th>Keterangan &amp; Tindak Lanjut</th>
            </tr>
          </thead>
          <tbody>
            ${manifest.blockers
              .map(
                (b) => `
              <tr>
                <td><strong>${escapeHtml(b.source)}</strong></td>
                <td><a href="${escapeHtml(b.url)}" target="_blank" rel="noopener noreferrer" class="mono" style="font-size: var(--text-xs); overflow-wrap: anywhere; word-break: break-word;">${escapeHtml(b.url)}</a></td>
                <td>${escapeHtml(b.reason)}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;

  return async function unmount() {};
}
