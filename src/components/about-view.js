import { FEATURE_REGISTRY, FEATURE_STATUS_META } from "../core/feature-registry.js";
import { renderStatePanel } from "./state-panel.js";

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

  container.innerHTML = `
    <section class="page-header">
      <div>
        <h1>Tentang Proyek &amp; Sumber Data</h1>
        <p class="page-lead">
          FireReach Medan memetakan kejadian kebakaran dan mengevaluasi jangkauan layanan pemadam kebakaran di Kota Medan menggunakan data publik terverifikasi dan pemrosesan GIS terbuka.
        </p>
      </div>
      <span class="status-badge ${services.supabase.isConfigured ? "status-badge--active" : "status-badge--local"}">
        <span aria-hidden="true">${services.supabase.isConfigured ? "[+]" : "[o]"}</span>
        <span>${services.supabase.statusLabel}</span>
      </span>
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
          <strong>Status Supabase:</strong> ${services.supabase.note}
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
                  <strong>${ds.title}</strong>
                  <div class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">
                    SHA-256: ${ds.sha256 ? ds.sha256.slice(0, 14) + "..." : "-"}
                  </div>
                </td>
                <td>${ds.publisher}</td>
                <td>${ds.period}</td>
                <td><code class="mono">${ds.granularity}</code></td>
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
                <td><strong>${b.source}</strong></td>
                <td><code class="mono" style="font-size: var(--text-xs);">${b.url}</code></td>
                <td>${b.reason}</td>
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
