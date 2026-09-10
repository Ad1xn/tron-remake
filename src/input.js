/* =========================================================================
   INPUT — Tastatur.
   =========================================================================
   Gelenkt wird wie im Original RELATIV: eine Taste heisst nicht "fahre
   nach links", sondern "dreh dich um 90° nach links". Darum ist eine
   Kurve ein EREIGNIS, kein Zustand — ein Tastendruck, eine Kurve. Wer
   die Taste hält, dreht sich nicht im Kreis.

   Die Bremse dagegen ist ein Zustand: gehalten = gebremst.

   Weil die Physik 125-mal pro Sekunde rechnet, ein Mensch aber nicht so
   oft drückt, werden Kurven in einer kurzen Schlange gepuffert (max. 2).
   Sonst gehen schnelle Doppelkurven verloren — und genau die braucht
   man, um sich in eine Lücke zu quetschen.
   ========================================================================= */

import { RULES } from "./config.js";

/* Die Leertaste steht bewusst in KEINEM Schema: sie startet die Runde.
   Beides zugleich (bremsen und starten) macht sie unbrauchbar. */
export const SCHEMES = {
  arrows: { left: "ArrowLeft", right: "ArrowRight", brake: ["ArrowDown"] },
  wasd:   { left: "KeyA",      right: "KeyD",       brake: ["KeyS"] },
  ijkl:   { left: "KeyJ",      right: "KeyL",       brake: ["KeyK"] },
  numpad: { left: "Numpad4",   right: "Numpad6",    brake: ["Numpad5"] },
};

export const SCHEME_LABELS = {
  arrows: "← →",
  wasd:   "A D",
  ijkl:   "J L",
  numpad: "4 6",
};

export function createInput(game, hotkeys = {}) {
  /* Pro Mensch: eine Schlange gepufferter Kurven und der Bremszustand. */
  const humans = game.cycles.filter((c) => c.driver.type === "human");
  const state = new Map(humans.map((c) => [c.id, { queue: [], brake: false }]));

  const isBrake = (scheme, code) =>
    [].concat(SCHEMES[scheme].brake).includes(code);

  function onKey(down) {
    return (e) => {
      if (e.repeat && down) return;                 // Halten dreht nicht weiter

      let used = false;
      for (const c of humans) {
        const scheme = SCHEMES[c.driver.controls] || SCHEMES.arrows;
        const s = state.get(c.id);

        if (e.code === scheme.left || e.code === scheme.right) {
          if (down && s.queue.length < 2) {
            s.queue.push(e.code === scheme.left ? 1 : -1);
          }
          used = true;
        } else if (isBrake(c.driver.controls, e.code)) {
          s.brake = down;
          used = true;
        }
      }

      if (down && hotkeys[e.code]) { hotkeys[e.code](); used = true; }
      if (used) e.preventDefault();
    };
  }

  const downHandler = onKey(true);
  const upHandler = onKey(false);
  window.addEventListener("keydown", downHandler);
  window.addEventListener("keyup", upHandler);

  return {
    /* Einmal pro Physik-Schritt: die nächste gepufferte Kurve heraus-
       geben, die Bremse durchreichen.

       WICHTIG: eine Kurve wird erst herausgegeben, wenn die Engine sie
       auch annimmt (TURN_DELAY ist vorbei). Sonst würde die zweite
       gepufferte Kurve 8 ms nach der ersten kommen, von der Engine
       verworfen — und der Puffer wäre wirkungslos. */
    consume() {
      const out = {};
      for (const c of humans) {
        if (!c.alive) continue;
        const s = state.get(c.id);
        const ready = game.time - c.turnAt >= RULES.TURN_DELAY;
        out[c.id] = {
          turn: ready && s.queue.length ? s.queue.shift() : 0,
          brake: s.brake,
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
