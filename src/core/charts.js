import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend
} from "chart.js";

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend
);

const activeCharts = new Set();

function syncDebugCount() {
  if (typeof window !== "undefined") {
    window.__firereachDebug = window.__firereachDebug || { activeMaps: 0, activeCharts: 0 };
    window.__firereachDebug.activeCharts = activeCharts.size;
  }
}

export function createChart(canvas, config) {
  const ctx = canvas.getContext("2d");
  const chart = new Chart(ctx, config);
  activeCharts.add(chart);
  syncDebugCount();

  return {
    chart,
    destroy() {
      if (activeCharts.has(chart)) {
        chart.destroy();
        activeCharts.delete(chart);
        syncDebugCount();
      }
    }
  };
}

export function getActiveChartCount() {
  return activeCharts.size;
}
