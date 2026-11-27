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

function resolveDatasetLicense(ds) {
  if (ds?.license) return ds.license;
  if (String(ds?.publisher || "").includes("BPBD")) return "Portal Satu Data Medan (Pembanding BPBD)";
  if (String(ds?.publisher || "").includes("Statistik")) return "BPS / Portal Satu Data Medan";
  return "Portal Satu Data Medan Open Data";
}

function renderBadgeDot(variant) {
  const color = variant === "active" ? "currentColor" : "currentColor";
  if (variant === "active" || variant === "[+]") {
    return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4 6.4 11.6 12.8 4.8" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (variant === "warn" || variant === "[!]") {
    return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 14.2 13.4H1.8L8 2.2Zm0 4.3v3.2m0 1.8h.01" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
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
          ${renderBadgeDot(services.supabase.isConfigured ? "active" : "local")}
          <span>Koneksi: ${escapeHtml(services.supabase.statusLabel)}</span>
        </span>
        <span
          class="status-badge ${sourceMeta.badgeClass}"
          id="about-data-source-badge"
          title="${escapeHtml(sourceMeta.title)}"
        >
          <span data-role="marker" aria-hidden="true">${renderBadgeDot(sourceMeta.marker)}</span>
          <span data-role="label">${escapeHtml(sourceMeta.label)}</span>
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
                    <td><strong>${escapeHtml(feat.owner)}</strong></td>
                    <td>${escapeHtml(feat.title)}</td>
                    <td>
                      <span class="status-badge ${meta.badgeClass}">
                        ${renderBadgeDot(meta.marker)}
                        <span>${escapeHtml(meta.label)}</span>
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
          <strong>Standar CRS:</strong> Analisis jarak, luas, jaringan jalan, dan kepadatan metrik dijalankan pada <code class="mono">${escapeHtml(manifest.crs_metric)}</code> (UTM Zone 47N), sedangkan penyimpanan PostGIS dan pertukaran GeoJSON web memakai <code class="mono">${escapeHtml(manifest.crs_web)}</code>.
        </p>
        <p style="font-size: var(--text-sm); margin-bottom: var(--space-2);">
          <strong>Atribusi &amp; Lisensi Peta:</strong> Batas kecamatan dan jaringan jalan OpenStreetMap berada di bawah lisensi <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL 1.0</a> (<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap contributors</a>).
        </p>
        <p style="font-size: var(--text-sm); margin-bottom: 0;">
          <strong>Prinsip integritas spasial:</strong> Data agregat kecamatan atau bulanan tidak pernah diubah menjadi titik koordinat palsu, tidak ada scraping atau penyimpanan koordinat Google Maps, dan seluruh lapisan analitik memisahkan data resmi Damkarmat dari pengayaan terdokumentasi publik.
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
              <th>Penerbit &amp; Lisensi</th>
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
                <td>
                  <div>${escapeHtml(ds.publisher)}</div>
                  <div style="font-size: var(--text-xs); color: var(--color-ink-muted);">${escapeHtml(resolveDatasetLicense(ds))}</div>
                </td>
                <td>${escapeHtml(ds.period)}</td>
                <td><code class="mono">${escapeHtml(ds.granularity)}</code></td>
                <td class="mono tabular">${services.format.number(ds.record_count)}</td>
                  <td>
                    <span class="status-badge ${ds.status === "verified" ? "status-badge--active" : "status-badge--dev"}">
                      ${renderBadgeDot(ds.status === "verified" ? "active" : "dev")}
                      <span>${ds.status === "verified" ? "Terverifikasi" : "Fallback OSM"}</span>
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
          <h2>Pengayaan Terdokumentasi Publik (Terpisah dari Rekap Resmi)</h2>
          <span class="status-badge status-badge--dev">${renderBadgeDot("dev")}<span>needs_review (Katalog Publik)</span></span>
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
                    <div class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted); overflow-wrap: anywhere;">
                      SHA-256: ${item.sha256 ? escapeHtml(item.sha256.slice(0, 14)) + "..." : "-"}
                      ${item.path ? ` | <a href="${escapeHtml(item.path)}" target="_blank" rel="noopener noreferrer">Katalog JSON</a>` : ""}
                    </div>
                  </td>
                  <td>${escapeHtml(item.publisher)}</td>
                  <td>${escapeHtml(item.period)}</td>
                  <td class="mono tabular">${services.format.number(item.record_count)}</td>
                  <td><code class="mono">${escapeHtml(item.accuracy_summary)}</code></td>
                  <td><span class="status-badge status-badge--dev">${renderBadgeDot("dev")}<span>${escapeHtml(item.status)}</span></span></td>
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

  const badgeEl = container.querySelector("#about-data-source-badge");
  const markerEl = badgeEl?.querySelector?.('[data-role="marker"]') || null;
  const labelEl = badgeEl?.querySelector?.('[data-role="label"]') || null;
  const noteEl = container.querySelector("#about-active-source-note");

  const unsubscribe =
    typeof services.dataStatus.subscribe === "function"
      ? services.dataStatus.subscribe((nextStatus) => {
          const nextMeta = describeActiveDataSource(nextStatus);
          if (badgeEl) {
            badgeEl.className = `status-badge ${nextMeta.badgeClass}`;
            badgeEl.title = nextMeta.title;
          }
          if (markerEl) markerEl.innerHTML = renderBadgeDot(nextMeta.marker);
          if (labelEl) labelEl.textContent = nextMeta.label;
          if (noteEl) {
            const reasonText =
              (nextStatus?.isStaleFallback || nextStatus?.isFallback) && nextStatus?.reason
                ? ` (${nextStatus.reason})`
                : "";
            noteEl.innerHTML = `<strong>Sumber Data Aktif:</strong> ${escapeHtml(nextMeta.label)}${escapeHtml(reasonText)}`;
          }
        })
      : () => {};

  return async function unmount() {
    unsubscribe();
  };
}
