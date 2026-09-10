/* =========================================================================
   REPLAY — ein ganzes Match in ein paar Kilobyte.
   =========================================================================
   Der Trick steckt in der Engine: gleicher seed + gleiche Eingaben =
   gleiches Spiel, Zentimeter für Zentimeter. Ein Replay muss deshalb
   keine Positionen speichern, sondern nur:

       seed  +  wer wollte in welchem Schritt lenken und bremsen

   Das ist pro Schritt EIN Buchstabe pro Bike:

       S geradeaus    L links    R rechts      (ohne Bremse)
       s geradeaus    l links    r rechts      (mit Bremse)
       -  fährt nicht mehr

   Bei 125 Schritten pro Sekunde sind das ~250 Byte pro Bike und Sekunde,
   also wenige Kilobyte pro Match. Man kann für jede Trainings-Generation
   eine Datei wegschreiben und sie später alle nebeneinander anschauen.

   Und das Beste: die Wiedergabe braucht keine neue Spielschleife. Ein
   Band-Fahrer ist einfach ein Agent, der seine Antwort vom Band abliest.
   Alles, was live läuft (Engine, Renderer, HUD), läuft damit unverändert.

   Diese Datei kennt weder Browser noch Grafik — sie läuft auch in Node.
   ========================================================================= */

import { createGame } from "./engine.js";

export const REPLAY_VERSION = 2;             // 1 war das Raster-Tron

/* Aktion ⇄ Buchstabe. Gross = ohne Bremse, klein = mit. */
const LETTER = {
  "0,0": "S", "1,0": "L", "-1,0": "R",
  "0,1": "s", "1,1": "l", "-1,1": "r",
};
const ACTION_OF = {
  S: { turn:  0, brake: false }, s: { turn:  0, brake: true },
  L: { turn:  1, brake: false }, l: { turn:  1, brake: true },
  R: { turn: -1, brake: false }, r: { turn: -1, brake: true },
};

const letterOf = (a) =>
  LETTER[`${Math.sign((a && a.turn) | 0)},${a && a.brake ? 1 : 0}`] || "S";


/* ------------------------------------------------------------------
   AUFNEHMEN
   ------------------------------------------------------------------
       const rec = createRecorder(game, { label: "gen-12" });
       while (game.phase === "running") {
         const actions = collectActions(game);
         rec.note(actions);            // VOR dem step, sonst passt der Schritt nicht
         step(game, actions);
       }
       const tape = rec.finish();
   ------------------------------------------------------------------ */
export function createRecorder(game, meta = {}) {
  const tape = {
    version: REPLAY_VERSION,
    ...meta,                                   // label, generation, was du willst
    seed: game.seed,
    arena: game.arena,
    riders: game.cycles.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      agent: c.driver.fn ? (c.driver.agent || "fn") : (c.driver.agent || c.driver.type),
    })),
    ticks: [],
    result: null,
  };

  return {
    tape,

    note(actions = {}) {
      let line = "";
      for (const c of game.cycles) line += c.alive ? letterOf(actions[c.id]) : "-";
      tape.ticks.push(line);
    },

    finish() {
      const alive = game.cycles.filter((c) => c.alive);
      tape.result = {
        ticks: game.tick,
        seconds: game.time,
        winner: alive.length === 1 ? alive[0].name : null,
        winnerId: alive.length === 1 ? alive[0].id : 0,
        draw: alive.length !== 1,
        riders: game.cycles.map((c) => ({
          id: c.id, name: c.name, score: c.score, kills: c.kills,
          rubberUsed: Number(c.rubberUsed.toFixed(3)),
          topSpeed: Number(c.topSpeed.toFixed(2)),
          distance: Number(c.distance.toFixed(1)),
          deathTime: Number(c.deathTime.toFixed(3)),
          deathBy: c.deathBy,
        })),
      };
      return tape;
    },
  };
}


/* ------------------------------------------------------------------
   ABSPIELEN
   ------------------------------------------------------------------ */
export function tapeToGame(tape) {
  const riders = tape.riders.map((r, i) => ({
    name: r.name,
    color: r.color,
    driver: { type: "agent", agent: r.agent, fn: tapeDriver(tape, i) },
  }));

  return createGame({ riders, seed: tape.seed, arena: tape.arena });
}

/* Ein Fahrer, der nur nachschlägt. game.tick zählt erst in step() hoch —
   darum ist tape.ticks[game.tick] genau die Zeile, die jetzt dran ist.
   Läuft das Band aus, fährt er geradeaus weiter. */
export function tapeDriver(tape, riderIndex) {
  return function fromTape() {
    const line = tape.ticks[tape.cursor ?? -1] ?? null;   // (nur für Tests)
    return line ? ACTION_OF[line[riderIndex]] || ACTION_OF.S : ACTION_OF.S;
  };
}

/* Die Fassung, die die Arena benutzt: liest anhand von game.tick. */
export function tapeActions(tape, game) {
  const line = tape.ticks[game.tick];
  const out = {};
  game.cycles.forEach((c, i) => {
    if (!c.alive) return;
    out[c.id] = line ? (ACTION_OF[line[i]] || ACTION_OF.S) : ACTION_OF.S;
  });
  return out;
}

export const tapeLength = (tape) => tape.ticks.length;


/* ------------------------------------------------------------------
   PRÜFEN
   ------------------------------------------------------------------
   Ein Replay-Format, dem man nicht traut, ist wertlos. Diese Funktion
   spielt ein Band nach und vergleicht das Ergebnis mit dem, was drin
   steht. tools/selfplay.mjs macht das bei jedem Aufnahme-Lauf einmal.
   ------------------------------------------------------------------ */
export function verifyTape(tape, { step } = {}) {
  if (!step) throw new Error("verifyTape braucht step aus der engine");

  const game = tapeToGame(tape);
  let guard = 0;
  while (game.phase === "running" && guard++ <= tape.ticks.length + 2) {
    step(game, tapeActions(tape, game));
  }

  const alive = game.cycles.filter((c) => c.alive);
  const winner = alive.length === 1 ? alive[0].name : null;
  const scores = game.cycles.every(
    (c, i) => c.score === tape.result.riders[i].score);
  // Positionen auf den Millimeter: das ist der eigentliche Test, denn
  // hier würde jede Abweichung in der Physik auffallen.
  const places = game.cycles.every((c, i) =>
    Math.abs(c.distance - tape.result.riders[i].distance) < 0.05);

  return {
    ok: game.tick === tape.result.ticks && winner === tape.result.winner
        && scores && places,
    ticks: [tape.result.ticks, game.tick],
    winner: [tape.result.winner, winner],
    scoresMatch: scores,
    distanceMatch: places,
  };
}
