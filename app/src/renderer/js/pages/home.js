"use strict";

App.pages.home = (() => {
  const { bytes, escapeHtml } = App.format;

  function coverStyle(url) {
    return url ? ` style="background-image:url('${escapeHtml(url)}')"` : "";
  }

  async function render() {
    const el = document.getElementById("view-home");

    const [localRes, libraryRes] = await Promise.allSettled([
      window.api.local.list(),
      window.api.server.library(),
    ]);

    const localAll  = localRes.status  === "fulfilled" ? localRes.value  : [];
    const library   = libraryRes.status === "fulfilled" ? libraryRes.value : [];

    const installed = localAll.filter((t) => t.status === "completed");
    const pullingIds = new Set(localAll.filter((t) => t.status !== "cancelled" && t.status !== "error").map((t) => t.serverId));
    const readyToPull = library.filter((item) => !pullingIds.has(item.id));

    if (!installed.length && !readyToPull.length) {
      el.innerHTML = `<div class="home-empty">
        <strong>No games installed</strong>
        Search above to find and download games.
      </div>`;
      return;
    }

    const installedHtml = installed.length ? `
      <div class="page-hd">Installed</div>
      <div class="home-grid">
        ${installed.map((t) => `
          <div class="home-card" tabindex="0" aria-label="${escapeHtml(t.name)}">
            <div class="home-card-art"${coverStyle(t.coverUrl)}>${!t.coverUrl ? "🎮" : ""}</div>
            <div class="home-card-name">${escapeHtml(t.name)}</div>
          </div>`).join("")}
      </div>` : "";

    const readyHtml = readyToPull.length ? `
      <div class="page-hd ${installed.length ? "page-hd--mt" : ""}">Ready to Download</div>
      <div class="home-grid">
        ${readyToPull.map((item) => `
          <div class="home-card home-card--ready" tabindex="0" aria-label="${escapeHtml(item.name)}">
            <div class="home-card-art home-card-art--ready">
              <div class="home-card-ready-icon">↓</div>
            </div>
            <div class="home-card-name">${escapeHtml(item.name)}</div>
            <div class="home-card-size">${bytes(item.totalBytes)}</div>
            <button class="home-pull-btn" data-pull-id="${escapeHtml(item.id)}" data-pull-name="${escapeHtml(item.name)}">Pull Locally</button>
          </div>`).join("")}
      </div>` : "";

    el.innerHTML = `<div class="page-pad">${installedHtml}${readyHtml}</div>`;
  }

  async function handleClick(event) {
    const btn = event.target.closest(".home-pull-btn");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Starting…";
    try {
      const coverUrl = await window.api.meta.get(btn.dataset.pullName).catch(() => null);
      await window.api.local.start({ id: btn.dataset.pullId, coverUrl });
      await render();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Pull Locally";
      alert(err.message);
    }
  }

  return {
    init() {
      document.getElementById("view-home").addEventListener("click", handleClick);
    },
    show() { render(); },
  };
})();
