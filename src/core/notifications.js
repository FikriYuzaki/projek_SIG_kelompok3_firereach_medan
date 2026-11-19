export function createNotificationService(regionElement) {
  let activeTimer = null;

  function clear() {
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    if (!regionElement) return;
    regionElement.hidden = true;
    regionElement.innerHTML = "";
    regionElement.dataset.tone = "";
  }

  function show(message, tone = "info") {
    if (!regionElement) return;
    clear();

    const text = document.createElement("span");
    text.textContent = message;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn btn-secondary btn-sm";
    closeBtn.textContent = "Tutup";
    closeBtn.setAttribute("aria-label", "Tutup notifikasi");
    closeBtn.addEventListener("click", clear);

    regionElement.dataset.tone = tone;
    regionElement.append(text, closeBtn);
    regionElement.hidden = false;

    activeTimer = setTimeout(clear, 7000);
  }

  return { show, clear };
}
