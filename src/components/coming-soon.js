import { FEATURE_STATUS_META } from "../core/feature-registry.js";

export function renderComingSoon({ container, feature, navigate }) {
  const statusMeta = FEATURE_STATUS_META[feature.status] || FEATURE_STATUS_META["coming-soon"];

  container.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${feature.title}</h1>
        <p class="page-lead">${feature.description}</p>
      </div>
      <span class="status-badge ${statusMeta.badgeClass}">
        <span aria-hidden="true">${statusMeta.marker}</span>
        <span>${statusMeta.label}</span>
      </span>
    </section>

    <div class="split-layout split-layout--balanced">
      <section class="panel">
        <h2>Status Pengembangan Modul</h2>
        <p>
          Modul ini belum tersedia untuk analisis interaktif dan masih berada pada tahap
          <strong>${statusMeta.label}</strong> oleh penanggung jawab <strong>${feature.owner}</strong>.
        </p>
        <p class="page-lead" style="font-size: var(--text-sm);">
          Aktivasi modul hanya dilakukan setelah input spasial, parameter QGIS/PostGIS, dan pengujian penerimaan lolos tinjauan tim.
        </p>
        <div style="display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-4);">
          <a href="/" class="btn btn-primary" data-nav="/">Kembali ke Dashboard</a>
          <a href="/about" class="btn btn-secondary" data-nav="/about">Lihat Sumber Data &amp; Kontrak</a>
        </div>
      </section>

      <section class="panel-subtle">
        <h2>Rencana Input &amp; Output Kontrak</h2>
        <p style="font-size: var(--text-sm); margin-bottom: var(--space-2);">
          <strong>Folder kepemilikan:</strong> <code class="mono">src/features/${feature.id}/</code>
        </p>
        <p style="font-size: var(--text-sm); margin-bottom: var(--space-1);"><strong>Input terverifikasi yang dibutuhkan:</strong></p>
        <ul style="font-size: var(--text-sm); padding-left: var(--space-5); margin-bottom: var(--space-3);">
          ${(feature.plannedInputs || []).map((item) => `<li>${item}</li>`).join("")}
        </ul>
        <p style="font-size: var(--text-sm); margin-bottom: var(--space-1);"><strong>Output target:</strong></p>
        <ul style="font-size: var(--text-sm); padding-left: var(--space-5); margin-bottom: 0;">
          ${(feature.plannedOutputs || []).map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </section>
    </div>
  `;

  const backLink = container.querySelector('a[href="/"]');
  if (backLink && typeof navigate === "function") {
    backLink.addEventListener("click", (e) => {
      e.preventDefault();
      navigate("/");
    });
  }

  return async function unmount() {};
}
