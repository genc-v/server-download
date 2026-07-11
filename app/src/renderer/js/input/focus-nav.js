"use strict";

/**
 * Directional focus navigation shared by keyboard and gamepad: moves focus
 * geometrically (nearest element in the pressed direction) and survives the
 * periodic re-renders by re-finding elements via stable focus keys.
 */
App.focus = (() => {
  function focusables() {
    return [...document.querySelectorAll(
      "#topbar button, #topbar input, #tab-bar button, #main button, #main input"
    )].filter(
      (el) =>
        !el.disabled &&
        !el.closest("[hidden]") &&
        el.offsetParent !== null
    );
  }

  /** Stable identity for an element so focus survives innerHTML re-renders. */
  function keyOf(el) {
    if (!el) return null;
    const d = el.dataset ?? {};
    if (d.serverAction) return `sa:${d.serverAction}:${d.id}`;
    if (d.localAction) return `la:${d.localAction}:${d.id}`;
    if (d.libraryId) return `lib:${d.libraryId}`;
    if (d.index !== undefined) return `idx:${d.index}`;
    if (d.page) return `page:${d.page}`;
    if (el.id) return `id:${el.id}`;
    return null;
  }

  function findByKey(key) {
    if (!key) return null;
    const [kind, a, b] = key.split(":");
    const all = focusables();
    const exact = {
      sa: () => all.find((el) => el.dataset.serverAction === a && el.dataset.id === b),
      la: () => all.find((el) => el.dataset.localAction === a && el.dataset.id === b),
      lib: () => all.find((el) => el.dataset.libraryId === a),
      idx: () => all.find((el) => el.dataset.index === a),
      page: () => all.find((el) => el.dataset.page === a),
      id: () => document.getElementById(a),
    }[kind]?.();
    if (exact) return exact;

    // Button may have changed (Pause -> Resume): any action on the same item.
    if (kind === "sa") return all.find((el) => el.dataset.serverAction && el.dataset.id === b);
    if (kind === "la") return all.find((el) => el.dataset.localAction && el.dataset.id === b);
    return null;
  }

  function focusFirst() {
    const view = document.querySelector("#main > div:not([hidden])");
    const target = view?.querySelector("button:not(:disabled), input") ?? focusables()[0];
    target?.focus();
    return target ?? null;
  }

  /** dir: "up" | "down" | "left" | "right" */
  function move(dir) {
    const current = document.activeElement;
    if (!current || current === document.body) return focusFirst();

    const from = current.getBoundingClientRect();
    const cx = from.left + from.width / 2;
    const cy = from.top + from.height / 2;

    let best = null;
    let bestScore = Infinity;
    for (const el of focusables()) {
      if (el === current) continue;
      const rect = el.getBoundingClientRect();
      const ex = rect.left + rect.width / 2;
      const ey = rect.top + rect.height / 2;
      const dx = ex - cx;
      const dy = ey - cy;

      const forward =
        dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
      if (forward <= 4) continue; // must actually be in that direction
      const sideways = Math.abs(dir === "up" || dir === "down" ? dx : dy);

      const score = forward + sideways * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (best) {
      best.focus();
      best.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
    return best;
  }

  function activate() {
    const el = document.activeElement;
    if (!el) return;
    if (el.tagName === "BUTTON") el.click();
    else if (el.tagName === "INPUT") el.focus();
  }

  /** Re-render wrapper: keeps focus on "the same" element afterwards. */
  function preserve(renderFn) {
    const key = keyOf(document.activeElement);
    const hadFocus = key !== null;
    renderFn();
    if (hadFocus && keyOf(document.activeElement) !== key) {
      findByKey(key)?.focus();
    }
  }

  return { move, activate, focusFirst, preserve, keyOf };
})();
