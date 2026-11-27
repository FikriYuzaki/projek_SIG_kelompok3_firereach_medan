import { FEATURE_REGISTRY, FEATURE_STATUS_META } from "./feature-registry.js";
import { describeActiveDataSource } from "./data-status.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderStatusIcon(markerKey) {
  if (markerKey === "active" || markerKey === "[+]") {
    return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4 6.4 11.6 12.8 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (markerKey === "warn" || markerKey === "[!]") {
    return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 14.2 13.4H1.8L8 2.2Zm0 4.3v3.2m0 1.8h.01" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (markerKey === "dev" || markerKey === "review" || markerKey === "[~]" || markerKey === "[?]") {
    return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>`;
  }
  return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

export function createShellLayout(rootElement, supabaseStatus, initialSnapshotStatus = null) {
  const sourceMeta = describeActiveDataSource(
    initialSnapshotStatus || { mode: supabaseStatus.isConfigured ? "supabase_pending" : "local" }
  );
  rootElement.innerHTML = `
    <div class="app-shell">
      <a class="skip-link" href="#app-main">Langsung ke konten utama</a>
      <header class="app-header">
        <div class="app-header-left">
          <button
            type="button"
            class="menu-trigger"
            id="mobile-menu-trigger"
            aria-expanded="false"
            aria-controls="app-sidebar"
            aria-label="Buka menu navigasi"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <rect x="2" y="3" width="14" height="2" fill="currentColor"></rect>
              <rect x="2" y="8" width="14" height="2" fill="currentColor"></rect>
              <rect x="2" y="13" width="14" height="2" fill="currentColor"></rect>
            </svg>
            <span>Menu</span>
          </button>
          <a href="/" class="brand-link" data-nav="/">
            <span class="brand-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16">
                <path d="M8 1.5L13.5 14H2.5L8 1.5Z" fill="currentColor"></path>
              </svg>
            </span>
            <span>FireReach Medan</span>
            <span class="brand-subtitle">Web GIS Kebakaran &amp; Layanan Damkarmat</span>
          </a>
        </div>
        <div class="header-status-group">
          <span
            class="status-badge ${supabaseStatus.isConfigured ? "status-badge--active" : "status-badge--local"}"
            id="supabase-status-badge"
            title="${escapeHtml(supabaseStatus.note)}"
          >
            ${renderStatusIcon(supabaseStatus.isConfigured ? "active" : "local")}
            <span>Koneksi: ${escapeHtml(supabaseStatus.statusLabel)}</span>
          </span>
          <span
            class="status-badge ${sourceMeta.badgeClass}"
            id="data-source-status-badge"
            title="${escapeHtml(sourceMeta.title)}"
            role="status"
            aria-live="polite"
          >
            <span data-role="marker" aria-hidden="true">${renderStatusIcon(sourceMeta.marker)}</span>
            <span data-role="label">${escapeHtml(sourceMeta.label)}</span>
          </span>
        </div>
      </header>

      <div class="shell-body">
        <div class="sidebar-backdrop" id="sidebar-backdrop" hidden></div>
        <aside class="app-sidebar" id="app-sidebar" aria-label="Navigasi aplikasi">
          <div class="sidebar-mobile-top">
            <strong>Navigasi FireReach</strong>
            <button type="button" class="btn btn-secondary btn-sm" id="mobile-menu-close" aria-label="Tutup menu navigasi">
              Tutup
            </button>
          </div>
          <nav aria-label="Navigasi utama">
            <div class="nav-group-label">Ringkasan &amp; Referensi</div>
            <ul class="nav-list">
              <li>
                <a href="/" class="nav-link" data-nav="/">
                  <span class="nav-link-main">Dashboard</span>
                </a>
              </li>
              <li>
                <a href="/about" class="nav-link" data-nav="/about">
                  <span class="nav-link-main">Tentang &amp; Sumber Data</span>
                </a>
              </li>
            </ul>

            <div class="nav-group-label" style="margin-top: var(--space-5);">Empat Modul Analisis</div>
            <ul class="nav-list" id="module-nav-list">
              ${FEATURE_REGISTRY.map((feat) => {
                const meta = FEATURE_STATUS_META[feat.status];
                return `
                  <li>
                    <a href="${feat.route}" class="nav-link" data-nav="${feat.route}">
                      <span class="nav-link-main">${feat.shortTitle}</span>
                      <span class="status-badge ${meta.badgeClass}">
                        ${renderStatusIcon(meta.marker)}
                        <span>${meta.label}</span>
                      </span>
                    </a>
                  </li>
                `;
              }).join("")}
            </ul>
          </nav>
        </aside>

        <main class="app-main" id="app-main" tabindex="-1">
          <div class="app-main-inner">
            <div class="notification-region" id="app-notification" role="status" aria-live="polite" hidden></div>
            <div id="route-outlet"></div>
          </div>
        </main>
      </div>

      <footer class="app-footer">
        <div class="app-footer-inner">
          <span>FireReach Medan | Kota Medan, Sumatera Utara</span>
          <span class="mono">Web CRS: EPSG:4326 | QGIS Metric CRS: EPSG:32647</span>
        </div>
      </footer>
    </div>
  `;

  const menuTrigger = rootElement.querySelector("#mobile-menu-trigger");
  const closeBtn = rootElement.querySelector("#mobile-menu-close");
  const sidebar = rootElement.querySelector("#app-sidebar");
  const backdrop = rootElement.querySelector("#sidebar-backdrop");
  const outlet = rootElement.querySelector("#route-outlet");
  const notificationRegion = rootElement.querySelector("#app-notification");
  const dataSourceBadge = rootElement.querySelector("#data-source-status-badge");
  const dataSourceMarkerEl = dataSourceBadge?.querySelector('[data-role="marker"]');
  const dataSourceLabelEl = dataSourceBadge?.querySelector('[data-role="label"]');

  function updateDataSourceStatus(snapshotStatus) {
    if (!dataSourceBadge) return;
    const next = describeActiveDataSource(snapshotStatus);
    dataSourceBadge.className = `status-badge ${next.badgeClass}`;
    dataSourceBadge.title = next.title;
    if (dataSourceMarkerEl) dataSourceMarkerEl.innerHTML = renderStatusIcon(next.marker);
    if (dataSourceLabelEl) dataSourceLabelEl.textContent = next.label;
  }

  function setDrawerOpen(open) {
    sidebar.classList.toggle("is-open", open);
    backdrop.hidden = !open;
    menuTrigger.setAttribute("aria-expanded", String(open));
    if (open) {
      closeBtn.focus();
    } else if (document.activeElement && sidebar.contains(document.activeElement)) {
      menuTrigger.focus();
    }
  }

  menuTrigger.addEventListener("click", () => {
    const isOpen = sidebar.classList.contains("is-open");
    setDrawerOpen(!isOpen);
  });

  closeBtn.addEventListener("click", () => setDrawerOpen(false));
  backdrop.addEventListener("click", () => setDrawerOpen(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebar.classList.contains("is-open")) {
      setDrawerOpen(false);
    }
  });

  function setActiveRoute(pathname) {
    const links = rootElement.querySelectorAll("a[data-nav]");
    links.forEach((link) => {
      const target = link.getAttribute("data-nav");
      if (target === pathname) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  return {
    outlet,
    notificationRegion,
    setActiveRoute,
    closeDrawer: () => setDrawerOpen(false),
    updateDataSourceStatus
  };
}
