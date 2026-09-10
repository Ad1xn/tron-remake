/* =========================================================================
   ENGINE — die Spielregeln, und nur die.
   =========================================================================
   Durchgehende Bewegung statt Raster. Ein Bike hat eine Kommazahl als
   Position, fährt entlang einer von vier Achsen und dreht auf Befehl um
   90°. Seine Wand ist eine Kette dünner Strecken. Kollision heisst
   deshalb "Strahl gegen Strecke", nicht "ist das Kästchen belegt" — und
   genau darum passt ein Bike durch eine schmale Lücke zwischen zwei
   Wänden, wenn es sie trifft.

   Die Datei ist absichtlich "rein": kein document, kein window, keine
   Grafik, kein Zufall ausser dem selbst gesäten. Sie läuft auch in Node,
   damit tools/selfplay.mjs tausende Matches ohne Browser rechnen kann.

   Die Engine ruft NIE selbst einen Agenten auf. Sie bekommt von aussen
   eine Tabelle "wer will drehen und bremsen" und rechnet einen Schritt.

   REPRODUZIERBARKEIT: gleicher seed + gleiche Eingaben = gleiches Spiel,
   solange dieselbe JS-Laufzeit rechnet (Kommazahlen sind nur dort
   bitgenau gleich). Für Replays und Training reicht das.
   ========================================================================= */

import { RULES, SPAWNS, arenaFor } from "./config.js";

/* ------------------------------------------------------------------
   ACHSEN
   Vier Richtungen, als Index 0…3. y zeigt nach UNTEN (wie im Browser).
   Index + 1 ist eine Linkskurve, Index + 3 eine Rechtskurve — daraus
   wird die ganze Lenkung.
   ------------------------------------------------------------------ */
export const AXES = [
  { x:  1, y:  0 },   // 0 rechts
  { x:  0, y: -1 },   // 1 hoch
  { x: -1, y:  0 },   // 2 links
  { x:  0, y:  1 },   // 3 runter
];
export const AXIS_NAMES = ["right", "up", "left", "down"];

export const turnLeft  = (dir) => (dir + 1) % 4;
export const turnRight = (dir) => (dir + 3) % 4;
export const opposite  = (dir) => (dir + 2) % 4;

/* Zufall mit Startwert ("mulberry32"). Math.random() kann man nicht
   wiederholen, das hier schon. */
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

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const EPS = 1e-9;


/* ==================================================================
   EIN SPIEL ANLEGEN
   ================================================================== */
export function createGame(options = {}) {
  const riders = options.riders ?? [];
  const size = options.arena ?? arenaFor(riders.length);

  const game = {
    arena: size,
    time: 0,                       // Sekunden seit Rundenbeginn
    tick: 0,
    dt: RULES.TICK_MS / 1000,
    phase: "running",              // "running" | "over"
    rng: makeRng(options.seed ?? 1),
    seed: options.seed ?? 1,

    /* Die Aussenmauer: vier Strecken. cid 0 heisst "gehört keinem". */
    rim: [
      seg(0, 0, 0, size, 0),
      seg(size, 0, size, size, 0),
      seg(0, 0, size, 0, 0),
      seg(0, size, size, size, 0),
    ],

    /* Die Todeszone. Wächst erst nach ZONE_DELAY, und sitzt leicht
       neben der Mitte (siehe ZONE_JITTER in config.js). */
    zone: { x: size / 2, y: size / 2, r: 0, active: false },

    cycles: [],
  };

  // Zonen-Versatz aus dem gesäten Zufall — vor den Fahrern, damit die
  // Zahlenfolge nicht von der Fahrerzahl abhängt.
  {
    const j = RULES.ZONE_JITTER * size;
    game.zone.x += (game.rng() * 2 - 1) * j;
    game.zone.y += (game.rng() * 2 - 1) * j;
  }

  riders.forEach((rider, i) => {
    const spawn = SPAWNS[i % SPAWNS.length];
    const x = spawn.fx * size;
    const y = spawn.fy * size;

    game.cycles.push({
      id: i + 1,
      name: rider.name,
      color: rider.color,
      driver: rider.driver,

      x, y,
      spawnX: x, spawnY: y,
      dir: spawn.dir,

      speed: RULES.SPEED,
      rubber: RULES.RUBBER,        // voller Vorrat
      rubberUsed: 0,               // fürs HUD: wie viel schon verbraucht
      brake: RULES.BRAKE,
      braking: false,

      alive: true,
      deathTime: -1,
      deathBy: 0,                  // an wessen Wand (0 = Rand/eigene)
      turnAt: -1,                  // wann zuletzt gedreht
      turnSign: 1,
      grindAt: -1,                 // wann zuletzt gedrückt
      turns: 0,
      distance: 0,
      topSpeed: RULES.SPEED,
      score: 0,
      kills: 0,

      /* Eigene Würfel pro Fahrer. Klingt nach Kleinigkeit, ist keine:
         mit EINEM gemeinsamen Zufallsstrom treffen zwei gleiche Bots aus
         spiegelbildlichen Startplätzen exakt spiegelbildliche
         Entscheidungen — und sterben im selben Moment. Jede Runde endet
         dann unentschieden. */
      rng: makeRng((options.seed ?? 1) * 2654435761 + (i + 1) * 40503),

      /* Die eigene Wand: älteste Strecke zuerst, die letzte wächst. */
      walls: [seg(x, y, x, y, i + 1)],
      wallLen: 0,
    });
  });

  return game;
}

/* Eine Strecke. horiz merkt sich die Lage, das spart im Strahltest
   jedes Mal einen Vergleich. */
function seg(x1, y1, x2, y2, cid) {
  return { x1, y1, x2, y2, cid, horiz: Math.abs(y1 - y2) < EPS };
}

const segLen = (s) => Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);


/* ==================================================================
   DER STRAHL — die eine Frage, aus der dieses Tron besteht
   ==================================================================
   "Wie weit komme ich von (x,y) aus in Richtung dir, bevor etwas im
   Weg ist?" Alle Wände liegen auf einer Achse, darum ist der Test
   billig: ein waagerechter Strahl kann nur senkrechte Strecken
   treffen und umgekehrt.

   Was BEWUSST nicht getroffen wird:
     • Strecken parallel zum Strahl. Man fährt an einer Wand entlang,
       nicht in sie hinein — genau das ist Grinden.
     • Treffer bei Abstand ~0. Sonst würde jedes Bike direkt nach einer
       Kurve die eigene Wand treffen, die ja an seinem Kopf beginnt.
   ================================================================== */
export function castRay(game, x, y, dir, maxDist = Infinity, ignoreId = 0) {
  const d = AXES[dir];
  let best = maxDist, bestCid = -1;

  const test = (s) => {
    if (s.cid === ignoreId && s === lastWallOf(game, ignoreId)) return;
    const len = segLen(s);
    if (len < EPS) return;                     // Strecke der Länge 0

    let t;
    if (d.x !== 0) {
      if (s.horiz) return;                     // parallel
      t = (s.x1 - x) * d.x;
      if (t <= EPS || t >= best) return;
      const lo = Math.min(s.y1, s.y2), hi = Math.max(s.y1, s.y2);
      if (y < lo - EPS || y > hi + EPS) return;
    } else {
      if (!s.horiz) return;                    // parallel
      t = (s.y1 - y) * d.y;
      if (t <= EPS || t >= best) return;
      const lo = Math.min(s.x1, s.x2), hi = Math.max(s.x1, s.x2);
      if (x < lo - EPS || x > hi + EPS) return;
    }
    best = t; bestCid = s.cid;
  };

  for (const s of game.rim) test(s);
  for (const c of game.cycles) for (const s of c.walls) test(s);

  return { dist: best, cid: bestCid, own: bestCid === ignoreId };
}

function lastWallOf(game, cid) {
  const c = game.cycles.find((k) => k.id === cid);
  return c ? c.walls[c.walls.length - 1] : null;
}

/* Bequem für Agenten und für die Beschleunigung: was ist links, was
   rechts, was vorn. */
export function look(game, cycle, maxDist = RULES.ACCEL_RANGE * 4) {
  return {
    front: castRay(game, cycle.x, cycle.y, cycle.dir, maxDist, cycle.id),
    left:  castRay(game, cycle.x, cycle.y, turnLeft(cycle.dir), maxDist, cycle.id),
    right: castRay(game, cycle.x, cycle.y, turnRight(cycle.dir), maxDist, cycle.id),
  };
}


/* ==================================================================
   EIN ZEITSCHRITT
   ==================================================================
   actions ist { [cycleId]: { turn: -1|0|1, brake: bool } }
     turn = +1 links, -1 rechts, 0 geradeaus.

   Zurück kommt ein events-Objekt, an dem die Grafik hört, was passiert
   ist — sie muss dafür keine Zustände vergleichen.

   Reihenfolge ist wichtig und absichtlich:
     (a) lenken   (b) Tempo rechnen   (c) fahren, dabei Gummi
     (d) Bikes gegeneinander prüfen   (e) Wände nachziehen   (f) Ende?
   Alle Strahlen sehen den Stand VOM ANFANG des Schritts — sonst hätte
   das Bike, das zufällig zuerst dran ist, einen Vorteil.
   ================================================================== */
export function step(game, actions = {}) {
  const events = {
    deaths: [], turnsMade: [], grinds: [], finished: false, survivors: [],
  };
  if (game.phase !== "running") return events;

  const dt = game.dt;
  const living = game.cycles.filter((c) => c.alive);

  /* --- (a) LENKEN ------------------------------------------------- */
  for (const c of living) {
    const want = actions[c.id] || {};
    c.braking = !!want.brake && c.brake > 0;

    const turn = want.turn | 0;
    if (turn !== 0 && game.time - c.turnAt >= RULES.TURN_DELAY) {
      c.dir = turn > 0 ? turnLeft(c.dir) : turnRight(c.dir);
      c.turnSign = turn > 0 ? 1 : -1;      // nur fürs Kippen in der Grafik
      c.turnAt = game.time;
      c.turns++;
      // Die laufende Wand hier abschliessen und eine neue anfangen.
      c.walls.push(seg(c.x, c.y, c.x, c.y, c.id));
      events.turnsMade.push({ cycle: c, x: c.x, y: c.y, dir: c.dir });
    }
  }

  /* --- (b) TEMPO -------------------------------------------------- */
  for (const c of living) {
    // GRINDEN: eine Wand neben mir schiebt. Je näher, desto mehr — und
    // eine fremde Wand schiebt stärker als die eigene. Das ist der
    // Grund, überhaupt Risiko zu fahren.
    let accel = 0;
    for (const side of [turnLeft(c.dir), turnRight(c.dir)]) {
      const r = castRay(game, c.x, c.y, side, RULES.ACCEL_RANGE, c.id);
      if (r.cid < 0) continue;
      const factor = r.own ? RULES.ACCEL_SELF : RULES.ACCEL_ENEMY;
      accel += factor * RULES.ACCEL_WALL / (r.dist + RULES.ACCEL_OFFSET);
    }

    // Zurück zur Grundgeschwindigkeit, und Bremse.
    accel -= RULES.DECAY * (c.speed - RULES.SPEED);

    if (c.braking) {
      accel -= RULES.BRAKE_FORCE;
      c.brake = Math.max(0, c.brake - RULES.BRAKE_DEPLETE * dt);
    } else {
      c.brake = Math.min(RULES.BRAKE, c.brake + RULES.BRAKE_REFILL * dt);
    }

    c.speed = clamp(c.speed + accel * dt, RULES.SPEED_MIN, RULES.SPEED_MAX);
    if (c.speed > c.topSpeed) c.topSpeed = c.speed;
  }

  /* --- (c) FAHREN, und dabei GUMMI VERBRAUCHEN -------------------- */
  const moves = [];
  for (const c of living) {
    const d = AXES[c.dir];
    const want = c.speed * dt;

    const ray = castRay(game, c.x, c.y, c.dir, want + RULES.SKIN + 1, c.id);
    const room = Math.max(0, ray.dist - RULES.SKIN);
    const go = Math.min(want, room);

    const nx = c.x + d.x * go;
    const ny = c.y + d.y * go;
    moves.push({ c, x0: c.x, y0: c.y, x: nx, y: ny });

    c.distance += go;

    const blocked = want - go;
    if (blocked > EPS) {
      // RUBBER: nicht sofort tot, sondern drücken. Der Verbrauch ist
      // proportional dazu, wie hart man drückt — voll blockiert kostet
      // RUBBER_BURN pro Sekunde, also RUBBER/RUBBER_BURN Sekunden.
      const frac = blocked / want;
      const use = frac * RULES.RUBBER_BURN * dt;
      c.rubber -= use;
      c.rubberUsed += use;
      c.grindAt = game.time;
      c.speed = Math.max(RULES.SPEED_MIN, c.speed - frac * RULES.GRIND_DRAG * dt);
      events.grinds.push({ cycle: c, hard: frac, wallOf: ray.cid });

      if (c.rubber <= 0) die(game, c, ray.cid, events);
    } else if (game.time - c.grindAt > RULES.RUBBER_HOLD) {
      c.rubber = Math.min(RULES.RUBBER,
        c.rubber + (RULES.RUBBER / RULES.RUBBER_TIME) * dt);
    }
  }

  /* --- (d) BIKE GEGEN BIKE ---------------------------------------- */
  // Zwei Bikes, die frontal aufeinander zufahren, treffen NICHT die
  // Wand des anderen (die liegt parallel zur Fahrt). Also getrennt
  // prüfen: kreuzen sich die zwei Wege dieses Schritts?
  for (let i = 0; i < moves.length; i++) {
    for (let j = i + 1; j < moves.length; j++) {
      const a = moves[i], b = moves[j];
      if (!a.c.alive || !b.c.alive) continue;
      if (pathsCross(a, b)) {
        die(game, a.c, b.c.id, events, true);
        die(game, b.c, a.c.id, events, true);
      }
    }
  }

  /* --- (e) WÄNDE NACHZIEHEN --------------------------------------- */
  for (const m of moves) {
    const c = m.c;
    c.x = m.x; c.y = m.y;

    const active = c.walls[c.walls.length - 1];
    active.x2 = c.x; active.y2 = c.y;
    active.horiz = Math.abs(active.y1 - active.y2) < EPS;

    c.wallLen = 0;
    for (const s of c.walls) c.wallLen += segLen(s);
    if (RULES.WALL_LENGTH > 0) trimWall(c);
  }

  /* --- (e2) TODESZONE --------------------------------------------- */
  if (game.time >= RULES.ZONE_DELAY) {
    game.zone.active = true;
    game.zone.r += RULES.ZONE_GROW * dt;
    for (const c of game.cycles) {
      if (!c.alive) continue;
      if (Math.hypot(c.x - game.zone.x, c.y - game.zone.y) <= game.zone.r) {
        die(game, c, -1, events);          // -1 = die Zone, keine Strafe
      }
    }
  }

  game.tick++;
  game.time += dt;

  /* --- (f) RUNDE VORBEI? ------------------------------------------ */
  const survivors = game.cycles.filter((c) => c.alive);
  const finished = game.cycles.length > 1
    ? survivors.length <= 1
    : survivors.length === 0;

  if (finished) {
    game.phase = "over";
    events.finished = true;
    events.survivors = survivors;
    for (const c of survivors) c.score += RULES.SCORE_WIN;
  }

  return events;
}

/* Hinten abschneiden, damit die Wand nicht länger wird als erlaubt.
   Das ist das "die Wand verschwindet wieder" aus dem Original. */
function trimWall(c) {
  let over = c.wallLen - RULES.WALL_LENGTH;
  while (over > 0 && c.walls.length > 1) {
    const s = c.walls[0];
    const len = segLen(s);
    if (len <= over) {
      c.walls.shift();
      c.wallLen -= len;
      over -= len;
    } else {
      // Anfangspunkt nach vorn schieben.
      const ux = Math.sign(s.x2 - s.x1), uy = Math.sign(s.y2 - s.y1);
      s.x1 += ux * over; s.y1 += uy * over;
      c.wallLen -= over;
      over = 0;
    }
  }
}

function die(game, c, byCid, events, mutual = false) {
  if (!c.alive) return;
  c.alive = false;
  c.deathTime = game.time;
  c.deathBy = byCid;
  c.rubber = 0;

  const killer = game.cycles.find((k) => k.id === byCid);
  if (!mutual && killer && killer.id !== c.id) {
    killer.score += RULES.SCORE_KILL;
    killer.kills++;
  } else if (byCid === 0 || (killer && killer.id === c.id)) {
    c.score += RULES.SCORE_SUICIDE;          // Rand oder eigene Wand
  }                                          // byCid -1 (Zone): straffrei

  events.deaths.push({ cycle: c, by: byCid, mutual });
}

/* Kreuzen sich die beiden Strecken, die in diesem Schritt gefahren
   wurden? Beide liegen auf einer Achse, das macht es einfach. */
function pathsCross(a, b) {
  const aH = Math.abs(a.y - a.y0) < EPS;     // waagerecht gefahren
  const bH = Math.abs(b.y - b.y0) < EPS;

  const between = (v, p, q) => v >= Math.min(p, q) - EPS && v <= Math.max(p, q) + EPS;

  if (aH !== bH) {                            // senkrecht zueinander
    const h = aH ? a : b, v = aH ? b : a;
    return between(v.x0, h.x0, h.x) && between(h.y0, v.y0, v.y);
  }

  // Gleiche Achse: nur gefährlich, wenn sie auf derselben Linie liegen
  // und sich die Abschnitte überlappen (Frontalfahrt).
  if (aH) {
    if (Math.abs(a.y0 - b.y0) > RULES.SKIN * 4) return false;
    return Math.min(a.x0, a.x) <= Math.max(b.x0, b.x) + EPS
        && Math.min(b.x0, b.x) <= Math.max(a.x0, a.x) + EPS;
  }
  if (Math.abs(a.x0 - b.x0) > RULES.SKIN * 4) return false;
  return Math.min(a.y0, a.y) <= Math.max(b.y0, b.y) + EPS
      && Math.min(b.y0, b.y) <= Math.max(a.y0, a.y) + EPS;
}


/* ==================================================================
   BEOBACHTUNG — was ein Agent zu sehen bekommt
   ==================================================================
   Bewusst reines JSON und bewusst EGOZENTRISCH: vorn/links/rechts
   statt oben/unten. So kann dieselbe Beobachtung an ein lokales
   Modell, an einen Python-Prozess oder in eine Trainingsdatei gehen,
   und ein Netz muss die vier Fahrtrichtungen nicht einzeln lernen.
   ================================================================== */
export function observe(game, cycleId) {
  const me = game.cycles.find((c) => c.id === cycleId);
  const reach = game.arena;
  const l = look(game, me, reach);

  const d = AXES[me.dir];
  const ego = (dx, dy) => ({
    forward: dx * d.x + dy * d.y,
    right: -dx * d.y + dy * d.x,
  });

  return {
    arena: game.arena,
    time: game.time,
    tick: game.tick,

    self: {
      id: me.id, x: me.x, y: me.y, dir: me.dir,
      speed: me.speed,
      rubber: me.rubber, rubberFrac: me.rubber / RULES.RUBBER,
      brake: me.brake, brakeFrac: me.brake / RULES.BRAKE,
      wallLen: me.wallLen,
    },

    /* Die drei Strahlen: Abstand und ob es die eigene Wand ist. */
    front: { dist: l.front.dist, own: l.front.own, rim: l.front.cid === 0 },
    left:  { dist: l.left.dist,  own: l.left.own,  rim: l.left.cid === 0 },
    right: { dist: l.right.dist, own: l.right.own, rim: l.right.cid === 0 },

    /* Die Zone. Mitte und Radius gehören dazu, nicht nur der Abstand:
       wer ihr ausweichen will, muss wissen, WO sie ist — und ein Netz,
       das die Umgebung rastert, braucht sie als Fläche. */
    zone: {
      active: game.zone.active,
      x: game.zone.x, y: game.zone.y, r: game.zone.r,
      dist: Math.hypot(me.x - game.zone.x, me.y - game.zone.y) - game.zone.r,
    },

    /* ALLE Wände, flach als [x1,y1,x2,y2,cid, …]. cid 0 ist der Rand.
       Flach, weil das JSON sonst dreimal so gross wird — und weil ein
       Netz daraus ohnehin ein Bild rastert (src/features.js). */
    walls: flatWalls(game),

    others: game.cycles.filter((c) => c.id !== cycleId).map((c) => {
      const rel = ego(c.x - me.x, c.y - me.y);
      return {
        id: c.id, alive: c.alive, speed: c.speed,
        forward: rel.forward, right: rel.right,
        dist: Math.hypot(c.x - me.x, c.y - me.y),
        // Fährt er auf mich zu, quer, oder weg?
        heading: ((c.dir - me.dir) + 4) % 4,
      };
    }),
  };
}

export function flatWalls(game) {
  const out = [];
  const push = (s) => {
    if (Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1) < 0.01) return;
    out.push(s.x1, s.y1, s.x2, s.y2, s.cid);
  };
  for (const s of game.rim) push(s);
  for (const c of game.cycles) for (const s of c.walls) push(s);
  return out;
}

/* Wie viele Sekunden hält das Gummi bei diesem Tempo noch, wenn ich
   jetzt voll gegen eine Wand drücke? Die Zahl, die im Original über
   Leben und Tod entscheidet. */
export function rubberSeconds(cycle) {
  return cycle.rubber / RULES.RUBBER_BURN;
}
