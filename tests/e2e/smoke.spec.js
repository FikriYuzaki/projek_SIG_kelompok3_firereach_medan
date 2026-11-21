import { expect, test } from "@playwright/test";

test.describe("FireReach Medan E2E Smoke & Quality Gate", () => {
  test("covers dashboard, keyboard/mouse nav, Coming Soon, Hotspot Analyzer, Explorer filters, WebGL fallback, lifecycle cleanup, error state, and responsive layout", async ({
    page
  }) => {
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
    await expect(page.locator("#supabase-status-badge")).toContainText("Mode Lokal");

    for (const navLabel of ["Incident Explorer", "Hotspot Analyzer", "Station Coverage", "Priority Planner"]) {
      await expect(page.locator("#module-nav-list").getByText(navLabel)).toBeVisible();
    }

    // Check desktop no horizontal overflow
    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(desktopOverflow).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? 0)).toBe(1);

    // 2. Fire Hotspot Analyzer module interactions, 4-tier filter, chart empty state, and lifecycle cleanup
    await page.locator("#module-nav-list a[href='/hotspot-analyzer']").click();
    await expect(page.getByRole("heading", { name: "Fire Hotspot Analyzer" })).toBeVisible();
    await expect(page.getByText(/STATUS DATA \(DEMO\)/i)).toBeVisible();
    await expect(page.locator("#hotspot-map")).toBeVisible();
    await expect.poll(() => page.locator("#hotspot-map .leaflet-interactive").count()).toBeGreaterThan(0);
    await expect(page.locator("#hotspot-table-count")).toHaveText("2 zona");
    await expect(page.locator("#hotspot-chart-frame")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? 0)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeCharts ?? 0)).toBe(1);

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

    // Verify lifecycle cleanup when navigating away and re-mounting Hotspot Analyzer multiple times
    await page.locator("aside nav a[href='/about']").click();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? -1)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeCharts ?? -1)).toBe(0);

    await page.locator("#module-nav-list a[href='/hotspot-analyzer']").click();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? 0)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeCharts ?? 0)).toBe(1);

    // 3. Remaining Coming Soon modules display owner, status, and clean up previous Leaflet map/chart
    await page.locator("#module-nav-list a[href='/station-coverage']").click();
    await expect(page.getByRole("heading", { name: "Fire Station Coverage" })).toBeVisible();
    await expect(page.getByText("Adriel").first()).toBeVisible();
    await expect(page.getByText("Coming Soon").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeMaps ?? -1)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__firereachDebug?.activeCharts ?? -1)).toBe(0);

    await page.locator("#module-nav-list a[href='/priority-planner']").click();
    await expect(page.getByRole("heading", { name: "Fire Service Priority Planner" })).toBeVisible();
    await expect(page.getByText("Olo").first()).toBeVisible();
    await expect(page.getByText("Coming Soon").first()).toBeVisible();

    // 4. About & Data Sources page
    await page.locator("aside nav a[href='/about']").click();
    await expect(page.getByRole("heading", { name: /Tentang Proyek/i })).toBeVisible();
    await expect(page.getByText(/Register Sumber Data Terverifikasi/i)).toBeVisible();

    // 5. Fire Incident Explorer interactions + filter checks + Three.js toggle + DEMO opt-in separation
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
    await expect(page.locator("[data-preview-title]")).toBeVisible();

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

    // Verify Three.js schematic Play/Pause toggle works when WebGL is available (or fallback 2D is shown)
    const previewToggle = page.locator("[data-preview-toggle]");
    await expect(previewToggle).toBeVisible();
    const renderMode = await page.locator("[data-preview-stage]").getAttribute("data-render-mode");
    if (renderMode === "webgl") {
      const beforeText = await previewToggle.textContent();
      await previewToggle.click();
      await expect(previewToggle).not.toHaveText(beforeText);
    }

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
      const headerOverlap =
        brand && badge
          ? !(brand.right <= badge.left || badge.right <= brand.left || brand.bottom <= badge.top || badge.bottom <= brand.top)
          : false;
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

    // 8. Three.js WebGL unavailable fallback verification
    await page.addInitScript(() => {
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
          return null;
        }
        return origGetContext.call(this, type, ...args);
      };
    });
    await page.goto("/incident-explorer");
    await expect(page.locator("[data-preview-stage]")).toHaveAttribute("data-render-mode", "fallback-2d");
    await expect(page.locator("[data-preview-toggle]")).toHaveText("Mode Statis 2D");

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
});