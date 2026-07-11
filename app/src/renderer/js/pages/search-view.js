"use strict";

App.pages.search = (() => {
  const { escapeHtml } = App.format;

  let lastQuery = "";

  async function search(query) {
    lastQuery = query;
    const el = document.getElementById("view-search");
    el.innerHTML = `<div class="page-pad">
      <div class="search-label">${escapeHtml(query)}</div>
      <div class="search-sublabel">Searching…</div>
    </div>`;

    let results = [];
    try {
      results = await window.api.server.search(query);
    } catch (err) {
      el.innerHTML = `<div class="page-pad">
        <div class="search-label">${escapeHtml(query)}</div>
        <div class="error-msg">${escapeHtml(err.message)}</div>
      </div>`;
      return;
    }

    results = (results || []).filter((r) =>
      r.uris?.some((u) => u.includes("gofile.io"))
    );

    if (!results.length) {
      el.innerHTML = `<div class="page-pad">
        <div class="search-label">${escapeHtml(query)}</div>
        <div class="search-sublabel">No GoFile results found.</div>
      </div>`;
      return;
    }

    el.innerHTML = `<div class="page-pad">
      <div class="search-label">${escapeHtml(query)}</div>
      <div class="search-sublabel">${results.length} result${results.length !== 1 ? "s" : ""}</div>
      <div class="result-list" id="result-list">
        ${results.map((r, i) => `
          <div class="result-item" data-result-idx="${i}">
            <div class="result-info">
              <div class="result-name">${escapeHtml(r.title || r.name || "Unknown")}</div>
              ${r.fileSize ? `<div class="result-size">${escapeHtml(r.fileSize)}</div>` : ""}
            </div>
            <button class="result-dl-btn" data-result-idx="${i}">↓ Download</button>
          </div>`).join("")}
      </div>
    </div>`;

    const listEl = document.getElementById("result-list");
    listEl._results = results;
    // auto-focus first download button so controller can immediately press A
    setTimeout(() => listEl.querySelector(".result-dl-btn")?.focus(), 60);
  }

  async function handleClick(event) {
    const btn = event.target.closest(".result-dl-btn");
    if (!btn) return;

    const idx = Number(btn.dataset.resultIdx);
    const list = document.getElementById("result-list");
    const results = list?._results;
    if (!results?.[idx]) return;

    const entry = results[idx];
    btn.disabled = true;
    btn.textContent = "Adding…";

    try {
      await window.api.server.add({ uris: entry.uris });
      btn.textContent = "Added ✓";
      btn.classList.add("result-dl-btn--done");
      App.showView("downloads");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "↓ Download";
      const item = btn.closest(".result-item");
      const errEl = document.createElement("div");
      errEl.className = "error-msg";
      errEl.textContent = err.message;
      item?.appendChild(errEl);
    }
  }

  return {
    init() {
      document.getElementById("view-search").addEventListener("click", handleClick);
    },
    search,
    show() {
      if (lastQuery) search(lastQuery);
    },
  };
})();
