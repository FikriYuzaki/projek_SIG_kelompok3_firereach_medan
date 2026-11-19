// Contract placeholder for Adriel (station-coverage).
// Requires verified station coordinates and road-network topology checks in EPSG:32647.

export async function loadCoverageContract(_services) {
  return {
    isDemo: true,
    dataLabel: "DEMO",
    fixturePath: "data/fixtures/demo/station-coverage.demo.json",
    stations: [],
    zones: []
  };
}
