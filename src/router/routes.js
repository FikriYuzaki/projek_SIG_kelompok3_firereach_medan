import { FEATURE_REGISTRY } from "../core/feature-registry.js";

export const APP_ROUTES = Object.freeze([
  { path: "/", title: "Dashboard | FireReach Medan", kind: "dashboard" },
  { path: "/about", title: "Tentang & Sumber Data | FireReach Medan", kind: "about" },
  ...FEATURE_REGISTRY.map((feature) => ({
    path: feature.route,
    title: `${feature.title} | FireReach Medan`,
    kind: "feature",
    featureId: feature.id
  }))
]);

export function resolveRoute(pathname) {
  const cleanPath = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return APP_ROUTES.find((r) => r.path === cleanPath) || null;
}
