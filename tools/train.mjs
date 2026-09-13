#!/usr/bin/env node
/* =========================================================================
   TRAIN — das kleinste Training, das die ganze Kette schliesst.
   =========================================================================
   NACHAHMEN, nicht Verstärkungslernen. Das ist Absicht: hier soll noch
   kein gutes Netz entstehen, sondern bewiesen werden, dass die Kette
   überhaupt geschlossen ist —

       Matches fahren → Sensoren aus features.js → lernen →
       als Agent mitfahren → im selben Messstand gemessen werden

   Jede dieser Nahtstellen kann still kaputt sein, und bei
   Verstärkungslernen merkt man es nach Stunden statt nach Sekunden.

   BENUTZUNG

     node tools/train.mjs                          hunter nachahmen
     node tools/train.mjs --teacher cruiser
     node tools/train.mjs --matches 40 --epochs 30
     node tools/train.mjs --out out/netz-gen1.json

   OPTIONEN
     --teacher <name>   wen nachahmen            (Standard hunter)
     --matches <zahl>   Matches zum Sammeln      (Standard 30)
     --epochs <zahl>    Durchgänge               (Standard 25)
     --hidden <zahl>    verdeckte Neuronen       (Standard 24)
     --lr <zahl>        Lernrate                 (Standard 0.01)
     --batch <zahl>     Losgrösse                (Standard 128)
     --eval <zahl>      Matches zum Bewerten     (Standard 40)
     --seed <zahl>      Startwert                (Standard 1)
     --out <datei>      wohin die Gewichte       (Standard out/netz.json)

   WARUM TREFFERGENAUIGKEIT HIER LÜGT
     90 % aller Züge sind "geradeaus". Ein Netz, das nichts tut als
     geradeaus zu sagen, hat damit 90 % recht und fährt in die erste
     Wand. Gemessen wird deshalb die AUSGEWOGENE Genauigkeit: der
     Mittelwert der drei Trefferquoten je Klasse. Für den Zufall liegt
     die bei 33 %, für den Immer-geradeaus-Sager ebenfalls bei 33 %.

   WARUM NACH MATCHES GETEILT WIRD
     Aufeinanderfolgende Züge sind sich fast gleich. Teilt man zufällig
     nach Zeilen, steht zu fast jedem Prüfzug ein fast identischer
     Lernzug — die Prüfzahl wäre geschönt. Darum wandern ganze Matches
     entweder ins Lernen oder ins Prüfen.
   ========================================================================= */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { createGame, step, makeRng } from "../src/engine.js";
import { collectActions, AGENTS } from "../src/agents.js";
import { RULES, COLORS } from "../src/config.js";
import { viewOfGame, encodeSensors, indexOf, ACTIONS, SENSOR_NAMES }
  from "../src/features.js";
import { neuesNetz, vorwaerts, softmax, groesster, netzAlsJson, netzAgent,
         neueGradienten, neuerZwischenspeicher, rueckwaerts, anwenden }
  from "../src/net.js";
import { runMatch } from "./selfplay.mjs";


/* ------------------------------------------------------------------
   ARGUMENTE
   ------------------------------------------------------------------ */
function args(argv) {
  const o = { teacher: "hunter", matches: 30, epochs: 25, hidden: 24,
              lr: 0.01, batch: 128, eval: 40, seed: 1, out: "out/netz.json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--teacher") o.teacher = next();
    else if (a === "--out") o.out = next();
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("--") && a.slice(2) in o) o[a.slice(2)] = Number(next());
    else { console.error("Unbekannte Option: " + a); process.exit(1); }
  }
  return o;
}


/* ------------------------------------------------------------------
   1. DATEN SAMMELN
   ------------------------------------------------------------------
   Der Lehrer fährt gegen das ganze Feld. Aufgeschrieben werden nur SEINE
   Züge, und nur im Agenten-Takt — im Spiel wird er auch nur dann
   gefragt.
   ------------------------------------------------------------------ */
function sammeln(opt) {
  const gegner = Object.keys(AGENTS).filter((a) => a !== opt.teacher);
  const besetzung = [opt.teacher, ...gegner];

  const X = [], y = [], ausMatch = [];
  for (let m = 0; m < opt.matches; m++) {
    const order = besetzung.map((_, i) => besetzung[(i + m) % besetzung.length]);
    const riders = order.map((a, i) => ({
      name: a.toUpperCase().slice(0, 6), color: COLORS[i % COLORS.length],
      driver: { type: "agent", agent: a },
    }));
    const game = createGame({ riders, seed: opt.seed + m, mode: "lms" });

    while (game.phase === "running" && game.tick < 20000) {
      const actions = collectActions(game);
      if (game.tick % RULES.AGENT_EVERY === 0) {
        for (const c of game.cycles) {
          if (!c.alive || c.driver.agent !== opt.teacher) continue;
          const a = actions[c.id];
          if (!a) continue;
          X.push(encodeSensors(viewOfGame(game, c.id)));
          y.push(indexOf(a.turn));
          ausMatch.push(m);
        }
      }
      step(game, actions);
    }
  }
  return { X, y, ausMatch };
}


/* ------------------------------------------------------------------
   2. LERNEN
   ------------------------------------------------------------------
   Die Ableitung und Adam stehen in src/net.js — hier steht nur, WOMIT
   dRoh gefüllt wird: p minus dem, was der Lehrer getan hat, gewichtet
   nach Klasse.
   ------------------------------------------------------------------ */
function trainieren(netz, X, y, gewichtProKlasse, opt, rng) {
  const grad = neueGradienten(netz);
  const zw = neuerZwischenspeicher(netz);
  const reihenfolge = Uint32Array.from(X.keys());
  let letzterVerlust = 0;

  for (let e = 0; e < opt.epochs; e++) {
    // Mischen (Fisher-Yates), sonst lernt es die Reihenfolge mit.
    for (let i = reihenfolge.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [reihenfolge[i], reihenfolge[j]] = [reihenfolge[j], reihenfolge[i]];
    }

    let verlust = 0, n = 0;
    for (let start = 0; start < reihenfolge.length; start += opt.batch) {
      const ende = Math.min(start + opt.batch, reihenfolge.length);
      let gewichtSumme = 0;

      for (let r = start; r < ende; r++) {
        const idx = reihenfolge[r];
        const x = X[idx], ziel = y[idx];
        const g = gewichtProKlasse[ziel];
        gewichtSumme += g;

        vorwaerts(netz, x, zw);
        softmax(zw.roh, zw.p);
        verlust += -g * Math.log(Math.max(zw.p[ziel], 1e-12));
        n++;

        for (let k = 0; k < netz.aus; k++) {
          zw.dRoh[k] = g * (zw.p[k] - (k === ziel ? 1 : 0));
        }
        rueckwaerts(netz, x, zw, grad);
      }

      /* Durch die GEWICHTSSUMME teilen, nicht durch die Anzahl: sonst
         hinge die Schrittweite daran, wie viele seltene Klassen zufällig
         im Los waren. */
      anwenden(netz, grad, opt.lr, 1 / Math.max(gewichtSumme, 1e-9));
    }
    letzterVerlust = verlust / Math.max(n, 1);
    if (e === 0 || (e + 1) % 5 === 0 || e === opt.epochs - 1) {
      console.log("    Epoche " + String(e + 1).padStart(3)
        + "   Verlust " + letzterVerlust.toFixed(4));
    }
  }
  return letzterVerlust;
}


/* ------------------------------------------------------------------
   3. BEWERTEN — erst die Zahlen, dann das Spiel
   ------------------------------------------------------------------ */
function guete(netz, X, y) {
  const treffer = new Array(ACTIONS.length).fill(0);
  const gesamt = new Array(ACTIONS.length).fill(0);
  let richtig = 0;

  for (let i = 0; i < X.length; i++) {
    const k = groesster(vorwaerts(netz, X[i]));
    gesamt[y[i]]++;
    if (k === y[i]) { treffer[y[i]]++; richtig++; }
  }
  const jeKlasse = treffer.map((t, i) => (gesamt[i] ? t / gesamt[i] : 0));
  return {
    roh: richtig / Math.max(X.length, 1),
    jeKlasse,
    ausgewogen: jeKlasse.reduce((a, b) => a + b, 0) / jeKlasse.length,
    gesamt,
  };
}


/* ------------------------------------------------------------------
   LOS
   ------------------------------------------------------------------ */
async function main() {
  const opt = args(process.argv.slice(2));
  if (opt.help) { console.log("Siehe Kopf von tools/train.mjs"); return; }

  const rng = makeRng(opt.seed);
  console.log("\n  NACHAHMEN VON " + opt.teacher.toUpperCase()
    + "   ·   " + opt.matches + " Matches sammeln");

  const t0 = Date.now();
  const { X, y, ausMatch } = sammeln(opt);

  const verteilung = new Array(ACTIONS.length).fill(0);
  for (const k of y) verteilung[k]++;
  console.log("  " + X.length + " Züge in "
    + ((Date.now() - t0) / 1000).toFixed(1) + " s   ·   "
    + ACTIONS.map((a, i) => a + " " + (100 * verteilung[i] / y.length).toFixed(1) + " %").join("  ·  "));

  /* Nach MATCHES teilen, nicht nach Zeilen. */
  const grenze = Math.floor(opt.matches * 0.8);
  const lernIdx = [], pruefIdx = [];
  for (let i = 0; i < X.length; i++) (ausMatch[i] < grenze ? lernIdx : pruefIdx).push(i);
  const nimm = (idx, arr) => idx.map((i) => arr[i]);
  const Xl = nimm(lernIdx, X), yl = nimm(lernIdx, y);
  const Xp = nimm(pruefIdx, X), yp = nimm(pruefIdx, y);
  console.log("  Lernen " + Xl.length + " Züge (Match 0…" + (grenze - 1) + ")"
    + "   ·   Prüfen " + Xp.length + " Züge (Match " + grenze + "…" + (opt.matches - 1) + ")");

  /* Klassengewichte: die seltene Kurve zählt so viel wie die häufige
     Gerade. Ohne das sagt das Netz nur "geradeaus". */
  const zaehl = new Array(ACTIONS.length).fill(0);
  for (const k of yl) zaehl[k]++;
  const gewichtProKlasse = zaehl.map((c) => (c ? yl.length / (ACTIONS.length * c) : 0));
  console.log("  Klassengewichte: "
    + ACTIONS.map((a, i) => a + " ×" + gewichtProKlasse[i].toFixed(2)).join("  "));

  console.log("\n  LERNEN   " + SENSOR_NAMES.length + " → " + opt.hidden
    + " → " + ACTIONS.length);
  const netz = neuesNetz(SENSOR_NAMES.length, opt.hidden, ACTIONS.length, rng);
  const t1 = Date.now();
  trainieren(netz, Xl, yl, gewichtProKlasse, opt, rng);
  console.log("    " + ((Date.now() - t1) / 1000).toFixed(1) + " s");

  const gl = guete(netz, Xl, yl), gp = guete(netz, Xp, yp);
  console.log("\n  GENAUIGKEIT            LERNEN    PRÜFEN");
  console.log("    roh (lügt, s. o.)   " + (100 * gl.roh).toFixed(1).padStart(7)
    + " % " + (100 * gp.roh).toFixed(1).padStart(8) + " %");
  console.log("    ausgewogen          " + (100 * gl.ausgewogen).toFixed(1).padStart(7)
    + " % " + (100 * gp.ausgewogen).toFixed(1).padStart(8) + " %      (Zufall 33 %)");
  ACTIONS.forEach((a, i) => {
    console.log("      " + a.padEnd(18) + (100 * gl.jeKlasse[i]).toFixed(1).padStart(7)
      + " % " + (100 * gp.jeKlasse[i]).toFixed(1).padStart(8) + " %"
      + "      n=" + gp.gesamt[i]);
  });

  mkdirSync(dirname(opt.out), { recursive: true });
  writeFileSync(opt.out, JSON.stringify(netzAlsJson(netz, {
    lehrer: opt.teacher, matches: opt.matches, epochs: opt.epochs,
    sensoren: SENSOR_NAMES, ausgewogenPruef: gp.ausgewogen,
  })));
  console.log("\n  " + opt.out + "  ("
    + (netz.w1.length + netz.b1.length + netz.w2.length + netz.b2.length)
    + " Parameter)");

  /* ---- und jetzt der einzige Test, der zählt: mitfahren ---- */
  console.log("\n  ANTRETEN   ·   " + opt.eval + " Matches je Gegner   ·   1v1");
  console.log("  " + "-".repeat(60));
  console.log("  GEGNER".padEnd(14) + "SIEGE NETZ".padStart(12)
    + "%".padStart(8) + "Ø RUNDE".padStart(12));

  const agent = netzAgent(netz, { name: "netz" });
  for (const gegner of Object.keys(AGENTS)) {
    let siege = 0, sek = 0;
    for (let m = 0; m < opt.eval; m++) {
      /* Seiten tauschen, damit der Startplatz nicht das Ergebnis macht. */
      const paar = m % 2 === 0 ? [agent, gegner] : [gegner, agent];
      const res = await runMatch({ agents: paar, seed: 1 + m, mode: "lms" });
      if (res.winnerAgent === "netz") siege++;
      sek += res.seconds;
    }
    console.log("  " + gegner.padEnd(14) + String(siege).padStart(12)
      + (100 * siege / opt.eval).toFixed(1).padStart(8)
      + (sek / opt.eval).toFixed(1).padStart(11) + "s");
  }
  console.log("");
}

const direkt = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direkt) main();
