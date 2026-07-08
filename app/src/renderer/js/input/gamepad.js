"use strict";

/**
 * Controller support via the browser Gamepad API (Xbox/PS/generic layouts):
 *   D-pad / left stick   move focus
 *   A / Cross            activate focused control
 *   B / Circle           blur text field, otherwise back to the nav
 *   LB / RB              previous / next page
 * Directions auto-repeat while held (400 ms delay, then every 130 ms).
 */
(() => {
  const BUTTONS = {
    a: 0,
    b: 1,
    lb: 4,
    rb: 5,
    dpadUp: 12,
    dpadDown: 13,
    dpadLeft: 14,
    dpadRight: 15,
  };
  const STICK_THRESHOLD = 0.5;
  const REPEAT_DELAY_MS = 400;
  const REPEAT_INTERVAL_MS = 130;

  const statusBox = () => document.getElementById("gamepad-status");
  /** action -> { heldSince, lastFire } for edge detection + auto-repeat */
  const held = new Map();

  function pressedActions(pad) {
    const on = (i) => pad.buttons[i]?.pressed;
    return {
      up: on(BUTTONS.dpadUp) || pad.axes[1] < -STICK_THRESHOLD,
      down: on(BUTTONS.dpadDown) || pad.axes[1] > STICK_THRESHOLD,
      left: on(BUTTONS.dpadLeft) || pad.axes[0] < -STICK_THRESHOLD,
      right: on(BUTTONS.dpadRight) || pad.axes[0] > STICK_THRESHOLD,
      a: on(BUTTONS.a),
      b: on(BUTTONS.b),
      lb: on(BUTTONS.lb),
      rb: on(BUTTONS.rb),
    };
  }

  /** true when the action should fire this frame (edge or repeat). */
  function shouldFire(action, isDown, now, repeats) {
    if (!isDown) {
      held.delete(action);
      return false;
    }
    const state = held.get(action);
    if (!state) {
      held.set(action, { heldSince: now, lastFire: now });
      return true;
    }
    if (!repeats) return false;
    const active =
      now - state.heldSince >= REPEAT_DELAY_MS &&
      now - state.lastFire >= REPEAT_INTERVAL_MS;
    if (active) state.lastFire = now;
    return active;
  }

  function fire(action) {
    switch (action) {
      case "up":
      case "down":
      case "left":
      case "right":
        App.focus.move(action);
        break;
      case "a":
        App.focus.activate();
        break;
      case "b": {
        const el = document.activeElement;
        if (el?.tagName === "INPUT") el.blur();
        else document.querySelector("#nav button.active")?.focus();
        break;
      }
      case "lb":
        App.cyclePage(-1);
        App.focus.focusFirst();
        break;
      case "rb":
        App.cyclePage(1);
        App.focus.focusFirst();
        break;
    }
  }

  function poll() {
    const pad = [...navigator.getGamepads()].find((p) => p?.connected);
    if (pad) {
      const now = performance.now();
      const actions = pressedActions(pad);
      for (const [action, isDown] of Object.entries(actions)) {
        const repeats = ["up", "down", "left", "right"].includes(action);
        if (shouldFire(action, isDown, now, repeats)) fire(action);
      }
    }
    requestAnimationFrame(poll);
  }

  window.addEventListener("gamepadconnected", (event) => {
    statusBox().textContent = `🎮 ${event.gamepad.id.split("(")[0].trim()}`;
    if (!document.activeElement || document.activeElement === document.body) {
      App.focus.focusFirst();
    }
  });
  window.addEventListener("gamepaddisconnected", () => {
    if (![...navigator.getGamepads()].some((p) => p?.connected)) {
      statusBox().textContent = "";
    }
  });

  requestAnimationFrame(poll);
})();
