import L from "leaflet";
import "leaflet/dist/leaflet.css";

export const MEDAN_CENTER = [3.635, 98.675];
export const MEDAN_DEFAULT_ZOOM = 11;

const activeMaps = new Set();

function syncDebugCount() {
  if (typeof window !== "undefined") {
    window.__firereachDebug = window.__firereachDebug || { activeMaps: 0, activeCharts: 0 };
    window.__firereachDebug.activeMaps = activeMaps.size;
  }
}

export function createMap(element, options = {}) {
  const map = L.map(element, {
    center: options.center || MEDAN_CENTER,
    zoom: options.zoom || MEDAN_DEFAULT_ZOOM,
    zoomControl: options.zoomControl !== false,
    zoomAnimation: false,
    fadeAnimation: false,
    attributionControl: true
  });

  if (options.basemap !== false) {
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
  }

  activeMaps.add(map);
  syncDebugCount();

  let destroyed = false;
  return {
    map,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      activeMaps.delete(map);
      map.remove();
      syncDebugCount();
    }
  };
}

export function addGeoJson(map, geojson, options = {}) {
  const layer = L.geoJSON(geojson, options);
  layer.addTo(map);
  return layer;
}

export function fitBounds(map, target, options = { padding: [20, 20], animate: false }) {
  if (!target || !map || !map._loaded || !map._mapPane) return;
  const bounds = typeof target.getBounds === "function" ? target.getBounds() : target;
  if (bounds && typeof bounds.isValid === "function" && bounds.isValid()) {
    map.fitBounds(bounds, { animate: false, ...options });
  }
}

export function getActiveMapCount() {
  return activeMaps.size;
}
