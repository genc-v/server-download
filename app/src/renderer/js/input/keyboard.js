"use strict";

(() => {
  function isTyping(target) {
    return (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") && !target.readOnly;
  }

  document.addEventListener("keydown", (event) => {
    const typing = isTyping(event.target);

    const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    const dir = arrows[event.key];
    if (dir) {
      if (typing && (dir === "left" || dir === "right")) return;
      event.preventDefault();
      App.focus.move(dir);
      return;
    }

    if (event.key === "Escape") {
      if (typing) event.target.blur();
      else App.goBack?.();
      return;
    }

    if (typing) return;

    // / or Cmd+F → focus the search bar
    if (event.key === "/" || ((event.metaKey || event.ctrlKey) && event.key === "f")) {
      event.preventDefault();
      document.getElementById("search-input")?.focus();
    }
  });
})();
