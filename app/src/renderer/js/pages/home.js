"use strict";

/* Home (discovery rows + genre chips) and Browse ("see all" infinite grid).
   They share the card renderer, hover prefetch and infinite-grid helper. */
(() => {
  const { escapeHtml } = App.format;

  const today   = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  const GENRES = [
    { label: "All",        id: null  },
    { label: "Action",     id: "4"   },
    { label: "Adventure",  id: "3"   },
    { label: "RPG",        id: "5"   },
    { label: "Strategy",   id: "10"  },
    { label: "Shooter",    id: "2"   },
    { label: "Simulation", id: "14"  },
    { label: "Puzzle",     id: "7"   },
    { label: "Sports",     id: "15"  },
    { label: "Racing",     id: "1"   },
    { label: "Fighting",   id: "6"   },
  ];

  const DISCOVERY_ROWS = [
    { title: "Popular Right Now",     params: { ordering: "-rating", metacritic: "80,100" } },
    { title: "New Releases",          params: { ordering: "-released", dates: `${yearAgo},${today}` } },
    { title: "Critically Acclaimed",  params: { ordering: "-metacritic", metacritic: "90,100" } },
    { title: "Action & Shooter",      params: { genres: "4,2", ordering: "-rating", metacritic: "70,100" } },
    { title: "RPG & Adventure",       params: { genres: "5,3", ordering: "-rating", metacritic: "70,100" } },
    { title: "Best of All Time",      params: { ordering: "-metacritic", metacritic: "93,100", dates: `2000-01-01,${today}` } },
  ];

  /* ── shared helpers ── */

  function card(game) {
    const img  = game.background_image ? escapeHtml(game.background_image) : "";
    const mc   = game.metacritic;
    const year = game.released?.slice(0, 4) || "";
    const mcCls = mc >= 75 ? "" : mc >= 50 ? " yellow" : " red";
    return `
      <button class="game-card"
        data-rawg-id="${game.id}"
        data-title="${escapeHtml(game.name)}"
        data-cover="${img}">
        <div class="game-card-img"${img ? ` style="background-image:url('${img}')"` : ""}></div>
        <div class="game-card-body">
          <div class="game-card-name">${escapeHtml(game.name)}</div>
          <div class="game-card-meta">
            ${mc ? `<span class="mc-badge${mcCls}">${mc}</span>` : ""}
            ${year ? `<span>${escapeHtml(year)}</span>` : ""}
          </div>
        </div>
      </button>`;
  }

  function skeletons(n) {
    return Array(n).fill('<div class="skeleton-card"></div>').join("");
  }

  function openCard(gc) {
    App.showGame({
      rawgId:   gc.dataset.rawgId,
      title:    gc.dataset.title,
      coverUrl: gc.dataset.cover,
    });
  }

  const prefetched = new Set();
  function prefetchCard(gc) {
    const id = gc?.dataset.rawgId;
    if (!id || prefetched.has(id)) return;
    prefetched.add(id);
    window.api.rawg.game(id).catch(() => {});
    window.api.rawg.screenshots(id).catch(() => {});
  }

  /**
   * Infinite-scroll grid: renders pages of a rawg:list query into
   * `container`, loading the next page when the sentinel nears the
   * viewport. Every page is cached in the main process.
   */
  function infiniteGrid(container, params) {
    let page = 1;
    let loading = false;
    let done = false;

    container.innerHTML = `
      <div class="game-grid">${skeletons(12)}</div>
      <div class="grid-sentinel"></div>
      <div class="grid-status"></div>`;
    const grid     = container.querySelector(".game-grid");
    const sentinel = container.querySelector(".grid-sentinel");
    const status   = container.querySelector(".grid-status");
    let firstLoad = true;

    async function loadNext() {
      if (loading || done) return;
      loading = true;
      if (!firstLoad) status.textContent = "Loading more…";
      try {
        const data = await window.api.rawg.list({ ...params, page_size: 40, page });
        const games = data?.results || [];
        if (firstLoad) { grid.innerHTML = ""; firstLoad = false; }
        grid.insertAdjacentHTML("beforeend", games.map(card).join(""));
        status.textContent = "";
        page += 1;
        if (!data?.next || !games.length) {
          done = true;
          observer.disconnect();
          if (!grid.children.length) {
            status.textContent = "No games found";
          }
        }
      } catch (err) {
        if (firstLoad) { grid.innerHTML = ""; firstLoad = false; }
        status.textContent = err.message;
        done = true;
        observer.disconnect();
      }
      loading = false;
    }

    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadNext(); },
      { root: document.getElementById("main"), rootMargin: "800px" }
    );
    observer.observe(sentinel);
    loadNext();
    return () => observer.disconnect();
  }

  /* ── Home page ── */

  App.pages.home = (() => {
    let activeGenreId = null;
    let rendered = false;
    let gridTeardown = null;

    function renderDiscovery(el) {
      el.innerHTML = DISCOVERY_ROWS
        .map((row, i) => `
          <div class="row-section">
            <button class="section-hd" data-row-index="${i}">
              ${escapeHtml(row.title)}<span class="section-see-all">See all ›</span>
            </button>
            <div class="row-wrap"><div class="skeleton-row">${skeletons(8)}</div></div>
          </div>`)
        .join("");

      const sections = el.querySelectorAll(".row-section");
      DISCOVERY_ROWS.forEach((row, i) => {
        window.api.rawg.list({ ...row.params, page_size: 14 })
          .then((data) => {
            const wrap = sections[i]?.querySelector(".row-wrap");
            if (!wrap) return;
            const games = data?.results || [];
            wrap.innerHTML = games.length
              ? `<div class="card-row">${games.map(card).join("")}</div>`
              : "";
          })
          .catch((err) => {
            const wrap = sections[i]?.querySelector(".row-wrap");
            if (wrap) wrap.innerHTML = `<p class="error-msg">${escapeHtml(err.message)}</p>`;
          });
      });
    }

    function render() {
      const el = document.getElementById("view-home");
      gridTeardown?.();
      gridTeardown = null;

      const chips = GENRES.map((g) =>
        `<button class="filter-chip${activeGenreId === g.id ? " active" : ""}"
           data-genre-id="${g.id || ""}">${escapeHtml(g.label)}</button>`
      ).join("");

      el.innerHTML = `<div class="page-pad">
        <div class="filter-bar">${chips}</div>
        <div id="home-content"></div>
      </div>`;

      const content = document.getElementById("home-content");
      if (!activeGenreId) {
        renderDiscovery(content);
      } else {
        const label = GENRES.find((g) => g.id === activeGenreId)?.label || "";
        content.insertAdjacentHTML("afterbegin", `<div class="section-hd" style="cursor:default">${escapeHtml(label)}</div>`);
        const gridBox = document.createElement("div");
        content.appendChild(gridBox);
        gridTeardown = infiniteGrid(gridBox, {
          genres: activeGenreId, ordering: "-rating", metacritic: "60,100",
        });
      }
      rendered = true;
    }

    function handleClick(event) {
      const chip = event.target.closest(".filter-chip");
      if (chip) {
        activeGenreId = chip.dataset.genreId || null;
        render();
        return;
      }
      const seeAll = event.target.closest("[data-row-index]");
      if (seeAll) {
        const row = DISCOVERY_ROWS[Number(seeAll.dataset.rowIndex)];
        if (row) App.browse(row.title, row.params);
        return;
      }
      const gc = event.target.closest(".game-card");
      if (gc) openCard(gc);
    }

    return {
      init() {
        const el = document.getElementById("view-home");
        el.addEventListener("click", handleClick);
        el.addEventListener("mouseover", (e) => prefetchCard(e.target.closest(".game-card")));
      },
      show() {
        if (!rendered) render();
      },
    };
  })();

  /* ── Browse page ("See all" with infinite scroll) ── */

  App.pages.browse = (() => {
    let title = "";
    let params = null;
    let dirty = false;
    let gridTeardown = null;

    function render() {
      const el = document.getElementById("view-browse");
      gridTeardown?.();
      el.innerHTML = `<div class="page-pad">
        <div class="section-hd" style="cursor:default">${escapeHtml(title)}</div>
        <div id="browse-content"></div>
      </div>`;
      gridTeardown = infiniteGrid(el.querySelector("#browse-content"), params);
      document.getElementById("main").scrollTop = 0;
      dirty = false;
    }

    function handleClick(event) {
      const gc = event.target.closest(".game-card");
      if (gc) openCard(gc);
    }

    return {
      init() {
        const el = document.getElementById("view-browse");
        el.addEventListener("click", handleClick);
        el.addEventListener("mouseover", (e) => prefetchCard(e.target.closest(".game-card")));
      },
      set(t, p) {
        if (t !== title || JSON.stringify(p) !== JSON.stringify(params)) dirty = true;
        title = t;
        params = p;
      },
      show() {
        if (dirty) render();
      },
    };
  })();

  /* expose shared bits for search-view */
  App.gameCard = card;
  App.prefetchCard = prefetchCard;
  App.openCard = openCard;
})();
