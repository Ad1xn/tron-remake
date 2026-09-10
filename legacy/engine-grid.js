/* =========================================================================
   ENGINE — die Spielregeln, und nur die.
   =========================================================================
   Diese Datei ist absichtlich "rein": kein document, kein window, keine
   Grafik, kein Zufall ausser dem selbst gesäten. Das hat drei Vorteile:

     1. Sie läuft auch in Node — darum kann tools/selfplay.mjs tausende
        Matches ohne Browser rechnen (Trainingsdaten für eigene KIs).
     2. Gleicher seed + gleiche Aktionen = gleiches Spiel. Reproduzierbar.
     3. Man kann sie testen, ohne etwas zu zeichnen.

   Die Engine ruft NIE selbst einen Agenten auf. Sie bekommt von aussen
   eine Tabelle "welches Bike will wohin" und rechnet einen Schritt.
   Genau deshalb dürfen Agenten langsam oder asynchron sein (lokales
   Modell, Netzwerk, Python-Server …) ohne die Engine zu verkomplizieren.
   ========================================================================= */

import { CONFIG, SPAWNS, fieldFor } from "./config.js";

/* ------------------------------------------------------------------
   RICHTUNGEN
   Eine Richtung ist "wie verändert sich x und y". y geht nach UNTEN,
   darum ist oben y: -1. Nach aussen reden wir aber immer über die
   NAMEN ("up", "left", …) — Strings sind das bequemste Aktionsformat
   für eine KI.
   ------------------------------------------------------------------ */
export const DIRS = {
  up:    { x:  0, y: -1 },
  down:  { x:  0, y:  1 },
  left:  { x: -1, y:  0 },
  right: { x:  1, y:  0 },
};

export const DIR_NAMES = ["up", "down", "left", "right"];

export const OPPOSITE = {
  up: "down", down: "up", left: "right", right: "left",
};

/* Zufall mit Startwert ("mulberry32"). Math.random() kann man nicht
   wiederholen — das hier schon. Für Training unverzichtbar. */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return function random() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/* ------------------------------------------------------------------
   EIN SPIEL ANLEGEN
   ------------------------------------------------------------------ */
export function createGame(options = {}) {
  const riders = options.riders ?? [];

  // Das Feld wächst mit der Spielerzahl (fieldFor in config.js), damit
  // jeder Fahrer gleich viel Fläche hat. cols/rows von aussen schlagen
  // das immer — so kann ein Trainingslauf auch ein winziges Feld nehmen.
  const field = fieldFor(riders.length);
  const cols  = options.cols ?? field.cols;
  const rows  = options.rows ?? field.rows;
  const level = options.level ?? 1;

  const game = {
    cols,
    rows,
    level,
    tick: 0,
    phase: "running",            // "running" | "over"
    rng: makeRng(options.seed ?? 1),
    seed: options.seed ?? 1,

    // Belegte Kästchen: 0 = frei, sonst die id des Bikes. Ein flaches
    // Array statt eines 2D-Arrays — schneller und einfacher zu kopieren.
    occupied: new Int16Array(cols * rows),

    // Punkte auf dem Boden: 0 = keiner, 1 = normal, 2 = grosser.
    pellets: new Uint8Array(cols * rows),

    bikes: [],
  };

  riders.forEach((rider, i) => {
    const spawn = SPAWNS[i % SPAWNS.length];
    const x = Math.round(spawn.fx * (cols - 1));
    const y = Math.round(spawn.fy * (rows - 1));

    game.bikes.push({
      id: i + 1,                 // id > 0, weil 0 im Gitter "frei" heisst
      name: rider.name,
      color: rider.color,
      driver: rider.driver,
      x, y,
      spawnX: x, spawnY: y,
      dir: spawn.dir,            // Richtung als Name
      alive: true,
      score: 0,
      trail: [{ x, y }],         // alle je befahrenen Kästchen, für die Grafik
      deathTick: -1,
    });
  });

  // Startkästchen sofort belegen, sonst fährt man in seinen eigenen
  // Startpunkt zurück.
  for (const b of game.bikes) game.occupied[idx(game, b.x, b.y)] = b.id;

  if (options.pellets !== false) scatterPellets(game);

  return game;
}

/* Punkte im Schachbrett-Abstand auslegen, plus vier grosse in den Ecken
   — das ist die Pac-Man-Anleihe, die dem Punktestand einen Sinn gibt. */
function scatterPellets(game) {
  // Schrittweite 2 auf GERADEN Koordinaten — dadurch liegen Punkte auch
  // auf den Startreihen der Fahrer. Auf den ungeraden Koordinaten wäre
  // genau die Spur, auf der man losfährt, leer, und der Punktestand
  // bliebe die erste Sekunde auf 0 stehen.
  for (let y = 2; y < game.rows - 1; y += 2) {
    for (let x = 2; x < game.cols - 1; x += 2) {
      game.pellets[idx(game, x, y)] = 1;
    }
  }
  const corners = [
    [2, 2], [game.cols - 3, 2], [2, game.rows - 3], [game.cols - 3, game.rows - 3],
  ];
  for (const [x, y] of corners) game.pellets[idx(game, x, y)] = 2;

  // Kein Punkt unter einem Startplatz — den bekäme man ja geschenkt.
  for (const b of game.bikes) game.pellets[idx(game, b.x, b.y)] = 0;
}


/* ------------------------------------------------------------------
   DIE VIER FRAGEN, AUS DENEN TRON BESTEHT
   ------------------------------------------------------------------ */
export function idx(game, x, y) {
  return y * game.cols + x;
}

export function inside(game, x, y) {
  return x >= 0 && x < game.cols && y >= 0 && y < game.rows;
}

export function isFree(game, x, y) {
  return inside(game, x, y) && game.occupied[idx(game, x, y)] === 0;
}

/* Wie viele freie Kästchen liegen ab dem Bike in dieser Richtung? Das
   ist die "Weitsicht" der einfachen Bots. */
export function freeAhead(game, bike, dirName, limit = 12) {
  const dir = DIRS[dirName];
  let count = 0, x = bike.x, y = bike.y;
  for (let step = 0; step < limit; step++) {
    x += dir.x; y += dir.y;
    if (!isFree(game, x, y)) break;
    count++;
  }
  return count;
}


/* ------------------------------------------------------------------
   EIN ZEITSCHRITT — die wichtigste Funktion im ganzen Spiel
   ------------------------------------------------------------------
   actions ist ein Objekt { [bikeId]: "up" | "down" | "left" | "right" }.
   Fehlt ein Bike darin, fährt es geradeaus weiter.

   Zurück kommt ein "events"-Objekt. Die Grafik hört daran, was passiert
   ist (Explosion, Punkt gefressen, Runde vorbei) — sie muss dafür nicht
   den Zustand vergleichen.
   ------------------------------------------------------------------ */
export function step(game, actions = {}) {
  const events = { deaths: [], eaten: [], newTrail: [], finished: false, survivors: [] };
  if (game.phase !== "running") return events;

  const living = game.bikes.filter((b) => b.alive);

  // (a) Wunschrichtung übernehmen — aber keine 180°-Wende, das wäre
  //     sofortiger Selbstmord im eigenen Trail.
  for (const b of living) {
    const want = actions[b.id];
    if (want && DIRS[want] && want !== OPPOSITE[b.dir]) b.dir = want;
  }

  // (b) Erst ALLE Ziele berechnen, dann bewerten. Sonst hätte das Bike,
  //     das zufällig zuerst dran ist, einen Vorteil.
  const moves = living.map((b) => ({
    bike: b,
    x: b.x + DIRS[b.dir].x,
    y: b.y + DIRS[b.dir].y,
  }));

  // (c) Wer stirbt? Zwei Gründe.
  const doomed = new Set();

  //     Grund 1: Wand oder ein Trail (auch der eigene).
  for (const m of moves) {
    if (!isFree(game, m.x, m.y)) doomed.add(m.bike);
  }

  //     Grund 2: Frontal-Crash — zwei wollen ins gleiche Kästchen.
  for (const a of moves) {
    for (const b of moves) {
      if (a !== b && a.x === b.x && a.y === b.y) {
        doomed.add(a.bike);
        doomed.add(b.bike);
      }
    }
  }

  // (d) Ergebnis anwenden.
  for (const m of moves) {
    const b = m.bike;

    if (doomed.has(b)) {
      b.alive = false;
      b.deathTick = game.tick;
      events.deaths.push(b);
      continue;
    }

    b.x = m.x;
    b.y = m.y;

    const i = idx(game, m.x, m.y);
    game.occupied[i] = b.id;
    b.trail.push({ x: m.x, y: m.y });
    events.newTrail.push({ bike: b, x: m.x, y: m.y });

    const pellet = game.pellets[i];
    if (pellet) {
      game.pellets[i] = 0;
      b.score += pellet === 2 ? CONFIG.POWER_SCORE : CONFIG.PELLET_SCORE;
      events.eaten.push({ bike: b, x: m.x, y: m.y, kind: pellet });
    }
  }

  game.tick++;

  // (e) Ist die Runde vorbei? Bei mehreren Fahrern: wenn höchstens einer
  //     lebt. Bei einem einzigen Fahrer (Übungs- oder Trainingslauf):
  //     erst wenn der stirbt.
  const survivors = game.bikes.filter((b) => b.alive);
  const finished = game.bikes.length > 1 ? survivors.length <= 1 : survivors.length === 0;

  if (finished) {
    game.phase = "over";
    events.finished = true;
    events.survivors = survivors;
    for (const b of survivors) b.score += CONFIG.SURVIVE_SCORE;
  }

  return events;
}


/* ------------------------------------------------------------------
   BEOBACHTUNG — was ein Agent zu sehen bekommt
   ------------------------------------------------------------------
   Bewusst reines JSON: so kann genau dieselbe Beobachtung an ein
   lokales Modell, an einen Python-Prozess oder in eine Trainingsdatei
   gehen. Das Gitter ist aus Sicht des Fragenden umgerechnet:
     0 = frei, 1 = ich, 2 = Wand/anderer.
   Damit muss ein Netz keine Spieler-ids lernen und funktioniert
   automatisch mit 2, 3 oder 6 Fahrern.
   ------------------------------------------------------------------ */
export function observe(game, bikeId) {
  const me = game.bikes.find((b) => b.id === bikeId);
  const grid = new Array(game.cols * game.rows);

  for (let i = 0; i < grid.length; i++) {
    const owner = game.occupied[i];
    grid[i] = owner === 0 ? 0 : owner === bikeId ? 1 : 2;
  }

  return {
    cols: game.cols,
    rows: game.rows,
    tick: game.tick,
    grid,
    pellets: Array.from(game.pellets),
    self: { id: me.id, x: me.x, y: me.y, dir: me.dir, score: me.score },
    others: game.bikes
      .filter((b) => b.id !== bikeId)
      .map((b) => ({ id: b.id, x: b.x, y: b.y, dir: b.dir, alive: b.alive })),
    legal: DIR_NAMES.filter((d) => d !== OPPOSITE[me.dir]),
  };
}
