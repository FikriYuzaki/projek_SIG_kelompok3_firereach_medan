// Contract placeholder for Olo (priority-planner).
// Supports parallel UI work using data/fixtures/demo/priority-planner.demo.json before final upstream layers arrive.

export async function loadPriorityContract(_services) {
  return {
    isDemo: true,
    dataLabel: "DEMO",
    fixturePath: "data/fixtures/demo/priority-planner.demo.json",
    analysis: null,
    zones: []
  };
}
