"use strict";

(() => {
  /* ── navigation with history ── */
  let current = { kind: "view", name: "home" };
  const backStack = [];
  const backBtn      = document.getElementById("back-btn");
  const settingsBtn  = document.getElementById("settings-btn");
  const mainEl       = document.getElementById("main");

  const TAB_VIEWS = ["home", "downloads"];

  function setView(name) {
    for (const el of document.querySelectorAll("#main > div")) {
      el.hidden = el.id !== `view-${name}`;
    }
  }

  function updateTabs(name) {
    for (const btn of document.querySelectorAll(".tab-btn")) {
      btn.classList.toggle("active", btn.dataset.tab === name);
    }
    /* hide tab bar when searching or in settings */
    const tabBar = document.getElementById("tab-bar");
    tabBar.hidden = !TAB_VIEWS.includes(name);
    settingsBtn.classList.toggle("active", name === "settings");
  }

  function updateBackBtn() {
    backBtn.disabled = backStack.length === 0;
  }

  function pushCurrent() {
    backStack.push({ ...current, scroll: mainEl.scrollTop });
    if (backStack.length > 50) backStack.shift();
  }

  App.showView = (name, opts = {}) => {
    if (current.kind === "view" && current.name === name) {
      App.pages[name]?.show?.();
      return;
    }
    App.pages[current.name]?.hide?.();
    if (opts.push !== false) pushCurrent();
    current = { kind: "view", name };
    setView(name);
    App.pages[name]?.show?.();
    if (opts.push !== false) mainEl.scrollTop = 0;
    if (name !== "search") clearSearchInput();
    updateTabs(name);
    updateBackBtn();
    setTimeout(() => App.focus.focusFirst(), 60);
  };
  App.showPage = App.showView;

  App.goBack = () => {
    const prev = backStack.pop();
    if (!prev) return;
    App.pages[current.name]?.hide?.();
    current = prev;
    setView(prev.name);
    App.pages[prev.name]?.show?.();
    if (prev.name !== "search") clearSearchInput();
    updateTabs(prev.name);
    mainEl.scrollTop = prev.scroll || 0;
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
      updateTabs("search");
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

  /* ── tab bar ── */
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => App.showView(btn.dataset.tab));
  }

  /* ── settings button ── */
  settingsBtn.addEventListener("click", () => {
    if (current.kind === "view" && current.name === "settings") App.goBack();
    else App.showView("settings");
  });

  const CYCLE_VIEWS = ["home", "downloads"];
  App.cyclePage = (dir = 1) => {
    const name = current.kind === "view" && TAB_VIEWS.includes(current.name) ? current.name : "home";
    const idx  = CYCLE_VIEWS.indexOf(name);
    const next = CYCLE_VIEWS[((idx < 0 ? 0 : idx) + dir + CYCLE_VIEWS.length) % CYCLE_VIEWS.length];
    App.showView(next);
  };

  /* ── init ── */
  for (const page of Object.values(App.pages)) page.init?.();

  /* keep badge updated even when not on downloads page */
  setInterval(() => App.pages.downloads?.refreshBadge?.(), 5000);

  App.showView("home", { push: false });
})();
