import { describe, expect, it, vi } from "vitest";

vi.mock("leaflet", () => ({
  default: {
    map: () => ({}),
    tileLayer: () => ({ addTo: () => ({}) }),
    geoJSON: () => ({ addTo: () => ({}) }),
    layerGroup: () => ({ addTo: () => ({}) })
  }
}));

import {
  FEATURE_REGISTRY,
  FEATURE_STATUSES,
  getFeatureById,
  getFeatureByRoute,
  isModuleMountable
} from "../../src/core/feature-registry.js";
import * as incidentExplorer from "../../src/features/incident-explorer/index.js";
import * as hotspotAnalyzer from "../../src/features/hotspot-analyzer/index.js";
import * as stationCoverage from "../../src/features/station-coverage/index.js";
import * as priorityPlanner from "../../src/features/priority-planner/index.js";

describe("feature-registry contract", () => {
  it("registers all four modules with exact owners and initial non-active statuses", () => {
    expect(FEATURE_REGISTRY).toHaveLength(4);
    expect(getFeatureById("incident-explorer")?.owner).toBe("Fikri");
    expect(getFeatureById("incident-explorer")?.status).toBe(FEATURE_STATUSES.IN_DEVELOPMENT);

    expect(getFeatureById("hotspot-analyzer")?.owner).toBe("Adeptri");
    expect(getFeatureById("hotspot-analyzer")?.status).toBe(FEATURE_STATUSES.IN_DEVELOPMENT);

    expect(getFeatureById("station-coverage")?.owner).toBe("Adriel");
    expect(getFeatureById("station-coverage")?.status).toBe(FEATURE_STATUSES.IN_DEVELOPMENT);

    expect(getFeatureById("priority-planner")?.owner).toBe("Olo");
    expect(getFeatureById("priority-planner")?.status).toBe(FEATURE_STATUSES.IN_DEVELOPMENT);

    for (const item of FEATURE_REGISTRY) {
      expect(item.status).not.toBe(FEATURE_STATUSES.ACTIVE);
    }
  });

  it("matches mountable state policy and route resolution", () => {
    expect(isModuleMountable(FEATURE_STATUSES.COMING_SOON)).toBe(false);
    expect(isModuleMountable(FEATURE_STATUSES.BLOCKED)).toBe(false);
    expect(isModuleMountable(FEATURE_STATUSES.IN_DEVELOPMENT)).toBe(true);
    expect(isModuleMountable(FEATURE_STATUSES.ACTIVE)).toBe(true);
    expect(getFeatureByRoute("/hotspot-analyzer")?.id).toBe("hotspot-analyzer");
  });

  it("verifies every module exports matching manifest.id and mount function", () => {
    const modules = [incidentExplorer, hotspotAnalyzer, stationCoverage, priorityPlanner];
    for (const mod of modules) {
      expect(mod.manifest).toBeDefined();
      expect(typeof mod.manifest.id).toBe("string");
      expect(getFeatureById(mod.manifest.id)).not.toBeNull();
      expect(typeof mod.mount).toBe("function");
    }
  });
});
