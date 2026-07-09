"use strict";

App.sidebar = (() => {
  const { bytes, escapeHtml, percent } = App.format;

  const ACTIVE_LOCAL = ["queued", "checking", "downloading", "retrying"];

  function thumbStyle(url) {
    return url ? ` style="background-image:url('${escapeHtml(url)}')"` : "";
  }

  function renderItems(transfers, library) {
    const localActive    = transfers.filter((t) => ACTIVE_LOCAL.includes(t.status));
    const localCompleted = transfers.filter((t) => t.status === "completed");
    const fetched        = new Set(transfers.filter((t) => t.status !== "cancelled").map((t) => t.serverId));
    const readyItems     = library.filter((item) => !fetched.has(item.id));

    const parts = [];

    // In-progress local downloads
    for (const t of localActive) {
      const pct = percent(t.downloadedBytes, t.totalBytes);
      parts.push(`
        <div class="sidebar-item" data-local-id="${t.id}" style="cursor:default">
          <div class="sidebar-thumb"${thumbStyle(t.coverUrl)}>
            ${!t.coverUrl ? "🎮" : ""}
          </div>
          <div class="sidebar-info">
            <div class="sidebar-name">${escapeHtml(t.name)}</div>
            <div class="sidebar-sub">${t.totalBytes ? pct.toFixed(0) + "%" : t.status}</div>
            <div class="sidebar-mini-bar">
              <div class="sidebar-mini-fill" style="width:${t.totalBytes ? pct : 0}%"></div>
            </div>
          </div>
        </div>`);
    }

    // Ready-to-pull library items
    for (const item of readyItems) {
      parts.push(`
        <div class="sidebar-item" style="cursor:default">
          <div class="sidebar-thumb">📦</div>
          <div class="sidebar-info">
            <div class="sidebar-name">${escapeHtml(item.name)}</div>
            <div class="sidebar-sub">${bytes(item.totalBytes)}</div>
          </div>
          <button class="sidebar-pull-btn" data-pull-id="${item.id}" data-pull-name="${escapeHtml(item.name)}">↓ Pull</button>
        </div>`);
    }

    // Completed local downloads
    for (const t of localCompleted) {
      parts.push(`
        <button class="sidebar-item" data-open-game="${escapeHtml(t.name)}">
          <div class="sidebar-thumb"${thumbStyle(t.coverUrl)}>
            ${!t.coverUrl ? "🎮" : ""}
          </div>
          <div class="sidebar-info">
            <div class="sidebar-name">${escapeHtml(t.name)}</div>
          </div>
          <span class="sidebar-badge done">✓</span>
        </button>`);
    }

    return parts.join("") || '<div class="sidebar-empty">Nothing downloaded yet.<br>Find a game and queue it.</div>';
  }

  async function refresh() {
    const listEl = document.getElementById("sidebar-list");
    if (!listEl) return;

    const [transfersRes, libraryRes] = await Promise.allSettled([
      window.api.local.list(),
      window.api.server.library(),
    ]);

    const transfers = transfersRes.status === "fulfilled" ? transfersRes.value : [];
    const library   = libraryRes.status === "fulfilled"   ? libraryRes.value   : [];

    App.focus.preserve(() => {
      listEl.innerHTML = renderItems(transfers, library);
    });
  }

  async function click(event) {
    // Pull a library item to this machine
    const pullBtn = event.target.closest("[data-pull-id]");
    if (pullBtn) {
      pullBtn.disabled = true;
      pullBtn.textContent = "…";
      try {
        const coverUrl = await window.api.meta.get(pullBtn.dataset.pullName).catch(() => null);
        await window.api.local.start({ id: pullBtn.dataset.pullId, coverUrl });
        refresh();
      } catch (err) {
        pullBtn.disabled = false;
        pullBtn.textContent = "Retry";
        pullBtn.title = err.message;
        const sub = pullBtn.closest(".sidebar-item")?.querySelector(".sidebar-sub");
        if (sub) sub.textContent = err.message;
      }
      return;
    }

    // Open a completed game's detail page
    const openBtn = event.target.closest("[data-open-game]");
    if (openBtn) {
      App.showGame({ title: openBtn.dataset.openGame });
    }
  }

  return {
    init() {
      document.getElementById("sidebar-list").addEventListener("click", click);
      refresh();
    },
    refresh,
  };
})();
