"use strict";

App.pages.search = (() => {
  const { escapeHtml } = App.format;

  let lastQuery = "";
  let page = 1;
  let hasMore = false;
  let loading = false;

  function skeletons(n) {
    return Array(n).fill('<div class="skeleton-card"></div>').join("");
  }

  async function run(query) {
    lastQuery = query;
    page = 1;
    hasMore = false;
    const el = document.getElementById("view-search");
    el.innerHTML = `<div class="page-pad">
      <div class="search-label">Results for "${escapeHtml(query)}"</div>
      <div class="search-sublabel">Searching…</div>
      <div class="search-grid">${skeletons(12)}</div>
      <div class="grid-status"></div>
    </div>`;

    try {
      const data = await window.api.rawg.list({ search: query, page_size: 20, page: 1 });
      if (lastQuery !== query) return; // stale response
      const games = data?.results || [];
      hasMore = !!data?.next;
      const grid = el.querySelector(".search-grid");
      const sub  = el.querySelector(".search-sublabel");
      if (sub) sub.textContent = data?.count ? `${data.count.toLocaleString()} results` : `${games.length} results`;
      if (grid) {
        grid.innerHTML = games.length
          ? games.map(App.gameCard).join("")
          : `<div class="view-empty"><strong>No results</strong>"${escapeHtml(query)}" wasn't found.</div>`;
      }
      renderLoadMore(el);
    } catch (err) {
      if (lastQuery !== query) return;
      el.innerHTML = `<div class="page-pad"><p class="error-msg">${escapeHtml(err.message)}</p></div>`;
    }
  }

  function renderLoadMore(el) {
    const status = el.querySelector(".grid-status");
    if (!status) return;
    status.innerHTML = hasMore
      ? '<button class="load-more-btn" id="search-load-more">Load more</button>'
      : "";
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    const el  = document.getElementById("view-search");
    const btn = document.getElementById("search-load-more");
    if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
    const query = lastQuery;
    try {
      const data = await window.api.rawg.list({ search: query, page_size: 20, page: page + 1 });
      if (lastQuery !== query) return;
      page += 1;
      hasMore = !!data?.next;
      const games = data?.results || [];
      el.querySelector(".search-grid")
        ?.insertAdjacentHTML("beforeend", games.map(App.gameCard).join(""));
      renderLoadMore(el);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "Load more"; }
      const status = el.querySelector(".grid-status");
      if (status) status.insertAdjacentHTML("beforeend", `<p class="error-msg">${escapeHtml(err.message)}</p>`);
    } finally {
      loading = false;
    }
  }

  function handleClick(event) {
    if (event.target.closest("#search-load-more")) { loadMore(); return; }
    const gc = event.target.closest(".game-card");
    if (gc) App.openCard(gc);
  }

  return {
    init() {
      const el = document.getElementById("view-search");
      el.addEventListener("click", handleClick);
      el.addEventListener("mouseover", (e) => App.prefetchCard(e.target.closest(".game-card")));
    },
    search(query) {
      run(query);
    },
  };
})();
