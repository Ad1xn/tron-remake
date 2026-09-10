/* =========================================================================
   ARENA — der Zuschauerraum für aufgezeichnete Matches.
   =========================================================================
   Warum das existiert: eine Verlustkurve im Terminal sieht gleich aus,
   egal ob ein Netz Tron gelernt hat oder ob es gelernt hat, im Kreis zu
   fahren, um den Überlebens-Bonus abzugrasen. Zuschauen zeigt den
   Unterschied in drei Sekunden. Darum ist das hier kein Spielzeug,
   sondern das Werkzeug, mit dem man später die Belohnung debuggt.

   Diese Datei benutzt genau dieselben Teile wie main.js — engine,
   render3d, hud. Nur die Fahrer kommen nicht aus agents.js, sondern
   vom Band (src/replay.js). Deshalb braucht die Wiedergabe keine
   einzige neue Zeile in der Engine oder im Renderer.
   ========================================================================= */

import { RULES } from "./config.js";
import { step } from "./engine.js";
import { tapeToGame, tapeActions } from "./replay.js";
import { createRenderer } from "./render3d.js";
import { createHud } from "./hud.js";

const el = (id) => document.getElementById(id);

const view = createRenderer(el("board"));
const hud  = createHud();


/* ------------------------------------------------------------------
   ZUSTAND
   ------------------------------------------------------------------ */
let dir     = new URLSearchParams(location.search).get("dir") || "out/replays";
let entries = [];            // Inhaltsverzeichnis: { file, label, ticks, winner }
let cache   = new Map();     // file -> Band (Bänder sind winzig, also merken)

let tape    = null;
let cursor  = -1;
let game    = null;

let playing = false;
let speed   = 1;
let acc     = 0;
let last    = performance.now();
let autoNext = true;

const tickMs = () => RULES.TICK_MS / speed;


/* ------------------------------------------------------------------
   BÄNDER LADEN
   ------------------------------------------------------------------
   Ein statischer Webserver kann keinen Ordner auflisten — darum
   schreibt tools/selfplay.mjs eine index.json mit der Liste.
   ------------------------------------------------------------------ */
async function loadIndex() {
  try {
    const res = await fetch(dir + "/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const manifest = await res.json();
    entries = manifest.files || [];
  } catch {
    entries = [];
  }

  fillSelect();

  if (entries.length === 0) {
    hud.show("KEINE AUFNAHMEN",
      "In " + dir + " liegt keine index.json.",
      "node tools/selfplay.mjs --n 20 --record " + dir);
    return;
  }
  await load(0);
}

async function getTape(entry) {
  if (cache.has(entry.file)) return cache.get(entry.file);
  const res = await fetch(dir + "/" + entry.file, { cache: "no-store" });
  const t = await res.json();
  cache.set(entry.file, t);
  return t;
}

function fillSelect() {
  el("tape-select").innerHTML = entries.map((e, i) =>
    `<option value="${i}">${String(i + 1).padStart(3, "0")} · ${e.label || e.file}`
    + ` · ${e.ticks} Ticks · ${e.winner || "unentschieden"}</option>`).join("");
}


/* ------------------------------------------------------------------
   EIN BAND AUFLEGEN
   ------------------------------------------------------------------ */
async function load(i, { play = true } = {}) {
  if (!entries.length) return;
  cursor = (i + entries.length) % entries.length;
  tape = await getTape(entries[cursor]);

  el("tape-select").value = String(cursor);
  build();
  hud.hide();
  playing = play;
  refresh();
}

/* Frisches Spiel aus dem Band. Das ist die ganze Wiedergabe-Logik:
   die Fahrer sind Agenten, die ihre Antwort nachschlagen. */
function build() {
  game = tapeToGame(tape);
  view.setGame(game);
  view.follow(game.cycles[0].id);
  hud.setRiders(game.cycles);
  el("scrub").max = String(tape.ticks.length);
  el("scrub").value = "0";
  acc = 0;
  refresh();
}

/* Ein Tick. visual=false beim Spulen: dann keine Explosionen, sonst
   knallt es beim Ziehen am Regler dutzende Mal hintereinander. */
function tickOnce(visual = true) {
  if (game.phase !== "running") return null;

  const events = step(game, tapeActions(tape, game));

  // Beim Spulen keine Explosionen: sonst knallt es beim Ziehen am
  // Regler dutzende Mal hintereinander.
  if (visual) for (const d of events.deaths) view.explode(d.cycle);

  if (events.finished) finish(events.survivors);
  return events;
}

function finish(survivors) {
  playing = false;
  const winner = survivors.length === 1 ? survivors[0] : null;
  hud.show(
    winner ? winner.name + " GEWINNT" : "UNENTSCHIEDEN",
    (winner ? winner.driver.agent + " · " : "") + game.time.toFixed(1) + " s",
    autoNext && entries.length > 1 ? "gleich weiter …" : "N = nächstes Band"
  );
  if (autoNext && entries.length > 1) setTimeout(() => {
    if (!playing) load(cursor + 1);
  }, 1400);
}

/* Zu einem Tick springen: neu aufbauen und stumm vorspulen. Geht, weil
   das Band deterministisch ist — es gibt keinen anderen Weg zu Tick 120
   als die 120 Schritte, aber die kosten nichts. */
function seek(target) {
  build();
  hud.hide();
  for (let i = 0; i < target && game.phase === "running"; i++) tickOnce(false);
  refresh();
}


/* ------------------------------------------------------------------
   ANZEIGE
   ------------------------------------------------------------------ */
function refresh() {
  if (!game || !tape) return;

  const shown = game.cycles.filter((c) => c.alive)[0] || game.cycles[0];
  hud.update({
    me: shown,
    cycles: game.cycles,
    score: game.tick,                             // Chip "TICK"
    best: tape.ticks.length,                      // Chip "LÄNGE"
  });
  el("band-value").textContent = (cursor + 1) + "/" + entries.length;

  el("scrub").value = String(Math.min(game.tick, tape.ticks.length));
  el("play").textContent = playing ? "❚❚" : "▶";
  el("speed-label").textContent = speed.toFixed(2).replace(/0$/, "") + "×";
  el("tape-label").textContent = tape.label || entries[cursor]?.file || "";
  el("seed-label").textContent = "Seed " + tape.seed + " · Arena " + tape.arena + " m";
}


/* ------------------------------------------------------------------
   BEDIENUNG
   ------------------------------------------------------------------ */
el("play").onclick  = () => {
  if (game.phase !== "running") { build(); hud.hide(); }
  playing = !playing;
  refresh();
};
el("step").onclick  = () => { playing = false; tickOnce(); refresh(); };
el("back").onclick  = () => { playing = false; seek(Math.max(0, game.tick - 1)); };
el("restart").onclick = () => { build(); hud.hide(); playing = true; };
el("prev").onclick  = () => load(cursor - 1);
el("next").onclick  = () => load(cursor + 1);
el("reload").onclick = () => { cache.clear(); loadIndex(); };

el("tape-select").onchange = (e) => load(Number(e.target.value));
el("scrub").oninput = (e) => { playing = false; seek(Number(e.target.value)); };
el("speed").oninput = (e) => { speed = Number(e.target.value); refresh(); };
el("auto").onchange = (e) => { autoNext = e.target.checked; refresh(); };

window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const keys = {
    Space:      () => el("play").click(),
    ArrowRight: () => el("step").click(),
    ArrowLeft:  () => el("back").click(),
    KeyN:       () => load(cursor + 1),
    KeyP:       () => load(cursor - 1),
    KeyR:       () => el("restart").click(),
    KeyC:       () => view.toggleMode(),
    KeyF:       () => {
      const alive = game.cycles.filter((c) => c.alive);
      if (alive.length) view.follow(alive[Math.floor(Math.random() * alive.length)].id);
    },
  };
  if (keys[e.code]) { e.preventDefault(); keys[e.code](); }
});

/* Bänder auch per Drag & Drop, damit man eine einzelne Datei anschauen
   kann, ohne einen Server zu starten. */
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])].filter((f) => f.name.endsWith(".json"));
  if (!files.length) return;

  entries = [];
  cache.clear();
  for (const f of files) {
    const t = JSON.parse(await f.text());
    if (!t.ticks) continue;                        // keine index.json annehmen
    cache.set(f.name, t);
    entries.push({
      file: f.name, label: t.label || f.name,
      ticks: t.result?.ticks ?? t.ticks.length, winner: t.result?.winner,
    });
  }
  fillSelect();
  if (entries.length) load(0);
});


/* ------------------------------------------------------------------
   SCHLEIFE — identisch zu main.js: Engine tickt fest, gezeichnet wird
   bei jedem Bild, alpha lässt die Bikes zwischen den Kästchen gleiten.
   ------------------------------------------------------------------ */
function loop(now) {
  const dt = Math.min(now - last, 100);
  last = now;

  if (playing && game && game.phase === "running") {
    acc += dt;
    let guard = 0;
    while (acc >= tickMs() && game.phase === "running" && guard++ < 8) {
      acc -= tickMs();
      tickOnce();
    }
    refresh();
  }

  view.render(dt);
  requestAnimationFrame(loop);
}

window.addEventListener("resize", () => view.resize());

loadIndex();
requestAnimationFrame(loop);

window.ARENA = {
  get game() { return game; },
  get tape() { return tape; },
  load, seek, tickOnce,
};
