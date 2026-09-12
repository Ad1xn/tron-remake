/* =========================================================================
   HUD — das Cockpit.
   =========================================================================
   Nachgebaut nach der "classic"-Cockpit-Datei des Originals
   (resource/proto/AATeam/classic.aacockpit.xml). Daraus kommt die
   Anordnung, und zwar genau so:

     • Drei Anzeigen in einer Reihe unten:  RUBBER — SPEED — BRAKES
       (Positionen x = -0.48, 0, +0.48 in der Originaldatei)
     • Jede zeigt Minimum, aktuellen Wert und Maximum als Zahlen.
       Rubber gegen CYCLE_RUBBER, Speed gegen das Maximum, Brakes gegen 1.
     • Die Beschriftungen sind ROT (0xff3333 in der Originaldatei).
     • Der Punktestand steht UNTEN LINKS als "Me:" und "Top:" und
       wechselt die Farbe: grün wenn ich vorn bin, orange bei Gleichstand,
       sonst cyan.

   Vorher hatte ich einen breiten Balken quer über die Seite und den Score
   oben — beides war falsch.

   Dazu die kleinen Namen und Gummi-Zahlen über den anderen Bikes: die
   sieht man im Original auch (Cockpits zeigen "rubber meters above the
   enemies'/teammates' bikes").
   ========================================================================= */

import { RULES, MODES } from "./config.js";

export const css = (hex) => "#" + hex.toString(16).padStart(6, "0");

const MODE_NAMES = Object.fromEntries(
  Object.entries(MODES).map(([k, m]) => [k, m.name]));

export function createHud() {
  const el = (id) => document.getElementById(id);

  const g = {
    rubber: { fill: el("rubber-bar"), val: el("rubber-value"), max: el("rubber-max") },
    speed:  { fill: el("speed-bar"),  val: el("speed-value"),  max: el("speed-max") },
    brake:  { fill: el("brake-bar"),  val: el("brake-value") },
  };
  const scoreMe = el("score-me");
  const scoreTop = el("score-top");
  const fastest = el("fastest");
  const enemies = el("enemies");
  const friends = el("friends");
  const modeEl = el("mode-label");
  const labelBox = el("labels");
  const overlayEl = el("overlay");
  const titleEl = el("overlay-title");
  const textEl = el("overlay-text");
  const hintEl = el("overlay-hint");

  const pct = (v) => (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + "%";
  let labelPool = [];

  return {
    setRiders(cycles, mode) {
      modeEl.textContent = MODE_NAMES[mode] || mode;
      g.rubber.max.textContent = RULES.RUBBER.toFixed(0);
      g.speed.max.textContent = "100";

      // Ein Kästchen pro Fahrer, wiederverwendet. Bei 16 Fahrern wäre
      // Neu-Erzeugen pro Frame Unsinn.
      labelBox.innerHTML = cycles.map((c) =>
        `<span class="tag" data-id="${c.id}" style="--c:${css(c.color)}">
           <i class="nm"></i><i class="rb"></i>
         </span>`).join("");
      labelPool = cycles.map((c) => ({
        cycle: c,
        box: labelBox.querySelector(`.tag[data-id="${c.id}"]`),
        nm: labelBox.querySelector(`.tag[data-id="${c.id}"] .nm`),
        rb: labelBox.querySelector(`.tag[data-id="${c.id}"] .rb`),
      }));
      for (const l of labelPool) l.nm.textContent = l.cycle.name;
    },

    /* Jeden Frame. `me` ist das Bike, dem die Kamera folgt. */
    update({ me, cycles, mode }) {
      if (me) {
        g.rubber.fill.style.width = pct(me.rubber / RULES.RUBBER);
        g.rubber.fill.classList.toggle("low", me.rubber / RULES.RUBBER < 0.34);
        // Im Original steht dort "Rubber Used" — also das Verbrauchte.
        g.rubber.val.textContent = me.rubberUsed.toFixed(1);

        g.speed.fill.style.width = pct(me.speed / 100);
        g.speed.fill.classList.toggle("fast", me.speed > RULES.SPEED * 1.6);
        g.speed.val.textContent = me.speed.toFixed(1);

        g.brake.fill.style.width = pct(me.brake / RULES.BRAKE_MAX);
        g.brake.fill.classList.toggle("using", !!me.braking);
        g.brake.val.textContent = me.braking ? "1" : "0";
      }

      const alive = cycles.filter((c) => c.alive);
      const top = Math.max(...cycles.map((c) => c.score));
      const mine = me ? me.score : 0;
      scoreMe.textContent = mine;
      scoreTop.textContent = top;
      scoreMe.className = mine > top ? "up" : mine === top ? "tie" : "";

      const quickest = alive.reduce((a, c) => (!a || c.speed > a.speed ? c : a), null);
      fastest.textContent = quickest
        ? quickest.name + " " + quickest.speed.toFixed(1) : "–";

      if (mode === "fortress" && me) {
        friends.textContent = alive.filter((c) => c.team === me.team && c !== me).length;
        enemies.textContent = alive.filter((c) => c.team !== me.team).length;
      } else {
        friends.textContent = 0;
        enemies.textContent = Math.max(0, alive.length - 1);
      }
    },

    /* Namen und Gummi über den anderen Bikes. project kommt vom
       Renderer — das HUD rechnet selbst nichts Räumliches. */
    tags(project, meId) {
      for (const l of labelPool) {
        const c = l.cycle;
        if (!c.alive || c.id === meId) { l.box.style.display = "none"; continue; }
        const p = project(c.x, c.y);
        if (!p.visible) { l.box.style.display = "none"; continue; }
        l.box.style.display = "block";
        l.box.style.transform = `translate(-50%,-100%) translate(${p.x}px,${p.y}px)`;
        l.rb.textContent = c.rubberUsed.toFixed(1);
        l.rb.classList.toggle("low", c.rubber / RULES.RUBBER < 0.34);
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
