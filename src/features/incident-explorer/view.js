import L from "leaflet";
import { mountFireResponseSimulation } from "./response-simulation.js";
import { renderStatePanel } from "../../components/state-panel.js";
import {
  CATEGORY_LABELS,
  classifyChoroplethTier,
  computeChoroplethBreaks,
  filterIndependentCandidates,
  filterOfficialRows,
  filterSupabasePoints,
  getDominantCategory,
  loadExplorerDatasets,
  normalizeDistrictName,
  shouldResetMapExtent
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
    return `<span class="status-badge status-badge--active">Terverifikasi Resmi</span>`;
  }
  if (status === "needs_review") {
    return `<span class="status-badge status-badge--dev">Katalog Publik (needs_review)</span>`;
  }
  return `<span class="status-badge status-badge--warn">${escapeHtml(status || "unlocated")}</span>`;
}

function formatSourceLinkLabel(url, fallbackIndex = 1) {
  const raw = String(url || "");
  if (raw.includes("peraturan.bpk.go.id")) {
    return "JDIH BPK (Perwali 25/2018 - historis)";
  }
  if (raw.includes("portal.medan.go.id")) {
    return "Portal Pemko Medan";
  }
  if (raw.includes("medanbelawan.medan.go.id")) {
    return "Kec. Medan Belawan";
  }
  if (raw.includes("metrorakyat.com")) {
    return "Metro Rakyat";
  }
  const antaraMatch = raw.match(/antaranews\.com\/berita\/(\d+)/);
  if (antaraMatch) {
    return `ANTARA Sumut (${antaraMatch[1]})`;
  }
  if (raw.includes("detik.com")) {
    return `Detik Sumut (#${fallbackIndex})`;
  }
  return `Sumber #${fallbackIndex}`;
}

function getRowKey(row, isDemoMode) {
  if (!row) return null;
  return isDemoMode ? row.source_record_id : row.displayLabel;
}

function buildDetailHtml({ row, state, format, categoryLabels }) {
  if (!row) {
    return { html: `<dt>Status</dt><dd>Belum ada baris terpilih</dd>`, qaNote: "", previewType: "umum" };
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

  if (state.period === "2016-2021-bulanan") {
    return {
      html: `
        <dt>Periode</dt><dd>${escapeHtml(row.display_label || row.displayLabel)}</dd>
        <dt>Kejadian Kebakaran (Kota Medan)</dt><dd class="mono tabular">${format.number(row.total_incidents)}</dd>
        <dt>Granularitas</dt><dd class="mono">${escapeHtml(row.granularity)}</dd>
        <dt>Akurasi &amp; Status</dt><dd class="mono">${escapeHtml(row.location_accuracy)} / ${escapeHtml(row.verification_status)}</dd>
        <dt>Geometri</dt><dd class="mono">geom = null</dd>
        <dt>Sumber Data</dt><dd>${escapeHtml(row.source_name || "Satu Data Medan")}</dd>
      `,
      qaNote: "Arsip bulanan 2016 - 2021 tingkat kota (72 baris, total 1.372); tidak merinci kecamatan maupun koordinat individual.",
      previewType: "umum"
    };
  }

  if (state.period === "bpbd-2021-2023") {
    return {
      html: `
        <dt>Kecamatan</dt><dd>${escapeHtml(row.district_name)} <span class="mono">(${escapeHtml(row.area_code)})</span></dd>
        <dt>Kebakaran BPBD 2022</dt><dd class="mono tabular">${format.number(row.fire_incidents)}</dd>
        <dt>Kebakaran BPBD 2021</dt><dd class="mono tabular">${format.number(row.fire_incidents_2021)}</dd>
        <dt>Banjir / Puting Beliung / Longsor (2022)</dt><dd class="mono tabular">${row.flood_events} / ${row.wind_events} / ${row.landslide_events}</dd>
        <dt>Total Bencana BPBD 2022</dt><dd class="mono tabular">${format.number(row.total_disasters)}</dd>
        <dt>Akurasi &amp; Status</dt><dd>${escapeHtml(row.location_accuracy)} / ${renderBadge(row.verification_status)}</dd>
        <dt>Geometri</dt><dd class="mono">Poligon kecamatan (titik = null)</dd>
        <dt>Sumber Data</dt><dd>${escapeHtml(row.source_name || "BPBD Kota Medan")}</dd>
      `,
      qaNote:
        "Data pembanding BPBD (2021: 108 kebakaran vs Damkarmat 207; 2022: 138 vs 216; bulanan 2023: 87 vs 219). Baris JUMLAH BPBD 2022 mencetak tanah longsor 0 meski Medan Tuntungan tercatat 1.",
      previewType: "umum"
    };
  }

  if (state.period === "bpbd-2022-2023-bulanan") {
    return {
      html: `
        <dt>Periode</dt><dd>${escapeHtml(row.display_label || row.displayLabel)}</dd>
        <dt>Tahun / Bulan</dt><dd class="mono">${escapeHtml(row.period_year)} / ${escapeHtml(row.month_name)}</dd>
        <dt>Kebakaran (BPBD)</dt><dd class="mono tabular">${format.number(row.fire_incidents || 0)}</dd>
        <dt>Banjir / Puting Beliung / Longsor</dt><dd class="mono tabular">${row.flood_events || 0} / ${row.wind_events || 0} / ${row.landslide_events || 0}</dd>
        <dt>Total Bencana (BPBD)</dt><dd class="mono tabular">${format.number(row.total_disasters || 0)}</dd>
        <dt>Granularitas</dt><dd class="mono">${escapeHtml(row.granularity)}</dd>
        <dt>Geometri</dt><dd class="mono">geom = null (unknown)</dd>
        <dt>Sumber Data</dt><dd>${escapeHtml(row.source_name || "BPBD Kota Medan")}</dd>
      `,
      qaNote:
        "Seri bulanan BPBD 2022 (138 kebakaran) dan 2023 (87 kebakaran; total 225) disajikan terpisah sebagai pembanding Damkarmat (216 dan 219) tanpa atribut koordinat atau kecamatan.",
      previewType: "umum"
    };
  }

  if (state.period === "non-kebakaran-2023-2025") {
    const discNote = row.left_vs_category_discrepancy
      ? ` Selisih internal spreadsheet: total kolom kiri ${row.total_rescues} vs jumlah kategori kanan ${row.category_sum_total} (${row.left_vs_category_discrepancy > 0 ? `+${row.left_vs_category_discrepancy}` : row.left_vs_category_discrepancy}).`
      : "";
    return {
      html: `
        <dt>Periode</dt><dd>${escapeHtml(row.display_label || row.displayLabel)}</dd>
        <dt>Total Penyelamatan Non-Kebakaran</dt><dd class="mono tabular">${format.number(row.total_rescues)}</dd>
        <dt>Jumlah Rincian Kategori</dt><dd class="mono tabular">${format.number(row.category_sum_total)}</dd>
        <dt>Jenis Terbanyak</dt><dd>${escapeHtml(row.dominant_rescue_type || "-")} (${format.number(row.dominant_rescue_count || 0)})</dd>
        <dt>Klasifikasi Kebakaran</dt><dd class="mono">is_fire_incident = false (terpisah)</dd>
        <dt>Geometri</dt><dd class="mono">geom = null</dd>
        <dt>Sumber Data</dt><dd>${escapeHtml(row.source_name)}</dd>
      `,
      qaNote: `Operasi penyelamatan non-kebakaran tidak dihitung ke angka kejadian kebakaran.${discNote}`,
      previewType: "umum"
    };
  }

  if (state.period === "kandidat-independen") {
    const hasCoords = typeof row.lat === "number" && typeof row.lon === "number";
    const occurredTime = row.occurred_time_wib ? `${escapeHtml(row.occurred_time_wib)} WIB` : "Tidak tersedia (bukan 00:00)";
    const additionalUrls = Array.isArray(row.additional_source_urls) ? row.additional_source_urls : [];
    const additionalLinksHtml = additionalUrls.length
      ? `
        <dt>Liputan Duplikat Terhubung (${additionalUrls.length})</dt>
        <dd>
          <ul style="margin: 0; padding-left: 1.1rem; display: grid; gap: 0.25rem;">
            ${additionalUrls
              .map(
                (url, idx) =>
                  `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="overflow-wrap: anywhere;">${escapeHtml(formatSourceLinkLabel(url, idx + 1))}</a></li>`
              )
              .join("")}
          </ul>
        </dd>
      `
      : "";
    return {
      html: `
        <dt>ID Kandidat</dt><dd class="mono">${escapeHtml(row.source_record_id)}</dd>
        <dt>Tanggal &amp; Jam Kejadian</dt><dd class="mono">${escapeHtml(row.occurred_on || "-")} | ${occurredTime}</dd>
        <dt>Jam Laporan / Pemadaman</dt><dd class="mono">${escapeHtml(row.reported_at_wib ? `${row.reported_at_wib} WIB` : "-")} / ${escapeHtml(row.extinguish_window_wib || "-")}</dd>
        <dt>Publikasi Artikel</dt><dd class="mono">${escapeHtml(row.published_at || "-")}</dd>
        <dt>Kecamatan / Kelurahan</dt><dd>${escapeHtml(row.district_name || "-")}${row.subdistrict_name ? ` / ${escapeHtml(row.subdistrict_name)}` : ""}</dd>
        <dt>Lokasi (Generalisasi Ruas)</dt><dd>${escapeHtml(row.address_text || "-")}</dd>
        <dt>Objek</dt><dd>${escapeHtml(row.object_summary || row.object_type || "-")}</dd>
        <dt>Unit Terlibat</dt><dd>${escapeHtml(row.dispatched_units_note || "-")}</dd>
        <dt>Akurasi &amp; KDE</dt><dd class="mono">${escapeHtml(row.location_accuracy)} / Non-KDE</dd>
        <dt>Geometri</dt><dd class="mono">${hasCoords ? `${row.lat}, ${row.lon} (${escapeHtml(row.osm_ref || "OSM")})` : "geom = null (district_only)"}</dd>
        <dt>Status Verifikasi</dt><dd>${renderBadge(row.verification_status)}</dd>
        <dt>Sumber Publik</dt><dd><a href="${escapeHtml(row.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.source_name)}</a></dd>
        ${additionalLinksHtml}
      `,
      qaNote: row.review_notes || "Kandidat dari media berita terbuka; belum terverifikasi laporan resmi Damkarmat.",
      previewType: row.object_type || "umum"
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

function getExplorerChartTitle(state) {
  if (state.period === "2023-dampak") {
    return "Bagaimana tren bulanan kejadian & korban kebakaran Tahun 2023?";
  }
  if (state.period === "2016-2025-tahunan") {
    return "Bagaimana tren tahunan kebakaran Kota Medan (2016 - 2025)?";
  }
  if (state.period === "bpbd-2021-2023") {
    return "Bagaimana perbandingan kejadian kebakaran BPBD per Kecamatan (2021 vs 2022)?";
  }
  if (state.period === "bpbd-2022-2023-bulanan") {
    return "Bagaimana tren bulanan kebakaran dibanding total bencana BPBD (2022 - 2023)?";
  }
  if (state.period === "kandidat-independen") {
    return "Berapa sebaran kandidat berita kebakaran per Kecamatan (bukan sensus lengkap)?";
  }
  const catLabel = CATEGORY_LABELS[state.category] || CATEGORY_LABELS.semua;
  if (state.period === "2023-kecamatan") {
    return `Berapa jumlah kejadian (${catLabel}) per Kecamatan pada Tahun 2023?`;
  }
  if (state.period === "2016-2021-bulanan") {
    return "Bagaimana tren bulanan kebakaran Kota Medan sepanjang 2016 - 2021?";
  }
  if (state.period === "non-kebakaran-2023-2025") {
    return "Bagaimana tren bulanan operasi penyelamatan non-kebakaran (2023 - 2025)?";
  }
  const yr = state.period === "2024-bulanan" ? "2024" : "2025";
  return `Bagaimana tren bulanan kejadian (${catLabel}) sepanjang Tahun ${yr}?`;
}

function getExplorerTableTitle(state) {
  if (state.period === "2023-dampak") {
    return "Rekapitulasi Bulanan Dampak & Kerugian Kebakaran (2023)";
  }
  if (state.period === "2016-2025-tahunan") {
    return "Deret Historis Kejadian Kebakaran Kota Medan (2016 - 2025)";
  }
  if (state.period === "2016-2021-bulanan") {
    return "Rekapitulasi Bulanan Kejadian Kebakaran Kota Medan (2016 - 2021)";
  }
  if (state.period === "bpbd-2021-2023") {
    return "Pembanding BPBD Kota Medan per Kecamatan (Kebakaran 2021 - 2022)";
  }
  if (state.period === "bpbd-2022-2023-bulanan") {
    return "Pembanding Bulanan BPBD Kota Medan (Kebakaran & Total Bencana 2022 - 2023)";
  }
  if (state.period === "non-kebakaran-2023-2025") {
    return "Rekapitulasi Operasi Penyelamatan Non-Kebakaran Damkarmat (2023 - 2025)";
  }
  if (state.period === "kandidat-independen") {
    return "Tabel Kandidat Kejadian Media Independen (needs_review, Bukan Statistik Resmi)";
  }
  if (state.period === "2023-kecamatan") {
    return "Rekapitulasi Kejadian Kebakaran per Kecamatan (2023)";
  }
  const yr = state.period === "2024-bulanan" ? "2024" : "2025";
  return `Rekapitulasi Bulanan Kejadian Kebakaran (${yr})`;
}

function buildOfficialTableMarkup({ rows, state, format }) {
  const isDist = state.period === "2023-kecamatan";
  const title = getExplorerTableTitle(state);
  if (state.period === "2023-dampak") {
    return {
      title,
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
      title,
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

  if (state.period === "2016-2021-bulanan") {
    return {
      title,
      count: `${rows.length} baris`,
      html: `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Periode</th>
                <th>Tahun</th>
                <th>Jumlah Kejadian</th>
                <th>Granularitas</th>
                <th>Akurasi</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr data-interactive="true" data-row-key="${escapeHtml(r.displayLabel)}" tabindex="0" class="${state.selectedKey === r.displayLabel ? "is-selected" : ""}">
                  <td><strong>${escapeHtml(r.displayLabel)}</strong></td>
                  <td class="mono">${r.period_year}</td>
                  <td class="mono tabular"><strong>${format.number(r.filteredCount)}</strong></td>
                  <td class="mono">${escapeHtml(r.granularity)}</td>
                  <td class="mono">${escapeHtml(r.location_accuracy)}</td>
                  <td>${renderBadge(r.verification_status)}</td>
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

  if (state.period === "bpbd-2021-2023") {
    return {
      title,
      count: `${rows.length} baris`,
      html: `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Kecamatan</th>
                <th>Kebakaran 2022 (BPBD)</th>
                <th>Kebakaran 2021 (BPBD)</th>
                <th>Banjir 2022</th>
                <th>Puting Beliung 2022</th>
                <th>Longsor 2022</th>
                <th>Total Bencana 2022</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr data-interactive="true" data-row-key="${escapeHtml(r.displayLabel)}" tabindex="0" class="${state.selectedKey === r.displayLabel ? "is-selected" : ""}">
                  <td><strong>${escapeHtml(r.district_name)}</strong></td>
                  <td class="mono tabular"><strong>${format.number(r.fire_incidents)}</strong></td>
                  <td class="mono tabular">${format.number(r.fire_incidents_2021)}</td>
                  <td class="mono tabular">${r.flood_events}</td>
                  <td class="mono tabular">${r.wind_events}</td>
                  <td class="mono tabular">${r.landslide_events}</td>
                  <td class="mono tabular">${format.number(r.total_disasters)}</td>
                  <td>${renderBadge(r.verification_status)}</td>
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

  if (state.period === "non-kebakaran-2023-2025") {
    return {
      title,
      count: `${rows.length} baris`,
      html: `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Periode</th>
                <th>Total Penyelamatan</th>
                <th>Jumlah Kategori</th>
                <th>Jenis Dominan</th>
                <th>Selisih Kolom</th>
                <th>Klasifikasi</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr data-interactive="true" data-row-key="${escapeHtml(r.displayLabel)}" tabindex="0" class="${state.selectedKey === r.displayLabel ? "is-selected" : ""}">
                  <td><strong>${escapeHtml(r.displayLabel)}</strong></td>
                  <td class="mono tabular"><strong>${format.number(r.total_rescues)}</strong></td>
                  <td class="mono tabular">${format.number(r.category_sum_total)}</td>
                  <td>${escapeHtml(r.dominant_rescue_type || "-")} (${format.number(r.dominant_rescue_count || 0)})</td>
                  <td class="mono tabular">${r.left_vs_category_discrepancy || 0}</td>
                  <td class="mono">Non-Kebakaran</td>
                  <td>${renderBadge(r.verification_status)}</td>
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

  if (state.period === "bpbd-2022-2023-bulanan") {
    return {
      title,
      count: `${rows.length} baris`,
      html: `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Periode</th>
                <th>Kebakaran (BPBD)</th>
                <th>Banjir</th>
                <th>Puting Beliung</th>
                <th>Longsor</th>
                <th>Total Bencana</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr data-interactive="true" data-row-key="${escapeHtml(r.displayLabel)}" tabindex="0" class="${state.selectedKey === r.displayLabel ? "is-selected" : ""}">
                  <td><strong>${escapeHtml(r.displayLabel)}</strong></td>
                  <td class="mono tabular"><strong>${format.number(r.fire_incidents || 0)}</strong></td>
                  <td class="mono tabular">${r.flood_events || 0}</td>
                  <td class="mono tabular">${r.wind_events || 0}</td>
                  <td class="mono tabular">${r.landslide_events || 0}</td>
                  <td class="mono tabular">${format.number(r.total_disasters || 0)}</td>
                  <td>${renderBadge(r.verification_status)}</td>
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

  if (state.period === "kandidat-independen") {
    return {
      title,
      count: `${rows.length} kandidat`,
      html: `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID Kandidat</th>
                <th>Tgl Kejadian</th>
                <th>Kecamatan</th>
                <th>Lokasi (Generalisasi Ruas)</th>
                <th>Objek</th>
                <th>Akurasi</th>
                <th>Geometri</th>
                <th>Status</th>
                <th>Sumber</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr data-interactive="true" data-row-key="${escapeHtml(r.source_record_id)}" tabindex="0" class="${state.selectedKey === r.source_record_id ? "is-selected" : ""}">
                  <td class="mono"><strong>${escapeHtml(r.source_record_id)}</strong></td>
                  <td class="mono">${escapeHtml(r.occurred_on)}${r.occurred_time_wib ? ` ${escapeHtml(r.occurred_time_wib)}` : ""}</td>
                  <td>${escapeHtml(r.district_name || "-")}</td>
                  <td>${escapeHtml(r.address_text || "-")}</td>
                  <td>${escapeHtml(r.object_summary || r.object_type || "-")}</td>
                  <td class="mono">${escapeHtml(r.location_accuracy)}</td>
                  <td class="mono">${typeof r.lat === "number" ? "Point" : "null"}</td>
                  <td>${renderBadge(r.verification_status)}</td>
                  <td>
                    <a href="${escapeHtml(r.source_url)}" target="_blank" rel="noopener noreferrer" data-external-link="true">${escapeHtml(r.source_name)}</a>${Array.isArray(r.additional_source_urls) && r.additional_source_urls.length > 0 ? ` <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">(+${r.additional_source_urls.length})</span>` : ""}
                  </td>
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
    title,
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
      publicYear: "semua",
      publicSource: "semua",
      publicAccuracy: "semua",
      search: "",
      sortBy: "default",
      selectedKey: null,
      showSupabasePoints: true,
      unlocatedFilter: "semua"
    };

    const supabaseBadgeText = supabaseStatus.active
      ? supabaseStatus.partialLoad
        ? `Supabase Parsial (${supabaseStatus.partitioned.verifiedLocated.length} titik)`
        : `Supabase Aktif (${supabaseStatus.partitioned.verifiedLocated.length} titik)`
      : supabaseStatus.source === "local_fallback"
        ? "Fallback Lokal (Supabase gagal)"
        : "Mode Lokal (Arsip Resmi)";
    const hasSupabasePoints =
      supabaseStatus.active && (supabaseStatus.partitioned.verifiedLocated || []).length > 0;

    container.innerHTML = `
      <section class="page-header">
        <div>
          <h1>${escapeHtml(manifest.title)}</h1>
          <p class="page-lead">
            Eksplorasi data kejadian kebakaran Kota Medan resmi (2016 - 2025), pembanding BPBD, penyelamatan non-kebakaran, serta ${services.format.number((summary.independent_incident_candidates?.records || []).length)} insiden terdokumentasi publik secara terpisah.
          </p>
        </div>
        <div class="explorer-header-actions">
          <span class="status-badge status-badge--active" id="explorer-mode-badge">Mode: Data Resmi Damkarmat</span>
          <span class="status-badge status-badge--local" id="explorer-source-mode">${escapeHtml(supabaseBadgeText)}</span>
        </div>
      </section>

      <div class="notice-banner" id="explorer-granularity-banner" role="region" aria-label="Informasi granularitas data"></div>

      <div class="tab-bar" role="tablist" aria-label="Tampilan data Fire Incident Explorer">
        <button type="button" class="tab-btn" role="tab" id="tab-verified" aria-selected="true" aria-controls="explorer-tab-verified" data-tab="verified">
          Eksplorasi Dataset &amp; Peta
        </button>
        <button type="button" class="tab-btn" role="tab" id="tab-unlocated" aria-selected="false" aria-controls="explorer-tab-unlocated" data-tab="unlocated">
          Belum Terlokasi &amp; Perlu Review (${summary.unlocated_register.length} batch)
        </button>
        <button type="button" class="tab-btn" role="tab" id="tab-simulation" aria-selected="false" aria-controls="explorer-tab-simulation" data-tab="simulation">
          Simulasi Respons Damkarmat
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
                <option value="2016-2021-bulanan">2016 - 2021 (Agregat Bulanan Damkarmat)</option>
                <option value="bpbd-2021-2023">2021 - 2023 (Pembanding BPBD Medan)</option>
                <option value="bpbd-2022-2023-bulanan">2022 - 2023 (Pembanding Bulanan BPBD Medan)</option>
                <option value="non-kebakaran-2023-2025">2023 - 2025 (Penyelamatan Non-Kebakaran)</option>
                <option value="kandidat-independen">2024 - 2026 (Insiden Terdokumentasi Publik)</option>
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
                <option value="desc">Terbanyak / Terbaru</option>
                <option value="asc">Tersedikit / Terlama</option>
                <option value="name">Nama / Tahun (A - Z)</option>
              </select>
            </div>
            <div>
              <button type="button" class="btn btn-secondary" id="filter-reset">Reset Filter</button>
            </div>
          </div>
          <div class="filter-bar" id="explorer-public-filters" hidden style="margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--color-border);">
            <div class="field">
              <label for="filter-public-year">Tahun Insiden Publik</label>
              <select id="filter-public-year">
                <option value="semua">Semua Tahun (2024 - 2026)</option>
                <option value="2026">2026</option>
                <option value="2025">2025</option>
                <option value="2024">2024</option>
              </select>
            </div>
            <div class="field">
              <label for="filter-public-source">Sumber Publikasi</label>
              <select id="filter-public-source">
                <option value="semua">Semua Sumber Publik</option>
                <option value="p2k.medan.go.id">Portal Damkarmat (p2k.medan.go.id)</option>
                <option value="antara">ANTARA Sumut</option>
                <option value="detik">Detik Sumut</option>
              </select>
            </div>
            <div class="field">
              <label for="filter-public-accuracy">Tingkat Akurasi Lokasi</label>
              <select id="filter-public-accuracy">
                <option value="semua">Semua Akurasi (34 Kejadian)</option>
                <option value="approximate">Perkiraan Ruas OSM (approximate)</option>
                <option value="district_only">Kecamatan Saja (district_only)</option>
              </select>
            </div>
          </div>
          <p class="explorer-source-note ${supabaseStatus.truncated || supabaseStatus.partialLoad || supabaseStatus.source === "local_fallback" ? "explorer-source-note--warn" : ""}" id="explorer-supabase-note">${escapeHtml(supabaseStatus.note)}</p>
        </section>

        <section class="explorer-metrics" id="explorer-metrics" aria-label="Ringkasan hasil filter" style="margin-top: var(--space-4);"></section>

        <div class="split-layout split-layout--map-lead" style="margin-top: var(--space-4);">
          <section class="panel map-card">
            <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2);">
              <h2 id="explorer-map-title">Peta Kejadian per Kecamatan (Tahun 2023)</h2>
              <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">EPSG:4326</span>
            </div>
            <div class="map-layer-toggle" id="explorer-supabase-layer-bar" ${!hasSupabasePoints ? "hidden" : ""}>
              <label class="layer-toggle-label" for="toggle-supabase-points">
                <input type="checkbox" id="toggle-supabase-points" checked />
                <span>Tampilkan Layer Terpisah Titik Individual Supabase (<strong id="supabase-point-filter-count">0</strong> titik sesuai filter; terpisah dari statistik agregat)</span>
              </label>
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
              <h3 style="margin-bottom: var(--space-1);">Simulasi Respons Damkarmat</h3>
              <p style="font-size: var(--text-xs); color: var(--color-ink-muted); margin-bottom: var(--space-3);">
                Uji rute jaringan jalan OSM dari pos skenario terdekat serta proses pemadaman interaktif (non-darurat).
              </p>
              <button type="button" class="btn btn-primary btn-sm" id="open-simulation-tab-btn">
                Buka Simulasi Respons
              </button>
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

        <section class="panel" id="explorer-upt-candidates-panel" style="margin-top: var(--space-4);" hidden></section>
      </div>

      <div id="explorer-tab-unlocated" role="tabpanel" aria-labelledby="tab-unlocated" hidden></div>
      <div id="explorer-tab-simulation" role="tabpanel" aria-labelledby="tab-simulation" hidden></div>
    `;

    const modeBadgeEl = container.querySelector("#explorer-mode-badge");
    const bannerEl = container.querySelector("#explorer-granularity-banner");
    const tabVerifiedBtn = container.querySelector("#tab-verified");
    const tabUnlocatedBtn = container.querySelector("#tab-unlocated");
    const tabSimulationBtn = container.querySelector("#tab-simulation");
    const tabVerifiedPanel = container.querySelector("#explorer-tab-verified");
    const tabUnlocatedPanel = container.querySelector("#explorer-tab-unlocated");
    const tabSimulationPanel = container.querySelector("#explorer-tab-simulation");
    const openSimBtn = container.querySelector("#open-simulation-tab-btn");
    const uptCandidatesPanelEl = container.querySelector("#explorer-upt-candidates-panel");

    const periodSel = container.querySelector("#filter-period");
    const districtSel = container.querySelector("#filter-district");
    const categorySel = container.querySelector("#filter-category");
    const publicFiltersBar = container.querySelector("#explorer-public-filters");
    const publicYearSel = container.querySelector("#filter-public-year");
    const publicSourceSel = container.querySelector("#filter-public-source");
    const publicAccuracySel = container.querySelector("#filter-public-accuracy");
    const searchInput = container.querySelector("#filter-search");
    const sortSel = container.querySelector("#filter-sort");
    const resetBtn = container.querySelector("#filter-reset");
    const supabaseLayerBarEl = container.querySelector("#explorer-supabase-layer-bar");
    const supabasePointsToggle = container.querySelector("#toggle-supabase-points");
    const supabasePointCountEl = container.querySelector("#supabase-point-filter-count");

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

    const simulationHandle = mountFireResponseSimulation({
      container: tabSimulationPanel,
      services,
      summary,
      districtsGeoJson
    });
    const mapHandle = services.maps.createMap(container.querySelector("#explorer-map"));
    const dynamicOverlay = L.layerGroup().addTo(mapHandle.map);
    const supabaseOverlay = L.layerGroup().addTo(mapHandle.map);

    let districtGeoLayer = null;
    let activeBreaks = null;
    let activeRowMap = new Map();
    let lastMapLayerKey = "";
    let lastExtentCtx = null;
    let activeRowsSnapshot = [];
    let chartHandle = null;
    let invalidateTimer = null;
    let isMounted = true;

    function isChoroplethPeriod() {
      return state.period === "2023-kecamatan" || state.period === "bpbd-2021-2023";
    }

    function getMapLayerKey() {
      return `${state.period}|${state.district}|${state.category}|${state.publicYear}|${state.publicSource}|${state.publicAccuracy}|${state.search}|${state.showSupabasePoints}`;
    }

    function computeDistrictFeatureStyle(feature) {
      const name = feature.properties.district_name;
      if (!isChoroplethPeriod()) {
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
    }

    function applySelectionUiOnly(selectedKey) {
      state.selectedKey = selectedKey;
      const found = activeRowsSnapshot.find(
        (item) => getRowKey(item, state.period === "kandidat-independen") === selectedKey
      );
      updateDetail(found);

      const rows = tableWrapEl.querySelectorAll("tr[data-row-key]");
      rows.forEach((tr) => {
        tr.classList.toggle("is-selected", tr.getAttribute("data-row-key") === selectedKey);
      });

      if (districtGeoLayer) {
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

    function updateModeBadge() {
      if (!modeBadgeEl) return;
      if (state.period === "kandidat-independen") {
        modeBadgeEl.className = "status-badge status-badge--dev";
        modeBadgeEl.textContent = "Mode: Insiden Terdokumentasi Publik";
        return;
      }
      if (state.period === "bpbd-2021-2023" || state.period === "bpbd-2022-2023-bulanan") {
        modeBadgeEl.className = "status-badge status-badge--dev";
        modeBadgeEl.textContent = "Mode: Pembanding BPBD (Terpisah)";
        return;
      }
      if (state.period === "non-kebakaran-2023-2025") {
        modeBadgeEl.className = "status-badge status-badge--dev";
        modeBadgeEl.textContent = "Mode: Penyelamatan Non-Kebakaran (Terpisah)";
        return;
      }
      modeBadgeEl.className = "status-badge status-badge--active";
      modeBadgeEl.textContent = "Mode: Data Resmi Damkarmat";
    }

    function updateBanner() {
      updateModeBadge();

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
          <strong>Catatan Seri Historis 2016 - 2025:</strong> Data 2016 - 2022 tersedia pada level agregat tahunan/bulanan kota (<code>geom = null</code>) dengan perbedaan cakupan luar kota pada arsip 2019, 2020, dan 2021.
        `;
      } else if (state.period === "2016-2021-bulanan") {
        bannerEl.className = "notice-banner notice-banner--warn";
        bannerEl.innerHTML = `
          <strong>Agregat Bulanan Damkarmat 2016 - 2021 (72 Baris):</strong> Seluruh 72 baris bulanan berjumlah 1.372 kejadian dan cocok identik per tahun dengan seri tahunan resmi, tanpa kolom kecamatan atau koordinat (<code>geom = null</code>).
        `;
      } else if (state.period === "bpbd-2021-2023") {
        bannerEl.className = "notice-banner notice-banner--warn";
        bannerEl.innerHTML = `
          <strong>Dataset Pembanding BPBD Kota Medan (2021 - 2023):</strong> Disajikan terpisah dari statistik resmi Dinas Damkarmat (BPBD mencatat 108 kebakaran di 2021, 138 di 2022, dan 87 bulanan di 2023 dibanding Damkarmat 207, 216, dan 219).
        `;
      } else if (state.period === "bpbd-2022-2023-bulanan") {
        bannerEl.className = "notice-banner notice-banner--warn";
        bannerEl.innerHTML = `
          <strong>Pembanding Bulanan BPBD Kota Medan (2022 - 2023):</strong> Berisi 24 baris bulanan (138 kebakaran di 2022 dan 87 kebakaran di 2023; total 225 kebakaran dari 303 bencana BPBD). Disajikan terpisah dari statistik resmi Damkarmat tanpa koordinat atau kecamatan (<code>geom = null</code>).
        `;
      } else if (state.period === "non-kebakaran-2023-2025") {
        bannerEl.className = "notice-banner notice-banner--warn";
        bannerEl.innerHTML = `
          <strong>Penyelamatan Non-Kebakaran Damkarmat (2023 - 2025):</strong> Berisi 2.218 operasi evakuasi non-kebakaran (ular, sarang tawon, cincin, kucing, dll.). Dipisahkan tegas dan tidak pernah dihitung ke jumlah kebakaran (<code>geom = null</code>).
        `;
      } else if (state.period === "kandidat-independen") {
        const pubRecords = summary.independent_incident_candidates?.records || [];
        const approxCount = pubRecords.filter((r) => typeof r.lat === "number" && typeof r.lon === "number").length;
        const distOnlyCount = pubRecords.length - approxCount;
        bannerEl.className = "notice-banner notice-banner--warn";
        bannerEl.innerHTML = `
          <strong>Katalog Insiden Terdokumentasi Publik (Terpisah dari Rekap Resmi):</strong> Berisi ${services.format.number(pubRecords.length)} kejadian unik terkurasi dari Portal Damkarmat Medan (p2k.medan.go.id), ANTARA Sumut, dan Detik Sumut beserta 6 kandidat pos UPT. Sebanyak ${services.format.number(approxCount)} kejadian memiliki perkiraan koordinat ruas OSM (<code>approximate</code>) dan ${services.format.number(distOnlyCount)} tetap <code>district_only</code> (<code>geom = null</code>).
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

      chartTitleEl.textContent = getExplorerChartTitle(state);

      if (!rows.length) {
        chartEmptyEl.hidden = false;
        chartFrameEl.hidden = true;
        return;
      }

      chartEmptyEl.hidden = true;
      chartFrameEl.hidden = false;

      if (state.period === "2023-dampak") {
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

      if (state.period === "bpbd-2021-2023") {
        chartHandle = services.charts.createChart(chartCanvas, {
          type: "bar",
          data: {
            labels: rows.map((r) => r.district_name),
            datasets: [
              {
                label: "BPBD Kebakaran 2022 (138 total)",
                data: rows.map((r) => Number(r.fire_incidents || 0)),
                backgroundColor: "#B84A35"
              },
              {
                label: "BPBD Kebakaran 2021 (108 total)",
                data: rows.map((r) => Number(r.fire_incidents_2021 || 0)),
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

      if (state.period === "bpbd-2022-2023-bulanan") {
        chartHandle = services.charts.createChart(chartCanvas, {
          type: "bar",
          data: {
            labels: rows.map((r) => r.displayLabel),
            datasets: [
              {
                label: "Kebakaran BPBD (kejadian)",
                data: rows.map((r) => Number(r.fire_incidents || 0)),
                backgroundColor: "#B84A35"
              },
              {
                label: "Total Bencana BPBD (kebakaran, banjir, angin, longsor)",
                data: rows.map((r) => Number(r.total_disasters || 0)),
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

      if (state.period === "kandidat-independen") {
        const byDistrict = new Map();
        for (const r of rows) {
          const d = r.district_name || "Tidak Tercatat";
          const cur = byDistrict.get(d) || { approx: 0, distOnly: 0 };
          if (r.location_accuracy === "approximate") cur.approx += 1;
          else cur.distOnly += 1;
          byDistrict.set(d, cur);
        }
        const labels = [...byDistrict.keys()].sort((a, b) => a.localeCompare(b, "id"));
        chartHandle = services.charts.createChart(chartCanvas, {
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                label: "Perkiraan Ruas/Landmark (approximate)",
                data: labels.map((l) => byDistrict.get(l).approx),
                backgroundColor: "#D58A43"
              },
              {
                label: "Kecamatan Saja (geom = null)",
                data: labels.map((l) => byDistrict.get(l).distOnly),
                backgroundColor: "#356067"
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { stacked: true },
              y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
            }
          }
        });
        return;
      }

      const catLabel = CATEGORY_LABELS[state.category];

      const isBar = state.period === "2023-kecamatan";
      const seriesLabel =
        state.period === "non-kebakaran-2023-2025"
          ? "Penyelamatan non-kebakaran (operasi)"
          : state.period === "2016-2021-bulanan"
            ? "Kebakaran Kota Medan (kejadian)"
            : `${catLabel} (kejadian)`;
      const seriesColor = state.period === "non-kebakaran-2023-2025" ? "#356067" : "#B84A35";
      const fillColor =
        state.period === "non-kebakaran-2023-2025" ? "rgba(53, 96, 103, 0.16)" : "rgba(184, 74, 53, 0.2)";

      chartHandle = services.charts.createChart(chartCanvas, {
        type: isBar ? "bar" : "line",
        data: {
          labels: rows.map((r) => r.displayLabel),
          datasets: [
            {
              label: seriesLabel,
              data: rows.map((r) => r.filteredCount),
              backgroundColor: isBar ? seriesColor : fillColor,
              borderColor: seriesColor,
              borderWidth: 2,
              tension: 0.2,
              fill: !isBar
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

    function renderMapAndLegend(rows, { fitExtent = true } = {}) {
      dynamicOverlay.clearLayers();
      supabaseOverlay.clearLayers();
      districtGeoLayer = null;

      if (supabaseLayerBarEl) {
        supabaseLayerBarEl.hidden = state.period === "kandidat-independen" || !hasSupabasePoints;
      }

      if (state.period === "kandidat-independen") {
        activeBreaks = null;
        activeRowMap = new Map();
        const approxIncidents = rows.filter((r) => typeof r.lat === "number" && typeof r.lon === "number");
        const candStations = (summary.candidate_stations?.stations || []).filter(
          (st) => typeof st.lat === "number" && typeof st.lon === "number"
        );
        mapTitleEl.textContent = "Peta Kandidat Media Independen & Pos UPT Perkiraan (needs_review)";
        legendEl.innerHTML = `
          <span class="legend-item"><span class="legend-swatch" style="background: #8A5218; border-radius: 50%;"></span> Kandidat Kebakaran (${approxIncidents.length} approximate, Non-KDE)</span>
          <span class="legend-item"><span class="legend-swatch" style="background: #FBF2E6; border: 2px solid #356067; border-radius: 50%;"></span> Kandidat UPT I, II, V &amp; VI (${candStations.length} approximate OSM, needs_review)</span>
          <span class="legend-item"><span class="legend-swatch" style="background: #356067; border-radius: 50%;"></span> Mako 0.0 Terverifikasi</span>
        `;
        provenanceEl.innerHTML = `
          <span>Kandidat: ANTARA Sumut, Detik Sumut, Portal Pemko Medan, Perwali 25/2018 (historis) &amp; OSM Nominatim (needs_review, Non-KDE)</span>
          <span>Batas: OpenStreetMap Nominatim (&copy; OpenStreetMap contributors, ODbL)</span>
        `;

        const normalizedTargetDistrict =
          state.district !== "semua" ? normalizeDistrictName(state.district) : null;
        let selectedDistrictLayer = null;

        districtGeoLayer = L.geoJSON(districtsGeoJson, {
          style: (feature) => {
            const isTarget =
              normalizedTargetDistrict &&
              normalizeDistrictName(feature.properties.district_name) === normalizedTargetDistrict;
            return {
              color: isTarget ? "#202A2D" : "#6E7A7D",
              weight: isTarget ? 2 : 1,
              fillColor: "#ECEAE2",
              fillOpacity: isTarget ? 0.32 : 0.14
            };
          },
          onEachFeature: (feature, layer) => {
            const name = feature.properties.district_name;
            if (normalizedTargetDistrict && normalizeDistrictName(name) === normalizedTargetDistrict) {
              selectedDistrictLayer = layer;
            }
            const distCount = rows.filter((r) => r.district_name === name).length;
            layer.bindPopup(
              `<strong>${escapeHtml(name)}</strong><br/>Kandidat berita pada filter: ${distCount} (bukan sensus resmi)`
            );
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
            .bindPopup(`<strong>${escapeHtml(st.name)}</strong><br/>${escapeHtml(st.address)}<br/>Status: Terverifikasi`)
            .addTo(dynamicOverlay);
        }

        for (const st of candStations) {
          L.circleMarker([st.lat, st.lon], {
            radius: 7,
            color: "#356067",
            weight: 2.5,
            fillColor: "#FBF2E6",
            fillOpacity: 0.95
          })
            .bindPopup(
              `<strong>${escapeHtml(st.name)}</strong><br/>${escapeHtml(st.address)}<br/>Status: ${escapeHtml(st.verification_status)} (${escapeHtml(st.location_accuracy)})<br/><em>${escapeHtml(st.conflict_notes)}</em>`
            )
            .addTo(dynamicOverlay);
        }

        for (const rec of approxIncidents) {
          const timeText = rec.occurred_time_wib ? ` ${rec.occurred_time_wib} WIB` : "";
          L.circleMarker([rec.lat, rec.lon], {
            radius: 7,
            color: "#202A2D",
            weight: 2,
            fillColor: "#8A5218",
            fillOpacity: 0.88
          })
            .bindPopup(
              `<strong>${escapeHtml(rec.source_record_id)} (Kandidat)</strong><br/>` +
                `Tanggal: ${escapeHtml(rec.occurred_on)}${escapeHtml(timeText)}<br/>` +
                `Lokasi: ${escapeHtml(rec.address_text)}<br/>` +
                `Objek: ${escapeHtml(rec.object_summary || rec.object_type)}<br/>` +
                `Akurasi: ${escapeHtml(rec.location_accuracy)} / Status: ${escapeHtml(rec.verification_status)}<br/>` +
                `<a href="${escapeHtml(rec.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(rec.source_name)}</a>`
            )
            .on("click", () => applySelectionUiOnly(rec.source_record_id))
            .addTo(dynamicOverlay);
        }

        if (fitExtent) {
          services.maps.fitBounds(mapHandle.map, selectedDistrictLayer || districtGeoLayer);
        }
        return;
      }

      activeRowMap = new Map(rows.map((r) => [r.district_name, r]));
      const isDist = isChoroplethPeriod();

      if (isDist) {
        activeBreaks = computeChoroplethBreaks(rows.map((r) => r.filteredCount));
        mapTitleEl.textContent =
          state.period === "bpbd-2021-2023"
            ? "Peta Kebakaran BPBD per Kecamatan (Tahun 2022, Pembanding)"
            : `Peta Kejadian 2023 per Kecamatan (${CATEGORY_LABELS[state.category]})`;
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
                : state.period === "2016-2021-bulanan"
                  ? "Agregat Bulanan 2016 - 2021"
                  : state.period === "bpbd-2022-2023-bulanan"
                    ? "Pembanding Bulanan BPBD 2022 - 2023"
                    : state.period === "non-kebakaran-2023-2025"
                      ? "Penyelamatan Non-Kebakaran 2023 - 2025"
                      : "Seri Tahunan 2016 - 2025";
        mapTitleEl.textContent = `Batas Wilayah Kota Medan (${periodLabel})`;
        legendEl.innerHTML = `
          <span class="legend-item"><span class="legend-swatch" style="background: #ECEAE2;"></span> Data pada mode ini tidak memiliki atribut koordinat individual (geom = null)</span>
          <span class="legend-item"><span class="legend-swatch" style="background: #356067; border-radius: 50%;"></span> Mako 0.0 Damkarmat</span>
        `;
      }

      const filteredSupabasePoints = filterSupabasePoints(
        supabaseStatus.partitioned.verifiedLocated || [],
        {
          period: state.period,
          district: state.district,
          category: state.category,
          search: state.search
        }
      );
      if (supabasePointCountEl) {
        supabasePointCountEl.textContent = services.format.number(filteredSupabasePoints.length);
      }

      if (state.showSupabasePoints && filteredSupabasePoints.length > 0) {
        const strictCount = filteredSupabasePoints.filter((p) => p.kde_eligible).length;
        const approxCount = filteredSupabasePoints.length - strictCount;
        if (strictCount > 0) {
          legendEl.innerHTML += `<span class="legend-item"><span class="legend-swatch" style="background: #202A2D; border-radius: 50%;"></span> Layer Titik Supabase Terverifikasi (${strictCount})</span>`;
        }
        if (approxCount > 0) {
          legendEl.innerHTML += `<span class="legend-item"><span class="legend-swatch" style="background: #8A5218; border-radius: 50%;"></span> Layer Titik Perkiraan / Approximate (${approxCount}; non-KDE default)</span>`;
        }
      }

      provenanceEl.innerHTML =
        state.period === "bpbd-2021-2023" || state.period === "bpbd-2022-2023-bulanan"
          ? `<span>Batas: OpenStreetMap Nominatim (&copy; OpenStreetMap contributors, ODbL)</span><span>Data: BPBD Kota Medan via Satu Data Medan (pembanding)</span>`
          : `<span>Batas: OpenStreetMap Nominatim (&copy; OpenStreetMap contributors, ODbL)</span><span>Data: Dinas Damkarmat Kota Medan via Satu Data Medan</span>`;

      let selectedDistrictLayer = null;
      const normalizedTargetDistrict =
        isDist && state.district !== "semua" ? normalizeDistrictName(state.district) : null;

      districtGeoLayer = L.geoJSON(districtsGeoJson, {
        style: (feature) => computeDistrictFeatureStyle(feature),
        onEachFeature: (feature, layer) => {
          const name = feature.properties.district_name;
          if (normalizedTargetDistrict && normalizeDistrictName(name) === normalizedTargetDistrict) {
            selectedDistrictLayer = layer;
          }
          const matched = activeRowMap.get(name);
          const countText =
            isDist && matched
              ? state.period === "bpbd-2021-2023"
                ? `BPBD 2022: ${matched.filteredCount} kebakaran (2021: ${matched.fire_incidents_2021})`
                : `${matched.filteredCount} kejadian`
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

      if (state.showSupabasePoints) {
        for (const pt of filteredSupabasePoints) {
          const isApprox = pt.location_accuracy === "approximate";
          const dateText = pt.occurred_at
            ? services.format.date(pt.occurred_at)
            : pt.period_year
              ? `Tahun ${pt.period_year}`
              : "-";
          const accuracyText = isApprox
            ? `${pt.location_accuracy} (perkiraan; tidak otomatis masuk KDE)`
            : pt.location_accuracy;
          L.circleMarker([pt.lat, pt.lon], {
            radius: isApprox ? 6.5 : 6,
            color: "#FFFFFF",
            weight: 1.5,
            fillColor: isApprox ? "#8A5218" : "#202A2D",
            fillOpacity: 0.92
          })
            .bindPopup(
              `<strong>${escapeHtml(pt.source_record_id)}</strong><br/>` +
                `Tanggal/Periode: ${escapeHtml(dateText)}<br/>` +
                `Alamat: ${escapeHtml(pt.address_text || pt.district_name || "-")}<br/>` +
                `Kategori/Objek: ${escapeHtml(pt.object_type || "Tidak tercatat")}<br/>` +
                `Akurasi: ${escapeHtml(accuracyText)}<br/>` +
                `Sumber: ${escapeHtml(pt.source_name)}<br/>` +
                `<em>Layer individual Supabase (terpisah dari agregat statis)</em>`
            )
            .addTo(supabaseOverlay);
        }
      }

      if (fitExtent) {
        services.maps.fitBounds(mapHandle.map, selectedDistrictLayer || districtGeoLayer);
      }
    }

    function renderTable(rows) {
      tableTitleEl.textContent = getExplorerTableTitle(state);
      if (!rows.length) {
        tableCountEl.textContent = state.period === "kandidat-independen" ? "0 catatan" : "0 baris";
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

      const view = buildOfficialTableMarkup({ rows, state, format: services.format });
      tableTitleEl.textContent = view.title;
      tableCountEl.textContent = view.count;
      tableWrapEl.innerHTML = view.html;

      const rowEls = tableWrapEl.querySelectorAll("tr[data-row-key]");
      rowEls.forEach((tr) => {
        const pick = () => applySelectionUiOnly(tr.getAttribute("data-row-key"));
        tr.addEventListener(
          "click",
          (e) => {
            if (e.target && e.target.closest("a")) return;
            pick();
          },
          { signal: ac.signal }
        );
        tr.addEventListener(
          "keydown",
          (e) => {
            if (e.target && e.target.closest("a")) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pick();
            }
          },
          { signal: ac.signal }
        );
      });
    }

    function renderUptCandidatesPanel() {
      if (!uptCandidatesPanelEl) return;
      if (state.period !== "kandidat-independen") {
        uptCandidatesPanelEl.hidden = true;
        uptCandidatesPanelEl.innerHTML = "";
        return;
      }

      const stations = summary.candidate_stations?.stations || [];
      const approxCount = stations.filter((s) => Boolean(s.geom)).length;
      const nullCount = stations.length - approxCount;

      uptCandidatesPanelEl.hidden = false;
      uptCandidatesPanelEl.innerHTML = `
        <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-2);">
          <h2>Inspeksi Kandidat Pos UPT Wilayah I - VI (Bukan Pos Terverifikasi)</h2>
          <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">
            ${stations.length} kandidat (${nullCount} geom = null, ${approxCount} titik ruas)
          </span>
        </div>
        <p style="font-size: var(--text-sm); color: var(--color-ink-muted); margin-bottom: var(--space-3);">
          Seluruh pos UPT berstatus <code class="mono">needs_review</code> karena <code class="mono">p2k.medan.go.id</code> mengembalikan HTTP 403 Cloudflare. Pos dengan <code class="mono">geom = null</code> (UPT-03 dan UPT-04) tidak ditampilkan sebagai titik pada peta.
        </p>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Kode &amp; Nama Pos</th>
                <th>Wilayah / Alamat Kandidat</th>
                <th>Status</th>
                <th>Akurasi &amp; Peta</th>
                <th>Catatan Konflik Alamat</th>
                <th>Referensi Sumber</th>
              </tr>
            </thead>
            <tbody>
              ${stations
                .map((st) => {
                  const hasCoords = Boolean(st.geom && typeof st.lat === "number" && typeof st.lon === "number");
                  const evidenceUrls =
                    Array.isArray(st.evidence_urls) && st.evidence_urls.length > 0
                      ? st.evidence_urls
                      : st.source_url
                        ? [st.source_url]
                        : [];
                  const refHtml = evidenceUrls.length
                    ? `<ul style="margin: 0; padding-left: 1rem; display: grid; gap: 0.2rem;">${evidenceUrls
                        .map(
                          (u, idx) =>
                            `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(formatSourceLinkLabel(u, idx + 1))}</a></li>`
                        )
                        .join("")}</ul>`
                    : "-";
                  return `
                    <tr>
                      <td>
                        <strong class="mono">${escapeHtml(st.station_code)}</strong>
                        <div style="font-size: var(--text-xs); color: var(--color-ink-muted);">${escapeHtml(st.name)}</div>
                      </td>
                      <td>
                        <strong>${escapeHtml(st.district_name || "-")}</strong>
                        <div style="font-size: var(--text-xs); color: var(--color-ink-muted);">${escapeHtml(st.address || "-")}</div>
                      </td>
                      <td>${renderBadge(st.verification_status)}</td>
                      <td>
                        <span class="mono">${escapeHtml(st.location_accuracy)}</span>
                        <div class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">
                          ${hasCoords ? `Titik ruas (${escapeHtml(st.osm_ref || "OSM")})` : "geom = null (tidak di peta)"}
                        </div>
                      </td>
                      <td style="font-size: var(--text-xs);">${escapeHtml(st.conflict_notes || "-")}</td>
                      <td style="font-size: var(--text-xs);">${refHtml}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    function renderMetrics(rows) {
      if (state.period === "kandidat-independen") {
        const approxCount = rows.filter((r) => typeof r.lat === "number").length;
        metricsEl.innerHTML = `
          <div class="metric-box"><div class="metric-label">Kandidat Unik Terfilter</div><div class="metric-value">${services.format.number(rows.length)}</div></div>
          <div class="metric-box"><div class="metric-label">Perkiraan Ruas (approximate)</div><div class="metric-value">${services.format.number(approxCount)}</div></div>
          <div class="metric-box"><div class="metric-label">Kecamatan Saja (geom = null)</div><div class="metric-value">${services.format.number(rows.length - approxCount)}</div></div>
          <div class="metric-box"><div class="metric-label">Status Verifikasi &amp; KDE</div><div class="metric-value metric-value--meta">needs_review / Non-KDE</div></div>
        `;
        return;
      }

      if (state.period === "bpbd-2021-2023") {
        const fire2022 = rows.reduce((s, r) => s + Number(r.fire_incidents || 0), 0);
        const fire2021 = rows.reduce((s, r) => s + Number(r.fire_incidents_2021 || 0), 0);
        metricsEl.innerHTML = `
          <div class="metric-box"><div class="metric-label">Kebakaran BPBD 2022</div><div class="metric-value">${services.format.number(fire2022)}</div></div>
          <div class="metric-box"><div class="metric-label">Kebakaran BPBD 2021</div><div class="metric-value">${services.format.number(fire2021)}</div></div>
          <div class="metric-box"><div class="metric-label">Kebakaran BPBD 2023 (Bulanan)</div><div class="metric-value">87</div></div>
          <div class="metric-box"><div class="metric-label">Peran Dataset</div><div class="metric-value metric-value--meta">Pembanding BPBD</div></div>
        `;
        return;
      }

      if (state.period === "bpbd-2022-2023-bulanan") {
        const fireTotal = rows.reduce((s, r) => s + Number(r.fire_incidents || 0), 0);
        const fire2022 = rows
          .filter((r) => Number(r.period_year) === 2022)
          .reduce((s, r) => s + Number(r.fire_incidents || 0), 0);
        const fire2023 = rows
          .filter((r) => Number(r.period_year) === 2023)
          .reduce((s, r) => s + Number(r.fire_incidents || 0), 0);
        metricsEl.innerHTML = `
          <div class="metric-box"><div class="metric-label">Kebakaran BPBD (Filter)</div><div class="metric-value">${services.format.number(fireTotal)}</div></div>
          <div class="metric-box"><div class="metric-label">BPBD 2022 / 2023</div><div class="metric-value metric-value--meta">${services.format.number(fire2022)} / ${services.format.number(fire2023)}</div></div>
          <div class="metric-box"><div class="metric-label">Baris Bulan Terfilter</div><div class="metric-value">${services.format.number(rows.length)}</div></div>
          <div class="metric-box"><div class="metric-label">Peran Dataset</div><div class="metric-value metric-value--meta">Pembanding BPBD (geom = null)</div></div>
        `;
        return;
      }

      if (state.period === "non-kebakaran-2023-2025") {
        const totalRescues = rows.reduce((s, r) => s + Number(r.total_rescues || 0), 0);
        metricsEl.innerHTML = `
          <div class="metric-box"><div class="metric-label">Operasi Non-Kebakaran</div><div class="metric-value">${services.format.number(totalRescues)}</div></div>
          <div class="metric-box"><div class="metric-label">Total Arsip 2023 - 2025</div><div class="metric-value">${services.format.number(summary.non_fire_rescues?.combined_total || 0)}</div></div>
          <div class="metric-box"><div class="metric-label">Baris Bulan Terfilter</div><div class="metric-value">${services.format.number(rows.length)}</div></div>
          <div class="metric-box"><div class="metric-label">Klasifikasi</div><div class="metric-value metric-value--meta">Non-Kebakaran (Terpisah)</div></div>
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
      const isPublicMode = state.period === "kandidat-independen";
      const supportsDistrict =
        state.period === "2023-kecamatan" ||
        state.period === "bpbd-2021-2023" ||
        isPublicMode;
      const supportsCategory =
        state.period === "2023-kecamatan" ||
        state.period === "2024-bulanan" ||
        state.period === "2025-bulanan" ||
        isPublicMode;

      districtSel.disabled = !supportsDistrict;
      periodSel.disabled = false;
      categorySel.disabled = !supportsCategory;
      sortSel.disabled = false;
      if (publicFiltersBar) {
        publicFiltersBar.hidden = !isPublicMode;
      }

      updateBanner();

      const activeRows = isPublicMode
        ? filterIndependentCandidates(summary.independent_incident_candidates?.records || [], {
            district: state.district,
            category: state.category,
            year: state.publicYear,
            source: state.publicSource,
            accuracy: state.publicAccuracy,
            search: state.search,
            sortBy: state.sortBy
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

      const isRecordKeyMode = isPublicMode;
      if (!state.selectedKey || !activeRows.some((r) => getRowKey(r, isRecordKeyMode) === state.selectedKey)) {
        state.selectedKey = activeRows[0] ? getRowKey(activeRows[0], isRecordKeyMode) : null;
      }

      const selectedRow = activeRows.find((r) => getRowKey(r, isRecordKeyMode) === state.selectedKey);

      renderMetrics(activeRows);
      const nextLayerKey = getMapLayerKey();
      const nextExtentCtx = {
        demoMode: false,
        period: state.period,
        district: state.district
      };
      if (nextLayerKey !== lastMapLayerKey) {
        const shouldFit = shouldResetMapExtent(lastExtentCtx, nextExtentCtx);
        lastMapLayerKey = nextLayerKey;
        lastExtentCtx = nextExtentCtx;
        renderMapAndLegend(activeRows, { fitExtent: shouldFit });
      } else if (districtGeoLayer && isChoroplethPeriod()) {
        districtGeoLayer.setStyle((feature) => computeDistrictFeatureStyle(feature));
      }
      renderChart(activeRows);
      renderTable(activeRows);
      renderUptCandidatesPanel();
      updateDetail(selectedRow);
    }

    function resetFilters() {
      state.period = "2023-kecamatan";
      state.district = "semua";
      state.category = "semua";
      state.publicYear = "semua";
      state.publicSource = "semua";
      state.publicAccuracy = "semua";
      state.search = "";
      state.sortBy = "default";
      state.selectedKey = null;
      periodSel.value = state.period;
      districtSel.value = state.district;
      categorySel.value = state.category;
      if (publicYearSel) publicYearSel.value = "semua";
      if (publicSourceSel) publicSourceSel.value = "semua";
      if (publicAccuracySel) publicAccuracySel.value = "semua";
      searchInput.value = "";
      sortSel.value = state.sortBy;
      syncView();
    }

    function switchTab(nextTab) {
      state.activeTab = nextTab;
      const showVerified = nextTab === "verified";
      const showUnlocated = nextTab === "unlocated";
      const showSimulation = nextTab === "simulation";
      tabVerifiedBtn.setAttribute("aria-selected", String(showVerified));
      tabUnlocatedBtn.setAttribute("aria-selected", String(showUnlocated));
      tabSimulationBtn.setAttribute("aria-selected", String(showSimulation));
      tabVerifiedPanel.hidden = !showVerified;
      tabUnlocatedPanel.hidden = !showUnlocated;
      tabSimulationPanel.hidden = !showSimulation;
      if (showVerified) {
        if (invalidateTimer) clearTimeout(invalidateTimer);
        invalidateTimer = setTimeout(() => {
          invalidateTimer = null;
          if (isMounted && mapHandle.map._mapPane) {
            mapHandle.map.invalidateSize({ animate: false });
          }
        }, 0);
      } else if (showSimulation) {
        simulationHandle.activate();
      }
    }

    periodSel.addEventListener(
      "change",
      () => {
        state.period = periodSel.value;
        if (
          state.period !== "2023-kecamatan" &&
          state.period !== "bpbd-2021-2023" &&
          state.period !== "kandidat-independen"
        ) {
          state.district = "semua";
          districtSel.value = "semua";
        }
        if (
          state.period === "2023-dampak" ||
          state.period === "2016-2025-tahunan" ||
          state.period === "2016-2021-bulanan" ||
          state.period === "bpbd-2021-2023" ||
          state.period === "bpbd-2022-2023-bulanan" ||
          state.period === "non-kebakaran-2023-2025"
        ) {
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
    if (supabasePointsToggle) {
      supabasePointsToggle.addEventListener(
        "change",
        () => {
          state.showSupabasePoints = supabasePointsToggle.checked;
          syncView();
        },
        { signal: ac.signal }
      );
    }
    tabVerifiedBtn.addEventListener("click", () => switchTab("verified"), { signal: ac.signal });
    tabUnlocatedBtn.addEventListener("click", () => switchTab("unlocated"), { signal: ac.signal });
    tabSimulationBtn.addEventListener("click", () => switchTab("simulation"), { signal: ac.signal });
    if (openSimBtn) {
      openSimBtn.addEventListener("click", () => switchTab("simulation"), { signal: ac.signal });
    }

    const tabOrder = ["verified", "unlocated", "simulation"];
    const tabBtns = {
      verified: tabVerifiedBtn,
      unlocated: tabUnlocatedBtn,
      simulation: tabSimulationBtn
    };
    const handleTabKey = (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const curIdx = Math.max(0, tabOrder.indexOf(state.activeTab));
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const nextTab = tabOrder[(curIdx + delta + tabOrder.length) % tabOrder.length];
        switchTab(nextTab);
        tabBtns[nextTab]?.focus();
      }
    };
    tabVerifiedBtn.addEventListener("keydown", handleTabKey, { signal: ac.signal });
    tabUnlocatedBtn.addEventListener("keydown", handleTabKey, { signal: ac.signal });
    tabSimulationBtn.addEventListener("keydown", handleTabKey, { signal: ac.signal });

    if (publicYearSel) {
      publicYearSel.addEventListener(
        "change",
        () => {
          state.publicYear = publicYearSel.value;
          state.selectedKey = null;
          syncView();
        },
        { signal: ac.signal }
      );
    }
    if (publicSourceSel) {
      publicSourceSel.addEventListener(
        "change",
        () => {
          state.publicSource = publicSourceSel.value;
          state.selectedKey = null;
          syncView();
        },
        { signal: ac.signal }
      );
    }
    if (publicAccuracySel) {
      publicAccuracySel.addEventListener(
        "change",
        () => {
          state.publicAccuracy = publicAccuracySel.value;
          state.selectedKey = null;
          syncView();
        },
        { signal: ac.signal }
      );
    }

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
      supabaseOverlay.clearLayers();
      if (chartHandle) {
        chartHandle.destroy();
        chartHandle = null;
      }
      simulationHandle.destroy();
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
