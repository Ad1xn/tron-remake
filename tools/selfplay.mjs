/* =========================================================================
   SELFPLAY — Matches ohne Bildschirm, so schnell wie es der Rechner hergibt.
   =========================================================================
   Das ist der MESSSTAND. Bevor irgendeine KI existiert, braucht man eine
   Zahl, gegen die man sie hält: "aggressor schlägt survivor in 68 % der
   Runden". Ohne die Zahl weiss man später nie, ob das Netz gut ist oder
   ob nur der Gegner schlecht war.

   Möglich ist das, weil src/engine.js keine Grafik kennt: dieselbe Datei,
   die im Browser läuft, läuft hier in Node — es gibt also keine zweite,
   leicht abweichende Version der Spielregeln.

   BENUTZUNG

     node tools/selfplay.mjs                             1v1, cruiser vs grinder
     node tools/selfplay.mjs --matches 500               mehr Runden
     node tools/selfplay.mjs --agents grinder,hunter
     node tools/selfplay.mjs --players 3                 1v1v1 (Feld wächst mit)
     node tools/selfplay.mjs --matrix                    jeder gegen jeden, 1v1
     node tools/selfplay.mjs --replays out/replays       Bänder für arena.html
     node tools/selfplay.mjs --jsonl daten/spiele.jsonl  Zug für Zug zum Lernen
     node tools/selfplay.mjs --help

   OPTIONEN
     --matches <zahl>   Matches pro Paarung          (Standard 200, auch --n)
     --agents <liste>   Agenten, mit Komma           (Standard cruiser,grinder)
     --players <zahl>   Fahrer pro Match; füllt die Agentenliste auf
     --seed <zahl>      Start-Seed                   (Standard 1)
          --field <zahl>     Arena-Kantenlänge in Metern erzwingen
     --maxTicks <zahl>  Notbremse gegen Endlos-Runden (Standard 20000
                        Schritte = 160 s bei 125 Hz)
     --matrix           alle 1v1-Paarungen durchspielen

   AUFNEHMEN — zwei Sorten, die man nicht verwechseln darf
     --replays <ordner> BÄNDER zum Anschauen: winzig, weil nur seed +
                        Richtungen. Dazu eine index.json für arena.html.
     --replaysN <zahl>  wie viele Bänder pro Paarung (Standard 20)
     --jsonl <datei>    TRAININGSDATEN: pro Zug eine Zeile
                        { match, tick, agent, obs, action }. Das ist das
                        volle Gitter aus observe() — wird schnell gross.
     --record <agent>   nur die Züge dieses Agenten ins jsonl schreiben

   WARUM FESTE SEEDS
     Die Seeds sind seed, seed+1, seed+2 … — also immer dieselben Karten.
     Nur so ist "Generation 5" mit "Generation 20" vergleichbar. Zum
     Trainieren nimmt man später zufällige Seeds, zum BEWERTEN immer die
     gleichen.

   WARUM SEITENWECHSEL
     Startplatz 1 ist nicht Startplatz 2. Darum rotiert die Fahrerliste
     nach jedem Match — jeder Agent fährt jeden Platz gleich oft.
   ========================================================================= */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { createGame, step, observe } from "../src/engine.js";
import { collectActions, AGENTS } from "../src/agents.js";
import { createRecorder, verifyTape } from "../src/replay.js";
import { arenaFor, RULES } from "../src/config.js";

const COLORS = [0x22d3ee, 0xfb923c, 0xa855f7, 0x4ade80, 0xf472b6, 0xfacc15];

/* Alle geschriebenen Bänder, für das Inhaltsverzeichnis am Ende. Ein
   statischer Webserver kann keinen Ordner auflisten — arena.html liest
   deshalb diese index.json. */
const WRITTEN = [];


/* ------------------------------------------------------------------
   ARGUMENTE
   ------------------------------------------------------------------ */
function parseArgs(argv) {
  const out = {
    n: 200, agents: ["cruiser", "grinder"], players: 0, seed: 1, level: 1,
    field: 0, maxTicks: 20000, matrix: false, help: false,
    replays: "", replaysN: 20,          // Bänder für arena.html
    jsonl: "", record: "",              // Trainingsdaten, optional auf einen Agenten
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--matrix") out.matrix = true;
    else if (a === "--n" || a === "--matches") out.n = Number(next());
    else if (a === "--agents") out.agents = next().split(",").map((s) => s.trim());
    else if (a === "--players") out.players = Number(next());
    else if (a === "--seed") out.seed = Number(next());
    else if (a === "--level") out.level = Number(next());
    else if (a === "--field") out.field = Number(next());
    else if (a === "--maxTicks") out.maxTicks = Number(next());
    else if (a === "--replays") out.replays = next();
    else if (a === "--replaysN") out.replaysN = Number(next());
    else if (a === "--jsonl") out.jsonl = next();
    else if (a === "--record") out.record = next();
    else { console.error("Unbekannte Option: " + a); process.exit(1); }
  }
  return out;
}


/* ------------------------------------------------------------------
   EIN MATCH
   ------------------------------------------------------------------
   Genau die Schleife, die auch main.js fährt — nur ohne Uhr, ohne
   Zeichnen und ohne Mensch. Exportiert, weil das Trainings-Skript
   später dieselbe Funktion braucht.
   ------------------------------------------------------------------ */
export async function runMatch({
  agents, seed, level = 1, field = 0, maxTicks = 20000, record = false, meta = {},
  onMove = null,
}) {
  // Ein Eintrag ist entweder ein Name aus AGENTS ("survivor") oder direkt
  // eine Funktion — damit ein trainiertes Netz später ohne Umbau hier
  // antreten kann: runMatch({ agents: ["survivor", meinNetz] }).
  const riders = agents.map((a, i) => {
    const isFn = typeof a === "function";
    const label = isFn ? (a.agentName || a.name || "netz") : a;
    return {
      name: String(label).toUpperCase().slice(0, 6),
      color: COLORS[i % COLORS.length],
      driver: isFn
        ? { type: "agent", agent: String(label), fn: a }
        : { type: "agent", agent: a },
    };
  });

  const game = createGame({ riders, seed, arena: field || arenaFor(riders.length) });
  const rec = record ? createRecorder(game, meta) : null;

  while (game.phase === "running" && game.tick < maxTicks) {
    let actions = collectActions(game);
    if (actions && typeof actions.then === "function") actions = await actions;
    if (rec) rec.note(actions);              // VOR dem step

    // Trainingsdaten: was der Agent SAH und was er daraus machte. Muss
    // vor dem step passieren — danach ist der Zustand ein anderer.
    // observe() kostet ein Array pro Bike, darum nur wenn wirklich
    // jemand zuhört.
    if (onMove && game.tick % RULES.AGENT_EVERY === 0) {
      for (const c of game.cycles) {
        if (!c.alive) continue;
        onMove({
          tick: game.tick,
          t: Number(game.time.toFixed(3)),
          agent: c.driver.agent,
          obs: observe(game, c.id),
          action: actions[c.id] || { turn: 0, brake: false },
        });
      }
    }

    step(game, actions);
  }

  // Platzierung: Überlebende zuerst, dann die, die am längsten durchhielten.
  const ranked = [...game.cycles].sort((a, b) =>
    (b.alive - a.alive) || (b.deathTime - a.deathTime));
  const placement = new Map();
  ranked.forEach((c, i) => placement.set(c.id, i + 1));

  const survivors = game.cycles.filter((c) => c.alive);

  return {
    tape: rec ? rec.finish() : null,
    ticks: game.tick,
    seconds: game.time,
    truncated: game.phase === "running",     // Notbremse hat gegriffen
    winner: survivors.length === 1 ? survivors[0] : null,
    bikes: game.cycles.map((c) => ({
      name: c.name, agent: c.driver.agent, score: c.score, kills: c.kills,
      alive: c.alive, place: placement.get(c.id),
      rubberUsed: c.rubberUsed, topSpeed: c.topSpeed, distance: c.distance,
    })),
  };
}


/* ------------------------------------------------------------------
   EINE PAARUNG: n Matches, Seiten getauscht, Statistik gesammelt
   ------------------------------------------------------------------ */
async function runSeries(agents, opt) {
  const stats = new Map();
  const bump = (name) => {
    if (!stats.has(name)) {
      stats.set(name, { name, matches: 0, wins: 0, draws: 0, places: 0,
                        score: 0, alive: 0, kills: 0, rubber: 0, top: 0 });
    }
    return stats.get(name);
  };
  for (const a of agents) bump(a);

  let ticksTotal = 0, secondsTotal = 0, truncated = 0, tapes = 0, moves = 0;
  const t0 = Date.now();

  for (let m = 0; m < opt.n; m++) {
    // Seitenwechsel: Liste um m Plätze rotieren.
    const order = agents.map((_, i) => agents[(i + m) % agents.length]);
    const wantTape = !!opt.replays && tapes < opt.replaysN;

    // Eine Zeile pro Zug. Gesammelt und einmal pro Match geschrieben —
    // eine Datei-Operation pro Zug wäre der Flaschenhals.
    const lines = [];
    const onMove = opt.jsonl
      ? (mv) => {
          if (opt.record && mv.agent !== opt.record) return;
          lines.push(JSON.stringify({ match: m, ...mv }));
        }
      : null;

    const res = await runMatch({
      agents: order,
      seed: opt.seed + m,
      level: opt.level,
      field: opt.field,
      maxTicks: opt.maxTicks,
      record: wantTape,
      meta: { label: agents.join(" vs ") + " #" + m },
      onMove,
    });

    if (lines.length) {
      appendFileSync(opt.jsonl, lines.join("\n") + "\n");
      moves += lines.length;
    }

    ticksTotal += res.ticks;
    secondsTotal += res.seconds;
    if (res.truncated) truncated++;

    for (const b of res.bikes) {
      const s = bump(b.agent);
      s.matches++;
      s.places += b.place;
      s.score += b.score;
      s.kills += b.kills;
      s.rubber += b.rubberUsed;
      s.top = Math.max(s.top, b.topSpeed);
      if (b.alive) s.alive++;
    }
    if (res.winner) bump(res.winner.driver?.agent ?? res.bikes.find((b) => b.alive).agent).wins++;
    else for (const b of res.bikes) bump(b.agent).draws += 1 / res.bikes.length;

    if (res.tape) {
      const dir = opt.replays;
      mkdirSync(dir, { recursive: true });
      const file = join(dir,
        `${agents.join("-")}-${String(m).padStart(4, "0")}.json`);
      writeFileSync(file, JSON.stringify(res.tape));
      WRITTEN.push({
        file: file.slice(dir.length + 1),
        label: res.tape.label,
        seed: res.tape.seed,
        players: res.tape.riders.length,
        ticks: res.tape.result.ticks,
        winner: res.tape.result.winner,
      });
      tapes++;

      // Einmal pro Paarung prüfen, dass ein Band exakt dasselbe Match ergibt.
      if (tapes === 1) {
        const check = verifyTape(res.tape, { step });
        if (!check.ok) {
          console.error("!! Replay stimmt nicht mit dem Match überein:", check);
          process.exitCode = 1;
        }
      }
    }
  }

  const secs = (Date.now() - t0) / 1000;
  return {
    agents,
    rows: [...stats.values()],
    avgTicks: ticksTotal / opt.n,
    avgSeconds: secondsTotal / opt.n,
    truncated,
    secs,
    perSec: opt.n / Math.max(secs, 0.001),
    tapes,
    moves,
  };
}


/* ------------------------------------------------------------------
   AUSGABE
   ------------------------------------------------------------------ */
const pad = (s, w) => String(s).padEnd(w);
const num = (s, w) => String(s).padStart(w);

function printSeries(series, opt) {
  const n = opt.n;
  const field = (opt.field || arenaFor(series.agents.length)) + " m";

  console.log("");
  console.log("  " + series.agents.join("  vs  ")
    + `   ·   ${n} Matches   ·   Feld ${field}   ·   Seeds ${opt.seed}…${opt.seed + n - 1}`);
  console.log("  " + "-".repeat(72));
  console.log("  " + pad("AGENT", 12) + num("SIEGE", 7) + num("%", 8)
    + num("PLATZ", 8) + num("SCORE", 8) + num("KILLS", 7)
    + num("RUBBER", 8) + num("SPITZE", 8));

  const sorted = [...series.rows].sort((a, b) => b.wins - a.wins);
  for (const r of sorted) {
    console.log("  " + pad(r.name, 12)
      + num(r.wins, 7)
      + num((100 * r.wins / n).toFixed(1), 8)
      + num((r.places / r.matches).toFixed(2), 8)
      + num((r.score / r.matches).toFixed(1), 8)
      + num(r.kills, 7)
      + num((r.rubber / r.matches).toFixed(2), 8)
      + num(r.top.toFixed(0) + "m/s", 8));
  }

  const draws = series.rows.reduce((a, r) => a + r.draws, 0);
  console.log("  " + "-".repeat(72));
  console.log("  " + pad("Unentschieden", 16) + Math.round(draws)
    + "   ·   Ø Runde " + series.avgSeconds.toFixed(1) + " s"
    + " (" + Math.round(series.avgTicks) + " Schritte)"
    + (series.truncated ? "   ·   " + series.truncated + " abgebrochen" : ""));
  console.log("  " + pad("Tempo", 16) + Math.round(series.perSec) + " Matches/s"
    + "   ·   " + series.secs.toFixed(2) + " s gesamt"
    + (series.tapes ? "   ·   " + series.tapes + " Bänder" : "")
    + (series.moves ? "   ·   " + series.moves + " Züge im jsonl" : ""));
}


/* ------------------------------------------------------------------
   LOS
   ------------------------------------------------------------------ */
async function main() {
  const opt = parseArgs(process.argv.slice(2));

  if (opt.help) {
    console.log(
      "\n  node tools/selfplay.mjs [--matches 200] [--agents a,b] [--players 2]"
      + "\n                          [--seed 1] [--matrix] [--field 32]"
      + "\n                          [--replays ordner] [--replaysN 20]"
      + "\n                          [--jsonl datei] [--record agent]"
      + "\n\n  Verfügbare Agenten: " + Object.keys(AGENTS).join(", ")
      + "\n\n  --replays = Bänder zum Anschauen (arena.html)"
      + "\n  --jsonl   = Zug für Zug zum Lernen (gross)\n");
    return;
  }

  // Spielerzahl auffüllen: --players 4 mit zwei Agenten heisst a,b,a,b.
  let agents = opt.agents;
  if (opt.players > agents.length) {
    agents = Array.from({ length: opt.players }, (_, i) => opt.agents[i % opt.agents.length]);
  } else if (opt.players > 0) {
    agents = agents.slice(0, opt.players);
  }

  for (const a of agents) {
    if (!AGENTS[a]) {
      console.error(`Kein Agent namens "${a}". Da sind: ` + Object.keys(AGENTS).join(", "));
      process.exit(1);
    }
  }

  // Frische Datei: sonst hängen zwei Läufe aneinander und "match 0"
  // kommt zweimal vor.
  if (opt.jsonl) {
    mkdirSync(dirname(opt.jsonl), { recursive: true });
    writeFileSync(opt.jsonl, "");
  }

  if (opt.matrix) {
    const names = Object.keys(AGENTS);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        printSeries(await runSeries([names[i], names[j]], opt), opt);
      }
    }
    writeManifest(opt);
    console.log("");
    return;
  }

  printSeries(await runSeries(agents, opt), opt);
  writeManifest(opt);
  console.log("");
}

/* Inhaltsverzeichnis für arena.html. Ein schon vorhandenes wird ERGÄNZT,
   nicht überschrieben — sonst verliert man beim zweiten Lauf in denselben
   Ordner die Bänder des ersten. */
function writeManifest(opt) {
  if (!opt.replays || WRITTEN.length === 0) return;
  const path = join(opt.replays, "index.json");

  let old = [];
  if (existsSync(path)) {
    try { old = JSON.parse(readFileSync(path, "utf8")).files || []; } catch { old = []; }
  }
  const files = [...old.filter((o) => !WRITTEN.some((w) => w.file === o.file)), ...WRITTEN];

  writeFileSync(path, JSON.stringify({
    created: new Date().toISOString(),
    count: files.length,
    files,
  }, null, 2));
  console.log("\n  " + path + "  (" + files.length + " Bänder, " + WRITTEN.length + " neu)");
  console.log("  Anschauen:  arena.html"
    + (opt.replays === "out/replays" ? "" : "?dir=" + opt.replays));
}

/* Nur starten, wenn die Datei WIRKLICH aufgerufen wurde. Wer sie nur
   importiert (z. B. das spätere Trainings-Skript, das runMatch braucht),
   soll nicht aus Versehen 200 Matches auslösen. */
const startedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (startedDirectly) main();
