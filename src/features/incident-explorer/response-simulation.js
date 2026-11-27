import L from "leaflet";
import { createResponseAudioController } from "./response-audio.js";
import {
  SIMULATION_ASSUMED_SPEED_KMH,
  buildAdjacencyList,
  planFireResponseScenario
} from "./response-router.js";

const PHASE_META = Object.freeze({
  idle: { label: "Belum Memilih Lokasi", badgeClass: "status-badge--local", marker: "[o]" },
  loading: { label: "Memuat Graf Jalan OSM...", badgeClass: "status-badge--local", marker: "[~]" },
  routing: { label: "Mencari Pos & Rute...", badgeClass: "status-badge--dev", marker: "[~]" },
  ready: { label: "Siap Simulasi", badgeClass: "status-badge--active", marker: "[+]" },
  en_route: { label: "Armada Simulasi Menuju Lokasi", badgeClass: "status-badge--dev", marker: "[>]" },
  extinguishing: { label: "Proses Pemadaman Berjalan", badgeClass: "status-badge--demo", marker: "[*]" },
  paused: { label: "Simulasi Dijeda", badgeClass: "status-badge--dev", marker: "[||]" },
  completed: { label: "Selesai (Api Padam - Simulasi)", badgeClass: "status-badge--active", marker: "[+]" },
  error: { label: "Lokasi / Rute Tidak Valid", badgeClass: "status-badge--demo", marker: "[!]" }
});

const PRESET_LOCATIONS = Object.freeze([
  { id: "petisah", label: "Medan Petisah (Kawasan Pusat Kota)", lat: 3.5882, lon: 98.6635 },
  { id: "tuntungan", label: "Medan Tuntungan (Jl. Bunga Turi)", lat: 3.5165, lon: 98.6242 },
  { id: "amplas", label: "Medan Amplas (Koridor Timbang Deli)", lat: 3.5418, lon: 98.7124 },
  { id: "helvetia", label: "Medan Helvetia (Koridor Gaperta)", lat: 3.6025, lon: 98.6412 },
  { id: "tembung", label: "Medan Tembung (Koridor Letda Sujono)", lat: 3.5992, lon: 98.7125 },
  { id: "belawan", label: "Medan Belawan (Koridor Pelabuhan)", lat: 3.7702, lon: 98.6805 },
  { id: "outside", label: "Titik Uji Luar Medan (Deli Serdang - Ditolak)", lat: 3.545, lon: 98.84 }
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildTruckIcon(bearingDeg = 0, beaconToggle = false) {
  const redColor = beaconToggle ? "#EF4444" : "#9A3B29";
  const blueColor = beaconToggle ? "#3B82F6" : "#1D4ED8";
  return L.divIcon({
    className: "sim-truck-marker",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `
      <div style="transform: rotate(${Math.round(bearingDeg)}deg); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
        <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="4" width="20" height="24" rx="4" fill="#B84A35" stroke="#202A2D" stroke-width="2"></rect>
          <rect x="9" y="7" width="14" height="5" rx="1.5" fill="#FFFFFF"></rect>
          <rect x="9" y="15" width="14" height="9" rx="1.5" fill="#9A3B29" stroke="#FFFFFF" stroke-width="1"></rect>
          <circle cx="11" cy="13" r="2.2" fill="${redColor}"></circle>
          <circle cx="21" cy="13" r="2.2" fill="${blueColor}"></circle>
        </svg>
      </div>
    `
  });
}

function buildFireTargetIcon(phase, intensity) {
  const isOut = phase === "completed" || intensity <= 0.02;
  const scale = isOut ? 0.75 : 0.75 + intensity * 0.45;
  const fill = isOut ? "#356067" : "#B84A35";
  const inner = isOut ? "#EAF2F3" : "#F59E0B";
  return L.divIcon({
    className: "sim-fire-marker",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `
      <div style="transform: scale(${scale.toFixed(2)}); width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r="10" fill="${fill}" stroke="#FFFFFF" stroke-width="2"></circle>
          <circle cx="13" cy="13" r="4.5" fill="${inner}"></circle>
        </svg>
      </div>
    `
  });
}

function computeBearingDeg(lat1, lon1, lat2, lon2) {
  const dy = lat2 - lat1;
  const dx = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return 0;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

function interpolateAlongPolyline(polyline, progress) {
  if (!Array.isArray(polyline) || polyline.length === 0) return null;
  if (polyline.length === 1 || progress <= 0) {
    const p = polyline[0];
    const next = polyline[1] || p;
    return { lat: p[0], lon: p[1], bearingDeg: computeBearingDeg(p[0], p[1], next[0], next[1]) };
  }
  if (progress >= 1) {
    const prev = polyline[polyline.length - 2] || polyline[0];
    const p = polyline[polyline.length - 1];
    return { lat: p[0], lon: p[1], bearingDeg: computeBearingDeg(prev[0], prev[1], p[0], p[1]) };
  }

  const segLens = [];
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = Math.hypot(polyline[i + 1][0] - polyline[i][0], polyline[i + 1][1] - polyline[i][1]);
    segLens.push(d);
    total += d;
  }
  if (total <= 0) {
    return { lat: polyline[0][0], lon: polyline[0][1], bearingDeg: 0 };
  }

  let targetDist = total * progress;
  for (let i = 0; i < segLens.length; i++) {
    const sl = segLens[i];
    if (targetDist <= sl || i === segLens.length - 1) {
      const t = sl > 0 ? Math.max(0, Math.min(1, targetDist / sl)) : 0;
      const a = polyline[i];
      const b = polyline[i + 1];
      return {
        lat: a[0] + (b[0] - a[0]) * t,
        lon: a[1] + (b[1] - a[1]) * t,
        bearingDeg: computeBearingDeg(a[0], a[1], b[0], b[1])
      };
    }
    targetDist -= sl;
  }
  const last = polyline[polyline.length - 1];
  return { lat: last[0], lon: last[1], bearingDeg: 0 };
}

function buildStageFallbackSvg({ phase, fireIntensity, travelProgress }) {
  const statusText =
    phase === "completed"
      ? "Api Padam (Skenario Selesai)"
      : phase === "extinguishing"
        ? `Pemadaman Berjalan (${Math.round(fireIntensity * 100)}% intensitas api)`
        : phase === "en_route"
          ? `Armada Simulasi Menuju Lokasi (${Math.round(travelProgress * 100)}%)`
          : phase === "ready"
            ? "Siap Simulasi (Klik Mulai Simulasi)"
            : "Pilih titik api di dalam batas Kota Medan";
  const showFlame = phase !== "idle" && phase !== "completed" && phase !== "error" && fireIntensity > 0.02;
  const showTruck = phase === "en_route" || phase === "extinguishing" || phase === "paused" || phase === "completed";
  const showWater = phase === "extinguishing";

  return `
    <svg viewBox="0 0 360 190" role="img" aria-label="Visualisasi 2D Simulasi Pemadaman: ${escapeHtml(statusText)}">
      <rect width="360" height="190" fill="#ECEAE2"></rect>
      <rect x="0" y="142" width="360" height="48" fill="#D9DEDA"></rect>
      <rect x="235" y="74" width="84" height="68" fill="#FFFFFF" stroke="#202A2D" stroke-width="2"></rect>
      <polygon points="227,74 277,46 327,74" fill="#356067"></polygon>
      ${
        showTruck
          ? `<g transform="translate(${phase === "en_route" ? Math.round(20 + travelProgress * 105) : 125}, 102)">
               <rect x="0" y="12" width="76" height="28" rx="4" fill="#B84A35" stroke="#202A2D" stroke-width="2"></rect>
               <rect x="52" y="16" width="18" height="12" fill="#FFFFFF" stroke="#202A2D"></rect>
               <circle cx="18" cy="42" r="7" fill="#202A2D"></circle>
               <circle cx="60" cy="42" r="7" fill="#202A2D"></circle>
               <rect x="46" y="6" width="8" height="6" fill="#EF4444"></rect>
               <rect x="56" y="6" width="8" height="6" fill="#3B82F6"></rect>
             </g>`
          : ""
      }
      ${
        showWater
          ? `<path d="M 192 114 Q 230 92 264 114" fill="none" stroke="#477A82" stroke-width="4" stroke-dasharray="6 4"></path>`
          : ""
      }
      ${
        showFlame
          ? `<g transform="translate(277, 118) scale(${(0.4 + fireIntensity * 0.7).toFixed(2)})">
               <path d="M 0 -36 C 14 -20 18 -6 0 12 C -18 -6 -14 -20 0 -36 Z" fill="#B84A35"></path>
               <path d="M 0 -24 C 8 -14 10 -4 0 8 C -10 -4 -8 -14 0 -24 Z" fill="#D58A43"></path>
             </g>`
          : ""
      }
      <text x="180" y="175" text-anchor="middle" fill="#202A2D" font-size="11" font-family="sans-serif" font-weight="600">
        Fallback 2D: ${escapeHtml(statusText)}
      </text>
    </svg>
  `;
}

export function mountFireResponseSimulation({ container, services, summary, districtsGeoJson }) {
  const ac = new AbortController();
  const audio = createResponseAudioController();
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  container.innerHTML = `
    <div class="sim-root" data-sim-phase="idle">
      <div class="notice-banner notice-banner--demo sim-disclaimer" role="region" aria-label="Disclaimer simulasi darurat">
        <div>
          <strong>SIMULASI: bukan layanan panggilan darurat dan bukan pengerahan armada Damkarmat sebenarnya.</strong>
          <div style="font-size: var(--text-xs); margin-top: var(--space-1);">
            Data real-time berikut tidak tersedia pada aplikasi ini: posisi armada, status kendaraan, ketersediaan personel, penerimaan panggilan darurat, dan kondisi lalu lintas aktual. Estimasi perjalanan skenario memakai asumsi kecepatan ${SIMULATION_ASSUMED_SPEED_KMH} km/jam pada graf jaringan jalan OSM (<code>EPSG:32647</code>).
          </div>
        </div>
        <span class="status-badge status-badge--local" id="sim-phase-badge">
          <span aria-hidden="true">[o]</span>
          <span>Belum Memilih Lokasi</span>
        </span>
      </div>

      <section class="panel" aria-label="Kontrol simulasi respons Damkarmat">
        <div class="sim-controls-grid">
          <div class="field">
            <label for="sim-station-scope">Cakupan Pos Skenario</label>
            <select id="sim-station-scope">
              <option value="with-candidates">Pos Terverifikasi + 4 Kandidat OSM (Mako 0.0 + UPT I, II, V, VI)</option>
              <option value="verified-only">Hanya Pos Terverifikasi (Mako 0.0 saja)</option>
            </select>
          </div>
          <div class="field">
            <label for="sim-preset-select">Titik Uji Cepat (Aksesibilitas Keyboard)</label>
            <div style="display: flex; gap: var(--space-2);">
              <select id="sim-preset-select">
                ${PRESET_LOCATIONS.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join("")}
              </select>
              <button type="button" class="btn btn-secondary" id="sim-apply-preset">Pilih Titik</button>
            </div>
          </div>
          <div class="sim-btn-row" role="group" aria-label="Kendali pemutaran simulasi">
            <button type="button" class="btn btn-secondary" id="sim-pick-btn" aria-pressed="true">
              Mode Klik Peta: Aktif
            </button>
            <button type="button" class="btn btn-primary" id="sim-start-btn" disabled>Mulai Simulasi</button>
            <button type="button" class="btn btn-secondary" id="sim-pause-btn" disabled>Jeda</button>
            <button type="button" class="btn btn-secondary" id="sim-reset-btn" disabled>Reset</button>
            <button type="button" class="btn btn-secondary" id="sim-audio-btn" aria-pressed="false">
              Suara: Nonaktif (Mute)
            </button>
          </div>
        </div>
        <p class="sim-hint" id="sim-status-message" role="status" aria-live="polite">
          Klik langsung pada wilayah Kota Medan di peta simulasi atau pilih titik uji cepat untuk menghitung rute jaringan jalan dari pos skenario terdekat.
        </p>
      </section>

      <div class="split-layout split-layout--map-lead">
        <section class="panel map-card">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2);">
            <h2>Peta Rute Armada Simulasi (Jaringan Jalan OSM)</h2>
            <span class="mono" style="font-size: var(--text-xs); color: var(--color-ink-muted);">EPSG:32647 routing / EPSG:4326 peta</span>
          </div>
          <div class="map-canvas sim-map-canvas" id="sim-map" role="region" aria-label="Peta interaktif simulasi rute armada pemadam"></div>
          <div class="map-legend">
            <span class="legend-item"><span class="legend-swatch" style="background: #356067; border-radius: 50%;"></span> Mako 0.0 (Terverifikasi)</span>
            <span class="legend-item"><span class="legend-swatch" style="background: #FBF2E6; border: 2px solid #8A5218; border-radius: 50%;"></span> Kandidat UPT OSM (needs_review)</span>
            <span class="legend-item"><span class="legend-swatch" style="background: #B84A35; border-radius: 50%;"></span> Titik Api Simulasi</span>
            <span class="legend-item"><span class="legend-swatch" style="background: #356067; width: 20px; height: 4px;"></span> Rute Jaringan Jalan OSM</span>
          </div>
          <div class="provenance-bar">
            <span>Graf jaringan jalan: Geofabrik / OpenStreetMap (&copy; OpenStreetMap contributors, ODbL 1.0)</span>
            <span>UPT-03 &amp; UPT-04 (district_only, geom = null) dikecualikan dari routing.</span>
          </div>
        </section>

        <aside style="display: flex; flex-direction: column; gap: var(--space-4);">
          <section class="panel">
            <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-2);">
              <h3 style="margin: 0;">Panggung Animasi Pemadaman</h3>
              <span class="mono" id="sim-intensity-label" style="font-size: var(--text-xs); color: var(--color-ink-muted);">Intensitas api: -</span>
            </div>
            <div class="sim-stage-box" id="sim-stage-box" data-render-mode="canvas-2d">
              <canvas id="sim-stage-canvas" width="360" height="190" aria-label="Animasi proses pemadaman kebakaran"></canvas>
            </div>
            <div class="sim-progress-track" aria-hidden="true">
              <div class="sim-progress-fill" id="sim-progress-fill" style="width: 0%;"></div>
            </div>
          </section>

          <section class="panel" aria-live="polite">
            <h3 style="margin-bottom: var(--space-2);">Pos Skenario Terdekat &amp; Rute</h3>
            <dl class="detail-kv" id="sim-station-kv">
              <dt>Status</dt><dd>Belum ada titik api terpilih</dd>
            </dl>
            <div class="detail-qa-note" id="sim-excluded-note"></div>
          </section>

          <section class="panel">
            <h3 style="margin-bottom: var(--space-2);">Timeline Proses Simulasi</h3>
            <ol class="sim-timeline" id="sim-timeline">
              <li data-step="pick">1. Pilih &amp; validasi titik api di Kota Medan</li>
              <li data-step="route">2. Hitung rute jaringan jalan pos skenario terdekat</li>
              <li data-step="dispatch">3. Armada simulasi bergerak mengikuti rute jalan</li>
              <li data-step="extinguish">4. Pemadaman, semburan air &amp; penurunan asap</li>
              <li data-step="summary">5. Api padam &amp; ringkasan batasan skenario</li>
            </ol>
            <div class="detail-qa-note" id="sim-summary-box" hidden></div>
          </section>
        </aside>
      </div>
    </div>
  `;

  const rootEl = container.querySelector(".sim-root");
  const phaseBadgeEl = container.querySelector("#sim-phase-badge");
  const scopeSelect = container.querySelector("#sim-station-scope");
  const presetSelect = container.querySelector("#sim-preset-select");
  const applyPresetBtn = container.querySelector("#sim-apply-preset");
  const pickBtn = container.querySelector("#sim-pick-btn");
  const startBtn = container.querySelector("#sim-start-btn");
  const pauseBtn = container.querySelector("#sim-pause-btn");
  const resetBtn = container.querySelector("#sim-reset-btn");
  const audioBtn = container.querySelector("#sim-audio-btn");
  const statusMsgEl = container.querySelector("#sim-status-message");
  const stageBoxEl = container.querySelector("#sim-stage-box");
  const stageCanvas = container.querySelector("#sim-stage-canvas");
  const intensityLabelEl = container.querySelector("#sim-intensity-label");
  const progressFillEl = container.querySelector("#sim-progress-fill");
  const stationKvEl = container.querySelector("#sim-station-kv");
  const excludedNoteEl = container.querySelector("#sim-excluded-note");
  const summaryBoxEl = container.querySelector("#sim-summary-box");
  const timelineEls = Array.from(container.querySelectorAll("#sim-timeline li"));

  let mapHandle = null;
  let baseLayer = null;
  let routeLayer = null;
  let actorLayer = null;

  const state = {
    phase: "idle",
    pausedFrom: null,
    pickActive: true,
    includeCandidates: true,
    graph: null,
    adj: null,
    graphLoading: false,
    graphError: null,
    plan: null,
    travelProgress: 0,
    extinguishProgress: 0,
    fireIntensity: 1,
    lastFrameMs: 0,
    beaconCounter: 0,
    stageClock: 0,
    particles: [],
    destroyed: false
  };

  let rafId = null;
  let canvasCtx = null;
  let renderMode = "canvas-2d";
  try {
    canvasCtx = stageCanvas.getContext("2d");
    if (!canvasCtx) renderMode = "fallback-2d";
  } catch {
    canvasCtx = null;
    renderMode = "fallback-2d";
  }
  stageBoxEl.dataset.renderMode = renderMode;

  let truckMarker = null;
  let targetMarker = null;
  let districtBoundaryLayer = null;

  function setPhase(nextPhase, message = null) {
    state.phase = nextPhase;
    rootEl.dataset.simPhase = nextPhase;
    const meta = PHASE_META[nextPhase] || PHASE_META.idle;
    phaseBadgeEl.className = `status-badge ${meta.badgeClass}`;
    phaseBadgeEl.innerHTML = `<span aria-hidden="true">${meta.marker}</span><span>${escapeHtml(meta.label)}</span>`;
    if (message !== null) {
      statusMsgEl.textContent = message;
    }
    syncControls();
    syncTimeline();
    if (nextPhase === "en_route") {
      audio.setPhase("en_route", 1);
    } else if (nextPhase === "extinguishing") {
      audio.setPhase("extinguishing", state.fireIntensity);
    } else if (nextPhase === "completed") {
      audio.setPhase("completed", 0);
    } else if (nextPhase === "paused") {
      audio.pause();
    } else {
      audio.stop();
    }
  }

  function syncControls() {
    const hasPlan = Boolean(state.plan && state.plan.ok);
    const isRunning = state.phase === "en_route" || state.phase === "extinguishing";
    const isPaused = state.phase === "paused";
    startBtn.disabled = !hasPlan || isRunning || isPaused || state.phase === "completed";
    pauseBtn.disabled = !isRunning && !isPaused;
    pauseBtn.textContent = isPaused ? "Lanjutkan" : "Jeda";
    resetBtn.disabled = state.phase === "idle" && !hasPlan && !state.graphError;
    pickBtn.setAttribute("aria-pressed", String(state.pickActive));
    pickBtn.textContent = state.pickActive ? "Mode Klik Peta: Aktif" : "Pilih Titik Api di Peta";
    if (!audio.isSupported()) {
      audioBtn.disabled = true;
      audioBtn.textContent = "Suara: Tidak Didukung Browser";
    } else {
      const muted = audio.isMuted();
      audioBtn.disabled = false;
      audioBtn.setAttribute("aria-pressed", String(!muted));
      audioBtn.textContent = muted ? "Suara: Nonaktif (Mute)" : "Suara: Aktif (Unmute)";
    }
  }

  function syncTimeline() {
    const activeMap = {
      idle: 0,
      loading: 0,
      routing: 1,
      ready: 2,
      en_route: 2,
      extinguishing: 3,
      paused: state.pausedFrom === "extinguishing" ? 3 : 2,
      completed: 4,
      error: 0
    };
    const activeIdx = activeMap[state.phase] ?? 0;
    timelineEls.forEach((li, idx) => {
      li.classList.toggle("is-done", state.phase === "completed" ? true : idx < activeIdx);
      li.classList.toggle("is-active", state.phase !== "completed" && idx === activeIdx);
    });
  }

  function renderStationMarkers() {
    const excludedList = (summary.candidate_stations?.stations || []).filter((s) => s.location_accuracy === "district_only");
    if (excludedList.length) {
      excludedNoteEl.textContent =
        `Pos tanpa koordinat terpetakan (${excludedList.map((s) => s.station_code).join(", ")}, district_only / geom = null) dikecualikan dari pemilihan pos dan routing jalan.`;
    }
    if (!baseLayer) return;
    baseLayer.clearLayers();
    districtBoundaryLayer = L.geoJSON(districtsGeoJson, {
      style: { color: "#556164", weight: 1, fillColor: "#ECEAE2", fillOpacity: 0.25 }
    }).addTo(baseLayer);

    for (const st of summary.verified_stations || []) {
      L.circleMarker([st.lat, st.lon], {
        radius: 8,
        color: "#FFFFFF",
        weight: 2,
        fillColor: "#356067",
        fillOpacity: 1
      })
        .bindPopup(`<strong>${escapeHtml(st.name)}</strong><br/>${escapeHtml(st.address)}<br/>Status: Terverifikasi`)
        .addTo(baseLayer);
    }

    if (state.includeCandidates) {
      for (const st of summary.candidate_stations?.stations || []) {
        if (st.location_accuracy !== "approximate" || typeof st.lat !== "number" || typeof st.lon !== "number") {
          continue;
        }
        L.circleMarker([st.lat, st.lon], {
          radius: 7,
          color: "#8A5218",
          weight: 2,
          fillColor: "#FBF2E6",
          fillOpacity: 0.95
        })
          .bindPopup(
            `<strong>${escapeHtml(st.name)}</strong><br/>${escapeHtml(st.address)}<br/>Akurasi: ${escapeHtml(st.location_accuracy)} | Status: ${escapeHtml(st.verification_status)}`
          )
          .addTo(baseLayer);
      }
    }
  }

  function ensureMapInitialized() {
    if (mapHandle || state.destroyed) return;
    const mapEl = container.querySelector("#sim-map");
    if (!mapEl) return;
    mapHandle = services.maps.createMap(mapEl);
    baseLayer = L.layerGroup().addTo(mapHandle.map);
    routeLayer = L.layerGroup().addTo(mapHandle.map);
    actorLayer = L.layerGroup().addTo(mapHandle.map);
    mapHandle.map.on("click", (e) => {
      if (!state.pickActive || state.destroyed) return;
      if (state.phase === "en_route" || state.phase === "extinguishing") return;
      selectFireTarget(e.latlng.lat, e.latlng.lng);
    });
    renderStationMarkers();
  }

  function renderPlanDetails() {
    if (!state.plan || !state.plan.ok) {
      stationKvEl.innerHTML = `<dt>Status</dt><dd>${escapeHtml(state.plan?.message || "Belum ada titik api terpilih")}</dd>`;
      summaryBoxEl.hidden = true;
      summaryBoxEl.textContent = "";
      return;
    }

    const { station, target, route } = state.plan;
    const statusBadge =
      station.verification_status === "verified"
        ? `<span class="status-badge status-badge--active">[+] verified</span>`
        : `<span class="status-badge status-badge--dev">[~] needs_review</span>`;
    const typeLabel = station.station_type === "mako" ? "Mako (Pos Induk)" : "UPT (Kandidat Publik)";
    const roadTrail = route.roadNames.length ? route.roadNames.join(" -> ") : "Segmen jalan lokal OSM";

    stationKvEl.innerHTML = `
      <dt>Pos Skenario Terdekat</dt><dd><strong>${escapeHtml(station.name)}</strong></dd>
      <dt>Jenis Pos</dt><dd>${escapeHtml(typeLabel)}</dd>
      <dt>Alamat</dt><dd>${escapeHtml(station.address)}</dd>
      <dt>Akurasi Lokasi</dt><dd class="mono">${escapeHtml(station.location_accuracy)}</dd>
      <dt>Status Verifikasi</dt><dd>${statusBadge}</dd>
      <dt>Sumber</dt><dd>${escapeHtml(station.source_name)}</dd>
      <dt>Kecamatan Target</dt><dd>${escapeHtml(target.district_name || "-")}</dd>
      <dt>Jarak Rute Jaringan</dt><dd class="mono tabular"><strong>${route.distanceKm.toFixed(2)} km</strong> (${Math.round(route.distanceM)} m)</dd>
      <dt>Estimasi Perjalanan Skenario</dt><dd class="mono tabular"><strong>${route.scenarioMinutes.toFixed(1)} menit</strong> (@ ${route.assumedSpeedKmh} km/jam)</dd>
      <dt>Ruas Jalan Utama</dt><dd style="font-size: var(--text-xs);">${escapeHtml(roadTrail)}</dd>
    `;
  }

  function drawStageVisuals(dtSec = 0) {
    const progressPct =
      state.phase === "completed"
        ? 100
        : state.phase === "extinguishing" || state.pausedFrom === "extinguishing"
          ? 50 + state.extinguishProgress * 50
          : state.phase === "en_route" || state.pausedFrom === "en_route"
            ? state.travelProgress * 50
            : 0;
    progressFillEl.style.width = `${Math.round(progressPct)}%`;
    intensityLabelEl.textContent =
      state.phase === "idle" || state.phase === "error"
        ? "Intensitas api: -"
        : state.phase === "completed"
          ? "Intensitas api: 0% (Padam)"
          : `Intensitas api: ${Math.round(state.fireIntensity * 100)}%`;

    if (renderMode === "fallback-2d" || !canvasCtx) {
      stageBoxEl.innerHTML = buildStageFallbackSvg({
        phase: state.phase,
        fireIntensity: state.fireIntensity,
        travelProgress: state.travelProgress
      });
      return;
    }

    const ctx = canvasCtx;
    const W = stageCanvas.width;
    const H = stageCanvas.height;
    state.stageClock += dtSec;

    ctx.clearRect(0, 0, W, H);
    // Archival sky & ground
    ctx.fillStyle = "#F4F2EC";
    ctx.fillRect(0, 0, W, 142);
    ctx.fillStyle = "#D9DEDA";
    ctx.fillRect(0, 142, W, 48);
    ctx.fillStyle = "#556164";
    ctx.fillRect(0, 142, W, 2);

    // Target building silhouette
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "#202A2D";
    ctx.lineWidth = 2;
    ctx.fillRect(236, 76, 86, 66);
    ctx.strokeRect(236, 76, 86, 66);
    ctx.fillStyle = "#356067";
    ctx.beginPath();
    ctx.moveTo(226, 76);
    ctx.lineTo(279, 46);
    ctx.lineTo(332, 76);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Windows
    ctx.fillStyle = state.phase === "completed" ? "#EAF2F3" : "#FBF2E6";
    ctx.fillRect(250, 92, 20, 18);
    ctx.strokeRect(250, 92, 20, 18);
    ctx.fillRect(288, 92, 20, 18);
    ctx.strokeRect(288, 92, 20, 18);

    // Dynamic smoke & flames
    const showFire = state.phase !== "idle" && state.phase !== "error" && state.fireIntensity > 0.02;
    if (showFire) {
      // Smoke plumes
      const smokeCount = Math.max(1, Math.round(5 * state.fireIntensity));
      for (let i = 0; i < smokeCount; i++) {
        const phaseOffset = reducedMotion ? i * 0.2 : ((state.stageClock * 0.45 + i * 0.22) % 1);
        const sx = 278 + Math.sin(i * 2.1 + state.stageClock) * 8;
        const sy = 74 - phaseOffset * 58;
        const sr = 6 + phaseOffset * 14 * state.fireIntensity;
        ctx.fillStyle = `rgba(85, 97, 100, ${(0.35 * (1 - phaseOffset) * state.fireIntensity).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3-layer flame
      const flicker = reducedMotion ? 1 : 0.92 + 0.14 * Math.sin(state.stageClock * 16);
      const scale = Math.max(0.1, state.fireIntensity) * flicker;
      const drawFlameLayer = (dx, h, w, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(278 + dx, 128);
        ctx.quadraticCurveTo(278 + dx - w, 128 - h * 0.45, 278 + dx, 128 - h);
        ctx.quadraticCurveTo(278 + dx + w, 128 - h * 0.45, 278 + dx, 128);
        ctx.fill();
      };
      drawFlameLayer(-8, 46 * scale, 16 * scale, "#B84A35");
      drawFlameLayer(8, 42 * scale, 15 * scale, "#B84A35");
      drawFlameLayer(0, 56 * scale, 18 * scale, "#D58A43");
      drawFlameLayer(0, 32 * scale, 10 * scale, "#FDE68A");
    } else if (state.phase === "completed") {
      // Calm post-extinguish steam wisps
      ctx.fillStyle = "rgba(71, 122, 130, 0.28)";
      ctx.beginPath();
      ctx.arc(274, 62, 10, 0, Math.PI * 2);
      ctx.arc(286, 54, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fire truck
    const showTruck =
      state.phase === "en_route" ||
      state.phase === "extinguishing" ||
      state.phase === "paused" ||
      state.phase === "completed";
    if (showTruck) {
      const truckX =
        state.phase === "en_route" || state.pausedFrom === "en_route"
          ? 18 + state.travelProgress * 108
          : 126;
      const truckY = 104;

      // Truck body
      ctx.fillStyle = "#B84A35";
      ctx.strokeStyle = "#202A2D";
      ctx.lineWidth = 2;
      ctx.fillRect(truckX, truckY + 10, 74, 28);
      ctx.strokeRect(truckX, truckY + 10, 74, 28);
      // Cab
      ctx.fillRect(truckX + 52, truckY + 2, 24, 36);
      ctx.strokeRect(truckX + 52, truckY + 2, 24, 36);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(truckX + 57, truckY + 8, 15, 11);
      ctx.strokeRect(truckX + 57, truckY + 8, 15, 11);
      // Wheels
      ctx.fillStyle = "#202A2D";
      ctx.beginPath();
      ctx.arc(truckX + 16, truckY + 40, 7, 0, Math.PI * 2);
      ctx.arc(truckX + 60, truckY + 40, 7, 0, Math.PI * 2);
      ctx.fill();

      // Red/blue emergency rotator beacons
      const strobe = reducedMotion ? true : Math.floor(state.stageClock * 5) % 2 === 0;
      ctx.fillStyle = strobe ? "#EF4444" : "#9A3B29";
      ctx.fillRect(truckX + 54, truckY - 4, 8, 6);
      ctx.fillStyle = strobe ? "#1D4ED8" : "#3B82F6";
      ctx.fillRect(truckX + 64, truckY - 4, 8, 6);

      // Pressurized water jet & splash droplets during extinguishing
      if (state.phase === "extinguishing") {
        ctx.strokeStyle = "#477A82";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(truckX + 74, truckY + 14);
        ctx.quadraticCurveTo(232, 92, 272, 116);
        ctx.stroke();

        ctx.fillStyle = "#356067";
        for (let d = 0; d < 6; d++) {
          const t = reducedMotion ? d / 6 : ((state.stageClock * 2.2 + d * 0.16) % 1);
          const wx = (1 - t) * (1 - t) * (truckX + 74) + 2 * (1 - t) * t * 232 + t * t * 272;
          const wy = (1 - t) * (1 - t) * (truckY + 14) + 2 * (1 - t) * t * 92 + t * t * 116;
          ctx.beginPath();
          ctx.arc(wx, wy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function renderRouteOnMap() {
    ensureMapInitialized();
    if (!routeLayer || !actorLayer || !mapHandle) return;
    routeLayer.clearLayers();
    actorLayer.clearLayers();
    truckMarker = null;
    targetMarker = null;

    if (!state.plan || !state.plan.ok) return;

    const { target, route } = state.plan;
    L.polyline(route.polylineLatLng, {
      color: "#356067",
      weight: 5,
      opacity: 0.9
    }).addTo(routeLayer);

    targetMarker = L.marker([target.lat, target.lon], {
      icon: buildFireTargetIcon(state.phase, state.fireIntensity)
    })
      .bindPopup(
        `<strong>Titik Api Simulasi (${escapeHtml(target.district_name)})</strong><br/>Koordinat: ${target.lat.toFixed(5)}, ${target.lon.toFixed(5)}`
      )
      .addTo(actorLayer);

    const pos = interpolateAlongPolyline(route.polylineLatLng, state.travelProgress);
    if (pos) {
      truckMarker = L.marker([pos.lat, pos.lon], {
        icon: buildTruckIcon(pos.bearingDeg, false),
        zIndexOffset: 500
      })
        .bindPopup(`<strong>Armada Simulasi</strong><br/>Dari: ${escapeHtml(state.plan.station.name)}`)
        .addTo(actorLayer);
    }

    services.maps.fitBounds(mapHandle.map, L.latLngBounds(route.polylineLatLng));
  }

  function stopLoop() {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function finishSimulation() {
    stopLoop();
    state.travelProgress = 1;
    state.extinguishProgress = 1;
    state.fireIntensity = 0;
    if (targetMarker) {
      targetMarker.setIcon(buildFireTargetIcon("completed", 0));
    }
    setPhase(
      "completed",
      "Simulasi selesai: armada simulasi tiba mengikuti rute jaringan jalan dan api skenario dipadamkan."
    );
    const { station, route, target } = state.plan;
    summaryBoxEl.hidden = false;
    summaryBoxEl.innerHTML = `
      <strong>Ringkasan Skenario Selesai:</strong> Armada simulasi dari <strong>${escapeHtml(station.name)}</strong> (${escapeHtml(station.verification_status)}) menempuh rute jaringan jalan OSM sepanjang <strong>${route.distanceKm.toFixed(2)} km</strong> menuju ${escapeHtml(target.district_name)} dengan estimasi perjalanan skenario <strong>${route.scenarioMinutes.toFixed(1)} menit</strong> (@ ${route.assumedSpeedKmh} km/jam). Hasil ini bersifat simulasi non-darurat dan tidak merepresentasikan waktu respons operasional aktual Damkarmat.
    `;
    drawStageVisuals(0);
  }

  function stepFrame(nowMs) {
    if (state.destroyed) return;
    if (state.phase !== "en_route" && state.phase !== "extinguishing") {
      rafId = null;
      return;
    }

    if (typeof document !== "undefined" && document.hidden) {
      state.lastFrameMs = nowMs;
      rafId = window.requestAnimationFrame(stepFrame);
      return;
    }

    const dtSec = state.lastFrameMs ? Math.min(0.1, (nowMs - state.lastFrameMs) / 1000) : 0.016;
    state.lastFrameMs = nowMs;

    const travelDurationSec = reducedMotion ? 1.2 : 4.0;
    const extinguishDurationSec = reducedMotion ? 1.2 : 3.5;

    if (state.phase === "en_route") {
      state.travelProgress = Math.min(1, state.travelProgress + dtSec / travelDurationSec);
      const pos = interpolateAlongPolyline(state.plan.route.polylineLatLng, state.travelProgress);
      if (truckMarker && pos) {
        truckMarker.setLatLng([pos.lat, pos.lon]);
        state.beaconCounter += 1;
        if (state.beaconCounter % 8 === 0) {
          truckMarker.setIcon(buildTruckIcon(pos.bearingDeg, (state.beaconCounter / 8) % 2 === 0));
        }
      }
      if (state.travelProgress >= 1) {
        state.extinguishProgress = 0;
        state.fireIntensity = 1;
        setPhase("extinguishing", "Armada simulasi tiba di lokasi. Proses pemadaman dan penurunan asap berjalan.");
      }
    } else if (state.phase === "extinguishing") {
      state.extinguishProgress = Math.min(1, state.extinguishProgress + dtSec / extinguishDurationSec);
      state.fireIntensity = Math.max(0, 1 - state.extinguishProgress);
      if (targetMarker) {
        targetMarker.setIcon(buildFireTargetIcon("extinguishing", state.fireIntensity));
      }
      if (state.extinguishProgress >= 1) {
        finishSimulation();
        return;
      }
    }

    drawStageVisuals(dtSec);
    rafId = window.requestAnimationFrame(stepFrame);
  }

  async function ensureRoadGraphLoaded() {
    if (state.graph && state.adj) return true;
    if (state.graphLoading) return false;
    state.graphLoading = true;
    state.graphError = null;
    setPhase("loading", "Memuat graf jaringan jalan OSM Kota Medan untuk perhitungan rute...");
    try {
      const graph = await services.dataStatus.fetchJson("medan_road_graph.json");
      if (state.destroyed) return false;
      state.graph = graph;
      state.adj = buildAdjacencyList(graph);
      state.graphLoading = false;
      return true;
    } catch (err) {
      if (state.destroyed) return false;
      state.graphLoading = false;
      state.graphError = err?.message || "Gagal memuat graf jaringan jalan OSM.";
      setPhase("error", `Gagal memuat graf jalan OSM: ${state.graphError}`);
      return false;
    }
  }

  async function selectFireTarget(lat, lon) {
    stopLoop();
    state.travelProgress = 0;
    state.extinguishProgress = 0;
    state.fireIntensity = 1;
    summaryBoxEl.hidden = true;

    const loaded = await ensureRoadGraphLoaded();
    if (!loaded || state.destroyed) return;

    setPhase("routing", "Memvalidasi batas Kota Medan dan menghitung rute jaringan jalan terpendek...");
    const result = planFireResponseScenario({
      targetLon: lon,
      targetLat: lat,
      districtsGeoJson,
      graph: state.graph,
      adj: state.adj,
      verifiedStations: summary.verified_stations || [],
      candidateStations: summary.candidate_stations?.stations || [],
      includeCandidates: state.includeCandidates,
      assumedSpeedKmh: SIMULATION_ASSUMED_SPEED_KMH
    });

    state.plan = result;
    renderPlanDetails();

    if (!result.ok) {
      routeLayer?.clearLayers();
      actorLayer?.clearLayers();
      setPhase("error", result.message);
      drawStageVisuals(0);
      return;
    }

    renderRouteOnMap();
    setPhase(
      "ready",
      `Rute siap: ${result.station.name} (${result.route.distanceKm.toFixed(2)} km, estimasi skenario ${result.route.scenarioMinutes.toFixed(1)} menit). Klik Mulai Simulasi.`
    );
    drawStageVisuals(0);
  }

  function startSimulation() {
    if (!state.plan || !state.plan.ok) return;
    state.travelProgress = 0;
    state.extinguishProgress = 0;
    state.fireIntensity = 1;
    state.pausedFrom = null;
    summaryBoxEl.hidden = true;
    state.lastFrameMs = performance.now();
    setPhase("en_route", "Armada simulasi bergerak mengikuti rute jaringan jalan OSM menuju titik api...");
    stopLoop();
    rafId = window.requestAnimationFrame(stepFrame);
  }

  function togglePause() {
    if (state.phase === "en_route" || state.phase === "extinguishing") {
      state.pausedFrom = state.phase;
      stopLoop();
      setPhase("paused", "Simulasi dijeda. Klik Lanjutkan untuk meneruskan pergerakan armada simulasi.");
    } else if (state.phase === "paused" && state.pausedFrom) {
      const resumeTo = state.pausedFrom;
      state.pausedFrom = null;
      state.lastFrameMs = performance.now();
      setPhase(
        resumeTo,
        resumeTo === "en_route"
          ? "Armada simulasi melanjutkan perjalanan mengikuti rute jaringan jalan..."
          : "Proses pemadaman dilanjutkan..."
      );
      audio.resume();
      rafId = window.requestAnimationFrame(stepFrame);
    }
  }

  function resetSimulation() {
    stopLoop();
    state.plan = null;
    state.pausedFrom = null;
    state.travelProgress = 0;
    state.extinguishProgress = 0;
    state.fireIntensity = 1;
    state.graphError = null;
    routeLayer?.clearLayers();
    actorLayer?.clearLayers();
    renderPlanDetails();
    setPhase(
      "idle",
      "Simulasi direset. Klik lokasi di dalam Kota Medan pada peta atau gunakan titik uji cepat."
    );
    drawStageVisuals(0);
    if (districtBoundaryLayer && mapHandle) {
      services.maps.fitBounds(mapHandle.map, districtBoundaryLayer);
    }
  }

  pickBtn.addEventListener(
    "click",
    () => {
      state.pickActive = !state.pickActive;
      syncControls();
    },
    { signal: ac.signal }
  );

  applyPresetBtn.addEventListener(
    "click",
    () => {
      const chosen = PRESET_LOCATIONS.find((p) => p.id === presetSelect.value);
      if (chosen) {
        selectFireTarget(chosen.lat, chosen.lon);
      }
    },
    { signal: ac.signal }
  );

  scopeSelect.addEventListener(
    "change",
    () => {
      state.includeCandidates = scopeSelect.value === "with-candidates";
      renderStationMarkers();
      if (state.plan?.ok && state.plan?.target) {
        selectFireTarget(state.plan.target.lat, state.plan.target.lon);
      }
    },
    { signal: ac.signal }
  );

  startBtn.addEventListener("click", startSimulation, { signal: ac.signal });
  pauseBtn.addEventListener("click", togglePause, { signal: ac.signal });
  resetBtn.addEventListener("click", resetSimulation, { signal: ac.signal });
  audioBtn.addEventListener(
    "click",
    () => {
      audio.setMuted(!audio.isMuted());
      syncControls();
    },
    { signal: ac.signal }
  );

  if (typeof document !== "undefined") {
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden && (state.phase === "en_route" || state.phase === "extinguishing")) {
          audio.pause();
        } else if (!document.hidden && (state.phase === "en_route" || state.phase === "extinguishing")) {
          audio.resume();
          state.lastFrameMs = performance.now();
        }
      },
      { signal: ac.signal }
    );
  }

  renderStationMarkers();
  renderPlanDetails();
  syncControls();
  syncTimeline();
  drawStageVisuals(0);

  return {
    async activate() {
      if (state.destroyed) return;
      ensureMapInitialized();
      if (mapHandle?.map?._mapPane) {
        mapHandle.map.invalidateSize({ animate: false });
        if (districtBoundaryLayer && !state.plan?.ok) {
          services.maps.fitBounds(mapHandle.map, districtBoundaryLayer);
        }
      }
      await ensureRoadGraphLoaded();
      if (!state.destroyed && state.phase === "loading") {
        setPhase(
          "idle",
          "Graf jalan OSM siap. Klik lokasi di dalam Kota Medan pada peta atau pilih titik uji cepat."
        );
      }
    },
    getStateSnapshot() {
      return {
        phase: state.phase,
        muted: audio.isMuted(),
        renderMode,
        hasPlan: Boolean(state.plan?.ok)
      };
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      stopLoop();
      ac.abort();
      audio.destroy();
      baseLayer?.clearLayers();
      routeLayer?.clearLayers();
      actorLayer?.clearLayers();
      mapHandle?.destroy();
    }
  };
}
