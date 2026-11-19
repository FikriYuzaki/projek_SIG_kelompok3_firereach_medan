import * as THREE from "three";

const OBJECT_PRESETS = {
  rumah: {
    label: "Bangunan Rumah Tinggal",
    note: "Ilustrasi skematis massa bangunan hunian (bukan model lokasi nyata).",
    color: 0xb84a35,
    roofColor: 0x202a2d,
    shape: "house"
  },
  ruko: {
    label: "Ruko / Bangunan Komersial",
    note: "Ilustrasi skematis blok ruko bertingkat (bukan model lokasi nyata).",
    color: 0xd58a43,
    roofColor: 0x356067,
    shape: "shophouse"
  },
  gudang: {
    label: "Gudang / Pabrik",
    note: "Ilustrasi skematis bangunan industri bentang lebar.",
    color: 0x477a82,
    roofColor: 0x202a2d,
    shape: "warehouse"
  },
  mako: {
    label: "Pos / Mako Damkarmat",
    note: "Ilustrasi skematis pos layanan pemadam (ruang armada siaga).",
    color: 0x356067,
    roofColor: 0xb84a35,
    shape: "station"
  },
  umum: {
    label: "Fasilitas Umum / Lainnya",
    note: "Ilustrasi skematis kategori objek non-hunian.",
    color: 0x6e7a7d,
    roofColor: 0x202a2d,
    shape: "generic"
  }
};

export function resolvePresetKey(rawType = "") {
  const text = String(rawType).toLowerCase();
  if (text.includes("mako") || text.includes("pos")) return "mako";
  if (text.includes("ruko")) return "ruko";
  if (text.includes("gudang") || text.includes("pabrik")) return "gudang";
  if (text.includes("rumah")) return "rumah";
  return "umum";
}

function canUseWebGL() {
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") || probe.getContext("webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
}

function buildFallbackSvg(preset) {
  return `
    <svg viewBox="0 0 320 200" role="img" aria-label="Skema 2D ${preset.label}">
      <rect width="320" height="200" fill="#ECEAE2"></rect>
      <rect x="40" y="148" width="240" height="8" fill="#D9DEDA"></rect>
      ${
        preset.shape === "shophouse"
          ? `<rect x="85" y="54" width="66" height="94" fill="#D58A43" stroke="#202A2D" stroke-width="2"></rect>
             <rect x="169" y="54" width="66" height="94" fill="#D58A43" stroke="#202A2D" stroke-width="2"></rect>
             <rect x="102" y="72" width="14" height="18" fill="#FFFFFF" stroke="#202A2D"></rect>
             <rect x="186" y="72" width="14" height="18" fill="#FFFFFF" stroke="#202A2D"></rect>`
          : preset.shape === "warehouse"
            ? `<rect x="64" y="84" width="192" height="64" fill="#477A82" stroke="#202A2D" stroke-width="2"></rect>
               <polygon points="58,84 160,52 262,84" fill="#202A2D"></polygon>`
            : preset.shape === "station"
              ? `<rect x="74" y="74" width="172" height="74" fill="#356067" stroke="#202A2D" stroke-width="2"></rect>
                 <rect x="92" y="100" width="44" height="48" fill="#FFFFFF" stroke="#202A2D" stroke-width="2"></rect>
                 <rect x="150" y="100" width="44" height="48" fill="#FFFFFF" stroke="#202A2D" stroke-width="2"></rect>
                 <rect x="74" y="64" width="172" height="10" fill="#B84A35"></rect>`
              : `<rect x="96" y="86" width="128" height="62" fill="#B84A35" stroke="#202A2D" stroke-width="2"></rect>
                 <polygon points="86,86 160,44 234,86" fill="#202A2D"></polygon>
                 <rect x="146" y="110" width="28" height="38" fill="#F4F2EC" stroke="#202A2D"></rect>`
      }
      <text x="160" y="182" text-anchor="middle" fill="#202A2D" font-size="11" font-family="sans-serif">
        Fallback 2D: ${preset.label}
      </text>
    </svg>
  `;
}

export function mountObjectSchematicPreview(container, initialType = "rumah") {
  let activeKey = resolvePresetKey(initialType);
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let isPlaying = !reducedMotion;

  container.innerHTML = `
    <div class="preview-box" data-preview-box>
      <div class="preview-stage" data-preview-stage></div>
      <div class="preview-controls">
        <div>
          <strong data-preview-title>${OBJECT_PRESETS[activeKey].label}</strong>
          <div style="color: var(--color-ink-muted);" data-preview-note>${OBJECT_PRESETS[activeKey].note}</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-preview-toggle>
          ${isPlaying ? "Jeda Putaran" : "Putar Pratinjau"}
        </button>
      </div>
    </div>
  `;

  const stageEl = container.querySelector("[data-preview-stage]");
  const titleEl = container.querySelector("[data-preview-title]");
  const noteEl = container.querySelector("[data-preview-note]");
  const toggleBtn = container.querySelector("[data-preview-toggle]");

  let renderer = null;
  let scene = null;
  let camera = null;
  let modelGroup = null;
  let frameId = null;
  let resizeObserver = null;
  let webglActive = false;
  const disposableItems = [];

  function clearGroup() {
    if (!modelGroup || !scene) return;
    scene.remove(modelGroup);
    while (disposableItems.length) {
      const item = disposableItems.pop();
      if (typeof item.dispose === "function") item.dispose();
    }
    modelGroup = null;
  }

  function buildMass(preset) {
    const group = new THREE.Group();
    const baseGeo = new THREE.BoxGeometry(3.2, 0.16, 2.4);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xd9deda, roughness: 0.9 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = -0.6;
    group.add(baseMesh);
    disposableItems.push(baseGeo, baseMat);

    const wallMat = new THREE.MeshStandardMaterial({ color: preset.color, roughness: 0.7 });
    const roofMat = new THREE.MeshStandardMaterial({ color: preset.roofColor, roughness: 0.6 });
    disposableItems.push(wallMat, roofMat);

    if (preset.shape === "shophouse") {
      const b1 = new THREE.BoxGeometry(1.1, 1.5, 1.3);
      const b2 = new THREE.BoxGeometry(1.1, 1.5, 1.3);
      const m1 = new THREE.Mesh(b1, wallMat);
      const m2 = new THREE.Mesh(b2, wallMat);
      m1.position.set(-0.62, 0.22, 0);
      m2.position.set(0.62, 0.22, 0);
      const cap = new THREE.BoxGeometry(2.45, 0.14, 1.4);
      const capMesh = new THREE.Mesh(cap, roofMat);
      capMesh.position.set(0, 1.02, 0);
      group.add(m1, m2, capMesh);
      disposableItems.push(b1, b2, cap);
    } else if (preset.shape === "warehouse") {
      const bodyGeo = new THREE.BoxGeometry(2.4, 0.9, 1.5);
      const bodyMesh = new THREE.Mesh(bodyGeo, wallMat);
      bodyMesh.position.y = -0.08;
      const roofGeo = new THREE.CylinderGeometry(0.95, 0.95, 2.42, 3);
      const roofMesh = new THREE.Mesh(roofGeo, roofMat);
      roofMesh.rotation.z = Math.PI / 2;
      roofMesh.position.y = 0.62;
      group.add(bodyMesh, roofMesh);
      disposableItems.push(bodyGeo, roofGeo);
    } else if (preset.shape === "station") {
      const bodyGeo = new THREE.BoxGeometry(2.3, 1.05, 1.4);
      const bodyMesh = new THREE.Mesh(bodyGeo, wallMat);
      bodyMesh.position.y = 0.0;
      const trimGeo = new THREE.BoxGeometry(2.4, 0.18, 1.5);
      const trimMesh = new THREE.Mesh(trimGeo, roofMat);
      trimMesh.position.y = 0.6;
      group.add(bodyMesh, trimMesh);
      disposableItems.push(bodyGeo, trimGeo);
    } else {
      const bodyGeo = new THREE.BoxGeometry(1.5, 0.95, 1.3);
      const bodyMesh = new THREE.Mesh(bodyGeo, wallMat);
      bodyMesh.position.y = -0.05;
      const roofGeo = new THREE.ConeGeometry(1.18, 0.72, 4);
      const roofMesh = new THREE.Mesh(roofGeo, roofMat);
      roofMesh.rotation.y = Math.PI / 4;
      roofMesh.position.y = 0.78;
      group.add(bodyMesh, roofMesh);
      disposableItems.push(bodyGeo, roofGeo);
    }
    return group;
  }

  function renderFallback(key) {
    const preset = OBJECT_PRESETS[key];
    stageEl.dataset.renderMode = "fallback-2d";
    stageEl.innerHTML = buildFallbackSvg(preset);
    toggleBtn.disabled = true;
    toggleBtn.textContent = "Mode Statis 2D";
  }

  if (canUseWebGL()) {
    try {
      const width = stageEl.clientWidth || 300;
      const height = stageEl.clientHeight || 180;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      stageEl.dataset.renderMode = "webgl";
      stageEl.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);
      camera.position.set(2.9, 2.0, 3.2);
      camera.lookAt(0, 0.2, 0);

      const amb = new THREE.AmbientLight(0xffffff, 0.85);
      const dir = new THREE.DirectionalLight(0xffffff, 0.9);
      dir.position.set(4, 6, 3);
      scene.add(amb, dir);

      modelGroup = buildMass(OBJECT_PRESETS[activeKey]);
      scene.add(modelGroup);
      renderer.render(scene, camera);
      webglActive = true;

      const tick = () => {
        if (!webglActive || !renderer) return;
        if (isPlaying && modelGroup) {
          modelGroup.rotation.y += 0.008;
          renderer.render(scene, camera);
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (!renderer || !camera) return;
          const w = stageEl.clientWidth || 300;
          const h = stageEl.clientHeight || 180;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h, false);
          renderer.render(scene, camera);
        });
        resizeObserver.observe(stageEl);
      }
    } catch {
      webglActive = false;
      renderFallback(activeKey);
    }
  } else {
    renderFallback(activeKey);
  }

  toggleBtn.addEventListener("click", () => {
    if (!webglActive) return;
    isPlaying = !isPlaying;
    toggleBtn.textContent = isPlaying ? "Jeda Putaran" : "Putar Pratinjau";
    toggleBtn.setAttribute("aria-pressed", String(!isPlaying));
  });

  function setObjectType(nextType) {
    activeKey = resolvePresetKey(nextType);
    const preset = OBJECT_PRESETS[activeKey];
    titleEl.textContent = preset.label;
    noteEl.textContent = preset.note;
    if (webglActive && scene && renderer) {
      clearGroup();
      modelGroup = buildMass(preset);
      scene.add(modelGroup);
      renderer.render(scene, camera);
    } else {
      renderFallback(activeKey);
    }
  }

  function destroy() {
    webglActive = false;
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    clearGroup();
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
  }

  return { setObjectType, destroy };
}
