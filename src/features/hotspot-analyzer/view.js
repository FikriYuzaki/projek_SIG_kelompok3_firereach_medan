export function renderHotspotPlaceholder({ container, manifest }) {
  container.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${manifest.title}</h1>
        <p class="page-lead">${manifest.description}</p>
      </div>
      <span class="status-badge status-badge--soon">[ ] Coming Soon</span>
    </section>
    <section class="panel">
      <p>Modul milik <strong>${manifest.owner}</strong>. Lihat <code>docs/tasks/adeptri.md</code> dan <code>data/fixtures/demo/hotspot-analyzer.demo.json</code> untuk kontrak data awal.</p>
    </section>
  `;
  return async function unmount() {};
}
