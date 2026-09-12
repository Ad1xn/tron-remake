/* =========================================================================
   MAIN — hier werden die Teile zusammengesteckt.
   =========================================================================
       config   → die Regeln in Zahlen (aus dem Original abgelesen)
       engine   → die Physik            (weiss nichts von Grafik)
       agents   → wer fährt die Bots    (weiss nichts von Grafik)
       render3d → die Bühne             (ändert nie den Zustand)
       input    → Tastatur
       hud      → das Cockpit

   ZWEI UHREN: die Physik tickt in festen Schritten (RULES.TICK_MS, also
   125 Hz), gezeichnet wird bei jedem Bildschirmbild. Einen Zwischenschritt
   zum Glätten braucht es nicht — bei 125 Hz und Kommazahlen bewegt sich
   alles ohnehin flüssig.

   Was hier ABSICHTLICH NICHT mehr steht, weil es im Original nichts
   davon gibt: Level, Levelbeschleunigung, Rekord im localStorage,
   Vogelperspektive, Punkte fürs Abschiessen.
   ========================================================================= */

import { RULES, MODES, MODE_LIST, COLORS, PALETTE, BOT_NAMES } from "./config.js";
import { createGame, step } from "./engine.js";
import { collectActions, AGENTS, makeRemoteAgent } from "./agents.js";
import { createRenderer } from "./render3d.js";
import { createHud } from "./hud.js";
import { createInput } from "./input.js";

const canvas = document.getElementById("board");
const view = createRenderer(canvas);
const hud = createHud();

let game = null;
let phase = "ready";                  // "ready" | "running" | "over"
let mode = RULES.MODE;
let players = RULES.PLAYERS;
let spectate = false;
let carried = new Map();              // Punkte über die Runden hinweg
let input = null;

let acc = 0;
let waiting = false;
let last = performance.now();
let frame = 0;
const DT_MS = RULES.TICK_MS;
const MAX_CATCHUP = 6;          // höchstens so viele Schritte pro Bild

const humanCycle = () => game.cycles.find((c) => c.driver.type === "human");
const shown = () => {
  const id = view.followId;
  return game.cycles.find((c) => c.id === id) || humanCycle() || game.cycles[0];
};


/* ------------------------------------------------------------------
   EINE RUNDE AUFBAUEN
   ------------------------------------------------------------------
   Ein Mensch und der Rest Bots — im Original ist das der
   "Offline singleplayer against bots". Die Bots werden aus der Leiter
   in agents.js gemischt, damit nicht alle gleich fahren.
   ------------------------------------------------------------------ */
const LADDER = ["grinder", "hunter", "cruiser", "rookie"];

function buildRoster() {
  const riders = [];
  const humans = spectate ? 0 : Math.min(RULES.HUMANS, players);

  for (let i = 0; i < players; i++) {
    const bot = LADDER[i % LADDER.length];
    const team = i % 2;
    riders.push({
      name: i < humans ? "DU" : BOT_NAMES[i % BOT_NAMES.length],
      /* Im Fortress trägt jeder die TEAMFARBE — man muss auf einen Blick
         sehen, wer zu wem gehört. Nur im Alle-gegen-alle bekommt jeder
         seine eigene. */
      /* In Mannschaftsmodi trägt jeder die TEAMFARBE — man muss auf
         einen Blick sehen, wer zu wem gehört. */
      color: MODES[mode].teams !== "solo"
        ? PALETTE.TEAM[team % PALETTE.TEAM.length]
        : COLORS[i % COLORS.length],
      team,
      driver: i < humans ? { type: "human" } : { type: "agent", agent: bot },
    });
  }
  return riders;
}

function newRound({ resetScore = false } = {}) {
  if (resetScore) carried = new Map();

  game = createGame({
    riders: buildRoster(),
    mode,
    seed: (Date.now() ^ (game ? game.tick * 2654435761 : 7)) >>> 0,
  });

  // Punkte aus den Runden davor übernehmen.
  for (const c of game.cycles) c.score = carried.get(c.name) || 0;

  if (input) input.dispose();
  input = createInput(game, HOTKEYS, (g) => view.setGlance(g));

  view.setGame(game);
  const me = humanCycle();
  view.follow(me ? me.id : game.cycles[0].id);

  hud.setRiders(game.cycles, mode);
  paint();

  acc = 0;
  waiting = false;
}

function paint() {
  hud.update({ me: shown(), cycles: game.cycles, mode });
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
  if (events.finished) endRound(events);
}

function endRound(events) {
  phase = "over";
  for (const c of game.cycles) carried.set(c.name, c.score);
  paint();

  const me = humanCycle();
  const survivors = events.survivors;
  const won = me && survivors.includes(me);

  const how = !me ? ""
    : me.alive ? ""
    : me.deathBy === 0 ? "Aussenmauer"
    : me.deathBy === me.id ? "eigene Wand"
    : me.deathBy === -1 ? "Zone"
    : "fremde Wand";

  const stats = me
    ? `Spitze ${me.topSpeed.toFixed(0)} m/s · ${me.distance.toFixed(0)} m · `
      + `Gummi ${me.rubberUsed.toFixed(1)}`
    : "";

  if (mode === "fortress" && events.zone?.type === "conquered") {
    const myTeam = me ? me.team : 0;
    const lost = events.zone.team === myTeam;
    hud.show(lost ? "FESTUNG GEFALLEN" : "FESTUNG EROBERT",
      (lost ? "Dein Team hat die Zone verloren. " : "Gegnerische Zone erobert. ") + stats,
      "LEERTASTE = nächste Runde");
  } else if (events.zone?.type === "win") {
    const who = events.zone.cycle;
    hud.show(who === me ? "ZONE ERREICHT" : who.name + " WAR ZUERST DA",
      "Die Win-Zone entscheidet die Runde. " + stats,
      "LEERTASTE = nächste Runde");
  } else if (won) {
    hud.show("ÜBERLEBT", stats, "LEERTASTE = nächste Runde");
  } else {
    const winner = survivors.length === 1 ? survivors[0].name : "NIEMAND";
    hud.show(winner + " GEWINNT",
      (how ? "Du: " + how + " · " : "") + stats,
      "LEERTASTE = nächste Runde");
  }
}

function advance() {
  if (phase === "running") return;
  if (phase === "over") newRound();
  phase = "running";
  hud.hide();
}


/* ------------------------------------------------------------------
   TASTEN, die nicht ans Bike gehen
   ------------------------------------------------------------------ */
const HOTKEYS = {
  Space: advance,
  KeyR: () => { newRound({ resetScore: true }); phase = "running"; hud.hide(); },
  KeyM: () => {                                    // durch alle vier Modi
    mode = MODE_LIST[(MODE_LIST.indexOf(mode) + 1) % MODE_LIST.length];
    newRound({ resetScore: true });
    phase = "running";
    hud.hide();
  },
  KeyV: () => {                                    // KI übernimmt / abgeben
    spectate = !spectate;
    newRound({ resetScore: true });
    phase = "running";
    hud.hide();
  },
  KeyC: () => view.toggleMode(),                   // Smart / Ich-Perspektive
  KeyF: () => {                                    // nächstem Bike zusehen
    const alive = game.cycles.filter((c) => c.alive);
    if (!alive.length) return;
    const i = alive.findIndex((c) => c.id === view.followId);
    view.follow(alive[(i + 1) % alive.length].id);
  },
};


/* ------------------------------------------------------------------
   DIE SCHLEIFE
   ------------------------------------------------------------------ */
function loop(now) {
  const dt = Math.min(now - last, 120);
  last = now;
  frame++;

  if (phase === "running" && !waiting) {
    acc += dt;

    /* NACHHOLEN, ABER NICHT UNENDLICH.
       Vorher durfte die Schleife 20 Schritte in einem Bild nachrechnen.
       Dauert ein Bild einmal zu lange, wächst acc, im nächsten Bild
       werden 20 Schritte fällig, das dauert wieder länger — und das
       Spiel steht. Genau diese Spirale war das Ruckeln in den Kurven.
       Jetzt sind sechs Schritte das Maximum, und was dann noch übrig
       ist, wird WEGGEWORFEN: lieber eine Zehntelsekunde Spielzeit
       verlieren als eine Sekunde Standbild. */
    let steps = 0;
    while (acc >= DT_MS && !waiting && phase === "running" && steps < MAX_CATCHUP) {
      acc -= DT_MS;
      steps++;
      doTick();
    }
    if (acc > DT_MS * MAX_CATCHUP) acc = 0;

    /* Das Cockpit muss nicht 60-mal pro Sekunde neu geschrieben werden —
       jede Änderung dort kostet den Browser ein Neu-Layout. */
    if (frame % 3 === 0) paint();
  }

  view.render(dt);
  if (frame % 2 === 0) hud.tags(view.project, view.followId);
  requestAnimationFrame(loop);
}


/* ------------------------------------------------------------------
   LOS
   ------------------------------------------------------------------ */
window.addEventListener("resize", () => view.resize());

newRound({ resetScore: true });
hud.show("TRON",
  "<b>← →</b> drehen um 90°, <b>↓</b> bremst.<br>"
  + "Dicht an einer SPIELERWAND wirst du schneller — die Aussenmauer "
  + "schiebt nicht. Wer in eine Wand fährt, stirbt nicht sofort, sondern "
  + "verbraucht <b>Gummi</b>: nur " + RULES.RUBBER + " Meter, und jede Kurve "
  + "kostet extra.<br>"
  + "Nach " + RULES.WIN_ZONE_DELAY + " s erscheint die <b>Win-Zone</b> — "
  + "wer hineinfährt, gewinnt.",
  "LEERTASTE = Start");
requestAnimationFrame(loop);

/* Für die Konsole:
     TRON.mode("fortress")
     TRON.players(8)
     TRON.game.cycles[1].driver = { type:"agent", agent:"hunter" }   */
window.TRON = {
  get game() { return game; },
  get phase() { return phase; },
  get view() { return view; },
  agents: AGENTS,
  makeRemoteAgent,
  tickOnce: () => { if (game.phase === "running") doTick(); },
  restart: () => HOTKEYS.KeyR(),
  mode: (m) => { mode = m; HOTKEYS.KeyR(); },
  players: (n) => { players = Math.max(2, Math.min(16, n | 0)); HOTKEYS.KeyR(); },
};
