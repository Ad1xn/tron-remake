/* =========================================================================
   INPUT — Tastatur.
   =========================================================================
   Gelenkt wird RELATIV, wie im Original: eine Taste heisst nicht "fahre
   nach links", sondern "dreh dich um 90° nach links". Eine Kurve ist also
   ein EREIGNIS — wer die Taste hält, dreht sich nicht im Kreis.

   Die Bremse ist ein Zustand: gehalten = gebremst.

   Und die GLANCE-Tasten, die es im Original gibt: solange gehalten,
   schaut die Kamera nach links, rechts oder hinten, ohne dass sich die
   Fahrtrichtung ändert. Ohne die wäre die Ich-Perspektive unspielbar.

   Weil die Physik 125-mal pro Sekunde rechnet, ein Mensch aber nicht so
   oft drückt, werden Kurven kurz gepuffert (CYCLE_TURN_MEMORY = 3) und erst freigegeben,
   wenn die Engine sie auch annimmt (CYCLE_DELAY). Sonst gehen schnelle
   Doppelkurven verloren — und genau die braucht man, um sich in eine
   Lücke zu quetschen.
   ========================================================================= */

import { RULES } from "./config.js";

export const KEYS = {
  left:   ["ArrowLeft", "KeyA"],
  right:  ["ArrowRight", "KeyD"],
  brake:  ["ArrowDown", "KeyS"],
  glanceLeft:  ["KeyQ"],
  glanceRight: ["KeyE"],
  glanceBack:  ["KeyW"],
};

const has = (list, code) => list.includes(code);

export function createInput(game, hotkeys = {}, onGlance = () => {}) {
  const humans = game.cycles.filter((c) => c.driver.type === "human");
  const state = { queue: [], brake: false };
  const glance = { left: false, right: false, back: false };

  const pushGlance = () => onGlance(
    glance.back ? 2 : glance.left ? 1 : glance.right ? -1 : 0);

  function onKey(down) {
    return (e) => {
      if (e.repeat && down) return;
      let used = true;

      if (has(KEYS.left, e.code)) {
        if (down && state.queue.length < RULES.TURN_MEMORY) state.queue.push(1);
      } else if (has(KEYS.right, e.code)) {
        if (down && state.queue.length < RULES.TURN_MEMORY) state.queue.push(-1);
      } else if (has(KEYS.brake, e.code)) {
        state.brake = down;
      } else if (has(KEYS.glanceLeft, e.code)) {
        glance.left = down; pushGlance();
      } else if (has(KEYS.glanceRight, e.code)) {
        glance.right = down; pushGlance();
      } else if (has(KEYS.glanceBack, e.code)) {
        glance.back = down; pushGlance();
      } else if (down && hotkeys[e.code]) {
        hotkeys[e.code]();
      } else {
        used = false;
      }

      if (used) e.preventDefault();
    };
  }

  const downHandler = onKey(true);
  const upHandler = onKey(false);
  window.addEventListener("keydown", downHandler);
  window.addEventListener("keyup", upHandler);

  return {
    consume() {
      const out = {};
      for (const c of humans) {
        if (!c.alive) continue;
        const ready = game.time - c.turnAt >= RULES.TURN_DELAY;
        out[c.id] = {
          turn: ready && state.queue.length ? state.queue.shift() : 0,
          brake: state.brake,
        };
      }
      return out;
    },
    dispose() {
      window.removeEventListener("keydown", downHandler);
      window.removeEventListener("keyup", upHandler);
    },
  };
}
