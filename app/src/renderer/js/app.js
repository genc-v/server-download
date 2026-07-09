"use strict";

(() => {
  const { bytes, percent, escapeHtml } = App.format;

  /* ── navigation with history ── */
  let current = { kind: "view", name: "home" };
  const backStack = [];
  const backBtn = document.getElementById("back-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const mainEl = document.getElementById("main");

  function setView(name) {
    for (const el of document.querySelectorAll("#main > div")) {
      el.hidden = el.id !== `view-${name}`;
    }
  }

  function updateBackBtn() {
    backBtn.disabled = backStack.length === 0;
  }

  function pushCurrent() {
    // Remember scroll position so Back lands exactly where you were.
    backStack.push({ ...current, scroll: mainEl.scrollTop });
    if (backStack.length > 50) backStack.shift();
  }

  App.showView = (name, opts = {}) => {
    if (current.kind === "view" && current.name === name) {
      App.pages[name]?.show?.();
      return;
    }
    if (opts.push !== false) pushCurrent();
    current = { kind: "view", name };
    setView(name);
    App.pages[name]?.show?.();
    if (opts.push !== false) mainEl.scrollTop = 0;
    if (name !== "search") clearSearchInput();
    settingsBtn.classList.toggle("active", name === "settings");
    updateBackBtn();
  };
  App.showPage = App.showView; // legacy alias

  App.showGame = (data, opts = {}) => {
    if (opts.push !== false) pushCurrent();
    current = { kind: "game", data };
    setView("game");
    settingsBtn.classList.remove("active");
    App.pages.game.show(data);
    updateBackBtn();
  };

  App.browse = (title, params) => {
    App.pages.browse.set(title, params);
    App.showView("browse");
  };

  App.goBack = () => {
    const prev = backStack.pop();
    if (!prev) return;
    current = prev;
    if (prev.kind === "game") {
      setView("game");
      settingsBtn.classList.remove("active");
      App.pages.game.show(prev.data);
    } else {
      setView(prev.name);
      App.pages[prev.name]?.show?.();
      if (prev.name !== "search") clearSearchInput();
      settingsBtn.classList.toggle("active", prev.name === "settings");
      // Views keep their DOM, so the saved offset is immediately valid.
      mainEl.scrollTop = prev.scroll || 0;
    }
    updateBackBtn();
  };

  backBtn.addEventListener("click", () => App.goBack());

  /* ── search bar ── */
  const searchInput = document.getElementById("search-input");
  const searchClear = document.getElementById("search-clear");
  let searchTimer = null;

  function clearSearchInput() {
    searchInput.value = "";
    searchClear.hidden = true;
  }

  function triggerSearch(query) {
    const q = query.trim();
    if (!q) {
      if (current.kind === "view" && current.name === "search") App.goBack();
      return;
    }
    if (!(current.kind === "view" && current.name === "search")) {
      pushCurrent();
      current = { kind: "view", name: "search" };
      setView("search");
      settingsBtn.classList.remove("active");
      updateBackBtn();
    }
    App.pages.search.search(q);
  }

  searchInput.addEventListener("input", () => {
    const val = searchInput.value;
    searchClear.hidden = !val;
    clearTimeout(searchTimer);
    if (!val.trim()) return;
    searchTimer = setTimeout(() => triggerSearch(val), 380);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(searchTimer); triggerSearch(searchInput.value); }
    if (e.key === "Escape") { clearSearchInput(); searchInput.blur(); }
  });

  searchClear.addEventListener("click", () => {
    clearSearchInput();
    if (current.kind === "view" && current.name === "search") App.goBack();
    searchInput.focus();
  });

  /* ── logo → home ── */
  document.getElementById("logo-btn").addEventListener("click", () => {
    clearSearchInput();
    App.showView("home");
  });

  /* ── settings button ── */
  settingsBtn.addEventListener("click", () => {
    if (current.kind === "view" && current.name === "settings") App.goBack();
    else App.showView("settings");
  });

  /* ── bottom download bar ── */
  const dlBar  = document.getElementById("download-bar");
  const dlName = document.getElementById("dl-bar-name");
  const dlPct  = document.getElementById("dl-bar-pct");
  const dlMeta = document.getElementById("dl-bar-meta");
  const dlFill = document.getElementById("dl-bar-fill");
  const dlCvr  = document.getElementById("dl-bar-cover");

  document.getElementById("dl-bar-goto").addEventListener("click", () => {
    App.showView("home");
  });

  async function updateDlBar() {
    try {
      const transfers = await window.api.local.list();
      const active = transfers.find((t) =>
        ["queued", "checking", "downloading", "retrying"].includes(t.status)
      );
      const show = !!active;
      dlBar.hidden = !show;
      document.body.classList.toggle("has-dl-bar", show);
      if (active) {
        const pct = percent(active.downloadedBytes, active.totalBytes);
        dlName.textContent = active.name;
        dlPct.textContent  = active.totalBytes ? pct.toFixed(1) + "%" : active.status;
        dlMeta.textContent = active.bytesPerSecond ? bytes(active.bytesPerSecond) + "/s" : active.status;
        dlFill.style.width = active.totalBytes ? pct + "%" : "0%";
        dlCvr.style.backgroundImage = active.coverUrl ? `url('${escapeHtml(active.coverUrl)}')` : "";
      }
    } catch {
      dlBar.hidden = true;
      document.body.classList.remove("has-dl-bar");
    }
  }

  App.cyclePage = () => {}; // gamepad compat no-op

  /* ── init ── */
  for (const page of Object.values(App.pages)) page.init?.();
  App.sidebar.init();

  setInterval(() => {
    updateDlBar();
    App.sidebar.refresh();
  }, 2000);

  App.showView("home", { push: false });
})();
