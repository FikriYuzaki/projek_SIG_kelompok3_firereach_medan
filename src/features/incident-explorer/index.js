import "./styles.css";
import { renderIncidentExplorer } from "./view.js";

export const manifest = {
  id: "incident-explorer",
  title: "Fire Incident Explorer",
  owner: "Fikri",
  description:
    "Menjelajahi catatan kejadian kebakaran Kota Medan, sumber data, tingkat ketelitian lokasi, dan daftar data yang belum terpetakan."
};

export async function mount({ container, services, params }) {
  return renderIncidentExplorer({ container, services, params, manifest });
}
