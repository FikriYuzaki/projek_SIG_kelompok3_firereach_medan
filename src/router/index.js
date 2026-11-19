import { resolveRoute } from "./routes.js";
import { getFeatureById, isModuleMountable } from "../core/feature-registry.js";
import { renderDashboard } from "../components/dashboard-view.js";
import { renderAbout } from "../components/about-view.js";
import { renderComingSoon } from "../components/coming-soon.js";
import { renderStatePanel } from "../components/state-panel.js";

export function createRouter({ shell, services }) {
  let currentUnmount = null;
  let navigationToken = 0;

  async function renderCurrentPath(pathname, { focusMain = false } = {}) {
    const token = ++navigationToken;
    shell.closeDrawer();

    if (typeof currentUnmount === "function") {
      try {
        await currentUnmount();
      } catch (err) {
        console.error("Module unmount error:", err);
      }
      currentUnmount = null;
    }

    if (token !== navigationToken) return;

    const matched = resolveRoute(pathname);
    if (!matched) {
      document.title = "Halaman Tidak Ditemukan | FireReach Medan";
      shell.setActiveRoute("");
      shell.outlet.replaceChildren(
        renderStatePanel({
          variant: "empty",
          title: "Halaman tidak ditemukan",
          message: `Alamat ${pathname} tidak terdaftar pada navigasi FireReach Medan.`,
          actionLabel: "Kembali ke Dashboard",
          onAction: () => navigate("/")
        })
      );
      return;
    }

    document.title = matched.title;
    shell.setActiveRoute(matched.path);
    shell.outlet.replaceChildren(
      renderStatePanel({
        variant: "loading",
        title: "Memuat tampilan",
        message: "Menyiapkan komponen dan membaca manifest data lokal..."
      })
    );

    try {
      let unmountFn = null;
      if (matched.kind === "dashboard") {
        unmountFn = await renderDashboard({ container: shell.outlet, services, navigate });
      } else if (matched.kind === "about") {
        unmountFn = await renderAbout({ container: shell.outlet, services, navigate });
      } else if (matched.kind === "feature") {
        const feature = getFeatureById(matched.featureId);
        if (!feature || !isModuleMountable(feature.status)) {
          unmountFn = renderComingSoon({ container: shell.outlet, feature, navigate });
        } else {
          const mod = await feature.loader();
          if (mod.manifest?.id !== feature.id) {
            throw new Error(`Manifest mismatch: expected ${feature.id}, got ${mod.manifest?.id}`);
          }
          if (token !== navigationToken) return;
          unmountFn = await mod.mount({ container: shell.outlet, services, params: {} });
        }
      }

      if (token !== navigationToken) {
        if (typeof unmountFn === "function") await unmountFn();
        return;
      }

      currentUnmount = typeof unmountFn === "function" ? unmountFn : null;
      if (focusMain) {
        const mainEl = document.getElementById("app-main");
        if (mainEl) mainEl.focus({ preventScroll: true });
      }
    } catch (err) {
      if (token !== navigationToken) return;
      console.error("Route mount error:", err);
      shell.outlet.replaceChildren(
        renderStatePanel({
          variant: "error",
          title: "Gagal memuat halaman",
          message: err.message || "Terjadi kesalahan saat merender modul.",
          actionLabel: "Coba Muat Ulang",
          onAction: () => renderCurrentPath(matched.path)
        })
      );
    }
  }

  function navigate(to) {
    const url = new URL(to, window.location.origin);
    if (url.pathname === window.location.pathname) return;
    window.history.pushState({}, "", url.pathname + url.search);
    renderCurrentPath(url.pathname, { focusMain: true });
  }

  function handleDocumentClick(event) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor = event.target.closest("a[data-nav]");
    if (!anchor) return;
    event.preventDefault();
    navigate(anchor.getAttribute("href"));
  }

  function handlePopState() {
    renderCurrentPath(window.location.pathname, { focusMain: true });
  }

  function start() {
    document.addEventListener("click", handleDocumentClick);
    window.addEventListener("popstate", handlePopState);
    return renderCurrentPath(window.location.pathname);
  }

  async function destroy() {
    document.removeEventListener("click", handleDocumentClick);
    window.removeEventListener("popstate", handlePopState);
    if (typeof currentUnmount === "function") {
      await currentUnmount();
      currentUnmount = null;
    }
  }

  return { start, navigate, destroy };
}
