"use strict";

App.pages.downloads = (() => {
  const { bytes, escapeHtml, percent } = App.format;

  const serverList = () => document.getElementById("server-downloads");
  const libraryList = () => document.getElementById("library");
  const localList = () => document.getElementById("local-transfers");

  /* ----------------------- server downloads ----------------------- */

  const SERVER_ACTIVE = ["queued", "resolving", "downloading", "retrying"];

  function serverActions(d) {
    if (SERVER_ACTIVE.includes(d.status)) {
      return `<button data-server-action="pause" data-id="${d.id}">Pause</button>
              <button data-server-action="cancel" data-id="${d.id}">Cancel</button>`;
    }
    if (d.status === "paused") {
      return `<button data-server-action="resume" data-id="${d.id}">Resume</button>
              <button data-server-action="cancel" data-id="${d.id}">Cancel</button>`;
    }
    if (d.status === "extracting") return "";
    if (d.status === "error" || d.status === "cancelled") {
      return `<button data-server-action="retry" data-id="${d.id}">Retry</button>
              <button data-server-action="remove" data-id="${d.id}">Remove</button>`;
    }
    return `<button data-server-action="remove" data-id="${d.id}">Remove</button>`;
  }

  function renderServer(items) {
    if (!items.length) {
      serverList().innerHTML = '<div class="empty">Nothing yet — queue something from Search</div>';
      return;
    }
    serverList().innerHTML = items
      .map((d) => {
        const done = d.status === "completed" || d.status === "installed";
        const pct = done ? 100 : percent(d.downloadedBytes, d.totalBytes);
        const indeterminate =
          d.status === "extracting" ||
          (SERVER_ACTIVE.includes(d.status) && !d.totalBytes && d.status !== "queued");

        const meta = [d.hoster];
        if (["downloading", "paused"].includes(d.status)) {
          meta.push(
            bytes(d.downloadedBytes) + (d.totalBytes ? " / " + bytes(d.totalBytes) : "")
          );
          if (d.bytesPerSecond) meta.push(bytes(d.bytesPerSecond) + "/s");
          if (d.totalBytes) meta.push(pct.toFixed(1) + "%");
        } else if (done) {
          meta.push(bytes(d.totalBytes || d.downloadedBytes));
        }
        if (d.status === "retrying") meta.push(`attempt ${d.attempts}/${d.maxAttempts}`);

        return `
          <div class="card">
            <div class="row">
              <div class="grow">
                <div class="name">${escapeHtml(d.filename || d.uri)}</div>
                <div class="meta">${meta.join(" · ")}</div>
              </div>
              <span class="status ${d.status}">${d.status}</span>
              <span class="actions">${serverActions(d)}</span>
            </div>
            <div class="bar${done ? " done" : ""}${indeterminate ? " indeterminate" : ""}">
              <div style="width:${pct}%"></div>
            </div>
            ${d.error ? `<div class="error-text">${escapeHtml(d.error)}</div>` : ""}
          </div>`;
      })
      .join("");
  }

  /* --------------------------- library ---------------------------- */

  function renderLibrary(items, transfers) {
    const fetched = new Set(
      transfers
        .filter((t) => !["cancelled"].includes(t.status))
        .map((t) => t.serverId)
    );
    const available = items.filter((item) => !fetched.has(item.id));

    if (!available.length) {
      libraryList().innerHTML =
        '<div class="empty">Nothing new — finished server downloads show up here</div>';
      return;
    }
    libraryList().innerHTML = available
      .map(
        (item) => `
          <div class="card">
            <div class="row">
              <div class="grow">
                <div class="name">${escapeHtml(item.name)}</div>
                <div class="meta">${bytes(item.totalBytes)} · ${item.fileCount} file${item.fileCount === 1 ? "" : "s"}</div>
              </div>
              <button class="primary-btn" data-library-id="${item.id}">Download</button>
            </div>
          </div>`
      )
      .join("");
  }

  /* ------------------------ local transfers ----------------------- */

  const LOCAL_ACTIVE = ["queued", "checking", "downloading", "retrying"];

  function localActions(t) {
    if (LOCAL_ACTIVE.includes(t.status)) {
      return `<button data-local-action="pause" data-id="${t.id}">Pause</button>
              <button data-local-action="cancel" data-id="${t.id}">Cancel</button>`;
    }
    if (t.status === "paused" || t.status === "error") {
      return `<button data-local-action="resume" data-id="${t.id}">Resume</button>
              <button data-local-action="cancel" data-id="${t.id}">Cancel</button>`;
    }
    return `<button data-local-action="remove" data-id="${t.id}">Remove</button>`;
  }

  function renderLocal(transfers) {
    if (!transfers.length) {
      localList().innerHTML = '<div class="empty">No local downloads yet</div>';
      return;
    }
    localList().innerHTML = transfers
      .map((t) => {
        const done = t.status === "completed";
        const pct = done ? 100 : percent(t.downloadedBytes, t.totalBytes);

        const meta = [];
        if (["downloading", "paused", "retrying"].includes(t.status)) {
          meta.push(bytes(t.downloadedBytes) + " / " + bytes(t.totalBytes));
          if (t.bytesPerSecond) meta.push(bytes(t.bytesPerSecond) + "/s");
          meta.push(pct.toFixed(1) + "%");
          if (t.currentFile) meta.push(escapeHtml(t.currentFile));
        } else if (done) {
          meta.push(bytes(t.totalBytes));
          meta.push("saved to " + escapeHtml(t.destDir));
        }

        return `
          <div class="card">
            <div class="row">
              <div class="grow">
                <div class="name">${escapeHtml(t.name)}</div>
                <div class="meta">${meta.join(" · ")}</div>
              </div>
              <span class="status ${t.status}">${t.status}</span>
              <span class="actions">${localActions(t)}</span>
            </div>
            <div class="bar${done ? " done" : ""}">
              <div style="width:${pct}%"></div>
            </div>
            ${t.error ? `<div class="error-text">${escapeHtml(t.error)}</div>` : ""}
          </div>`;
      })
      .join("");
  }

  /* --------------------------- refresh ----------------------------- */

  async function refresh() {
    try {
      const [server, library, transfers] = await Promise.all([
        window.api.server.downloads(),
        window.api.server.library(),
        window.api.local.list(),
      ]);
      App.setServerReachable(true);
      App.focus.preserve(() => {
        renderServer(server);
        renderLibrary(library, transfers);
        renderLocal(transfers);
      });
    } catch (error) {
      // Server unreachable: keep the last server render, still show local.
      App.setServerReachable(false, error.message);
      try {
        const transfers = await window.api.local.list();
        App.focus.preserve(() => renderLocal(transfers));
      } catch {
        /* main process gone; nothing to do */
      }
    }
  }

  async function click(event) {
    const button = event.target.closest("button");
    if (!button) return;

    try {
      if (button.dataset.serverAction) {
        await window.api.server.action(button.dataset.id, button.dataset.serverAction);
      } else if (button.dataset.libraryId) {
        button.disabled = true;
        await window.api.local.start(button.dataset.libraryId);
      } else if (button.dataset.localAction) {
        await window.api.local[button.dataset.localAction](button.dataset.id);
      } else {
        return;
      }
      await refresh();
    } catch (error) {
      button.disabled = false;
      alert(error.message);
    }
  }

  return {
    init() {
      document.getElementById("page-downloads").addEventListener("click", click);
    },
    show() {
      refresh();
    },
    refresh,
  };
})();
