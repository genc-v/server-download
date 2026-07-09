"use strict";

App.pages.game = (() => {
  const { escapeHtml } = App.format;
  let pendingSourceEntry = null;
  let currentCover = "";
  let slides = [];
  let slideIndex = 0;
  let loadToken = 0; // invalidates in-flight loads when a new game opens

  /* ── download section ── */
  function showChecking() {
    document.getElementById("game-dl-area").innerHTML =
      '<div class="game-checking">Checking availability…</div>';
  }

  function showReady(entry) {
    pendingSourceEntry = entry;
    document.getElementById("game-dl-area").innerHTML = `
      <button id="game-dl-btn" class="game-dl-btn">Queue Download</button>
      ${entry.fileSize ? `<div class="game-dl-size">${escapeHtml(entry.fileSize)}</div>` : ""}`;
    document.getElementById("game-dl-btn").addEventListener("click", queue);
  }

  function showNotAvail() {
    pendingSourceEntry = null;
    document.getElementById("game-dl-area").innerHTML =
      '<div class="game-not-avail">Not available in source</div>';
  }

  async function queue() {
    if (!pendingSourceEntry) return;
    const btn = document.getElementById("game-dl-btn");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Queuing…";

    const title = document.getElementById("game-title-text")?.textContent || "";
    try {
      await window.api.server.add({ uris: pendingSourceEntry.uris });
      if (currentCover && title) await window.api.meta.set(title, currentCover);
      btn.textContent = "Queued ✓";
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Queue Download";
      const errEl = document.getElementById("game-error");
      if (errEl) errEl.textContent = err.message;
    }
  }

  async function checkSource(title) {
    try {
      const results = await window.api.server.search(title);
      if (!results?.length) return null;
      const lower = title.toLowerCase();
      return (
        results.find((r) => r.title?.toLowerCase() === lower) ||
        results.find((r) => {
          const rt = r.title?.toLowerCase() || "";
          return rt.includes(lower) || lower.includes(rt);
        }) ||
        null
      );
    } catch { return null; }
  }

  /* ── slideshow (top of page) ── */
  function renderSlide() {
    const img = document.getElementById("slide-img");
    const count = document.getElementById("slide-count");
    if (!img || !slides.length) return;
    img.src = slides[slideIndex];
    if (count) count.textContent = `${slideIndex + 1} / ${slides.length}`;
    for (const t of document.querySelectorAll(".slide-thumb")) {
      t.classList.toggle("active", Number(t.dataset.slideIdx) === slideIndex);
    }
    // Preload neighbours so arrow clicks feel instant.
    for (const n of [slideIndex + 1, slideIndex - 1]) {
      const url = slides[(n + slides.length) % slides.length];
      if (url) new Image().src = url;
    }
  }

  function moveSlide(delta) {
    if (!slides.length) return;
    slideIndex = (slideIndex + delta + slides.length) % slides.length;
    renderSlide();
  }

  function setSlides(urls) {
    slides = urls;
    slideIndex = 0;
    const box = document.getElementById("game-media-top");
    if (!box) return;
    if (!urls.length) { box.innerHTML = ""; return; }

    const nav = urls.length > 1 ? `
      <button class="slide-nav prev" data-slide-move="-1" aria-label="Previous">‹</button>
      <button class="slide-nav next" data-slide-move="1" aria-label="Next">›</button>
      <div id="slide-count" class="slide-count">1 / ${urls.length}</div>` : "";

    const thumbs = urls.length > 1
      ? `<div class="slide-thumbs">${urls.map((u, i) =>
          `<img class="slide-thumb${i === 0 ? " active" : ""}" data-slide-idx="${i}" src="${escapeHtml(u)}" loading="lazy" alt="" />`
        ).join("")}</div>`
      : "";

    box.innerHTML = `
      <div class="slideshow">
        <img id="slide-img" class="slide-img" src="${escapeHtml(urls[0])}" alt="" />
        ${nav}
      </div>
      ${thumbs}`;
  }

  /* ── system requirements ── */
  // RAWG returns requirements as one run-together line; insert breaks
  // before the known spec labels so it reads like a spec sheet.
  function formatReqText(text) {
    return text
      .replace(/^\s*(Minimum|Recommended):\s*/i, "")
      .replace(
        /\s*(OS|Processor|Memory|Graphics|DirectX|Direct X|Storage|Hard Drive|Hard Disk Space|Video Card|Sound Card|Sound|Network|Additional Notes|Other Requirements):/g,
        "\n$1:"
      )
      .trim();
  }

  function renderRequirements(g) {
    const pc = g.platforms?.find((p) => p.platform?.slug === "pc");
    const min = pc?.requirements?.minimum;
    const rec = pc?.requirements?.recommended;
    if (!min && !rec) return "";
    const col = (label, text) => text ? `
      <div class="req-col">
        <div class="req-label">${label}</div>
        <div class="req-text">${escapeHtml(formatReqText(text))}</div>
      </div>` : "";
    return `
      <div class="sub-heading">System Requirements</div>
      <div class="req-grid">${col("Minimum", min)}${col("Recommended", rec)}</div>`;
  }

  function renderSpecs(g) {
    const rows = [];
    const plat = g.platforms?.map((p) => p.platform.name).join(", ");
    const devs = g.developers?.map((d) => d.name).join(", ");
    const pubs = g.publishers?.map((p) => p.name).join(", ");
    if (plat) rows.push(["Platforms", plat]);
    if (devs) rows.push(["Developer", devs]);
    if (pubs) rows.push(["Publisher", pubs]);
    if (g.released) rows.push(["Released", g.released]);
    if (g.esrb_rating) rows.push(["ESRB", g.esrb_rating.name]);
    if (!rows.length) return "";
    return `<div class="sub-heading">Details</div><div class="game-specs-grid">
      ${rows.map(([l, v]) => `<div class="spec-card"><div class="spec-label">${escapeHtml(l)}</div><div class="spec-value">${escapeHtml(v)}</div></div>`).join("")}
    </div>`;
  }

  /* ── main load ── */
  async function load(data) {
    const token = ++loadToken;
    pendingSourceEntry = null;
    currentCover = data.coverUrl || "";
    slides = [];
    slideIndex = 0;

    const el = document.getElementById("view-game");
    el.innerHTML = `
      <div class="game-detail-body">
        <div id="game-media-top"></div>
        <div class="game-header">
          <div class="game-header-left">
            <h1 class="game-title"><span id="game-title-text">${escapeHtml(data.title || "")}</span></h1>
            <div id="game-meta-row" class="game-meta-row"></div>
            <div id="game-genres" class="game-genres"></div>
          </div>
          <div class="game-dl-area" id="game-dl-area"></div>
        </div>
        <div id="game-error" class="error-msg"></div>
        <div id="game-summary-box"></div>
        <div id="game-reqs"></div>
        <div id="game-specs"></div>
      </div>`;

    document.getElementById("main").scrollTop = 0;
    if (currentCover) setSlides([currentCover]); // cover as first slide while shots load
    showChecking();

    // Resolve RAWG id if we only have a title
    let rawgId = data.rawgId;
    if (!rawgId && data.title) {
      try {
        const found = await window.api.rawg.search(data.title);
        if (found) rawgId = found.id;
      } catch { /* no key or network — continue */ }
    }
    if (token !== loadToken) return;

    const [detailRes, shotsRes, sourceEntry] = await Promise.all([
      rawgId ? window.api.rawg.game(rawgId).catch(() => null) : Promise.resolve(null),
      rawgId ? window.api.rawg.screenshots(rawgId).catch(() => null) : Promise.resolve(null),
      data.sourceEntry ? Promise.resolve(data.sourceEntry) : checkSource(data.title || ""),
    ]);
    if (token !== loadToken) return;

    if (detailRes) {
      const g = detailRes;
      if (g.background_image) currentCover = g.background_image;
      if (g.name) {
        const titleEl = document.getElementById("game-title-text");
        if (titleEl) titleEl.textContent = g.name;
      }

      const metaEl = document.getElementById("game-meta-row");
      if (metaEl) {
        const parts = [];
        if (g.metacritic) {
          const mcCls = g.metacritic >= 75 ? "" : g.metacritic >= 50 ? " yellow" : " red";
          parts.push(`<span class="game-score${mcCls}">${g.metacritic}</span>`);
        }
        if (g.rating) parts.push(`<span>★ ${g.rating.toFixed(1)}</span>`);
        if (g.released) {
          if (parts.length) parts.push('<span class="game-meta-dot">·</span>');
          parts.push(`<span>${escapeHtml(g.released)}</span>`);
        }
        if (g.ratings_count) parts.push(`<span class="game-meta-dot">·</span><span>${g.ratings_count.toLocaleString()} ratings</span>`);
        metaEl.innerHTML = parts.join(" ");
      }

      const genresEl = document.getElementById("game-genres");
      if (genresEl && g.genres?.length) {
        genresEl.innerHTML = g.genres
          .map((gn) => `<span class="genre-pill">${escapeHtml(gn.name)}</span>`)
          .join("");
      }

      // Summary is opt-in: collapsed behind a toggle.
      const sumBox = document.getElementById("game-summary-box");
      if (sumBox && g.description_raw) {
        const txt = g.description_raw.replace(/\r\n/g, "\n");
        sumBox.innerHTML = `
          <button id="summary-toggle" class="summary-toggle">Show summary</button>
          <p id="game-desc" class="game-desc" hidden></p>`;
        const desc = document.getElementById("game-desc");
        desc.textContent = txt;
        document.getElementById("summary-toggle").addEventListener("click", (e) => {
          const hidden = desc.hidden;
          desc.hidden = !hidden;
          e.target.textContent = hidden ? "Hide summary" : "Show summary";
        });
      }

      document.getElementById("game-reqs").innerHTML = renderRequirements(g);
      document.getElementById("game-specs").innerHTML = renderSpecs(g);
    }

    // Slideshow from the dedicated screenshots endpoint
    const urls = (shotsRes?.results || []).map((s) => s.image).filter(Boolean);
    if (urls.length) setSlides(urls);
    else if (currentCover) setSlides([currentCover]);

    if (sourceEntry) showReady(sourceEntry);
    else showNotAvail();
  }

  function handleClick(event) {
    const nav = event.target.closest("[data-slide-move]");
    if (nav) { moveSlide(Number(nav.dataset.slideMove)); return; }
    const thumb = event.target.closest(".slide-thumb");
    if (thumb) {
      slideIndex = Number(thumb.dataset.slideIdx) || 0;
      renderSlide();
    }
  }

  return {
    init() {
      document.getElementById("view-game").addEventListener("click", handleClick);
    },
    show(data) { load(data); },
  };
})();
