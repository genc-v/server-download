"use strict";

App.pages.home = (() => {
  const { bytes, percent, escapeHtml } = App.format;

  let pollTimer = null;

  function coverStyle(url) {
    return url ? ` style="background-image:url('${escapeHtml(url)}')"` : "";
  }

  function cardStatus(localEntry) {
    if (!localEntry) {
      return `<div class="hc-status hc-status--ready">
        <span class="hc-status-icon">↓</span>
        <span>Ready to pull</span>
      </div>`;
    }

    const s = localEntry.status;

    if (s === "completed") {
      return `<div class="hc-status hc-status--done">
        <span class="hc-status-icon">✓</span>
        <span>Installed</span>
      </div>`;
    }

    if (s === "error") {
      return `<div class="hc-status hc-status--error">
        <span class="hc-status-icon">!</span>
        <span>Error</span>
      </div>`;
    }

    /* active / queued / paused → show progress bar */
    const done  = localEntry.downloadedBytes || 0;
    const total = localEntry.totalBytes || 0;
    const speed = localEntry.bytesPerSecond || 0;
    const pct   = total ? percent(done, total) : 0;
    const isPaused = s === "paused";
    const label = isPaused ? "Paused" : (speed ? `${bytes(speed)}/s` : "Downloading…");

    return `<div class="hc-status hc-status--dl">
      <div class="hc-dl-row">
        <span class="hc-status-icon hc-dl-icon${isPaused ? " hc-dl-icon--paused" : ""}">↓</span>
        <span class="hc-dl-label">${label}</span>
        <span class="hc-dl-pct">${total ? pct.toFixed(0) + "%" : ""}</span>
      </div>
      <div class="hc-track"><div class="hc-fill" style="width:${pct}%"></div></div>
    </div>`;
  }

  async function render() {
    const el = document.getElementById("view-home");
    if (!el) return;

    const [localRes, libraryRes] = await Promise.allSettled([
      window.api.local.list(),
      window.api.server.library(),
    ]);

    const localAll = localRes.status  === "fulfilled" ? localRes.value  : [];
    const library  = libraryRes.status === "fulfilled" ? libraryRes.value : [];

    /* build a map: serverId → local transfer entry */
    const localByServerId = new Map(
      localAll.filter((t) => t.serverId).map((t) => [t.serverId, t])
    );

    /* also track locally completed by name for items pulled before serverId tracking */
    const localByName = new Map(
      localAll.map((t) => [t.name?.toLowerCase(), t])
    );

    /* merge server library with local state */
    const cards = library.map((item) => {
      const local = localByServerId.get(item.id)
        || localByName.get(item.name?.toLowerCase());
      return { item, local };
    });

    /* add any locally completed items not in server library */
    const serverIds = new Set(library.map((i) => i.id));
    for (const t of localAll) {
      if (t.status === "completed" && t.serverId && !serverIds.has(t.serverId)) {
        cards.push({ item: { id: t.serverId, name: t.name, totalBytes: t.totalBytes }, local: t });
      }
    }

    if (!cards.length) {
      el.innerHTML = `<div class="home-empty">
        <strong>No games available</strong>
        Search above to find and download games.
      </div>`;
      stopPoll();
      return;
    }

    const hasActive = cards.some(({ local }) =>
      local && !["completed", "error", "cancelled"].includes(local.status)
    );

    App.focus.preserve(() => {
      el.innerHTML = `<div class="page-pad">
        <div class="page-hd">Library</div>
        <div class="home-grid">
          ${cards.map(({ item, local }) => {
            const isReady     = !local;
            const isInstalled = local?.status === "completed";
            const isActive    = local && !["completed","error","cancelled"].includes(local.status);
            const isError     = local?.status === "error";

            return `<div class="home-card${isInstalled ? " home-card--installed" : ""}${isActive ? " home-card--active" : ""}" tabindex="0" aria-label="${escapeHtml(item.name)}">
              <div class="home-card-art"${coverStyle(local?.coverUrl)}>${!(local?.coverUrl) ? "🎮" : ""}</div>
              <div class="home-card-body">
                <div class="home-card-name">${escapeHtml(item.name)}</div>
                ${item.totalBytes && !isInstalled ? `<div class="home-card-size">${bytes(item.totalBytes)}</div>` : ""}
                ${isReady
                  ? `<button class="hc-pull-btn" data-pull-id="${escapeHtml(item.id)}" data-pull-name="${escapeHtml(item.name)}">
                      <span>↓</span> Pull Locally
                    </button>`
                  : cardStatus(local)
                }
                ${isError ? `<button class="hc-pull-btn hc-pull-btn--retry" data-pull-id="${escapeHtml(item.id)}" data-pull-name="${escapeHtml(item.name)}">Retry</button>` : ""}
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>`;
    });

    /* poll while downloads are active */
    if (hasActive) startPoll();
    else stopPoll();
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(render, 1500);
  }

  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  async function handleClick(event) {
    const btn = event.target.closest(".hc-pull-btn");
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = "<span>↓</span> Starting…";
    try {
      const coverUrl = await window.api.meta.get(btn.dataset.pullName).catch(() => null);
      await window.api.local.start({ id: btn.dataset.pullId, coverUrl });
      render();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = "<span>↓</span> Pull Locally";
      alert(err.message);
    }
  }

  return {
    init() {
      document.getElementById("view-home").addEventListener("click", handleClick);
    },
    show() { render(); },
    hide() { stopPoll(); },
  };
})();
