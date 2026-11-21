import "./styles.css";
import { renderHotspotAnalyzer } from "./view.js";

export const manifest = {
  id: "hotspot-analyzer",
  title: "Fire Hotspot Analyzer",
  owner: "Adeptri",
  description:
    "Analisis konsentrasi spasial kejadian kebakaran historis berbasis Kernel Density Estimation (KDE) pada CRS EPSG:32647."
};

export async function mount({ container, services, params }) {
  return renderHotspotAnalyzer({ container, services, params, manifest });
}