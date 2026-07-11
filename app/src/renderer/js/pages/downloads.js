"use strict";

App.pages.downloads = (() => {
  const { bytes, percent, escapeHtml } = App.format;

  const ACTIVE_LOCAL  = ["queued", "checking", "downloading", "retrying"];
  const ACTIVE_SERVER = ["active", "waiting", "downloading"];

  function normServer(dl) {
    const id     = dl.gid || dl.id || dl._id || "";
    const total  = Number(dl.totalLength)     || Number(dl.totalBytes)     || 0;
    const done   = Number(dl.completedLength) || Number(dl.downloadedBytes) || 0;
    const speed  = Number(dl.downloadSpeed)   || Number(dl.bytesPerSecond)  || 0;
    const name   = dl.name || dl.title
      || (dl.files?.[0]?.path?.split("/").pop() || "").replace(/\.[^.]+$/, "")
      || id;
    const status = (dl.status || "unknown").toLowerCase();
    const err    = dl.errorMessage || dl.error || "";
    return { id, name, status, total, done, speed, err };
  }

  function eta(done, total, speed) {
    if (!speed || !total) return "";
    const secs = (total - done) / speed;
    if (secs < 60) return `${Math.round(secs)}s left`;
    if (secs < 3600) return `${Math.round(secs / 60)}m left`;
    return `${(secs / 3600).toFixed(1)}h left`;
  }

  function progressRow(done, total, speed, status) {
    const pct      = percent(done, total);
    const pctStr   = total ? pct.toFixed(1) + "%" : "";
    const sizeStr  = total ? `${bytes(done)} / ${bytes(total)}` : "";
    const speedStr = speed ? bytes(speed) + "/s" : "";
    const etaStr   = eta(done, total, speed);
    const meta     = [speedStr, sizeStr, etaStr].filter(Boolean).join(" · ");
    return `
      <div class="dl-progress-label">
        <span class="dl-status">${escapeHtml(status)}</span>
        <span class="dl-pct">${pctStr}</span>
      </div>
      <div class="dl-track"><div class="dl-fill" style="width:${total ? pct : 0}%"></div></div>
      ${meta ? `<div class="dl-meta">${meta}</div>` : ""}`;
  }

  function extractStatusRow(t) {
    if (!t.extractStatus) return "";
    if (t.extractStatus === "extracting") {
      return `<div class="dl-extract-label dl-extract-label--active">Extracting…</div>`;
    }
    if (t.extractStatus === "done") {
      return `<div class="dl-extract-label dl-extract-label--done">Extracted</div>`;
    }
    if (t.extractStatus === "error") {
      return `<div class="dl-extract-label dl-extract-label--err">Extract failed: ${escapeHtml(t.extractError || "")}</div>`;
    }
    return "";
  }

  function renderServerSection(serverDls) {
    if (!serverDls.length) return "";
    return `<div class="dl-section-hd">Downloading on Server</div>` +
      serverDls.map((dl) => {
        const isActive = ACTIVE_SERVER.includes(dl.status);
        const isPaused = dl.status === "paused";
        const isDone   = dl.status === "complete" || dl.status === "completed";
        const isError  = dl.status === "error";
        return `
          <div class="dl-item">
            <div class="dl-item-body">
              <div class="dl-name">${escapeHtml(dl.name)}</div>
              ${isDone  ? `<div class="dl-done-label">Complete on server — pull it locally below</div>` : ""}
              ${isError ? `<div class="error-msg">${escapeHtml(dl.err)}</div>` : ""}
              ${!isDone ? progressRow(dl.done, dl.total, dl.speed, dl.status) : ""}
            </div>
            <div class="dl-actions">
              ${isActive ? `<button class="dl-btn dl-btn--pause"  data-server-id="${escapeHtml(dl.id)}" data-server-action="pause">Pause</button>`  : ""}
              ${isPaused ? `<button class="dl-btn dl-btn--resume" data-server-id="${escapeHtml(dl.id)}" data-server-action="resume">Resume</button>` : ""}
              ${isError  ? `<button class="dl-btn dl-btn--resume" data-server-id="${escapeHtml(dl.id)}" data-server-action="retry">Retry</button>`   : ""}
              ${!isDone  ? `<button class="dl-btn dl-btn--cancel" data-server-id="${escapeHtml(dl.id)}" data-server-action="cancel">Cancel</button>` : ""}
            </div>
          </div>`;
      }).join("");
  }

  function renderPullSection(pullable, pulling) {
    if (!pullable.length) return "";
    const pullingIds = new Set(pulling.map((t) => t.serverId));
    return `<div class="dl-section-hd">Ready to Pull Locally</div>` +
      pullable.map((item) => {
        const alreadyPulling = pullingIds.has(item.id);
        return `
          <div class="dl-item">
            <div class="dl-item-body">
              <div class="dl-name">${escapeHtml(item.name)}</div>
              <div class="dl-meta">${bytes(item.totalBytes)} on server</div>
            </div>
            <div class="dl-actions">
              ${alreadyPulling
                ? `<span class="dl-pulling-label">Pulling…</span>`
                : `<button class="dl-btn dl-btn--pull" data-pull-id="${escapeHtml(item.id)}" data-pull-name="${escapeHtml(item.name)}">↓ Pull Locally</button>`}
            </div>
          </div>`;
      }).join("");
  }

  function renderLocalActive(items) {
    if (!items.length) return "";
    return `<div class="dl-section-hd">Downloading Locally</div>` +
      items.map((t) => {
        const isActive = ACTIVE_LOCAL.includes(t.status);
        const isPaused = t.status === "paused";
        const isError  = t.status === "error";
        return `
          <div class="dl-item">
            <div class="dl-item-body">
              <div class="dl-name">${escapeHtml(t.name)}</div>
              ${isError ? `<div class="error-msg">${escapeHtml(t.error || "")}</div>` : ""}
              ${progressRow(t.downloadedBytes, t.totalBytes, t.bytesPerSecond, t.status)}
            </div>
            <div class="dl-actions">
              ${isActive ? `<button class="dl-btn dl-btn--pause"  data-local-id="${escapeHtml(t.id)}" data-local-action="pause">Pause</button>`  : ""}
              ${isPaused ? `<button class="dl-btn dl-btn--resume" data-local-id="${escapeHtml(t.id)}" data-local-action="resume">Resume</button>` : ""}
              ${isError  ? `<button class="dl-btn dl-btn--resume" data-local-id="${escapeHtml(t.id)}" data-local-action="resume">Retry</button>`  : ""}
              ${isError  ? `<button class="dl-btn dl-btn--remove" data-local-id="${escapeHtml(t.id)}" data-local-action="remove">Remove</button>` : ""}
              ${!isError ? `<button class="dl-btn dl-btn--cancel" data-local-id="${escapeHtml(t.id)}" data-local-action="cancel">Cancel</button>` : ""}
            </div>
          </div>`;
      }).join("");
  }

  function renderLocalDone(items) {
    if (!items.length) return "";
    return `<div class="dl-section-hd">Completed</div>` +
      items.map((t) => {
        const isExtracting = t.extractStatus === "extracting";
        const sizeStr = t.totalBytes ? bytes(t.totalBytes) : "";
        return `
          <div class="dl-item">
            <div class="dl-item-body">
              <div class="dl-name">${escapeHtml(t.name)}</div>
              ${sizeStr ? `<div class="dl-meta">${sizeStr}</div>` : ""}
              ${extractStatusRow(t)}
            </div>
            <div class="dl-actions">
              <button class="dl-btn dl-btn--extract" data-local-id="${escapeHtml(t.id)}" data-local-action="extract"
                ${isExtracting ? "disabled" : ""}>${isExtracting ? "Extracting…" : "Extract"}</button>
              <button class="dl-btn dl-btn--remove"  data-local-id="${escapeHtml(t.id)}" data-local-action="remove">Remove</button>
            </div>
          </div>`;
      }).join("");
  }

  function renderLocalCancelled(items) {
    if (!items.length) return "";
    return `<div class="dl-section-hd">Cancelled</div>` +
      items.map((t) => `
        <div class="dl-item dl-item--dim">
          <div class="dl-item-body">
            <div class="dl-name">${escapeHtml(t.name)}</div>
            <div class="dl-meta">Cancelled</div>
          </div>
          <div class="dl-actions">
            <button class="dl-btn dl-btn--remove" data-local-id="${escapeHtml(t.id)}" data-local-action="remove">Remove</button>
          </div>
        </div>`).join("");
  }

  function renderStats(serverDls, localActive, diskFree) {
    const serverActive = serverDls.filter((d) => ACTIVE_SERVER.includes(d.status));
    const serverRem = serverActive.reduce((s, d) => s + Math.max(0, d.total - d.done), 0);
    const localRem  = localActive.reduce((s, t) => s + Math.max(0, (t.totalBytes || 0) - (t.downloadedBytes || 0)), 0);
    const parts = [];
    if (serverRem) parts.push(`Server: ${bytes(serverRem)} remaining`);
    if (localRem)  parts.push(`Local: ${bytes(localRem)} remaining`);
    if (diskFree != null) parts.push(`Disk free: ${bytes(diskFree)}`);
    if (!parts.length) return "";
    return `<div class="dl-stats">${parts.join("  ·  ")}</div>`;
  }

  async function refresh() {
    const el = document.getElementById("view-downloads");
    if (!el || el.hidden) return;

    const [serverRaw, libraryRaw, localRaw, diskRaw] = await Promise.allSettled([
      window.api.server.downloads(),
      window.api.server.library(),
      window.api.local.list(),
      window.api.settings.diskFree(),
    ]);

    const rawServer = serverRaw.status  === "fulfilled" ? serverRaw.value  : [];
    const library   = libraryRaw.status === "fulfilled" ? libraryRaw.value : [];
    const localAll  = localRaw.status   === "fulfilled" ? localRaw.value   : [];
    const diskFree  = diskRaw.status    === "fulfilled" ? diskRaw.value    : null;

    const serverDls = (Array.isArray(rawServer) ? rawServer : []).map(normServer);

    const localInFlight = localAll.filter((t) =>
      ACTIVE_LOCAL.includes(t.status) || t.status === "paused" || t.status === "error"
    );
    const localDone      = localAll.filter((t) => t.status === "completed");
    const localCancelled = localAll.filter((t) => t.status === "cancelled");

    const alreadyPulled = new Set(
      localAll.filter((t) => t.status !== "cancelled").map((t) => t.serverId)
    );
    const pullable = library.filter((item) => !alreadyPulled.has(item.id));
    const pulling  = localAll.filter((t) => ACTIVE_LOCAL.includes(t.status));

    const content = document.getElementById("dl-content");
    if (!content) return;

    const hasAnything =
      serverDls.length || pullable.length ||
      localInFlight.length || localDone.length || localCancelled.length;

    App.focus.preserve(() => {
      content.innerHTML = hasAnything
        ? renderStats(serverDls, localInFlight, diskFree)
          + renderServerSection(serverDls)
          + renderPullSection(pullable, pulling)
          + renderLocalActive(localInFlight)
          + renderLocalDone(localDone)
          + renderLocalCancelled(localCancelled)
        : `<div class="dl-empty">
            <strong>No active downloads</strong>
            Search for a game and press Download to get started.
          </div>`;
    });

    const activeCount =
      serverDls.filter((d) => ACTIVE_SERVER.includes(d.status)).length + pulling.length;
    const badge = document.getElementById("downloads-badge");
    if (badge) {
      badge.hidden = activeCount === 0;
      badge.textContent = activeCount > 9 ? "9+" : String(activeCount);
    }
  }

  async function handleClick(event) {
    /* server actions */
    const serverBtn = event.target.closest("[data-server-action]");
    if (serverBtn) {
      serverBtn.disabled = true;
      try {
        await window.api.server.action(serverBtn.dataset.serverId, serverBtn.dataset.serverAction);
        await refresh();
      } catch (err) {
        serverBtn.disabled = false;
        alert(err.message);
      }
      return;
    }

    /* pull to local */
    const pullBtn = event.target.closest("[data-pull-id]");
    if (pullBtn) {
      pullBtn.disabled = true;
      pullBtn.textContent = "Starting…";
      try {
        const coverUrl = await window.api.meta.get(pullBtn.dataset.pullName).catch(() => null);
        await window.api.local.start({ id: pullBtn.dataset.pullId, coverUrl });
        await refresh();
      } catch (err) {
        pullBtn.disabled = false;
        pullBtn.textContent = "↓ Pull Locally";
        alert(err.message);
      }
      return;
    }

    /* local actions */
    const localBtn = event.target.closest("[data-local-action]");
    if (localBtn) {
      localBtn.disabled = true;
      try {
        const action = localBtn.dataset.localAction;
        const id     = localBtn.dataset.localId;
        if (action === "pause")   await window.api.local.pause(id);
        if (action === "resume")  await window.api.local.resume(id);
        if (action === "cancel")  await window.api.local.cancel(id);
        if (action === "remove")  await window.api.local.remove(id);
        if (action === "extract") {
          await window.api.local.extract(id);
          /* extraction runs async on the backend — poll will pick up status */
          await refresh();
          return;
        }
        await refresh();
      } catch (err) {
        localBtn.disabled = false;
        alert(err.message);
      }
      return;
    }
  }

  let pollTimer = null;

  return {
    init() {
      document.getElementById("view-downloads").addEventListener("click", handleClick);
    },
    show() {
      const el = document.getElementById("view-downloads");
      if (!el.querySelector("#dl-content")) {
        el.innerHTML = `<div class="page-pad"><div class="page-hd">Downloads</div><div id="dl-content"></div></div>`;
      }
      refresh();
      clearInterval(pollTimer);
      pollTimer = setInterval(refresh, 2000);
    },
    hide() {
      clearInterval(pollTimer);
      pollTimer = null;
    },
    refreshBadge: refresh,
  };
})();
