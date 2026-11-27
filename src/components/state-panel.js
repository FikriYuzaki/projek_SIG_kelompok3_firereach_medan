function renderStateIcon(variant) {
  if (variant === "error") {
    return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 14.5 13.5H1.5L8 1.5Zm0 4.2v3.8m0 1.8h.01" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (variant === "loading") {
    return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="22 10"/></svg>`;
  }
  return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

function createShimmerBar(className) {
  const bar = document.createElement("span");
  bar.className = `skeleton-shimmer ${className}`;
  return bar;
}

function buildLoadingSkeleton() {
  const wrapper = document.createElement("div");
  wrapper.className = "skeleton-workspace";
  wrapper.setAttribute("aria-hidden", "true");

  const kpiGrid = document.createElement("div");
  kpiGrid.className = "skeleton-kpi-grid";
  for (let i = 0; i < 4; i += 1) {
    const card = document.createElement("div");
    card.className = "skeleton-card";
    card.append(createShimmerBar("skeleton-line skeleton-line--short"), createShimmerBar("skeleton-value"));
    kpiGrid.appendChild(card);
  }

  const split = document.createElement("div");
  split.className = "skeleton-split";

  const mapPanel = document.createElement("div");
  mapPanel.className = "skeleton-panel";
  mapPanel.append(createShimmerBar("skeleton-line skeleton-line--medium"), createShimmerBar("skeleton-map-box"));

  const detailPanel = document.createElement("div");
  detailPanel.className = "skeleton-panel";
  detailPanel.appendChild(createShimmerBar("skeleton-line skeleton-line--medium"));

  const rows = document.createElement("div");
  rows.className = "skeleton-table-rows";
  for (let i = 0; i < 4; i += 1) {
    rows.appendChild(
      createShimmerBar(i === 3 ? "skeleton-row skeleton-line--medium" : "skeleton-row")
    );
  }
  detailPanel.appendChild(rows);

  split.append(mapPanel, detailPanel);
  wrapper.append(kpiGrid, split);
  return wrapper;
}

export function renderStatePanel({ variant = "empty", title, message, actionLabel = "", onAction = null }) {
  const box = document.createElement("section");
  box.className = variant === "loading" ? "state-panel state-panel--loading" : "state-panel";
  box.setAttribute("data-state-variant", variant);
  if (variant === "error") {
    box.setAttribute("role", "alert");
  } else if (variant === "loading") {
    box.setAttribute("role", "status");
    box.setAttribute("aria-busy", "true");
  }

  const badge = document.createElement("span");
  badge.className = `status-badge ${
    variant === "error"
      ? "status-badge--warn"
      : variant === "loading"
        ? "status-badge--dev"
        : "status-badge--soon"
  }`;
  const labelText =
    variant === "error" ? "Gangguan Data" : variant === "loading" ? "Memuat" : "Kosong";
  badge.innerHTML = `${renderStateIcon(variant)}<span>${labelText}</span>`;

  const heading = document.createElement("h2");
  heading.textContent = title;

  const body = document.createElement("p");
  body.className = "page-lead";
  body.textContent = message;

  box.append(badge, heading, body);

  if (variant === "loading") {
    box.appendChild(buildLoadingSkeleton());
  }

  if (actionLabel && typeof onAction === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = actionLabel;
    btn.addEventListener("click", onAction);
    box.appendChild(btn);
  }

  return box;
}
