export function renderStationCoveragePlaceholder({ container, manifest }) {
  container.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${manifest.title}</h1>
        <p class="page-lead">${manifest.description}</p>
      </div>
      <span class="status-badge status-badge--soon">[ ] Coming Soon</span>
    </section>
    <section class="panel">
      <p>Modul milik <strong>${manifest.owner}</strong>. Lihat <code>docs/tasks/adriel.md</code> dan <code>data/fixtures/demo/station-coverage.demo.json</code> untuk kontrak data awal.</p>
    </section>
  `;
  return async function unmount() {};
}
