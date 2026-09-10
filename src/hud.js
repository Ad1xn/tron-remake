/* =========================================================================
   HUD — die Anzeige um das Spielfeld herum.
   =========================================================================
   Bewusst normales HTML/CSS und kein 3D: Text ist im Browser scharf,
   barrierefrei und in zwei Minuten umgebaut.

   Angezeigt wird, was im Original unten am Bildschirm steht und was man
   zum Spielen wirklich braucht: RUBBER (wie viel Wand-Drücken noch
   drin ist), SPEED und BRAKES. Der Punktestand ist Nebensache — man
   stirbt an leerem Gummi, nicht an fehlenden Punkten.
   ========================================================================= */

import { RULES } from "./config.js";

export const css = (hex) => "#" + hex.toString(16).padStart(6, "0");

export function createHud() {
  const el = (id) => document.getElementById(id);

  const rubberBar = el("rubber-bar");
  const rubberVal = el("rubber-value");
  const speedVal  = el("speed-value");
  const speedBar  = el("speed-bar");
  const brakeBar  = el("brake-bar");
  const scoreEl   = el("score-value");
  const bestEl    = el("best-value");
  const dotsEl    = el("rider-dots");
  const rosterEl  = el("roster");
  const overlayEl = el("overlay");
  const titleEl   = el("overlay-title");
  const textEl    = el("overlay-text");
  const hintEl    = el("overlay-hint");

  const fmt = (n) => Math.round(n).toLocaleString("de-CH");
  const pct = (v) => Math.max(0, Math.min(100, v * 100)).toFixed(1) + "%";

  return {
    /* Die Fahrerliste: Name, Farbe, Steuerung bzw. Agent. */
    setRiders(cycles) {
      rosterEl.innerHTML = cycles.map((c) => `
        <span class="rider" data-id="${c.id}" style="--c:${css(c.color)}">
          <i class="pip"></i>${c.name}
          <em>${c.driver.type === "human"
                ? (c.driver.label || "Tastatur")
                : c.driver.agent || "KI"}</em>
        </span>`).join("");

      dotsEl.innerHTML = cycles.map((c) =>
        `<i class="dot" data-id="${c.id}" style="--c:${css(c.color)}"></i>`).join("");
    },

    /* Jeden Frame: die drei Balken des verfolgten Bikes, plus wer lebt. */
    update({ me, cycles, score, best }) {
      if (me) {
        const rf = me.rubber / RULES.RUBBER;
        rubberBar.style.width = pct(rf);
        rubberBar.classList.toggle("low", rf < 0.4);
        // Im Original steht da "Rubber Used" — die verbrauchte Menge.
        rubberVal.textContent = me.rubberUsed.toFixed(1);

        speedVal.textContent = fmt(me.speed);
        speedBar.style.width = pct((me.speed - RULES.SPEED_MIN)
          / (RULES.SPEED_MAX - RULES.SPEED_MIN));
        speedBar.classList.toggle("fast", me.speed > RULES.SPEED * 1.5);

        brakeBar.style.width = pct(me.brake / RULES.BRAKE);
        brakeBar.classList.toggle("using", !!me.braking);
      }

      scoreEl.textContent = fmt(score);
      bestEl.textContent = fmt(best);

      for (const c of cycles) {
        const dot = dotsEl.querySelector(`.dot[data-id="${c.id}"]`);
        if (dot) dot.classList.toggle("dead", !c.alive);
        const chip = rosterEl.querySelector(`.rider[data-id="${c.id}"]`);
        if (chip) {
          chip.classList.toggle("dead", !c.alive);
          chip.querySelector("em").textContent = c.alive
            ? (c.driver.type === "human"
                ? (c.driver.label || "Tastatur")
                : c.driver.agent || "KI")
            : fmt(c.score) + " P";
        }
      }
    },

    show(title, text, hint) {
      titleEl.textContent = title;
      textEl.innerHTML = text;
      hintEl.textContent = hint;
      overlayEl.classList.remove("hidden");
    },

    hide() { overlayEl.classList.add("hidden"); },
  };
}
