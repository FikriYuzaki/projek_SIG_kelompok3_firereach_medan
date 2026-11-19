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
      ? "status-badge--demo"
      : variant === "loading"
        ? "status-badge--dev"
        : "status-badge--soon"
  }`;
  badge.textContent =
    variant === "error" ? "[!] Gangguan Data" : variant === "loading" ? "[~] Memuat" : "[ ] Kosong";

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
