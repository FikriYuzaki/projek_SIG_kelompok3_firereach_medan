import { describe, expect, it } from "vitest";
import {
  filterHotspotZones,
  filterKdeEligiblePoints,
  getHotspotTierMeta,
  loadHotspotZones
} from "../../src/features/hotspot-analyzer/service.js";

describe("hotspot-analyzer module contract", () => {
  it("hanya mengizinkan titik terverifikasi (exact_verified / address_geocoded_verified) dan menolak district_only", () => {
    const sampleRecords = [
      {
        id: "1",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geom: { type: "Point", coordinates: [98.67, 3.59] }
      },
      {
        id: "2",
        location_accuracy: "address_geocoded_verified",
        verification_status: "verified",
        geom: { type: "Point", coordinates: [98.68, 3.58] }
      },
      {
        id: "3",
        location_accuracy: "district_only",
        verification_status: "verified",
        geom: { type: "Point", coordinates: [98.69, 3.57] }
      },
      {
        id: "4",
        location_accuracy: "approximate",
        verification_status: "verified",
        geom: { type: "Point", coordinates: [98.66, 3.56] }
      },
      {
        id: "5",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        isDemo: true,
        geom: { type: "Point", coordinates: [98.65, 3.55] }
      }
    ];

    const eligible = filterKdeEligiblePoints(sampleRecords);
    expect(eligible).toHaveLength(2);
    expect(eligible.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("mengklasifikasikan tingkat kepadatan hotspot dengan warna yang sesuai", () => {
    expect(getHotspotTierMeta(3, "Tinggi").tier).toBe("high");
    expect(getHotspotTierMeta(2, "Sedang").tier).toBe("medium");
    expect(getHotspotTierMeta(1, "Rendah").tier).toBe("low");
  });

  it("memuat fixture zona hotspot dan memfilter berdasarkan kelas kepadatan", async () => {
    const dataset = await loadHotspotZones(null);
    expect(dataset.isDemo).toBe(true);
    expect(dataset.zones.length).toBeGreaterThan(0);

    const highOnly = filterHotspotZones(dataset.zones, { densityTier: "high" });
    expect(highOnly.every((z) => z.tierMeta.tier === "high")).toBe(true);
  });
});