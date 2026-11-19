// Contract placeholder for Adeptri (hotspot-analyzer).
// Do not run KDE on district_only aggregate data; require exact_verified or address_geocoded_verified points.

export async function loadHotspotZones(_services) {
  return {
    isDemo: true,
    dataLabel: "DEMO",
    fixturePath: "data/fixtures/demo/hotspot-analyzer.demo.json",
    analysis: null,
    zones: []
  };
}
