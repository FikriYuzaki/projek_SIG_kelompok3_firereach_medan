import "./styles.css";
import { renderPriorityPlannerPlaceholder } from "./view.js";

export const manifest = {
  id: "priority-planner",
  title: "Fire Service Priority Planner",
  owner: "Olo",
  description:
    "Penyusunan skor dan peringkat kecamatan prioritas peningkatan layanan berdasarkan hotspot historis, gap jangkauan, dan paparan penduduk."
};

export async function mount({ container, services, params }) {
  return renderPriorityPlannerPlaceholder({ container, services, params, manifest });
}
