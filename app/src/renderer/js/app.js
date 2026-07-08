"use strict";

(() => {
  const PAGE_ORDER = ["search", "downloads", "settings"];
  const navStatus = document.getElementById("nav-status");
  let currentPage = "search";

  App.setServerReachable = (reachable, message) => {
    navStatus.textContent = reachable ? "" : `Server unreachable${message ? ": " + message : ""}`;
  };

  App.showPage = (name) => {
    currentPage = name;
    for (const section of document.querySelectorAll("main > section")) {
      section.hidden = section.id !== `page-${name}`;
    }
    for (const button of document.querySelectorAll("#nav button[data-page]")) {
      button.classList.toggle("active", button.dataset.page === name);
    }
    App.pages[name]?.show?.();
  };

  App.cyclePage = (delta) => {
    const index = PAGE_ORDER.indexOf(currentPage);
    App.showPage(PAGE_ORDER[(index + delta + PAGE_ORDER.length) % PAGE_ORDER.length]);
  };

  document.getElementById("nav").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-page]");
    if (button) App.showPage(button.dataset.page);
  });

  for (const page of Object.values(App.pages)) page.init?.();

  // Live progress while the downloads page is visible.
  setInterval(() => {
    if (currentPage === "downloads") App.pages.downloads.refresh();
  }, 1000);

  App.showPage("search");
})();
