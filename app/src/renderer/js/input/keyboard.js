"use strict";

/**
 * Keyboard navigation on top of the native Tab order:
 *   Arrows      move focus spatially (up/down always; left/right except
 *               while editing text)
 *   Enter/Space activate (native button behavior)
 *   1 / 2 / 3   switch page (when not typing)
 *   / or Cmd+F  jump to search
 *   Escape      leave a text field / return focus to the nav
 */
(() => {
  const PAGE_KEYS = { 1: "search", 2: "downloads", 3: "settings" };

  function isTyping(target) {
    return target?.tagName === "INPUT" && !target.readOnly;
  }

  document.addEventListener("keydown", (event) => {
    const typing = isTyping(event.target);

    const arrows = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    const dir = arrows[event.key];
    if (dir) {
      // Let left/right edit text while typing; up/down still navigate.
      if (typing && (dir === "left" || dir === "right")) return;
      event.preventDefault();
      App.focus.move(dir);
      return;
    }

    if (event.key === "Escape") {
      if (typing) event.target.blur();
      else document.querySelector("#nav button.active")?.focus();
      return;
    }

    if (typing) return;

    if (PAGE_KEYS[event.key]) {
      App.showPage(PAGE_KEYS[event.key]);
      App.focus.focusFirst();
      return;
    }

    if (event.key === "/" || ((event.metaKey || event.ctrlKey) && event.key === "f")) {
      event.preventDefault();
      App.showPage("search");
      document.getElementById("search-input").focus();
    }
  });
})();
