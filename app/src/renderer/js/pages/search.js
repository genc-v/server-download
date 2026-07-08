"use strict";

App.pages.search = (() => {
  const { escapeHtml } = App.format;

  const form = () => document.getElementById("search-form");
  const input = () => document.getElementById("search-input");
  const button = () => document.getElementById("search-btn");
  const results = () => document.getElementById("search-results");
  const errorBox = () => document.getElementById("search-error");

  let lastResults = [];

  function render(items) {
    if (!items.length) {
      results().innerHTML = '<div class="empty">No matches in the source</div>';
      return;
    }
    results().innerHTML = items
      .map((item, index) => {
        const meta = [item.fileSize, item.uploadDate, item.source]
          .filter(Boolean)
          .map(escapeHtml)
          .join(" · ");
        return `
          <div class="card">
            <div class="row">
              <div class="grow">
                <div class="name">${escapeHtml(item.title)}</div>
                <div class="meta">${meta}</div>
              </div>
              <button class="primary-btn" data-index="${index}">Get on server</button>
            </div>
          </div>`;
      })
      .join("");
  }

  async function submit(event) {
    event.preventDefault();
    const query = input().value.trim();
    if (!query) return;

    button().disabled = true;
    errorBox().textContent = "";
    try {
      lastResults = await window.api.server.search(query);
      render(lastResults);
    } catch (error) {
      errorBox().textContent = error.message;
    } finally {
      button().disabled = false;
    }
  }

  async function clickResult(event) {
    const target = event.target.closest("button[data-index]");
    if (!target) return;
    const item = lastResults[Number(target.dataset.index)];
    if (!item) return;

    target.disabled = true;
    errorBox().textContent = "";
    try {
      await window.api.server.add({ uris: item.uris });
      target.textContent = "Queued on server";
    } catch (error) {
      target.disabled = false;
      errorBox().textContent = error.message;
    }
  }

  return {
    init() {
      form().addEventListener("submit", submit);
      results().addEventListener("click", clickResult);
    },
    show() {
      input().focus();
    },
  };
})();
