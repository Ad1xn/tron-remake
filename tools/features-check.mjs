#!/usr/bin/env node
/* =========================================================================
   FEATURES-CHECK — prüft die eine Regel, an der alles hängt.
   =========================================================================
   src/features.js verspricht: EGAL ob die Zahlen direkt aus dem Spiel
   kommen (Training in Node) oder als observe()-JSON über eine Leitung
   (Modell in Python) — es kommt DASSELBE heraus. Wenn das kippt, sieht
   ein Netz im Spiel andere Zahlen als beim Lernen, und niemand merkt es.

   Also: ein paar Matches spielen und bei jedem Zug beides vergleichen.
   Dazu die Wertebereiche prüfen (ein Netz mag keine 47 im Eingang) und
   die Belohnung aufschlüsseln — man sieht sofort, welcher Term dominiert.

       node tools/features-check.mjs [--matches 3]
   ========================================================================= */

import { createGame, step, observe, AXES } from "../src/engine.js";
import { collectActions } from "../src/agents.js";
import {
  viewOfGame, viewOfObs, encodeSensors, encodePatch, SENSOR_NAMES,
  PATCH_CHANNELS, PATCH_N, PATCH_CELL, shapes, reward, rewardSnapshot,
  ACTIONS, actionOf, indexOf, safeMask, localRoom,
} from "../src/features.js";

const arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};

const MATCHES = arg("matches", 5);

let checks = 0, fails = 0;
const fail = (msg) => { fails++; console.error("  FEHLER: " + msg); };
const ok = () => { checks++; };

function sameArray(a, b, what) {
  if (a.length !== b.length) return fail(what + ": Länge " + a.length + " ≠ " + b.length);
  for (let i = 0; i < a.length; i++) {
    // Beide Wege rechnen mit den gleichen Zahlen; Gleitkomma-Rauschen
    // erlauben wir trotzdem, sonst ist der Test zickig statt nützlich.
    if (Math.abs(a[i] - b[i]) > 1e-9) {
      return fail(what + ": Stelle " + i + " (" + a[i] + " ≠ " + b[i] + ")");
    }
  }
  ok();
}

function inRange(arr, lo, hi, what) {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return fail(what + ": NaN an Stelle " + i);
    if (arr[i] < lo || arr[i] > hi) {
      return fail(what + ": " + arr[i] + " an Stelle " + i
        + " liegt nicht in " + lo + "…" + hi
        + (SENSOR_NAMES[i] ? " (" + SENSOR_NAMES[i] + ")" : ""));
    }
  }
  ok();
}


/* ------------------------------------------------------------------
   1. Aktionen: hin und zurück
   ------------------------------------------------------------------ */
console.log("\n  AKTIONEN");
for (let i = 0; i < ACTIONS.length; i++) {
  const a = actionOf(i);
  if (indexOf(a.turn) !== i) fail(`actionOf/indexOf: ${i} → ${JSON.stringify(a)}`);
  else ok();
}
console.log("  " + checks + " Umrechnungen stimmen  (" + ACTIONS.join(", ") + ")");


/* ------------------------------------------------------------------
   2. Der Hauptteil: zwei Wege, ein Ergebnis
   ------------------------------------------------------------------ */
console.log("\n  ZWEI WEGE, EIN ERGEBNIS  (game vs. observe-JSON)");

const rewardTotals = { raum: 0, tempo: 0, gummi: 0, leben: 0, zeit: 0,
                       kill: 0, tod: 0, sieg: 0 };
let moves = 0, matches = 0, deaths = 0, wins = 0;

/* Spannweite jeder Eingabe mitschreiben. Eine Zahl, die sich NIE ändert,
   ist für ein Netz Ballast — und meistens ein Fehler. Genau so ist
   raum_anteil aufgefallen: stand konstant auf 0,5, weil die Flutfüllung
   auf dem eigenen Kopf-Kästchen startete und deshalb immer 0 zurückgab. */
const range = SENSOR_NAMES.map(() => ({ lo: Infinity, hi: -Infinity, sum: 0 }));

for (let m = 0; m < MATCHES; m++) {
  const riders = ["grinder", "hunter", "cruiser"].map((a) => ({
    name: a.toUpperCase().slice(0, 6),
    color: 0x22d3ee,
    driver: { type: "agent", agent: a },
  }));
  const game = createGame({ riders, seed: 1000 + m });
  matches++;

  // Nur jeden AGENT_EVERY-ten Schritt prüfen — so oft, wie ein Netz
  // auch gefragt würde. Alles andere wäre 125-mal pro Sekunde umsonst.
  /* Die Momentaufnahmen halten ÜBER die Schritte hinweg, nicht je
     Schritt: nur so lässt sich auch ein Tod abrechnen, der zwischen zwei
     Stichproben passiert. */
  const snaps = new Map();

  while (game.phase === "running" && game.tick < 30000) {
    const probe = game.tick % 4 === 0;      // so oft wie ein Agent gefragt wird

    for (const b of probe ? game.cycles : []) {
      if (!b.alive) continue;

      const vGame = viewOfGame(game, b.id);
      const vObs  = viewOfObs(observe(game, b.id));

      // (a) Sensoren müssen auf beiden Wegen gleich sein …
      const sGame = encodeSensors(vGame);
      const sObs  = encodeSensors(vObs);
      sameArray(sGame, sObs, "Sensoren");
      inRange(sGame, -1, 1, "Sensoren");
      for (let i = 0; i < sGame.length; i++) {
        const r = range[i];
        r.lo = Math.min(r.lo, sGame[i]);
        r.hi = Math.max(r.hi, sGame[i]);
        r.sum += sGame[i];
      }

      // (b) … und der Ausschnitt auch.
      const pGame = encodePatch(vGame);
      const pObs  = encodePatch(vObs);
      sameArray(pGame, pObs, "Ausschnitt");
      inRange(pGame, 0, 1, "Ausschnitt");

      // (c) Das Bild ist gedreht: die eigene Wand liegt direkt HINTER
      //     mir, im Bild also eine Zeile unter der Mitte, Kanal 0.
      //     Nur prüfbar, wenn seit der letzten Kurve auch wirklich mehr
      //     als zwei Zellen gefahren wurden — direkt nach einer Kurve
      //     liegt hinter mir noch das alte, querstehende Stück.
      const R = PATCH_N / 2;
      const behind = 0 * PATCH_N * PATCH_N + (R + 1) * PATCH_N + R;
      const gefahren = (game.time - b.turnAt) * b.speed;
      if (b.wallLen > PATCH_CELL * 2 && gefahren > PATCH_CELL * 2.5
          && pGame[behind] !== 1) {
        fail(`Drehung: eigene Wand nicht hinter mir (dir ${b.dir}, `
          + `len ${b.wallLen.toFixed(1)})`);
      } else ok();

      // (d) Die Sicherheitsmaske darf nie eine Richtung erlauben, in der
      //     nachweislich zu wenig Platz ist.
      const safe = safeMask(vGame);
      const dists = [vGame.rays.front, vGame.rays.left, vGame.rays.right];
      const need = Math.max(b.speed, 1) * 0.25;
      if (safe.some((v, i) => v === 1 && dists[i] <= need)) {
        fail("safeMask erlaubt eine Richtung ohne Platz");
      } else ok();

      // (e) Der Platz im Bild ist ein Anteil, muss also in 0…1 liegen.
      const room = localRoom(pGame);
      if (!(room >= 0 && room <= 1)) fail("localRoom ausserhalb 0…1: " + room);
      else ok();

      snaps.set(b.id, rewardSnapshot(vGame));
      moves++;
    }

    const events = step(game, collectActions(game));

    // Tode und Siege direkt aus den events zählen, nicht aus der
    // Belohnung: gestorben wird auch zwischen zwei Stichproben.
    deaths += events.deaths.length;
    if (events.finished) wins += events.survivors.length;

    /* (f) Belohnung abrechnen — im Agenten-Takt UND immer dann, wenn
       etwas Endgültiges passiert ist. Ohne den zweiten Teil fallen Tod,
       Abschuss und Sieg fast immer zwischen zwei Stichproben: sie treffen
       nur jeden vierten Schritt. In der Auswertung standen sie deshalb
       auf 0,00 — bei 10 Toden und 5 Siegen im selben Lauf. */
    if (!probe && !events.deaths.length && !events.finished) continue;

    for (const b of game.cycles) {
      const before = snaps.get(b.id);
      if (!before) continue;
      // Das Bike MUSS mitgegeben werden: ohne es kann reward() nicht
      // in events.survivors nachsehen, und der Siegbonus bleibt aus.
      const v = reward(before, viewOfGame(game, b.id), events, b);
      for (const k in rewardTotals) rewardTotals[k] += v.parts[k];
      // Tote vergessen, sonst sterben sie in jedem weiteren Schritt neu.
      if (b.alive) snaps.set(b.id, rewardSnapshot(viewOfGame(game, b.id)));
      else snaps.delete(b.id);
      ok();
    }
  }
}

console.log("  " + moves + " Züge in " + matches + " Matches geprüft"
  + "  ·  " + deaths + " Tode, " + wins + " Siege");


/* ------------------------------------------------------------------
   2b. Bewegt sich jede Zahl überhaupt?
   ------------------------------------------------------------------ */
console.log("\n  SPANNWEITE JEDER EINGABE  (konstant = Ballast oder Fehler)");
SENSOR_NAMES.forEach((name, i) => {
  const r = range[i];
  const konstant = r.hi - r.lo < 1e-9;
  if (konstant) fail("Sensor " + name + " ist konstant " + r.lo.toFixed(3));
  else ok();
  console.log("  " + name.padEnd(14)
    + r.lo.toFixed(3).padStart(8) + " …" + r.hi.toFixed(3).padStart(8)
    + "   Ø " + (r.sum / moves).toFixed(3).padStart(7)
    + (konstant ? "   !! KONSTANT" : ""));
});

if (Math.abs(rewardTotals.raum) < 1e-9) {
  fail("Der Term RAUM ist über den ganzen Lauf exakt 0 — er wirkt nicht.");
} else ok();


/* ------------------------------------------------------------------
   3. Was das Netz zu sehen bekommt, in Zahlen
   ------------------------------------------------------------------ */
const sh = shapes();
console.log("\n  EINGABEN");
console.log("  Sensoren:    " + sh.sensors + " Zahlen  (" + SENSOR_NAMES.join(", ") + ")");
console.log("  Bild:        " + sh.patch.channels + " × " + sh.patch.side + " × "
  + sh.patch.side + " = " + sh.patch.total + " Zahlen  ("
  + PATCH_CHANNELS.join(", ") + ")"
  + "\n               " + sh.patch.metres + " m Sichtfeld, "
  + PATCH_CELL + " m pro Zelle");
console.log("  Ausgänge:    " + sh.actions + " (" + ACTIONS.join("/") + ") + Bremse");

console.log("\n  BELOHNUNG — Summe über alle Züge, nach Term");
const abs = Object.values(rewardTotals).reduce((a, v) => a + Math.abs(v), 0) || 1;
for (const [k, v] of Object.entries(rewardTotals)) {
  const share = (100 * Math.abs(v) / abs).toFixed(0).padStart(3) + " %";
  console.log("  " + k.padEnd(7) + v.toFixed(2).padStart(9) + "   " + share
    + "  " + "█".repeat(Math.round(30 * Math.abs(v) / abs)));
}
console.log("  " + "gesamt".padEnd(7)
  + Object.values(rewardTotals).reduce((a, v) => a + v, 0).toFixed(2).padStart(9));
console.log("\n  Nicht falsch ablesen: RAUM ist eine DIFFERENZ pro Schritt. Die"
  + "\n  Summe über ein Match ist deshalb nur (Ende − Anfang) und sagt fast"
  + "\n  nichts über die Wirkung — die steckt im dichten Signal Schritt für"
  + "\n  Schritt. TEMPO, GUMMI, KILL, TOD und SIEG sind untereinander"
  + "\n  vergleichbar, RAUM ist es nicht.");

console.log("\n  " + (fails === 0
  ? checks + " Prüfungen, alle in Ordnung"
  : fails + " FEHLER bei " + checks + " Prüfungen") + "\n");

process.exit(fails ? 1 : 0);
