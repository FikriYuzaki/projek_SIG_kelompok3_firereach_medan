function renderStateIcon(variant) {
  if (variant === "error") {
    return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 14.5 13.5H1.5L8 1.5Zm0 4.2v3.8m0 1.8h.01" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (variant === "loading") {
    return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="22 10"/></svg>`;
  }
  return `<svg class="status-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

export function renderStatePanel({ variant = "empty", title, message, actionLabel = "", onAction = null }) {
  const box = document.createElement("section");
  box.className = "state-panel";
  box.setAttribute("data-state-variant", variant);
  if (variant === "error") {
    box.setAttribute("role", "alert");
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
