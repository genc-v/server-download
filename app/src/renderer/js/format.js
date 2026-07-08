"use strict";
window.App = window.App || { pages: {} };

App.format = {
  bytes(n) {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log2(n) / 10));
    return (n / 2 ** (10 * i)).toFixed(i === 0 ? 0 : 1) + " " + units[i];
  },

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
  },

  percent(done, total) {
    return total ? Math.min(100, (done / total) * 100) : 0;
  },
};
