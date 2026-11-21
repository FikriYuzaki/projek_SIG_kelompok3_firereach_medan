import "./styles.css";
import { renderPriorityPlanner } from "./view.js";

export const manifest = {
  id: "priority-planner",
  title: "Fire Service Priority Planner",
  owner: "Olo",
  description:
    "Penyusunan skor dan peringkat kecamatan prioritas peningkatan layanan berdasarkan beban kebakaran historis, gap jangkauan, dan paparan penduduk."
};

export async function mount({ container, services, params }) {
  return renderPriorityPlanner({ container, services, params, manifest });
}
