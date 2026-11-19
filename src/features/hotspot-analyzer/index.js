import "./styles.css";
import { renderHotspotPlaceholder } from "./view.js";

export const manifest = {
  id: "hotspot-analyzer",
  title: "Fire Hotspot Analyzer",
  owner: "Adeptri",
  description:
    "Analisis konsentrasi spasial kejadian kebakaran historis berbasis Kernel Density Estimation (KDE) pada CRS EPSG:32647."
};

export async function mount({ container, services, params }) {
  return renderHotspotPlaceholder({ container, services, params, manifest });
}
