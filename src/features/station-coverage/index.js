import "./styles.css";
import { renderStationCoverage } from "./view.js";

export const manifest = {
  id: "station-coverage",
  title: "Fire Station Coverage",
  owner: "Adriel",
  description:
    "Evaluasi jangkauan layanan pos Damkarmat berbasis jaringan jalan Kota Medan dan perbandingannya dengan buffer jarak lurus."
};

export async function mount({ container, services, params }) {
  return renderStationCoverage({ container, services, params, manifest });
}
