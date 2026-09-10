/* =========================================================================
   MAIN — hier werden die Teile zusammengesteckt.
   =========================================================================
       config   → die Regeln in Zahlen
       engine   → die Physik            (weiss nichts von Grafik)
       agents   → wer fährt die Bots    (weiss nichts von Grafik)
       render3d → die Bühne             (ändert nie den Zustand)
       input    → Tastatur
       hud      → Rubber, Speed, Brakes, Punkte, Overlay

   Diese Datei ist der einzige Ort, der alle kennt.

   ZWEI UHREN, das ist der Trick:
     • Die Physik tickt in FESTEN Schritten (RULES.TICK_MS, 125 Hz) —
       nur so ist das Spiel fair, reproduzierbar und für Replays
       brauchbar.
     • Gezeichnet wird bei jedem Bildschirmbild. Ein Zwischenschritt
       zum Glätten ist nicht nötig: bei 125 Hz und Kommazahlen bewegt
       sich alles ohnehin flüssig.
   ========================================================================= */

import { RULES, ROSTER } from "./config.js";
import { createGame, step } from "./engine.js";
import { collectActions, AGENTS, makeRemoteAgent } from "./agents.js";
import { createRenderer } from "./render3d.js";
import { createHud } from "./hud.js";
import { createInput, SCHEME_LABELS } from "./input.js";

const canvas = document.getElementById("board");
const view   = createRenderer(canvas);
const hud    = createHud();

let game     = null;
let phase    = "ready";                 // "ready" | "running" | "over"
let round    = 1;
let carried  = new Map();               // Punkte über die Runden hinweg
let best     = Number(localStorage.getItem("tron.best") || 0);
let spectate = false;
let input    = null;

let acc = 0;
let waiting = false;
let last = performance.now();

const DT_MS = RULES.TICK_MS;

const humanCycle = () => game.cycles.find((c) => c.driver.type === "human");
const shownCycle = () => {
  const h = humanCycle();
  if (h && h.alive) return h;
  const alive = game.cycles.filter((c) => c.alive);
  return alive[0] || h || game.cycles[0];
};
const scoreOf = (c) => (carried.get(c.name) || 0) + (c ? c.score : 0);


/* ------------------------------------------------------------------
   EINE RUNDE AUFBAUEN
   ------------------------------------------------------------------ */
function buildRoster() {
  return ROSTER.map((rider) => {
    // Im Zuschauer-Modus wird aus dem Menschen ein Agent. Genau dieser
    // Schalter ist später der Platz für ein eigenes trainiertes Netz:
    // driver: { type: "agent", fn: meineKI }
    if (spectate && rider.driver.type === "human") {
      return { ...rider, driver: { type: "agent", agent: "grinder" } };
    }
    if (rider.driver.type === "human") {
      return {
        ...rider,
        driver: { ...rider.driver, label: SCHEME_LABELS[rider.driver.controls] },
      };
    }
    return rider;
  });
}

function newRound({ resetScore = false } = {}) {
  if (resetScore) { carried = new Map(); round = 1; }

  game = createGame({
    riders: buildRoster(),
    seed: (Date.now() ^ (round * 2654435761)) >>> 0,
  });

  if (input) input.dispose();
  input = createInput(game, HOTKEYS);

  view.setGame(game);
  const me = humanCycle();
  view.follow(me ? me.id : game.cycles[0].id);

  hud.setRiders(game.cycles);
  paint();

  acc = 0;
  waiting = false;
}

function paint() {
  const me = shownCycle();
  hud.update({
    me,
    cycles: game.cycles,
    score: scoreOf(humanCycle() || me),
    best,
  });
}


/* ------------------------------------------------------------------
   EIN PHYSIK-SCHRITT
   ------------------------------------------------------------------ */
function doTick() {
  const actions = collectActions(game, input.consume());

  if (actions && typeof actions.then === "function") {
    waiting = true;
    actions.then((resolved) => { waiting = false; applyStep(resolved); });
  } else {
    applyStep(actions);
  }
}

function applyStep(actions) {
  const events = step(game, actions);

  for (const d of events.deaths) view.explode(d.cycle);
  if (events.finished) endRound(events.survivors);
}

function endRound(survivors) {
  phase = "over";

  for (const c of game.cycles) {
    carried.set(c.name, (carried.get(c.name) || 0) + c.score);
  }
  const me = humanCycle();
  const mine = me ? carried.get(me.name) || 0 : 0;
  if (mine > best) {
    best = mine;
    localStorage.setItem("tron.best", String(best));
  }
  paint();

  const won = me && survivors.includes(me);
  const winner = survivors.length === 1 ? survivors[0] : null;

  const stats = (c) => c
    ? `Spitze ${Math.round(c.topSpeed)} m/s · ${Math.round(c.distance)} m · `
      + `Gummi ${c.rubberUsed.toFixed(1)}`
    : "";

  if (won) {
    hud.show("RUNDE " + round + " GEWONNEN", stats(me), "LEERTASTE = Runde " + (round + 1));
  } else if (!winner) {
    hud.show("UNENTSCHIEDEN", "Alle gleichzeitig raus. " + stats(me),
      "LEERTASTE = noch eine Runde");
  } else {
    const how = me && me.deathBy === -1 ? "Todeszone"
      : me && me.deathBy === 0 ? "Aussenmauer"
      : me && me.deathBy === me.id ? "eigene Wand"
      : "fremde Wand";
    hud.show(winner.name + " GEWINNT",
      (me ? "Du: " + how + " · " + stats(me) : stats(winner)),
      "LEERTASTE = noch eine Runde");
  }
}

/* Leertaste: startet, macht weiter, oder fängt neu an. */
function advance() {
  if (phase === "running") return;
  if (phase === "over") { round++; newRound(); }
  phase = "running";
  hud.hide();
}


/* ------------------------------------------------------------------
   TASTEN, die nicht ans Bike gehen
   ------------------------------------------------------------------ */
const HOTKEYS = {
  Space: advance,
  KeyR: () => { newRound({ resetScore: true }); phase = "running"; hud.hide(); },
  KeyV: () => {                                    // KI übernimmt / abgeben
    spectate = !spectate;
    newRound({ resetScore: true });
    phase = "running";
    hud.hide();
  },
  KeyC: () => view.toggleMode(),                   // Verfolger / Übersicht
  KeyF: () => {                                    // nächstem Bike folgen
    const alive = game.cycles.filter((c) => c.alive);
    if (!alive.length) return;
    const i = alive.findIndex((c) => c.id === (shownCycle() || {}).id);
    view.follow(alive[(i + 1) % alive.length].id);
  },
};


/* ------------------------------------------------------------------
   DIE SCHLEIFE
   ------------------------------------------------------------------ */
function loop(now) {
  const dt = Math.min(now - last, 120);
  last = now;

  if (phase === "running" && !waiting) {
    acc += dt;
    let guard = 0;
    // Bis zu 20 Schritte pro Bild nachholen (125 Hz sind 8 ms —
    // bei 60 fps sind das gut zwei Schritte pro Bild).
    while (acc >= DT_MS && !waiting && phase === "running" && guard++ < 20) {
      acc -= DT_MS;
      doTick();
    }
    paint();
  }

  view.render(dt);
  requestAnimationFrame(loop);
}


/* ------------------------------------------------------------------
   LOS
   ------------------------------------------------------------------ */
window.addEventListener("resize", () => view.resize());

newRound({ resetScore: true });
hud.show("TRON",
  "Pfeiltasten drehen um 90°. <b>Runter</b> bremst.<br>"
  + "Dicht an einer Wand wirst du schneller. Wer in eine Wand fährt, "
  + "stirbt nicht sofort — er verbraucht <b>Gummi</b>. Ist es leer, ist Schluss.",
  "LEERTASTE = Start");
requestAnimationFrame(loop);

/* Für die Konsole:
     TRON.game.cycles[1].driver = { type:"agent", agent:"hunter" }
     TRON.agents.myNet = ({game,cycle}) => ({ turn: 1, brake: false })
     TRON.tickOnce()                                                    */
window.TRON = {
  get game() { return game; },
  get phase() { return phase; },
  get view() { return view; },
  agents: AGENTS,
  makeRemoteAgent,
  tickOnce: () => { if (game.phase === "running") doTick(); },
  restart: () => HOTKEYS.KeyR(),
  camera: () => HOTKEYS.KeyC(),
};
