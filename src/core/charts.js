import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
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
  Filler,
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
  const mergedConfig = {
    ...config,
    options: {
      animation: false,
      ...(config?.options || {})
    }
  };
  const chart = new Chart(ctx, mergedConfig);
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
