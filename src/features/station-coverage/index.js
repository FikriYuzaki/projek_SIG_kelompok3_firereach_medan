import "./styles.css";
import { renderStationCoveragePlaceholder } from "./view.js";

export const manifest = {
  id: "station-coverage",
  title: "Fire Station Coverage",
  owner: "Adriel",
  description:
    "Evaluasi jangkauan layanan pos Damkarmat berbasis jaringan jalan Kota Medan dan perbandingannya dengan buffer jarak lurus."
};

export async function mount({ container, services, params }) {
  return renderStationCoveragePlaceholder({ container, services, params, manifest });
}
