/* =========================================================================
   ENGINE — die Spielregeln, und nur die.
   =========================================================================
   Durchgehende Bewegung, keine Kästchen. Ein Bike hat Kommazahlen als
   Position, fährt entlang einer von vier Achsen und dreht auf Befehl um
   90°. Seine Wand ist eine Kette dünner Strecken; Kollision heisst
   "Strahl gegen Strecke". Darum passt ein Bike durch jede Lücke, die es
   wirklich trifft.

   Die Zahlen und Formeln kommen aus dem Quellcode von Armagetron
   Advanced (gCycleMovement.cpp, gWinZone.cpp) — siehe config.js, dort
   steht bei jedem Wert der Originalname.

   Fünf Mechaniken, und alle fünf hängen zusammen:

     GRINDEN   Wandnähe beschleunigt. ZWEI Wände beschleunigen stärker als
               eine: fremde + eigene ist ein "Slingshot", zwei fremde ein
               "Tunnel". Die Aussenmauer schiebt NICHT (ACCEL_RIM = 0).
     TEMPO     Über dem Grundtempo verfällt es kaum (0,1), darunter zieht
               es stark hoch (5). Erarbeitetes Tempo behält man also.
     KURVE     Kostet 5 % Tempo und erhöht den Gummi-Malus.
     GUMMI     Streckenbasiert: verbraucht wird die Strecke, die man nicht
               fahren konnte. Hohes Tempo frisst also mehr. Und das Tempo
               zur Wand ist auf RUBBER_SPEED × Abstand begrenzt — daraus
               kommt das weiche Anschmiegen.
     BREMSE    Verzögerung; der Vorrat ist standardmässig unendlich.

   Diese Datei ist rein: kein document, kein window, keine Grafik, kein
   Zufall ausser dem selbst gesäten. Sie läuft auch in Node.
   ========================================================================= */

import { RULES, MODES, spawnFor, spawnForTeam, arenaFor } from "./config.js";

/* ------------------------------------------------------------------
   ACHSEN — Index + 1 ist eine Linkskurve, + 3 eine Rechtskurve.
   y zeigt nach UNTEN (wie im Browser).
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
  const size = options.arena ?? arenaFor();
  const mode = options.mode ?? RULES.MODE;

  const def = MODES[mode] || MODES.lms;

  const game = {
    arena: size,
    mode,
    modeDef: def,
    /* Die Regeln DIESER Runde: Grundwerte, vom Modus überschrieben.
       Fortress und Sumo fahren eine andere Physik als das Grundspiel —
       mehr Schub an Wänden, mehr Gummi, kleinere Explosionen. */
    rules: { ...RULES, ...(def.rules || {}) },
    time: 0,
    tick: 0,
    dt: RULES.TICK_MS / 1000,
    phase: "running",              // "running" | "over"
    rng: makeRng(options.seed ?? 1),
    seed: options.seed ?? 1,
    winner: null,                  // Bike oder Team-Index
    winnerTeam: -1,
    lastDeath: 0,                  // wann zuletzt jemand gestorben ist —
                                   // die Win-Zone hängt daran

    rim: [
      seg(0, 0, 0, size, 0), seg(size, 0, size, size, 0),
      seg(0, 0, size, 0, 0), seg(0, size, size, size, 0),
    ],

    /* Die WIN-Zone. Sie ist ein PATT-BRECHER, kein Ziel: sie erscheint
       nur, wenn die Runde lange läuft UND eine Weile niemand gestorben
       ist — und im Einzelspieler gar nicht. */
    winZone: { x: size / 2, y: size / 2, r: 0, active: false },

    /* Zonen: je nach Modus keine, eine pro Team oder eine pro Fahrer. */
    zones: [],

    cycles: [],

    /* Gitter-Index für die Strahlen, siehe oben. */
    index: null,
    indexAt: 0,
  };

  {
    const j = (def.winZone.randomness ?? RULES.WIN_ZONE_RANDOMNESS) * size;
    game.winZone.x += (game.rng() * 2 - 1) * j;
    game.winZone.y += (game.rng() * 2 - 1) * j;
  }

  /* Bei Mannschaftsmodi zählt, wer im Team der Wievielte ist — daraus
     wird die Startreihe vor der eigenen Festung. */
  const teamPlay = def.teams !== "solo";
  const teamCount = {};
  const teamSize = {};
  if (teamPlay) {
    riders.forEach((r, i) => {
      const t = r.team ?? (i % 2);
      teamSize[t] = (teamSize[t] || 0) + 1;
    });
  }

  riders.forEach((rider, i) => {
    /* Im Sumo ist jeder seine eigene Mannschaft — so steht es in
       sumo_complete.cfg: team_max_players 1. */
    const team = teamPlay ? (rider.team ?? (i % 2)) : i;
    let spawn = rider.spawn;
    if (!spawn) {
      if (teamPlay) {
        const k = teamCount[team] = (teamCount[team] || 0);
        teamCount[team]++;
        spawn = spawnForTeam(k, teamSize[team], team, size);
      } else {
        spawn = spawnFor(i, riders.length, size);
      }
    }

    game.cycles.push({
      id: i + 1,
      name: rider.name,
      color: rider.color,
      driver: rider.driver,
      team,

      x: spawn.x, y: spawn.y,
      spawnX: spawn.x, spawnY: spawn.y,
      dir: spawn.dir,

      speed: RULES.START_SPEED,
      rubber: game.rules.RUBBER,
      rubberUsed: 0,
      rubberMalus: 0,
      brake: RULES.BRAKE_MAX,
      braking: false,

      alive: true,
      deathTime: -1,
      deathBy: 0,
      turnAt: -1,
      grindAt: -1,
      turnSign: 1,
      turns: 0,
      distance: 0,
      topSpeed: RULES.START_SPEED,
      score: 0,
      kills: 0,

      /* Eigene Würfel pro Fahrer: mit einem gemeinsamen Zufallsstrom
         treffen zwei gleiche Bots aus spiegelbildlichen Startplätzen
         spiegelbildliche Entscheidungen und sterben gleichzeitig. */
      rng: makeRng((options.seed ?? 1) * 2654435761 + (i + 1) * 40503),

      walls: [seg(spawn.x, spawn.y, spawn.x, spawn.y, i + 1)],
      wallLen: 0,
    });
  });

  /* ZONEN. "team" = eine je Mannschaft an gegenüberliegenden Enden,
     "solo" = eine je Fahrer an seinem Startplatz (so ist Sumo gebaut). */
  if (def.zones === "team") {
    const teams = [...new Set(game.cycles.map((c) => c.team))].sort();
    const spots = [
      { x: size * 0.5, y: size * 0.12 }, { x: size * 0.5, y: size * 0.88 },
      { x: size * 0.12, y: size * 0.5 }, { x: size * 0.88, y: size * 0.5 },
    ];
    game.zones = teams.map((t, k) => makeZone(game, t, spots[k % spots.length]));
  } else if (def.zones === "solo") {
    game.zones = game.cycles.map((c) => makeZone(game, c.team, { x: c.x, y: c.y }));
  }

  indexRebuild(game);
  return game;
}

function makeZone(game, team, spot) {
  return {
    team,
    x: spot.x, y: spot.y,
    r: game.modeDef.zone.radius,
    conquest: 0,             // 0 = unberührt, 1 = erobert
    conquered: false,
    collapse: 0,             // zusammenfallende Zone nach der Eroberung
    lastEnemy: -1e9,         // wann zuletzt ein Gegner drin stand
    inside: { attackers: 0, defenders: 0 },
  };
}

function seg(x1, y1, x2, y2, cid) {
  return { x1, y1, x2, y2, cid, horiz: Math.abs(y1 - y2) < EPS, dead: false };
}
const segLen = (s) => Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);


/* ==================================================================
   DER GITTER-INDEX — und warum es ohne ihn ruckelt
   ==================================================================
   Ohne Index prüft jeder Strahl JEDE Wandstrecke im Spiel. Bei 16
   Fahrern sind das nach einer halben Minute ein paar hundert Strecken,
   und pro Schritt werden ~100 Strahlen geworfen: gemessen 1,1 bis
   2,6 ms pro Schritt, also bis zu einem Drittel eines Kerns — in
   Spitzen genau dann, wenn viel gekurvt wird. Das ist das Ruckeln.

   Der Index legt ein grobes Gitter über die Arena und merkt sich pro
   Zelle, welche Strecken sie berühren. Ein Strahl läuft dann nur die
   Zellen ab, die er wirklich kreuzt.

   Zwei Feinheiten, ohne die es falsch wäre:

     • Die LAUFENDE Strecke jedes Bikes wächst jeden Schritt. Sie käme
       im Index sofort aus dem Tritt, also steht sie nicht drin und wird
       direkt geprüft — das sind höchstens 16 Stück.
     • Wird hinten abgeschnitten (endliche Wandlänge), verschwinden
       Strecken. Ein Eintrag im Index würde dann auf eine Wand zeigen,
       die es nicht mehr gibt, und ein Bike an nichts sterben lassen.
       Darum bekommt eine entfernte Strecke dead = true und wird
       übersprungen.
   ================================================================== */
const INDEX_CELL = 12;          // Meter pro Zelle

function makeIndex(arena) {
  const n = Math.max(1, Math.ceil(arena / INDEX_CELL) + 1);
  return { n, cell: INDEX_CELL, buckets: Array.from({ length: n * n }, () => []) };
}

/* Eine Strecke in alle Zellen legen, die sie berührt — mit einer Zelle
   Rand, damit an Zellgrenzen nichts durchfällt. */
function indexAdd(idx, s) {
  const q = (v) => Math.floor(v / idx.cell);
  const cx0 = Math.max(0, q(Math.min(s.x1, s.x2)) - 1);
  const cx1 = Math.min(idx.n - 1, q(Math.max(s.x1, s.x2)) + 1);
  const cy0 = Math.max(0, q(Math.min(s.y1, s.y2)) - 1);
  const cy1 = Math.min(idx.n - 1, q(Math.max(s.y1, s.y2)) + 1);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) idx.buckets[cy * idx.n + cx].push(s);
  }
}

/* Ab und zu komplett neu aufbauen, damit toter Ballast verschwindet. */
function indexRebuild(game) {
  const idx = game.index = makeIndex(game.arena);
  for (const s of game.rim) indexAdd(idx, s);
  for (const c of game.cycles) {
    const lastIdx = c.walls.length - 1;
    c.walls.forEach((s, i) => {
      if (i === lastIdx || s.dead) return;      // laufende Strecke bleibt draussen
      indexAdd(idx, s);
    });
  }
  game.indexAt = game.tick;
}


/* ==================================================================
   DER STRAHL
   ==================================================================
   "Wie weit komme ich von (x,y) in Richtung dir, bevor etwas im Weg
   ist?" Alle Wände liegen auf einer Achse, darum ist der Test billig:
   ein waagerechter Strahl kann nur senkrechte Strecken treffen.

   Was BEWUSST nicht getroffen wird: Strecken parallel zum Strahl (man
   fährt an einer Wand ENTLANG, das ist Grinden) und Treffer bei
   Abstand ~0 (sonst trifft jedes Bike direkt nach einer Kurve die
   eigene Wand, die ja an seinem Kopf beginnt).
   ================================================================== */
export function castRay(game, x, y, dir, maxDist = Infinity, ignoreId = 0) {
  const d = AXES[dir];
  const idx = game.index;
  let best = maxDist, bestCid = -1;
  const skipSeg = ignoreId ? lastWallOf(game, ignoreId) : null;

  /* Der eigentliche Test. Achsenparallel heisst: ein waagerechter
     Strahl kann nur senkrechte Strecken treffen und umgekehrt.

     Was BEWUSST nicht getroffen wird: Strecken parallel zum Strahl (man
     fährt an einer Wand ENTLANG, das ist Grinden) und Treffer bei
     Abstand ~0 (sonst trifft jedes Bike direkt nach einer Kurve die
     eigene Wand, die ja an seinem Kopf beginnt). */
  const test = (s) => {
    if (s === skipSeg || s.dead) return;
    if (segLen(s) < EPS) return;

    let t;
    if (d.x !== 0) {
      if (s.horiz) return;
      t = (s.x1 - x) * d.x;
      if (t <= EPS || t > best) return;
      const lo = Math.min(s.y1, s.y2), hi = Math.max(s.y1, s.y2);
      if (y < lo - EPS || y > hi + EPS) return;
    } else {
      if (!s.horiz) return;
      t = (s.y1 - y) * d.y;
      if (t <= EPS || t > best) return;
      const lo = Math.min(s.x1, s.x2), hi = Math.max(s.x1, s.x2);
      if (x < lo - EPS || x > hi + EPS) return;
    }

    /* Stossen zwei Wände exakt aneinander, trifft der Strahl beide im
       selben Punkt. Dann darf nicht die Reihenfolge entscheiden, wem der
       Abschuss zugeschrieben wird — also gewinnt die kleinere id. Sonst
       liefert dieselbe Lage je nach Suchweg eine andere Antwort. */
    if (t < best || s.cid < bestCid) { best = t; bestCid = s.cid; }
  };

  /* Die laufenden Strecken stehen nicht im Index — höchstens 16 Stück. */
  for (const c of game.cycles) {
    const active = c.walls[c.walls.length - 1];
    if (active) test(active);
  }

  if (!idx) {                                  // ohne Index: alles prüfen
    for (const s of game.rim) test(s);
    for (const c of game.cycles) for (const s of c.walls) test(s);
    return { dist: best, cid: bestCid, own: bestCid === ignoreId };
  }

  /* Und jetzt die Zellen entlang des Strahls, in der Reihenfolge, in der
     er sie kreuzt. Sobald eine Zelle einen Treffer liefert, kann keine
     spätere näher liegen — dann ist Schluss. */
  const n = idx.n, cell = idx.cell;
  const fixed = d.x !== 0
    ? Math.min(n - 1, Math.max(0, Math.floor(y / cell)))
    : Math.min(n - 1, Math.max(0, Math.floor(x / cell)));
  const stepDir = d.x !== 0 ? d.x : d.y;
  let cur = d.x !== 0
    ? Math.min(n - 1, Math.max(0, Math.floor(x / cell)))
    : Math.min(n - 1, Math.max(0, Math.floor(y / cell)));

  const reach = Number.isFinite(maxDist) ? maxDist : game.arena * 2;
  const maxCells = Math.ceil(reach / cell) + 2;

  for (let k = 0; k <= maxCells; k++) {
    if (cur < 0 || cur >= n) break;
    const bucket = d.x !== 0
      ? idx.buckets[fixed * n + cur]
      : idx.buckets[cur * n + fixed];

    const before = best;
    for (let i = 0; i < bucket.length; i++) test(bucket[i]);
    if (best < before) break;                  // Treffer in dieser Zelle

    cur += stepDir;
  }

  return { dist: best, cid: bestCid, own: bestCid === ignoreId };
}

function lastWallOf(game, cid) {
  const c = game.cycles.find((k) => k.id === cid);
  return c ? c.walls[c.walls.length - 1] : null;
}

export function look(game, cycle, maxDist = RULES.ARENA) {
  return {
    front: castRay(game, cycle.x, cycle.y, cycle.dir, maxDist, cycle.id),
    left:  castRay(game, cycle.x, cycle.y, turnLeft(cycle.dir), maxDist, cycle.id),
    right: castRay(game, cycle.x, cycle.y, turnRight(cycle.dir), maxDist, cycle.id),
  };
}


/* ==================================================================
   EIN ZEITSCHRITT
   ==================================================================
   actions ist { [cycleId]: { turn: -1|0|1, brake: bool } }.
   Alle Strahlen sehen den Stand VOM ANFANG des Schritts — sonst hätte
   das Bike, das zufällig zuerst dran ist, einen Vorteil.
   ================================================================== */
export function step(game, actions = {}) {
  const events = {
    deaths: [], turnsMade: [], grinds: [], zone: null,
    finished: false, survivors: [],
  };
  if (game.phase !== "running") return events;

  const dt = game.dt;
  const living = game.cycles.filter((c) => c.alive);

  /* --- (a) LENKEN -------------------------------------------------- */
  for (const c of living) {
    const want = actions[c.id] || {};
    c.braking = !!want.brake && c.brake > 0;

    const turn = want.turn | 0;
    if (turn !== 0 && game.time - c.turnAt >= RULES.TURN_DELAY) {
      c.dir = turn > 0 ? turnLeft(c.dir) : turnRight(c.dir);
      c.turnSign = turn > 0 ? 1 : -1;
      c.turnAt = game.time;
      c.turns++;

      // Eine Kurve kostet Tempo und verschlechtert das Gummi. Beides
      // steht im Original in denselben zwei Zeilen.
      c.speed *= RULES.TURN_SPEED_FACTOR;
      c.rubberMalus += RULES.RUBBER_MALUS_TURN;

      // Die eben beendete Strecke wächst nicht mehr — ab in den Index.
      const closed = c.walls[c.walls.length - 1];
      closed.x2 = c.x; closed.y2 = c.y;
      closed.horiz = Math.abs(closed.y1 - closed.y2) < EPS;
      if (segLen(closed) > EPS) indexAdd(game.index, closed);

      c.walls.push(seg(c.x, c.y, c.x, c.y, c.id));
      events.turnsMade.push({ cycle: c, x: c.x, y: c.y, dir: c.dir });
    }
  }

  /* --- (b) TEMPO --------------------------------------------------- */
  for (const c of living) {
    /* GRINDEN. Pro Seite: ACCEL × Faktor / (Abstand + OFFSET). Und der
       eigentliche Trick des Originals: zwei Wände sind mehr als eine.
         fremd + eigen → Slingshot
         fremd + fremd → Tunnel
       Die Aussenmauer schiebt gar nicht (ACCEL_RIM = 0). */
    let accWall = 0, sides = 0, ownSides = 0;
    for (const side of [turnLeft(c.dir), turnRight(c.dir)]) {
      const r = castRay(game, c.x, c.y, side, RULES.WALL_NEAR, c.id);
      if (r.cid < 0) continue;
      const factor = r.cid === 0 ? RULES.ACCEL_RIM
        : r.own ? RULES.ACCEL_SELF : RULES.ACCEL_ENEMY;
      if (factor <= 0) continue;
      accWall += game.rules.ACCEL * factor / (r.dist + RULES.ACCEL_OFFSET);
      sides++;
      if (r.own) ownSides++;
    }
    if (sides === 2) {
      accWall *= ownSides === 1 ? RULES.ACCEL_SLINGSHOT : RULES.ACCEL_TUNNEL;
    }

    /* Zurück zum Grundtempo — über dem Grundtempo kaum, darunter stark. */
    const diff = RULES.SPEED - c.speed;
    let accel = accWall + diff *
      (c.speed > RULES.SPEED ? RULES.DECAY_ABOVE : RULES.DECAY_BELOW);

    if (c.braking) {
      accel -= RULES.BRAKE;
      if (RULES.BRAKE_DEPLETE > 0) {
        c.brake = Math.max(0, c.brake - RULES.BRAKE_DEPLETE * dt);
      }
    } else if (RULES.BRAKE_REFILL > 0) {
      c.brake = Math.min(RULES.BRAKE_MAX, c.brake + RULES.BRAKE_REFILL * dt);
    }

    c.speed = clamp(c.speed + accel * dt,
      RULES.SPEED * RULES.SPEED_MIN_RATIO, RULES.SPEED_MAX);
    if (c.speed > c.topSpeed) c.topSpeed = c.speed;

    /* Der Gummi-Malus fällt mit der Zeit wieder ab. */
    if (c.rubberMalus > 0) {
      c.rubberMalus = Math.max(0,
        c.rubberMalus - (c.rubberMalus / RULES.RUBBER_MALUS_TIME) * dt);
    }
  }

  /* --- (c) FAHREN, und dabei GUMMI VERBRAUCHEN --------------------- */
  const moves = [];
  for (const c of living) {
    const d = AXES[c.dir];
    const want = c.speed * dt;

    const ray = castRay(game, c.x, c.y, c.dir, want + RULES.SKIN + 2, c.id);
    const gap = Math.max(0, ray.dist - RULES.SKIN);

    /* Anschmiegen: das Tempo zur Wand ist auf RUBBER_SPEED × Abstand
       begrenzt. Nahe an der Wand wird man dadurch immer langsamer,
       statt hart zu stoppen. */
    const go = Math.min(want, gap, RULES.RUBBER_SPEED * gap * dt);

    moves.push({ c, x0: c.x, y0: c.y, x: c.x + d.x * go, y: c.y + d.y * go });
    c.distance += go;

    const blocked = want - go;
    if (blocked > EPS) {
      /* STRECKENBASIERT: verbraucht wird, was man nicht fahren konnte,
         verschlechtert um den Malus. Hohes Tempo kostet damit mehr. */
      const use = blocked * (1 + c.rubberMalus);
      c.rubber -= use;
      c.rubberUsed += use;
      c.grindAt = game.time;
      events.grinds.push({ cycle: c, metres: blocked, wallOf: ray.cid });
      if (c.rubber <= 0) die(game, c, ray.cid, events);
    } else if (game.time - c.grindAt > RULES.RUBBER_HOLD) {
      c.rubber = Math.min(game.rules.RUBBER,
        c.rubber + (game.rules.RUBBER / RULES.RUBBER_TIME) * dt);
    }
  }

  /* --- (d) BIKE GEGEN BIKE ----------------------------------------- */
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

  /* --- (e) WÄNDE NACHZIEHEN ---------------------------------------- */
  for (const m of moves) {
    const c = m.c;
    const grew = Math.abs(m.x - m.x0) + Math.abs(m.y - m.y0);
    c.x = m.x; c.y = m.y;

    /* WER IN DIESEM SCHRITT GESTORBEN IST, BEKOMMT KEINE WAND MEHR.
       Das war ein echter Fehler und im Bild gut zu sehen: stirbt jemand,
       sprengt seine Explosion Löcher in die Wände (blowHoles) — dabei
       kann die gerade wachsende Strecke komplett verschwinden. Danach
       lief hier trotzdem "die letzte Strecke bis zum Bike verlängern",
       und das traf dann eine ALTE, abgeschlossene Strecke und zog sie
       zur Todesstelle. Ergebnis: eine Wand, die weiter geht als der
       Fahrer, der sie gezogen hat — und schräg obendrein, weil dabei
       die falsche Koordinate verschoben wurde. */
    if (!c.alive) continue;

    const active = c.walls[c.walls.length - 1];
    if (!active) continue;
    active.x2 = c.x; active.y2 = c.y;
    active.horiz = Math.abs(active.y1 - active.y2) < EPS;

    // FORTSCHREIBEN, nicht neu summieren: alle Strecken jedes Bikes in
    // jedem Schritt aufzuaddieren war bei 16 Fahrern reine Verschwendung.
    c.wallLen += grew;
    if (game.rules.WALL_LENGTH > 0) trimWall(game, c);
  }

  /* WALLS_STAY_UP_DELAY: die Wände eines Verstorbenen bleiben noch acht
     Sekunden stehen und verschwinden dann KOMPLETT. So öffnet sich die
     Arena im Lauf einer Runde wieder. */
  if (RULES.WALLS_STAY_UP_DELAY >= 0) {
    for (const c of game.cycles) {
      if (c.alive || !c.walls.length) continue;
      if (game.time - c.deathTime < RULES.WALLS_STAY_UP_DELAY) continue;
      for (const w of c.walls) w.dead = true;
      c.walls = [];
      c.wallLen = 0;
      game.indexAt = -999;                  // beim nächsten Mal neu bauen
    }
  }

  /* Etwa einmal pro Sekunde den Index säubern (abgeschnittene Strecken). */
  if (game.tick - game.indexAt > 120) indexRebuild(game);

  game.tick++;
  game.time += dt;

  /* --- (f) ZONEN --------------------------------------------------- */
  if (game.zones.length) updateZones(game, events, dt);
  updateWinZone(game, events, dt);

  /* --- (g) RUNDE VORBEI? ------------------------------------------- */
  if (game.phase === "running") checkEnd(game, events);

  return events;
}


/* ==================================================================
   DIE WIN-ZONE  (Last Man Standing)
   ==================================================================
   Erscheint nach WIN_ZONE_DELAY, wächst mit WIN_ZONE_EXPANSION. Wer
   hineinfährt, GEWINNT die Runde sofort. Das ist der Unterschied zu
   meiner ersten Fassung: sie tötet nicht, sie belohnt. (Im Original
   gibt es dafür den Schalter WIN_ZONE_DEATH.)

   Sie ist der Grund, dass eine Runde überhaupt endet: die Wände
   verschwinden hinten wieder, die Arena füllt sich also nie.
   ================================================================== */
function updateWinZone(game, events, dt) {
  const z = game.winZone;
  const w = game.modeDef.winZone;

  /* ZWEI Bedingungen, so wie in gGame.cpp:
       time > WIN_ZONE_MIN_ROUND_TIME  UND
       time - lastdeath > WIN_ZONE_MIN_LAST_DEATH
     Im Einzelspieler stehen beide auf 1000000 — dort gibt es sie also
     schlicht nicht, und man gewinnt nur, indem man übrig bleibt. */
  if (!z.active) {
    if (!Number.isFinite(w.round) || !Number.isFinite(w.lastDeath)) return;
    if (game.time <= w.round) return;
    if (game.time - game.lastDeath <= w.lastDeath) return;
    z.active = true;
    z.r = w.initial ?? RULES.WIN_ZONE_INITIAL;
  }

  /* Die Ausdehnung darf NEGATIV sein — im Sumo ist sie das: eine riesige
     Zone, die zusammenschrumpft. */
  z.r = Math.max(0, z.r + (w.expansion ?? RULES.WIN_ZONE_EXPANSION) * dt);
  if (z.r <= 0) { z.active = false; return; }

  for (const c of game.cycles) {
    if (!c.alive) continue;
    if (Math.hypot(c.x - z.x, c.y - z.y) > z.r) continue;

    if (RULES.WIN_ZONE_DEATH) {
      die(game, c, -1, events);
    } else {
      events.zone = { type: "win", cycle: c };
      const team = c.team;
      finish(game, events, game.cycles.filter((k) => k.alive && k.team === team), team);
      return;
    }
  }
}


/* ==================================================================
   ZONEN — Fortress UND Sumo, mit derselben Formel
   ==================================================================
   Aus den Kommentaren in settings.cfg ergibt sich eine einzige Zeile:

     erobert += (Gegner × CONQUEST − Besitzer × DEFEND − DECAY) × dt

   Fortress (0,5 / 0,25 / 0,1):
     niemand drin      → −0,1/s, eine angefangene Eroberung verfällt
     ein Gegner drin   → +0,4/s, nach 2,5 s ist die Festung gefallen
     mit Verteidiger   → +0,15/s, man hält also dagegen

   Sumo (0 / 0,6 / −0,3) — dieselbe Formel, andere Vorzeichen:
     niemand drin      → +0,3/s, die Zone EROBERT SICH SELBST
     Besitzer drin     → −0,3/s, sie erholt sich wieder

   Deshalb muss man im Sumo in seiner Zone bleiben. Wird sie erobert,
   stirbt ihr Besitzer (KILL_RATIO 1). Das ist kein Sonderfall im Code,
   sondern dieselben drei Zahlen mit anderem Vorzeichen.

   CONQUEST_TIMEOUT: hatte lange kein Gegner Kontakt mit der Zone, fällt
   sie harmlos zusammen, statt ihren Besitzer zu töten. Sonst würde im
   Sumo jeder sterben, nur weil sonst niemand mehr da ist.
   ================================================================== */
function updateZones(game, events, dt) {
  const z = game.modeDef.zone;
  if (!z) return;

  for (const zone of game.zones) {
    if (zone.conquered) {
      zone.collapse = Math.min(1, zone.collapse + RULES.FORTRESS_COLLAPSE * dt);
      continue;
    }

    let attackers = 0, defenders = 0;
    for (const c of game.cycles) {
      if (!c.alive) continue;
      if (Math.hypot(c.x - zone.x, c.y - zone.y) > zone.r) continue;
      if (c.team === zone.team) defenders++; else attackers++;
    }
    zone.inside = { attackers, defenders };
    if (attackers > 0) zone.lastEnemy = game.time;

    const rate = attackers * z.conquest - defenders * z.defend - z.decay;
    zone.conquest = clamp(zone.conquest + rate * dt, 0, 1);

    if (zone.conquest >= 1) conquerZone(game, zone, events);
  }
}

function conquerZone(game, zone, events) {
  zone.conquered = true;
  const z = game.modeDef.zone;

  /* Harmlos, wenn schon lange kein Gegner mehr Kontakt hatte. */
  const harmless = z.timeout > 0 && game.time - zone.lastEnemy > z.timeout;

  const owners = game.cycles.filter((c) => c.alive && c.team === zone.team);
  const conquerors = game.cycles.filter((c) => c.alive && c.team !== zone.team);

  events.zone = { type: "conquered", team: zone.team, zone, harmless };

  if (!harmless) {
    if (z.conqueredScore && conquerors.length) {
      /* Gerundet. Im Original ist FORTRESS_CONQUERED_SCORE für Sumo
         bewusst 60 — "divisible by 2,3,4,5 and 6 players", steht als
         Kommentar daneben. Bei 7 Eroberern geht es trotzdem nicht auf,
         und ein Punktestand wie 8,285714 sieht albern aus. */
      const each = Math.round(z.conqueredScore / conquerors.length);
      for (const c of conquerors) c.score += each;
    }

    /* Wie viele Besitzer sterben mit der Zone. */
    let kill = Math.max(z.killMin | 0, Math.round(owners.length * (z.killRatio || 0)));
    if (kill > 0) {
      // Die der Zone am nächsten zuerst — so steht es im Original.
      const byDist = [...owners].sort((a, b) =>
        Math.hypot(a.x - zone.x, a.y - zone.y) - Math.hypot(b.x - zone.x, b.y - zone.y));
      for (const c of byDist.slice(0, kill)) die(game, c, -1, events);
    }
  }

  if (z.conqueredWin && conquerors.length) {
    finish(game, events, conquerors, conquerors[0].team);
  }
}

/* Wer hat noch eine Zone, die ihm gehört? FORTRESS_SURVIVE_WIN: die
   letzte Mannschaft mit unerobertem Zuhause gewinnt. */
function zoneTeamsAlive(game) {
  return [...new Set(game.zones.filter((z) => !z.conquered).map((z) => z.team))];
}

/* ==================================================================
   RUNDENENDE
   ================================================================== */
function checkEnd(game, events) {
  const alive = game.cycles.filter((c) => c.alive);
  const z = game.modeDef.zone;

  /* FORTRESS_SURVIVE_WIN: die letzte Mannschaft mit unerobertem Zuhause
     gewinnt — auch wenn noch Gegner leben. */
  if (z && z.surviveWin && game.zones.length) {
    const left = zoneTeamsAlive(game);
    if (left.length === 1) {
      finish(game, events, alive.filter((c) => c.team === left[0]), left[0]);
      return;
    }
    if (left.length === 0) { finish(game, events, [], -1); return; }
  }

  /* Sonst: letzte Mannschaft bzw. letzter Fahrer. Im Alle-gegen-alle ist
     jeder seine eigene Mannschaft, also ist das dieselbe Prüfung. */
  const teams = [...new Set(alive.map((c) => c.team))];
  const soloish = game.modeDef.teams === "solo";

  if (soloish) {
    const finished = game.cycles.length > 1 ? alive.length <= 1 : alive.length === 0;
    if (finished) finish(game, events, alive, alive[0] ? alive[0].team : -1);
    return;
  }

  if (teams.length <= 1) finish(game, events, alive, teams[0] ?? -1);
}

function finish(game, events, survivors, team = -1) {
  game.phase = "over";
  events.finished = true;
  events.survivors = survivors;
  game.winner = survivors.length === 1 ? survivors[0] : null;
  game.winnerTeam = team;

  for (const c of survivors) c.score += game.rules.SCORE_WIN;
}

/* Hinten abschneiden — die Wand ist endlich lang. */
function trimWall(game, c) {
  /* CYCLE_RUBBER_WALL_SHRINK: verbrauchtes Gummi VERKÜRZT die eigene
     Wand. Auf Fortress-Servern steht der Wert auf 1 — wer sich durch
     eine Lücke drückt, verliert also hinten Mauer. */
  const used = game.rules.RUBBER - c.rubber;
  const max = Math.max(20, game.rules.WALL_LENGTH
    - used * (game.rules.RUBBER_WALL_SHRINK || 0));
  let over = c.wallLen - max;
  while (over > 0 && c.walls.length > 1) {
    const s = c.walls[0];
    const len = segLen(s);
    if (len <= over) {
      s.dead = true;              // steht evtl. noch im Index — überspringen
      c.walls.shift(); c.wallLen -= len; over -= len;
    } else {
      const ux = Math.sign(s.x2 - s.x1), uy = Math.sign(s.y2 - s.y1);
      s.x1 += ux * over; s.y1 += uy * over;
      c.wallLen -= over; over = 0;
    }
  }
}

/* ==================================================================
   EXPLOSIONEN SPRENGEN LÖCHER
   ==================================================================
   Aus dem Quellcode: gCycle::explosionRadius = 4.0, "the radius of the
   holes blewn in by an explosion". Stirbt jemand, wird aus jeder Wand
   in diesem Umkreis ein Stück herausgeschnitten — auch aus den eigenen.

   Das ist die Lücke, die man ab und zu in einem Trail aufgehen sieht:
   sie ist nicht zufällig, dort ist jemand gestorben. Und sie ist ein
   echtes Spielelement — durch so ein Loch kann man fahren.

   Weil alle Wände achsenparallel liegen, ist das Ausschneiden einfach:
   aus einer Strecke wird ein Stück entfernt, übrig bleiben null, ein
   oder zwei Reste.
   ================================================================== */
function blowHoles(game, cx, cy, radius, events) {
  let cut = 0;

  for (const c of game.cycles) {
    if (!c.walls.length) continue;
    const activeOld = c.walls[c.walls.length - 1];
    const kept = [];
    let newActive = null;

    for (const w of c.walls) {
      const horiz = w.horiz;
      const perp = horiz ? Math.abs(w.y1 - cy) : Math.abs(w.x1 - cx);

      if (perp >= radius || segLen(w) < EPS) { kept.push(w); continue; }

      // Halbe Sehne des Kreises auf Höhe dieser Strecke.
      const half = Math.sqrt(radius * radius - perp * perp);
      const mid = horiz ? cx : cy;
      const a = horiz ? w.x1 : w.y1;
      const b = horiz ? w.x2 : w.y2;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const cutLo = mid - half, cutHi = mid + half;

      if (cutHi <= lo || cutLo >= hi) { kept.push(w); continue; }
      cut++;

      const piece = (from, to) => {
        if (to - from < 0.05) return null;
        return horiz ? seg(from, w.y1, to, w.y1, w.cid)
                     : seg(w.x1, from, w.x1, to, w.cid);
      };

      const left = cutLo > lo ? piece(lo, cutLo) : null;
      const right = cutHi < hi ? piece(cutHi, hi) : null;
      w.dead = true;                       // der alte Eintrag im Index gilt nicht mehr

      /* Die LAUFENDE Strecke braucht besondere Sorgfalt: ihr Kopf-Ende
         muss das Kopf-Ende bleiben, sonst wächst die Wand plötzlich in
         die falsche Richtung. */
      const headAt = horiz ? w.x2 : w.y2;
      for (const p of [left, right]) {
        if (!p) continue;
        const pLo = horiz ? Math.min(p.x1, p.x2) : Math.min(p.y1, p.y2);
        const pHi = horiz ? Math.max(p.x1, p.x2) : Math.max(p.y1, p.y2);
        const holdsHead = headAt >= pLo - EPS && headAt <= pHi + EPS;

        if (w === activeOld && holdsHead) {
          // Enden so drehen, dass (x2,y2) wieder der Kopf ist.
          if (horiz) { p.x1 = headAt === pHi ? pLo : pHi; p.x2 = headAt; }
          else       { p.y1 = headAt === pHi ? pLo : pHi; p.y2 = headAt; }
          newActive = p;
        } else {
          kept.push(p);
        }
      }
    }

    if (w_hasActive(c, activeOld, kept)) { /* nichts zu tun */ }
    if (newActive) kept.push(newActive);
    else if (c.alive) {
      // Die laufende Strecke wurde ganz weggesprengt: bei null anfangen.
      kept.push(seg(c.x, c.y, c.x, c.y, c.id));
    }

    c.walls = kept;
    c.wallLen = 0;
    for (const w of c.walls) c.wallLen += segLen(w);
  }

  if (cut) {
    indexRebuild(game);
    events.holes = events.holes || [];
    events.holes.push({ x: cx, y: cy, r: radius, cut });
  }
}

/* Steht die alte laufende Strecke noch unverändert in der Liste? */
function w_hasActive(c, activeOld, kept) {
  return kept.length && kept[kept.length - 1] === activeOld;
}

function die(game, c, byCid, events, mutual = false) {
  if (!c.alive) return;
  c.alive = false;
  c.deathTime = game.time;
  game.lastDeath = game.time;
  c.deathBy = byCid;
  c.rubber = 0;

  /* Punkte wie im Original: fürs Abschiessen gibt es NICHTS
     (SCORE_KILL = 0), fürs Sterben Abzug. */
  const killer = game.cycles.find((k) => k.id === byCid);
  if (!mutual && killer && killer.id !== c.id) {
    killer.score += game.rules.SCORE_KILL;
    killer.kills++;
    c.score += game.rules.SCORE_DIE;
  } else if (byCid === 0 || (killer && killer.id === c.id)) {
    c.score += game.rules.SCORE_SUICIDE;
  } else {
    c.score += game.rules.SCORE_DIE;
  }

  events.deaths.push({ cycle: c, by: byCid, mutual });

  // Und jetzt die Löcher.
  if (game.rules.EXPLOSION_RADIUS > 0) {
    blowHoles(game, c.x, c.y, game.rules.EXPLOSION_RADIUS, events);
  }
}

/* Kreuzen sich die beiden Wege dieses Schritts? Zwei Bikes, die frontal
   aufeinander zufahren, treffen NICHT die Wand des anderen — die liegt
   parallel zur Fahrt. Also getrennt prüfen. */
function pathsCross(a, b) {
  const aH = Math.abs(a.y - a.y0) < EPS;
  const bH = Math.abs(b.y - b.y0) < EPS;
  const between = (v, p, q) => v >= Math.min(p, q) - EPS && v <= Math.max(p, q) + EPS;

  if (aH !== bH) {
    const h = aH ? a : b, v = aH ? b : a;
    return between(v.x0, h.x0, h.x) && between(h.y0, v.y0, v.y);
  }
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
   Reines JSON und egozentrisch: vorn/links/rechts statt oben/unten.
   Dieselbe Beobachtung kann an ein lokales Modell, an einen
   Python-Prozess oder in eine Trainingsdatei gehen.
   ================================================================== */
export function observe(game, cycleId) {
  const me = game.cycles.find((c) => c.id === cycleId);
  const l = look(game, me, game.arena);
  const d = AXES[me.dir];
  const ego = (dx, dy) => ({
    forward: dx * d.x + dy * d.y,
    right: -dx * d.y + dy * d.x,
  });

  return {
    arena: game.arena,
    mode: game.mode,
    time: game.time,
    tick: game.tick,

    self: {
      id: me.id, x: me.x, y: me.y, dir: me.dir, team: me.team,
      speed: me.speed,
      rubber: me.rubber, rubberFrac: me.rubber / RULES.RUBBER,
      rubberMalus: me.rubberMalus,
      brake: me.brake, braking: me.braking,
      wallLen: me.wallLen,
    },

    front: { dist: l.front.dist, own: l.front.own, rim: l.front.cid === 0 },
    left:  { dist: l.left.dist,  own: l.left.own,  rim: l.left.cid === 0 },
    right: { dist: l.right.dist, own: l.right.own, rim: l.right.cid === 0 },

    winZone: {
      active: game.winZone.active,
      x: game.winZone.x, y: game.winZone.y, r: game.winZone.r,
      dist: Math.hypot(me.x - game.winZone.x, me.y - game.winZone.y) - game.winZone.r,
    },

    zones: game.zones.map((z) => ({
      team: z.team, x: z.x, y: z.y, r: z.r,
      conquest: z.conquest, mine: z.team === me.team,
      dist: Math.hypot(me.x - z.x, me.y - z.y) - z.r,
    })),

    walls: flatWalls(game),

    others: game.cycles.filter((c) => c.id !== cycleId).map((c) => {
      const rel = ego(c.x - me.x, c.y - me.y);
      return {
        id: c.id, alive: c.alive, speed: c.speed, team: c.team,
        forward: rel.forward, right: rel.right,
        dist: Math.hypot(c.x - me.x, c.y - me.y),
        heading: ((c.dir - me.dir) + 4) % 4,
        rubberFrac: c.rubber / RULES.RUBBER,
      };
    }),
  };
}

export function flatWalls(game) {
  const out = [];
  const push = (s) => {
    if (segLen(s) < 0.01) return;
    out.push(s.x1, s.y1, s.x2, s.y2, s.cid);
  };
  for (const s of game.rim) push(s);
  for (const c of game.cycles) for (const s of c.walls) push(s);
  return out;
}
