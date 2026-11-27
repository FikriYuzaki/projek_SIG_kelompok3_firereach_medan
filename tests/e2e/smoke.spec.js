import { expect, test } from "@playwright/test";

test.describe("FireReach Medan E2E Smoke & Quality Gate", () => {
  test("covers dashboard, Hotspot Analyzer, Station Coverage, Priority Planner, Explorer filters, WebGL fallback, lifecycle cleanup, error state, and responsive layout", async ({
    page
  }) => {
    test.setTimeout(60000);
    const consoleErrors = [];
    const pageErrors = [];
    const failedAssets = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("response", (res) => {
      const url = res.url();
      if (url.startsWith("http://127.0.0.1:4173") && res.status() >= 400) {
        failedAssets.push(`${res.status()} ${url}`);
      }
    });

    // 1. Desktop Dashboard load + Supabase local status + 4 module nav items
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Ringkasan Pemetaan Kebakaran Kota Medan/i })).toBeVisible();
    await expect(page.locator("#supabase-status-badge")).toContainText("Koneksi: Mode Lokal");
    await expect(page.locator("#data-source-status-badge")).toContainText("Sumber Data: JSON Lokal");

    for (const navLabel of ["Incident Explorer", "Hotspot Analyzer", "Station Coverage", "Priority Planner"]) {
      await expect(page.locator("#module-nav-list").getByText(navLabel)).toBeVisible();
    }

    // Check desktop no horizontal overflow
    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(desktopOverflow).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? 0)).toBe(1);

    // 2. Fire Hotspot Analyzer module interactions, 4-tier filter, metadata, chart empty state, and lifecycle cleanup
    await page.locator("#module-nav-list a[href='/hotspot-analyzer']").click();
    await expect(page.getByRole("heading", { name: "Fire Hotspot Analyzer" })).toBeVisible();
    await expect(page.locator("#hotspot-data-status-badge")).toHaveAttribute("data-status-mode", "demo");
    await expect(page.getByText(/STATUS DATA \(DEMO\)/i)).toBeVisible();
    await expect(page.locator("#hotspot-metadata-kv")).toContainText("Quartic");
    await expect(page.locator("#hotspot-metadata-kv")).toContainText("1.000 meter");
    await expect(page.locator("#hotspot-metadata-kv")).toContainText("100 meter");
    await expect(page.locator("#hotspot-metadata-kv")).toContainText("OpenStreetMap");
    await expect(page.locator("#hotspot-map")).toBeVisible();
    await expect.poll(() => page.locator("#hotspot-map .leaflet-interactive").count()).toBeGreaterThan(0);
    await expect(page.locator("#hotspot-table-count")).toHaveText("2 zona");
    await expect(page.locator("#hotspot-chart-frame")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? 0)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeCharts ?? 0)).toBe(1);

    // Verify table selection updates detail panel and map interaction works
    await page.locator("tr[data-zone-id='demo-hotspot-2']").click();
    await expect(page.locator("#hotspot-zone-detail")).toContainText("demo-hotspot-2");

    // Test 4-tier filter options including Sangat Tinggi (very-high)
    await page.selectOption("#hotspot-filter-tier", "high");
    await expect(page.locator("#hotspot-table-count")).toHaveText("1 zona");
    await page.selectOption("#hotspot-filter-tier", "very-high");
    await expect(page.locator("#hotspot-table-count")).toHaveText("0 zona");
    await expect(page.locator("#hotspot-chart-empty")).toBeVisible();
    await page.click("#hotspot-filter-reset");
    await expect(page.locator("#hotspot-table-count")).toHaveText("2 zona");
    await expect(page.locator("#hotspot-chart-frame")).toBeVisible();

    // Test search empty state + reset recovery
    await page.fill("#hotspot-filter-search", "zona-tidak-ada-xyz");
    await expect(page.locator("#hotspot-table-count")).toHaveText("0 zona");
    await expect(page.locator("#hotspot-chart-empty")).toBeVisible();
    await page.click("#hotspot-filter-reset");
    await expect(page.locator("#hotspot-table-count")).toHaveText("2 zona");

    // Responsive checks on /hotspot-analyzer across desktop (1440), tablet (768), and mobile (375)
    for (const vp of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 }
    ]) {
      await page.setViewportSize(vp);
      const hotspotOverflow = await page.evaluate(() => {
        const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
        const metricOverflow = Array.from(document.querySelectorAll(".metric-box, .metric-value")).some(
          (el) => el.scrollWidth > el.clientWidth + 1
        );
        return { docOverflow, metricOverflow };
      });
      expect(hotspotOverflow.docOverflow).toBe(false);
      expect(hotspotOverflow.metricOverflow).toBe(false);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // Verify lifecycle cleanup when navigating away and re-mounting Hotspot Analyzer multiple times
    await page.locator("aside nav a[href='/about']").click();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? -1)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeCharts ?? -1)).toBe(0);

    await page.locator("#module-nav-list a[href='/hotspot-analyzer']").click();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? 0)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeCharts ?? 0)).toBe(1);

    // 3. Fire Station Coverage & Fire Service Priority Planner interactive modules + responsive checks
    await page.locator("#module-nav-list a[href='/station-coverage']").click();
    await expect(page.getByRole("heading", { name: "Fire Station Coverage" })).toBeVisible();
    await expect(page.locator("#coverage-status-badge")).toHaveAttribute("data-status-mode", "provisional");
    await expect(page.locator("#coverage-status-badge")).toContainText("PROVISIONAL");
    await expect(page.locator("#coverage-table-count")).toHaveText("21 dari 21 kecamatan");
    await expect.poll(() => page.locator("#coverage-map .leaflet-interactive").count()).toBeGreaterThan(0);
    await expect(page.locator("#coverage-chart-frame")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? 0)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeCharts ?? 0)).toBe(1);

    await page.uncheck("#coverage-toggle-euclidean");
    await page.selectOption("#coverage-band-select", "belum-terjangkau");
    await page.fill("#coverage-search-input", "tidak-ada-kecamatan-xyz");
    await expect(page.locator("#coverage-table-count")).toHaveText("0 dari 21 kecamatan");
    await page.click("#coverage-reset-btn");
    await expect(page.locator("#coverage-table-count")).toHaveText("21 dari 21 kecamatan");

    // Verified vs candidate counts & provenance table remain clearly separated
    await expect(page.locator("#coverage-kpi-verified")).toHaveText("1 Pos");
    await expect(page.locator("#coverage-kpi-candidates")).toHaveText("6 UPT");
    await expect(page.locator("#coverage-candidate-count-badge")).toContainText("6 KANDIDAT PUBLIK");
    await expect(page.locator("#coverage-stations-section")).toContainText("MAKO-00");
    await expect(page.locator("#coverage-stations-section")).toContainText("UPT-01");
    await expect(page.locator("#coverage-stations-section")).toContainText("UPT-04");
    await expect(page.locator("#coverage-stations-section")).toContainText("geom = null (kecamatan saja)");
    await expect(page.locator("#coverage-stations-section a[target='_blank']").first()).toHaveAttribute("target", "_blank");

    await page.uncheck("#coverage-toggle-candidates");
    await page.check("#coverage-toggle-candidates");

    // Candidate sensitivity scenario is strictly opt-in and marked non-official
    await page.selectOption("#coverage-scenario-select", "candidate_scenario");
    await expect(page.locator("#coverage-candidate-scenario-banner")).toBeVisible();
    await expect(page.locator("#coverage-candidate-scenario-banner")).toContainText("BUKAN CAKUPAN RESMI");
    await expect(page.locator("#coverage-kpi-net5-sub")).toContainText("Skenario non-resmi");

    // Zero delta stays neutral without '+' prefix, positive delta shows '+', table & controls do not clip at 1440px
    const deliDeltaCell = page.locator("#coverage-table-wrap tr[data-area-code='12.71.06'] td.coverage-delta-zero");
    await expect(deliDeltaCell).toHaveText("0.0%");
    await expect(page.locator("#coverage-table-wrap tr[data-area-code='12.71.06'] td.coverage-delta-pos")).toHaveCount(0);
    await page.locator("#coverage-table-wrap tr[data-area-code='12.71.06']").click();
    await expect(page.locator("#coverage-district-detail dd.coverage-delta-zero")).toHaveText("0.00 poin %");
    await expect(page.locator("#coverage-table-wrap tr[data-area-code='12.71.07'] td.coverage-delta-pos")).toHaveText("+68.9%");

    const desktopCoverageGeometry = await page.evaluate(() => {
      const invScroll = document.querySelector("#coverage-stations-table-wrap .table-scroll");
      const scenarioSelect = document.querySelector("#coverage-scenario-select");
      const searchInput = document.querySelector("#coverage-search-input");
      const invHeaderOverflow = Array.from(
        document.querySelectorAll("#coverage-stations-table-wrap thead th")
      ).some((th) => th.scrollWidth > th.clientWidth + 1);
      return {
        invOverflowPx: invScroll ? invScroll.scrollWidth - invScroll.clientWidth : -1,
        invHeaderOverflow,
        scenarioWidth: scenarioSelect ? Math.round(scenarioSelect.getBoundingClientRect().width) : 0,
        searchWidth: searchInput ? Math.round(searchInput.getBoundingClientRect().width) : 0
      };
    });
    expect(desktopCoverageGeometry.invOverflowPx).toBeLessThanOrEqual(1);
    expect(desktopCoverageGeometry.invHeaderOverflow).toBe(false);
    expect(desktopCoverageGeometry.scenarioWidth).toBeGreaterThanOrEqual(450);
    expect(desktopCoverageGeometry.searchWidth).toBeGreaterThanOrEqual(350);

    await page.click("#coverage-reset-btn");
    await expect(page.locator("#coverage-candidate-scenario-banner")).toBeHidden();
    await expect(page.locator("#coverage-table-count")).toHaveText("21 dari 21 kecamatan");

    for (const vp of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 }
    ]) {
      await page.setViewportSize(vp);
      const covOverflow = await page.evaluate(() => ({
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        metricOverflow: Array.from(document.querySelectorAll(".metric-box, .metric-value")).some(
          (el) => el.scrollWidth > el.clientWidth + 1
        )
      }));
      expect(covOverflow.docOverflow).toBe(false);
      expect(covOverflow.metricOverflow).toBe(false);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.locator("#module-nav-list a[href='/priority-planner']").click();
    await expect(page.getByRole("heading", { name: "Fire Service Priority Planner" })).toBeVisible();
    await expect(page.locator("#priority-status-badge")).toHaveAttribute("data-status-mode", "provisional");
    await expect(page.locator("#priority-status-badge")).toContainText("PROVISIONAL");
    await expect(page.locator("#priority-table-count")).toHaveText("21 dari 21 kecamatan");
    await expect.poll(() => page.locator("#priority-map .leaflet-interactive").count()).toBeGreaterThanOrEqual(21);
    await expect(page.locator("#priority-chart-frame")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? 0)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeCharts ?? 0)).toBe(1);

    // Invalid What-If weight sum is rejected without changing baseline
    await page.fill("#weight-hotspot-input", "60");
    await page.click("#priority-apply-weights");
    await expect(page.locator("#priority-weight-feedback")).toContainText("100%");
    await expect(page.locator("#priority-sim-badge")).toBeHidden();

    // Valid What-If weight recalculation + reset
    await page.fill("#weight-hotspot-input", "50");
    await page.fill("#weight-gap-input", "30");
    await page.fill("#weight-pop-input", "20");
    await page.click("#priority-apply-weights");
    await expect(page.locator("#priority-sim-badge")).toBeVisible();
    await expect(page.locator("#priority-active-weights-text")).toHaveText("50% / 30% / 20%");
    await page.click("#priority-reset-weights");
    await expect(page.locator("#priority-sim-badge")).toBeHidden();
    await expect(page.locator("#priority-active-weights-text")).toHaveText("40% / 35% / 25%");

    await page.fill("#priority-search-input", "tidak-ada-kecamatan-xyz");
    await expect(page.locator("#priority-table-count")).toHaveText("0 dari 21 kecamatan");
    await expect(page.locator("#priority-chart-empty")).toBeVisible();
    await page.click("#priority-filter-reset");
    await expect(page.locator("#priority-table-count")).toHaveText("21 dari 21 kecamatan");

    for (const vp of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 }
    ]) {
      await page.setViewportSize(vp);
      const prioOverflow = await page.evaluate(() => ({
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        metricOverflow: Array.from(document.querySelectorAll(".metric-box, .metric-value")).some(
          (el) => el.scrollWidth > el.clientWidth + 1
        )
      }));
      expect(prioOverflow.docOverflow).toBe(false);
      expect(prioOverflow.metricOverflow).toBe(false);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // 4. About & Data Sources page
    await page.locator("aside nav a[href='/about']").click();
    await expect(page.getByRole("heading", { name: /Tentang Proyek/i })).toBeVisible();
    await expect(page.getByText(/Register Sumber Data Terverifikasi/i)).toBeVisible();
    await expect(page.locator("a[href*='opendatacommons.org/licenses/odbl']")).toHaveAttribute("target", "_blank");
    await expect(page.locator("a[href*='openstreetmap.org/copyright']")).toHaveAttribute("target", "_blank");
    await expect(page.locator("a[href*='public_incident_candidates.json']")).toHaveAttribute("target", "_blank");

    // 5. Fire Incident Explorer interactions + filter checks + Damkarmat simulation + DEMO opt-in separation
    await page.locator("#module-nav-list a[href='/incident-explorer']").click();
    await expect(page.getByRole("heading", { name: "Fire Incident Explorer" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? 0)).toBe(1);

    // Default 2023 district view has 21 rows and 219 total
    await expect(page.locator("#explorer-table-count")).toHaveText("21 baris");

    // Filter by district
    await page.selectOption("#filter-district", "Medan Belawan");
    await expect(page.locator("#explorer-table-count")).toHaveText("1 baris");
    await expect(page.locator("#detail-kv")).toContainText("Medan Belawan");

    // Reset filter and test keyboard row selection in table
    await page.click("#filter-reset");
    await expect(page.locator("#explorer-table-count")).toHaveText("21 baris");
    const amplasRow = page.locator("tr[data-row-key='Medan Amplas']");
    await amplasRow.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#detail-kv")).toContainText("Medan Amplas");
    await expect(page.locator("#open-simulation-tab-btn")).toBeVisible();

    // Switch to 2024 monthly aggregate -> district filter disables honestly
    await page.selectOption("#filter-period", "2024-bulanan");
    await expect(page.locator("#filter-district")).toBeDisabled();
    await expect(page.locator("#explorer-table-count")).toHaveText("12 baris");
    await expect(page.locator("#explorer-granularity-banner")).toContainText("2024");

    // Switch category filter in 2025 monthly
    await page.selectOption("#filter-period", "2025-bulanan");
    await page.selectOption("#filter-category", "rumah");
    await expect(page.locator("#explorer-metrics")).toContainText("113");

    // Check 2023 impact & loss outlier mode
    await page.selectOption("#filter-period", "2023-dampak");
    await expect(page.locator("#filter-district")).toBeDisabled();
    await expect(page.locator("#filter-category")).toBeDisabled();
    await expect(page.locator("#explorer-table-count")).toHaveText("12 baris");
    await page.locator("tr[data-row-key='Maret']").click();
    await expect(page.locator("#detail-qa-note")).toContainText("776");

    // Check 2016-2025 annual series mode & verify sorting/search do not reset map zoom
    await page.selectOption("#filter-period", "2016-2025-tahunan");
    await expect(page.locator("#explorer-table-count")).toHaveText("10 tahun");
    await page.locator("#explorer-map .leaflet-control-zoom-in").click();
    const zoomAfterManualIn = await page.evaluate(
      () => window.__firereachDebug?.fitBoundsCalls ?? 0
    );
    await page.selectOption("#filter-sort", "desc");
    await expect(page.locator("#explorer-table-wrap tbody tr").first()).toContainText("2019");
    await page.fill("#filter-search", "2020");
    await expect(page.locator("#explorer-table-count")).toHaveText("1 tahun");
    const zoomAfterSortAndSearch = await page.evaluate(
      () => window.__firereachDebug?.fitBoundsCalls ?? 0
    );
    expect(zoomAfterSortAndSearch).toBe(zoomAfterManualIn);

    // Check empty filter state + Reset Filter recovery
    await page.fill("#filter-search", "tidak-ada-kecamatan-xyz");
    await expect(page.locator("#explorer-table-count")).toHaveText("0 baris");
    await expect(page.locator("#explorer-chart-empty")).toBeVisible();
    await page.click("#filter-reset");
    await expect(page.locator("#explorer-table-count")).toHaveText("21 baris");

    // Switch tab to Belum Terlokasi & Perlu Review and verify status filters + QA log
    await page.click("#tab-unlocated");
    await expect(page.getByText("UNLOC-2025-MONTHLY")).toBeVisible();
    await expect(page.getByText("UNLOC-2016-2022-ANNUAL")).toBeVisible();
    await expect(page.getByText("QA-2023-LOSS-OUTLIER")).toBeVisible();
    await expect(page.locator("#explorer-tab-unlocated").getByText("Medan Kota", { exact: true })).toBeVisible();

    await page.locator("[data-unloc-filter='needs_review']").click();
    await expect(page.locator("#unlocated-filtered-count")).toContainText("1 dari");
    await page.locator("[data-unloc-filter='semua']").click();
    await expect(page.locator("#unlocated-filtered-count")).toContainText("4 dari");

    // Return to verified tab & toggle opt-in DEMO fixture
    await page.click("#tab-verified");
    await page.click("#toggle-demo-mode");
    await expect(page.locator("#explorer-granularity-banner")).toContainText("DATA DEMO AKTIF");
    await expect(page.locator("#explorer-table-count")).toHaveText("3 record DEMO");
    await page.click("#toggle-demo-mode");
    await expect(page.locator("#explorer-granularity-banner")).not.toContainText("DATA DEMO AKTIF");

    // Verify Simulasi Respons Damkarmat tab: disclaimer, mute default, outside rejection, OSM routing, playback
    await page.click("#tab-simulation");
    await expect(page.locator("#explorer-tab-simulation")).toBeVisible();
    await expect(page.locator(".sim-disclaimer")).toContainText("SIMULASI: bukan layanan panggilan darurat");
    await expect(page.locator("#sim-audio-btn")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#sim-audio-btn")).toContainText("Nonaktif (Mute)");
    await page.click("#sim-audio-btn");
    await expect(page.locator("#sim-audio-btn")).toHaveAttribute("aria-pressed", "true");
    await page.click("#sim-audio-btn");
    await expect(page.locator("#sim-audio-btn")).toHaveAttribute("aria-pressed", "false");

    await page.selectOption("#sim-preset-select", "outside");
    await page.click("#sim-apply-preset");
    await expect(page.locator("#sim-status-message")).toContainText("di luar batas administratif");
    await expect(page.locator("#sim-start-btn")).toBeDisabled();

    await page.selectOption("#sim-preset-select", "helvetia");
    await page.click("#sim-apply-preset");
    await expect(page.locator("#sim-station-kv")).toContainText("Kandidat Pos UPT Wilayah V");
    await expect(page.locator("#sim-station-kv")).toContainText("35 km/jam");
    await expect(page.locator("#sim-excluded-note")).toContainText("UPT-03, UPT-04");
    await expect(page.locator("#sim-map .leaflet-overlay-pane svg path").first()).toBeAttached();
    await expect(page.locator("#sim-start-btn")).toBeEnabled();

    await page.selectOption("#sim-station-scope", "verified-only");
    await expect(page.locator("#sim-station-kv")).toContainText("Mako 0.0");
    await page.selectOption("#sim-station-scope", "with-candidates");
    await expect(page.locator("#sim-station-kv")).toContainText("Kandidat Pos UPT Wilayah V");

    await page.click("#sim-start-btn");
    await expect(page.locator("#sim-phase-badge")).toContainText("Armada Simulasi Menuju Lokasi");
    await page.click("#sim-pause-btn");
    await expect(page.locator("#sim-phase-badge")).toContainText("Simulasi Dijeda");
    await page.click("#sim-pause-btn");
    await expect(page.locator("#sim-phase-badge")).toContainText("Armada Simulasi Menuju Lokasi");
    await page.click("#sim-reset-btn");
    await expect(page.locator("#sim-phase-badge")).toContainText("Belum Memilih Lokasi");

    // Check simulation tab responsive layout at 375px and clean tab switching
    await page.setViewportSize({ width: 375, height: 812 });
    const simMobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(simMobileOverflow).toBe(false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click("#tab-verified");

    // 6. Keyboard navigation on sidebar link & verify zero leaked maps AND charts
    await page.locator("aside nav a[href='/']").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Ringkasan Pemetaan Kebakaran Kota Medan/i })).toBeVisible();
    await page.locator("aside nav a[href='/about']").click();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? -1)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeCharts ?? -1)).toBe(0);

    // 7. Desktop (1440x900) on /incident-explorer, Tablet (768x1024), and Mobile (375x812) responsive checks
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incident-explorer");
    const explorerDesktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(explorerDesktopOverflow).toBe(false);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/incident-explorer");
    const tabletOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(tabletOverflow).toBe(false);
    const tabletDemoBox = await page.locator("#toggle-demo-mode").boundingBox();
    expect(tabletDemoBox.height).toBeGreaterThanOrEqual(44);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/incident-explorer");
    const explorerMobileCheck = await page.evaluate(() => {
      const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      const metricOverflow = Array.from(document.querySelectorAll(".metric-box, .metric-value")).some(
        (el) => el.scrollWidth > el.clientWidth + 1
      );
      const brand = document.querySelector(".brand-link")?.getBoundingClientRect();
      const badge = document.querySelector("#supabase-status-badge")?.getBoundingClientRect();
      const sourceBadge = document.querySelector("#data-source-status-badge")?.getBoundingClientRect();
      const overlaps = (a, b) =>
        Boolean(a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
      const headerOverlap = overlaps(brand, badge) || overlaps(brand, sourceBadge) || overlaps(badge, sourceBadge);
      const headerZ = Number(getComputedStyle(document.querySelector(".app-header")).zIndex || 0);
      return { docOverflow, metricOverflow, headerOverlap, headerZ };
    });
    expect(explorerMobileCheck.docOverflow).toBe(false);
    expect(explorerMobileCheck.metricOverflow).toBe(false);
    expect(explorerMobileCheck.headerOverlap).toBe(false);
    expect(explorerMobileCheck.headerZ).toBeGreaterThan(1000);

    await page.goto("/");
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(mobileOverflow).toBe(false);

    const menuTrigger = page.locator("#mobile-menu-trigger");
    const box = await menuTrigger.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);

    await menuTrigger.click();
    await expect(page.locator("#app-sidebar")).toHaveClass(/is-open/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#app-sidebar")).not.toHaveClass(/is-open/);

    // 8. Canvas 2D unavailable fallback + reduced-motion verification on Simulation tab
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === "2d" && this.id === "sim-stage-canvas") {
          return null;
        }
        return origGetContext.call(this, type, ...args);
      };
    });
    await page.goto("/incident-explorer");
    await page.click("#tab-simulation");
    await expect(page.locator("#sim-stage-box")).toHaveAttribute("data-render-mode", "fallback-2d");
    await expect(page.locator("#sim-stage-box svg")).toContainText("Fallback 2D:");

    // Verify clean console, page errors, and static asset responses before simulated network failure
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedAssets).toEqual([]);

    // 9. Error state does not render a blank page when manifest fails
    await page.route("**/data/manifest.json", (route) => route.abort("failed"));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Manifest data tidak dapat dimuat/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("prioritizes valid verified KDE output and safely rejects invalid official payload back to DEMO", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 860 });

    // A. Valid verified KDE output
    await page.route("**/data/manifest.json", async (route) => {
      const response = await route.fetch();
      const manifestJson = await response.json();
      manifestJson.verified_outputs = {
        "hotspot-analyzer": {
          available: true,
          path: "/data/hotspot-analyzer.verified.geojson",
          status: "verified"
        }
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(manifestJson)
      });
    });

    await page.route("**/data/hotspot-analyzer.verified.geojson", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          type: "FeatureCollection",
          isDemo: false,
          dataLabel: "TERVERIFIKASI",
          notice: "Output KDE terverifikasi Kota Medan (uji integrasi).",
          analysis: {
            title: "KDE Kebakaran Kota Medan 2024",
            source: "Dinas Damkarmat Kota Medan",
            period_label: "Januari - Desember 2024",
            kernel_method: "Quartic",
            bandwidth_meters: 1000,
            pixel_size_meters: 100,
            working_crs: "EPSG:32647",
            classification_method: "Quantile (4 kelas)",
            incident_count_used: 38
          },
          features: [
            {
              type: "Feature",
              properties: {
                isDemo: false,
                dataLabel: "TERVERIFIKASI",
                zone_id: "verified-zone-1",
                density_class: "Sangat Tinggi",
                density_rank: 4,
                area_km2: 2.15
              },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [98.665, 3.582],
                    [98.685, 3.582],
                    [98.685, 3.598],
                    [98.665, 3.598],
                    [98.665, 3.582]
                  ]
                ]
              }
            }
          ]
        })
      });
    });

    await page.goto("/hotspot-analyzer");
    await expect(page.locator("#hotspot-data-status-badge")).toHaveAttribute("data-status-mode", "verified");
    await expect(page.locator("#hotspot-data-status-badge")).toContainText("TERVERIFIKASI");
    await expect(page.locator("#hotspot-metadata-kv")).toContainText("Dinas Damkarmat Kota Medan");
    await expect(page.locator("#hotspot-metadata-kv")).toContainText("38 titik");
    await expect(page.locator("#hotspot-table-count")).toHaveText("1 zona");

    // B. Malformed / DEMO official output must be rejected and safely fall back to DEMO
    await page.unroute("**/data/hotspot-analyzer.verified.geojson");
    await page.route("**/data/hotspot-analyzer.verified.geojson", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          type: "FeatureCollection",
          isDemo: true,
          dataLabel: "DEMO",
          features: []
        })
      });
    });

    await page.goto("/hotspot-analyzer");
    await expect(page.locator("#hotspot-verified-rejected-banner")).toBeVisible();
    await expect(page.locator("#hotspot-data-status-badge")).toHaveAttribute("data-status-mode", "demo");
    await expect(page.locator("#hotspot-data-status-badge")).toContainText("DEMO");
    await expect(page.locator("#hotspot-table-count")).toHaveText("2 zona");
  });

  test("safely rejects malformed or DEMO provisional payloads on Station Coverage and Priority Planner back to DEMO", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 860 });

    await page.route("**/data/station-coverage.provisional.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          isDemo: true,
          dataLabel: "DEMO",
          stations: []
        })
      });
    });

    await page.goto("/station-coverage");
    await expect(page.locator("#coverage-provisional-rejected")).toBeVisible();
    await expect(page.locator("#coverage-status-badge")).toHaveAttribute("data-status-mode", "demo");
    await expect(page.locator("#coverage-status-badge")).toContainText("DEMO");

    await page.route("**/data/priority-planner.provisional.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          isDemo: false,
          dataLabel: "PROVISIONAL",
          zones: []
        })
      });
    });

    await page.goto("/priority-planner");
    await expect(page.locator("#priority-provisional-rejected")).toBeVisible();
    await expect(page.locator("#priority-status-badge")).toHaveAttribute("data-status-mode", "demo");
    await expect(page.locator("#priority-status-badge")).toContainText("DEMO");
  });

  test("displays enriched Satu Data series, BPBD comparison, non-fire rescues, and unverified independent candidates cleanly", async ({
    page
  }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByText(/100% \(target 100%\)/i)).toBeVisible();
    await expect(page.getByText(/13\.10 mnt \(target 15\.00 mnt\)/i)).toBeVisible();
    await expect(page.getByText(/2\.218/)).toBeVisible();
    await expect(page.getByText(/27 \(17 titik ruas\)/)).toBeVisible();

    await page.goto("/about");
    await expect(page.getByText(/Pengayaan Kandidat Independen \(Belum Terverifikasi\)/i)).toBeVisible();
    await expect(page.getByText(/BPBD Rekapitulasi Bencana Tahun 2021/i)).toBeVisible();
    await expect(page.getByText(/ODbL 1\.0/i).first()).toBeVisible();
    await expect(page.locator("#about-data-source-badge")).toContainText("Sumber Data: JSON Lokal");
    await expect(page.locator("#about-active-source-note")).toContainText("Sumber Data: JSON Lokal");
    await expect(page.locator("table a[href*='p2k.medan.go.id']")).toHaveAttribute("target", "_blank");
    await expect(page.locator("table a[href*='medanterkini.medan.go.id']").first()).toHaveAttribute("target", "_blank");

    await page.goto("/incident-explorer");
    await expect(page.getByRole("heading", { name: "Fire Incident Explorer" })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? 0)).toBe(1);
    await expect(page.locator("#supabase-status-badge")).toContainText("Koneksi: Mode Lokal");
    await expect(page.locator("#data-source-status-badge")).toContainText("Sumber Data: JSON Lokal");
    await expect(page.locator("#tab-verified")).toHaveText("Eksplorasi Dataset & Peta");
    await expect(page.locator("#explorer-mode-badge")).toHaveText("Mode: Data Resmi Damkarmat");

    await page.selectOption("#filter-period", "2016-2021-bulanan");
    await expect(page.locator("#explorer-table-count")).toHaveText("72 baris");
    await expect(page.locator("#explorer-granularity-banner")).toContainText("1.372");

    await page.selectOption("#filter-period", "bpbd-2021-2023");
    await expect(page.locator("#explorer-mode-badge")).toHaveText("Mode: Pembanding BPBD (Terpisah)");
    await expect(page.locator("#explorer-table-count")).toHaveText("21 baris");
    await expect(page.locator("#explorer-granularity-banner")).toContainText("BPBD");
    await page.selectOption("#filter-district", "Medan Belawan");
    await expect(page.locator("#explorer-table-count")).toHaveText("1 baris");
    await expect(page.locator("#detail-kv")).toContainText("Medan Belawan");

    await page.selectOption("#filter-period", "bpbd-2022-2023-bulanan");
    await expect(page.locator("#explorer-mode-badge")).toHaveText("Mode: Pembanding BPBD (Terpisah)");
    await expect(page.locator("#explorer-table-count")).toHaveText("24 baris");
    await expect(page.locator("#explorer-metrics")).toContainText("225");

    await page.selectOption("#filter-period", "non-kebakaran-2023-2025");
    await expect(page.locator("#explorer-mode-badge")).toHaveText("Mode: Penyelamatan Non-Kebakaran (Terpisah)");
    await expect(page.locator("#explorer-table-count")).toHaveText("36 baris");
    await expect(page.locator("#explorer-granularity-banner")).toContainText("2.218");
    await expect(page.locator("#detail-kv")).toContainText("is_fire_incident = false");
    await page.locator("tr[data-row-key='Oktober 2024']").click();
    await expect(page.locator("#detail-qa-note")).toContainText("62 vs jumlah kategori kanan 61");

    await page.selectOption("#filter-period", "kandidat-independen");
    await expect(page.locator("#explorer-mode-badge")).toHaveText("Mode: Kandidat Independen (needs_review)");
    await expect(page.locator("#explorer-table-count")).toHaveText("27 kandidat");
    await expect(page.locator("#explorer-granularity-banner")).toContainText("Belum Terverifikasi");
    await expect(page.locator("#detail-kv")).toContainText("Non-KDE");
    await expect(page.locator("#explorer-upt-candidates-panel")).toBeVisible();
    await expect(page.locator("#explorer-upt-candidates-panel")).toContainText("UPT-01");
    await expect(page.locator("#explorer-upt-candidates-panel")).toContainText("geom = null (tidak di peta)");
    await expect(page.locator("#explorer-upt-candidates-panel a[href*='peraturan.bpk.go.id']").first()).toHaveAttribute(
      "target",
      "_blank"
    );
    await page.locator("tr[data-row-key='IND-2026-0127-DELI']").click();
    await expect(page.locator("#detail-kv")).toContainText("Liputan Duplikat Terhubung (3)");
    await expect(page.locator("#detail-kv a[href*='652642']")).toHaveAttribute("target", "_blank");
    await page.selectOption("#filter-district", "Medan Deli");
    await expect(page.locator("#explorer-table-count")).toHaveText("2 kandidat");

    // Verify empty-state chart & table titles always reflect active period rather than stale 2023 heading
    await page.fill("#filter-search", "zzzz-tidak-ada");
    await expect(page.locator("#explorer-table-count")).toHaveText("0 kandidat");
    await expect(page.locator("#explorer-chart-title")).toContainText("kandidat berita kebakaran");
    await expect(page.locator("#explorer-table-title")).toContainText("Kandidat Kejadian Media Independen");
    await page.selectOption("#filter-period", "bpbd-2022-2023-bulanan");
    await expect(page.locator("#explorer-table-count")).toHaveText("0 baris");
    await expect(page.locator("#explorer-chart-title")).toContainText("BPBD (2022 - 2023)");
    await expect(page.locator("#explorer-table-title")).toContainText("Pembanding Bulanan BPBD Kota Medan");
    await page.click("#filter-reset");
    await expect(page.locator("#explorer-table-count")).toHaveText("21 baris");

    for (const vp of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 }
    ]) {
      await page.setViewportSize(vp);
      const layoutCheck = await page.evaluate(() => ({
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        metricOverflow: Array.from(document.querySelectorAll(".metric-box, .metric-value")).some(
          (el) => el.scrollWidth > el.clientWidth + 1
        )
      }));
      expect(layoutCheck.docOverflow, `overflow at ${vp.width}px`).toBe(false);
      expect(layoutCheck.metricOverflow, `metric overflow at ${vp.width}px`).toBe(false);
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/about");
    const aboutOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(aboutOverflow).toBe(false);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});