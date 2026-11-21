import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const DELIVERABLES_DIR = path.join(ROOT, "deliverables");
const BUNDLE_DIR = path.join(DELIVERABLES_DIR, "ta-kelompok3-firereach-medan");
const ZIP_PATH = path.join(DELIVERABLES_DIR, "FireReach_Medan_Kelompok3_TA_SIG.zip");
const REPORT_MD_PATH = path.join(ROOT, "docs", "laporan", "DRAFT_MAKALAH_SIG_FIREREACH_MEDAN.md");
const REPORT_PDF_PATH = path.join(ROOT, "docs", "laporan", "DRAFT_Laporan_TA_SIG_FireReach_Medan.pdf");

const PNG_FILES = [
  path.join(ROOT, "qgis", "hotspot-analysis", "exports", "peta_agregat_kebakaran_medan_2023_template_kde.png"),
  path.join(ROOT, "qgis", "station-coverage", "exports", "peta_jangkauan_pos_damkarmat_medan_mako00.png"),
  path.join(ROOT, "qgis", "priority-analysis", "exports", "peta_prioritas_layanan_kebakaran_medan_provisional.png")
];

const QGIS_SUBDIRS = ["hotspot-analysis", "station-coverage", "priority-analysis"];

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInlineMarkdown(text, reportDir) {
  let s = escapeHtml(text);
  // Images first: ![alt](src)
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, rawSrc) => {
    const resolved = path.resolve(reportDir, rawSrc);
    if (fs.existsSync(resolved)) {
      const b64 = fs.readFileSync(resolved).toString("base64");
      return `<figure class="map-figure"><img src="data:image/png;base64,${b64}" alt="${alt}" /><figcaption>${alt}</figcaption></figure>`;
    }
    return `<div class="missing-img">[Gambar tidak ditemukan: ${escapeHtml(rawSrc)}]</div>`;
  });
  // Display equation $$...$$
  s = s.replace(/\$\$([^$]+)\$\$/g, (_m, expr) => {
    const cleaned = expr
      .replaceAll("\\text{", "")
      .replaceAll("}", "")
      .replaceAll("\\cdot", "&middot;")
      .replaceAll("\\_", "_");
    return `<div class="formula-box"><code>${cleaned}</code></div>`;
  });
  // Bold, code, italics
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return s;
}

function markdownToHtml(mdText, reportDir) {
  const lines = mdText.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inUl = false;
  let inOl = false;
  let inTable = false;
  let tableHeaderDone = false;
  let inQuote = false;

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
      tableHeaderDone = false;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      out.push("</blockquote>");
      inQuote = false;
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const line = rawLine.trim();

    if (!line) {
      closeLists();
      closeTable();
      closeQuote();
      continue;
    }

    if (line === "---") {
      closeLists();
      closeTable();
      closeQuote();
      out.push("<hr />");
      continue;
    }

    if (line.startsWith("> ")) {
      closeLists();
      closeTable();
      if (!inQuote) {
        out.push("<blockquote>");
        inQuote = true;
      }
      out.push(`<p>${renderInlineMarkdown(line.slice(2), reportDir)}</p>`);
      continue;
    } else {
      closeQuote();
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      closeLists();
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      const isSeparator = cells.every((c) => /^:?-+:?$/.test(c));
      if (!inTable) {
        out.push("<table><thead><tr>");
        for (const c of cells) {
          out.push(`<th>${renderInlineMarkdown(c, reportDir)}</th>`);
        }
        out.push("</tr></thead><tbody>");
        inTable = true;
        tableHeaderDone = false;
        continue;
      }
      if (isSeparator && !tableHeaderDone) {
        tableHeaderDone = true;
        continue;
      }
      out.push("<tr>");
      for (const c of cells) {
        out.push(`<td>${renderInlineMarkdown(c, reportDir)}</td>`);
      }
      out.push("</tr>");
      continue;
    } else {
      closeTable();
    }

    if (line.startsWith("### ")) {
      closeLists();
      out.push(`<h3>${renderInlineMarkdown(line.slice(4), reportDir)}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeLists();
      out.push(`<h2>${renderInlineMarkdown(line.slice(3), reportDir)}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeLists();
      out.push(`<h1>${renderInlineMarkdown(line.slice(2), reportDir)}</h1>`);
      continue;
    }

    const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${renderInlineMarkdown(olMatch[2], reportDir)}</li>`);
      continue;
    }

    const ulMatch = line.match(/^-\s+(.*)$/);
    if (ulMatch) {
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${renderInlineMarkdown(ulMatch[1], reportDir)}</li>`);
      continue;
    }

    closeLists();
    out.push(`<p>${renderInlineMarkdown(line, reportDir)}</p>`);
  }

  closeLists();
  closeTable();
  closeQuote();

  return out.join("\n");
}

function buildHtmlDocument(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>DRAFT Laporan TA SIG - FireReach Medan Kelompok 3</title>
<style>
  @page {
    size: A4 portrait;
    margin: 18mm 16mm 18mm 18mm;
  }
  body {
    font-family: "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif;
    color: #202A2D;
    font-size: 10pt;
    line-height: 1.5;
    margin: 0;
    padding: 0;
  }
  h1 {
    font-size: 15.5pt;
    color: #202A2D;
    border-bottom: 2px solid #B84A35;
    padding-bottom: 6px;
    margin-top: 0;
  }
  h2 {
    font-size: 12.5pt;
    color: #356067;
    margin-top: 16pt;
    margin-bottom: 6pt;
    page-break-after: avoid;
  }
  h3 {
    font-size: 10.5pt;
    color: #202A2D;
    margin-top: 11pt;
    margin-bottom: 4pt;
    page-break-after: avoid;
  }
  p, li {
    text-align: justify;
    margin: 0 0 6pt 0;
  }
  blockquote {
    background: #FAF6EE;
    border-left: 4px solid #8A5218;
    padding: 8pt 10pt;
    margin: 8pt 0 12pt 0;
    font-size: 9.2pt;
  }
  code {
    font-family: "IBM Plex Mono", Consolas, monospace;
    font-size: 8.6pt;
    background: #F4F2EC;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .formula-box {
    background: #F4F2EC;
    border: 1px solid #D9D5CB;
    padding: 7pt 10pt;
    margin: 6pt 0 10pt 0;
    text-align: center;
  }
  .formula-box code {
    background: transparent;
    font-size: 9.5pt;
    font-weight: 600;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0 12pt 0;
    font-size: 8pt;
    page-break-inside: auto;
  }
  thead {
    display: table-header-group;
  }
  tr {
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #CFD4D6;
    padding: 4pt 5pt;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #ECEAE2;
    color: #202A2D;
    font-weight: 700;
  }
  figure.map-figure {
    margin: 10pt 0 14pt 0;
    padding: 6pt;
    border: 1px solid #D9D5CB;
    background: #FFFFFF;
    page-break-inside: avoid;
    text-align: center;
  }
  figure.map-figure img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0 auto 5pt auto;
  }
  figure.map-figure figcaption {
    font-size: 8.5pt;
    color: #556164;
    font-weight: 600;
  }
  hr {
    border: 0;
    border-top: 1px solid #D9D5CB;
    margin: 12pt 0;
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function copyFilteredDir(srcDir, dstDir, skipNames = new Set()) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyFilteredDir(srcPath, dstPath, skipNames);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

async function generatePdfReport() {
  if (!fs.existsSync(REPORT_MD_PATH)) {
    throw new Error(`Draft markdown tidak ditemukan: ${REPORT_MD_PATH}`);
  }
  const mdText = fs.readFileSync(REPORT_MD_PATH, "utf-8");
  const bodyHtml = markdownToHtml(mdText, path.dirname(REPORT_MD_PATH));
  const fullHtml = buildHtmlDocument(bodyHtml);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: "load" });
    await page.pdf({
      path: REPORT_PDF_PATH,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate:
        '<div style="font-size:7.5pt; color:#556164; width:100%; text-align:right; padding-right:16mm; font-family:Arial,sans-serif;">DRAFT Laporan Tugas Akhir SIG - FireReach Medan (Kelompok 3)</div>',
      footerTemplate:
        '<div style="font-size:7.5pt; color:#556164; width:100%; text-align:center; font-family:Arial,sans-serif;">Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></div>',
      margin: { top: "18mm", bottom: "18mm", left: "18mm", right: "16mm" }
    });
  } finally {
    await browser.close();
  }
}

function assembleDeliverablePackage() {
  const distDir = path.join(ROOT, "dist");
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    throw new Error("Folder dist/ belum tersedia. Jalankan `npm run build` sebelum build_ta_deliverable.mjs.");
  }
  for (const pngPath of PNG_FILES) {
    if (!fs.existsSync(pngPath)) {
      throw new Error(`PNG layout wajib tidak ditemukan: ${pngPath}`);
    }
  }

  fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUNDLE_DIR, { recursive: true });

  // 1. Peta Layout PNG
  const pngOutDir = path.join(BUNDLE_DIR, "01_Peta_Layout_PNG");
  fs.mkdirSync(pngOutDir, { recursive: true });
  for (const pngPath of PNG_FILES) {
    fs.copyFileSync(pngPath, path.join(pngOutDir, path.basename(pngPath)));
  }

  // 2. Proyek QGIS (.qgz, layers, styles, python scripts)
  const qgisOutDir = path.join(BUNDLE_DIR, "02_Proyek_QGIS");
  const skipNames = new Set(["__pycache__", ".pytest_cache"]);
  for (const sub of QGIS_SUBDIRS) {
    copyFilteredDir(path.join(ROOT, "qgis", sub), path.join(qgisOutDir, sub), skipNames);
  }

  // 3. Web Map Interaktif (Vite built dist/)
  const webOutDir = path.join(BUNDLE_DIR, "03_Web_Map_Interaktif");
  copyFilteredDir(distDir, webOutDir);

  // 4. Makalah / Laporan (.PDF + .MD)
  const reportOutDir = path.join(BUNDLE_DIR, "04_Makalah_Laporan");
  fs.mkdirSync(reportOutDir, { recursive: true });
  fs.copyFileSync(REPORT_MD_PATH, path.join(reportOutDir, path.basename(REPORT_MD_PATH)));
  fs.copyFileSync(REPORT_PDF_PATH, path.join(reportOutDir, path.basename(REPORT_PDF_PATH)));

  // 5. README Struktur Pengumpulan
  const readmeContent = [
    "# Paket Pengumpulan Tugas Akhir SIG - FireReach Medan (Kelompok 3)",
    "",
    "Catatan: Lengkapi bagian `[LENGKAPI: ...]` pada `04_Makalah_Laporan/DRAFT_MAKALAH_SIG_FIREREACH_MEDAN.md`",
    "lalu kompilasi ulang PDF dengan `node scripts/build_ta_deliverable.mjs` sebelum pengumpulan resmi.",
    "",
    "## Struktur Folder",
    "- `01_Peta_Layout_PNG/` : 3 peta layout A4 Landscape ekspor QGIS (150 DPI):",
    "  - `peta_agregat_kebakaran_medan_2023_template_kde.png`",
    "  - `peta_jangkauan_pos_damkarmat_medan_mako00.png`",
    "  - `peta_prioritas_layanan_kebakaran_medan_provisional.png`",
    "- `02_Proyek_QGIS/` : Proyek portabel `.qgz` (`medan_hotspot_template.qgz`, `station_coverage.qgz`, `priority_analysis.qgz`), layer GeoPackage/GeoJSON, style `.qml`, dan skrip PyQGIS.",
    "- `03_Web_Map_Interaktif/` : Bundel produksi aplikasi Web GIS interaktif FireReach Medan (siap dilayani lewat HTTP server statis apa pun).",
    "- `04_Makalah_Laporan/` : Draft makalah terstruktur (`.md`) dan berkas cetak (`.pdf`).",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(BUNDLE_DIR, "README_STRUKTUR_PENGUMPULAN.md"), readmeContent, "utf-8");

  if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
  }
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${BUNDLE_DIR}\\*' -DestinationPath '${ZIP_PATH}' -Force`
    ],
    { stdio: "inherit" }
  );
}

async function main() {
  await generatePdfReport();
  assembleDeliverablePackage();
  const pdfSize = fs.statSync(REPORT_PDF_PATH).size;
  const zipSize = fs.statSync(ZIP_PATH).size;
  console.log(`Deliverable siap: PDF=${REPORT_PDF_PATH} (${pdfSize} bytes), ZIP=${ZIP_PATH} (${zipSize} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
