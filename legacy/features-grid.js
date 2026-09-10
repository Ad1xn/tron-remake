/* =========================================================================
   FEATURES — was das Netz SIEHT und wofür es BELOHNT wird.
   =========================================================================
   Das ist die Datei, an der laut Plan 90 % hängen. Der Algorithmus (DQN,
   PPO) sind zwanzig Zeilen aus einer Bibliothek; ob eine KI Tron lernt
   oder im Kreis fährt, entscheidet sich hier.

   DIE WICHTIGSTE REGEL: EINE WAHRHEIT.
   Das Training rechnet in Node direkt auf dem `game`-Objekt (schnell).
   Ein Modell in einem anderen Prozess bekommt `observe()`-JSON über die
   Brücke (makeRemoteAgent). Wären das zwei Kodierungen, würde das Netz
   im Spiel andere Zahlen sehen als beim Lernen — der Klassiker unter den
   stillen Fehlern, der einen Tage kostet.

   Darum gibt es hier den BLICK ("view"): eine dünne Hülle, die beides
   gleich aussehen lässt. Alle Kodierer arbeiten nur auf dem Blick.

       viewOfGame(game, bikeId)   ← im Training, ohne Kopie
       viewOfObs(observe(game,id)) ← am anderen Ende einer Leitung

   Diese Datei kennt weder Browser noch Grafik und läuft auch in Node.
   ========================================================================= */

import { CONFIG } from "./config.js";
import { DIRS, DIR_NAMES, OPPOSITE } from "./engine.js";


/* =========================================================================
   1. DER BLICK
   =========================================================================
   Ein Blick beantwortet drei Fragen: was ist in Kästchen (x,y), liegt da
   ein Punkt, und wo stehe ich mit wem. Kodierung wie in observe():
     0 = frei, 1 = ich (meine Spur), 2 = Wand, Rand oder ein anderer.
   Ausserhalb des Feldes ist immer 2 — dann muss kein Kodierer an den Rand
   denken.
   ========================================================================= */
export function viewOfGame(game, bikeId) {
  const me = game.bikes.find((b) => b.id === bikeId);
  if (!me) throw new Error("viewOfGame: kein Bike mit id " + bikeId);

  return {
    cols: game.cols,
    rows: game.rows,
    tick: game.tick,
    self: { id: me.id, x: me.x, y: me.y, dir: me.dir, score: me.score, alive: me.alive },
    others: game.bikes
      .filter((b) => b.id !== bikeId)
      .map((b) => ({ x: b.x, y: b.y, dir: b.dir, alive: b.alive })),

    at(x, y) {
      if (x < 0 || y < 0 || x >= game.cols || y >= game.rows) return 2;
      const owner = game.occupied[y * game.cols + x];
      return owner === 0 ? 0 : owner === bikeId ? 1 : 2;
    },
    pellet(x, y) {
      if (x < 0 || y < 0 || x >= game.cols || y >= game.rows) return 0;
      return game.pellets[y * game.cols + x];
    },
  };
}

export function viewOfObs(obs) {
  return {
    cols: obs.cols,
    rows: obs.rows,
    tick: obs.tick,
    self: { ...obs.self, alive: true },
    others: obs.others.map((o) => ({ x: o.x, y: o.y, dir: o.dir, alive: o.alive })),

    at(x, y) {
      if (x < 0 || y < 0 || x >= obs.cols || y >= obs.rows) return 2;
      return obs.grid[y * obs.cols + x];
    },
    pellet(x, y) {
      if (x < 0 || y < 0 || x >= obs.cols || y >= obs.rows) return 0;
      return obs.pellets[y * obs.cols + x];
    },
  };
}

const isFreeAt = (view, x, y) => view.at(x, y) === 0;


/* =========================================================================
   2. AKTIONEN — absolut oder relativ
   =========================================================================
   Ein Netz kann "nach links" auf zwei Weisen lernen:

     absolut  ("left")            vier Ausgänge, aber "links" heisst je
                                  nach Fahrtrichtung etwas anderes
     relativ  ("geradeaus/links/  drei Ausgänge, und "links" heisst immer
               rechts")           links — passt zum gedrehten Ausschnitt
                                  unten und lernt deutlich schneller

   Beides steht bereit; die Engine will am Ende immer einen absoluten
   Namen, absOf() rechnet um.
   ========================================================================= */
export const ACTIONS = DIR_NAMES;                       // 4 absolute
export const REL_ACTIONS = ["straight", "left", "right"]; // 3 relative

/* Nach links drehen: up→left→down→right→up. */
const LEFT_OF  = { up: "left", left: "down", down: "right", right: "up" };
const RIGHT_OF = { up: "right", right: "down", down: "left", left: "up" };

export function absOf(dir, rel) {
  if (rel === "left")  return LEFT_OF[dir];
  if (rel === "right") return RIGHT_OF[dir];
  return dir;
}

export function relOf(dir, abs) {
  if (abs === dir) return "straight";
  if (abs === LEFT_OF[dir]) return "left";
  if (abs === RIGHT_OF[dir]) return "right";
  return null;                        // 180°-Wende, gibt es nicht
}

/* Welche Aktionen sind erlaubt? Als 0/1-Maske, damit ein Netz die
   unmöglichen Ausgänge gar nicht erst anbieten muss. Die relative Maske
   ist immer [1,1,1] — der Rückwärtsgang existiert dort nicht, genau das
   ist ihr Vorteil. */
export function legalMask(view) {
  const dir = view.self.dir;
  return Float32Array.from(ACTIONS, (a) => (a === OPPOSITE[dir] ? 0 : 1));
}

/* Und was davon führt nicht sofort in den Tod. Praktisch als Notbremse
   um ein halb gelerntes Netz: erst das Netz fragen, dann diese Maske. */
export function safeMask(view, actions = ACTIONS) {
  const { x, y } = view.self;
  return Float32Array.from(actions, (a) => {
    const abs = actions === REL_ACTIONS ? absOf(view.self.dir, a) : a;
    if (abs === OPPOSITE[view.self.dir]) return 0;
    return isFreeAt(view, x + DIRS[abs].x, y + DIRS[abs].y) ? 1 : 0;
  });
}


/* =========================================================================
   3. FLUTFÜLLUNG auf dem Blick
   =========================================================================
   "Wie viel Welt bleibt mir?" — die entscheidende Zahl in Tron. agents.js
   hat schon eine Flutfüllung, die arbeitet aber direkt auf `game`. Diese
   hier arbeitet auf dem Blick und funktioniert deshalb auch am Ende einer
   Leitung. Puffer werden wiederverwendet, damit pro Tick kein neues Array
   entsteht.
   ========================================================================= */
const buf = { seen: null, queue: null, size: 0, stamp: 0 };

/* Flutfüllung ab EINER ODER MEHREREN Startzellen. Mehrere braucht man
   öfter als man denkt — siehe reachableAround gleich darunter. */
export function reachableFrom(view, starts, cap = Infinity) {
  const size = view.cols * view.rows;
  if (buf.size !== size) {
    buf.seen = new Int32Array(size);
    buf.queue = new Int32Array(size);
    buf.size = size;
    buf.stamp = 0;
  }
  const stamp = ++buf.stamp;

  let head = 0, tail = 0, count = 0;
  for (const s of starts) {
    if (!isFreeAt(view, s.x, s.y)) continue;
    const i = s.y * view.cols + s.x;
    if (buf.seen[i] === stamp) continue;
    buf.seen[i] = stamp;
    buf.queue[tail++] = i;
  }

  while (head < tail && count < cap) {
    const cell = buf.queue[head++];
    const x = cell % view.cols;
    const y = (cell - x) / view.cols;
    count++;

    for (const d of DIR_NAMES) {
      const nx = x + DIRS[d].x, ny = y + DIRS[d].y;
      if (!isFreeAt(view, nx, ny)) continue;
      const ni = ny * view.cols + nx;
      if (buf.seen[ni] === stamp) continue;
      buf.seen[ni] = stamp;
      buf.queue[tail++] = ni;
    }
  }
  return count;
}

/* Ab einem Kästchen. */
export function reachable(view, startX, startY, cap = Infinity) {
  return reachableFrom(view, [{ x: startX, y: startY }], cap);
}

/* WIE VIEL WELT BLEIBT DIESEM BIKE — die Zahl, um die es in Tron geht.
   ACHTUNG, hier steckt eine Falle, in die ich selbst gelaufen bin: das
   Kästchen, auf dem ein Bike STEHT, ist von ihm selbst belegt. Eine
   Flutfüllung, die dort startet, gibt darum immer 0 zurück, und jede
   Kennzahl darüber ist stumm. Also ab den freien NACHBARN füllen.
   (Genau dieser Fehler steckt auch im aggressor in agents.js — dort
   ist "Platz des Gegners" deshalb immer 0.) */
export function reachableAround(view, x, y, cap = Infinity) {
  return reachableFrom(view, DIR_NAMES.map((d) => ({
    x: x + DIRS[d].x, y: y + DIRS[d].y,
  })), cap);
}

/* Mein Raum gegen den des besten Gegners, als Anteil 0…1.
   0,5 = Gleichstand, > 0,5 = ich habe mehr. */
export function spaceShare(view) {
  const mine = reachableAround(view, view.self.x, view.self.y);
  let best = 0;
  for (const o of view.others) {
    if (!o.alive) continue;
    best = Math.max(best, reachableAround(view, o.x, o.y));
  }
  return { mine, best, share: mine + best > 0 ? mine / (mine + best) : 0.5 };
}

/* Wie weit ist es in dieser Richtung frei? */
export function freeAheadIn(view, dirName, limit = 24) {
  const d = DIRS[dirName];
  let x = view.self.x, y = view.self.y, n = 0;
  for (let i = 0; i < limit; i++) {
    x += d.x; y += d.y;
    if (!isFreeAt(view, x, y)) break;
    n++;
  }
  return n;
}


/* =========================================================================
   4. SENSOREN — die kleine Eingabe (16 Zahlen)
   =========================================================================
   Damit fängt man an: trainiert in Minuten, man versteht jede Zahl, und
   man sieht sofort, ob der Rest der Maschinerie läuft. Alles ist auf
   0…1 bzw. -1…1 gebracht — ein Netz mit rohen Kästchen-Zahlen (0…56)
   lernt schlecht.

   Alles ist EGOZENTRISCH: "vorn", "links", "rechts" statt "oben",
   "unten". Damit muss das Netz nicht viermal dasselbe lernen.
   ========================================================================= */
export const SENSOR_NAMES = [
  "frei_vorn", "frei_links", "frei_rechts",
  "raum_vorn", "raum_links", "raum_rechts",
  "raum_anteil",
  "gegner_vorn", "gegner_rechts", "gegner_naehe",
  "punkt_vorn", "punkt_rechts", "punkt_naehe",
  "gegner_leben", "wand_vorn", "zeit",
];

export function encodeSensors(view) {
  const { x, y, dir } = view.self;
  const span = Math.max(view.cols, view.rows);
  const free = countFree(view);

  const dirs = {
    straight: dir,
    left: LEFT_OF[dir],
    right: RIGHT_OF[dir],
  };

  const out = new Float32Array(SENSOR_NAMES.length);
  let k = 0;

  // 0-2: Sichtweite in die drei möglichen Richtungen.
  for (const rel of REL_ACTIONS) out[k++] = freeAheadIn(view, dirs[rel], span) / span;

  // 3-5: und was danach noch erreichbar wäre. DAS ist der Unterschied
  //      zwischen "vor mir ist frei" und "ich sperre mich gerade ein".
  for (const rel of REL_ACTIONS) {
    const d = DIRS[dirs[rel]];
    out[k++] = free ? reachable(view, x + d.x, y + d.y) / free : 0;
  }

  // 6: mein Raum gegen den besten Gegner. 0,5 = Gleichstand, >0,5 = ich
  //    habe mehr. Der Kern jeder Einkesselung.
  out[k++] = spaceShare(view).share;

  // 7-9: der nächste lebende Gegner, in MEINEM Koordinatensystem.
  const near = nearestOther(view);
  if (near) {
    const rel = toEgo(view, near.x - x, near.y - y);
    const dist = Math.abs(near.x - x) + Math.abs(near.y - y);
    out[k++] = rel.forward / span;
    out[k++] = rel.right / span;
    out[k++] = 1 - Math.min(dist / span, 1);
  } else { k += 3; }

  // 10-12: der nächste Punkt, ebenso. Der Hybrid schenkt dem Netz damit
  //        ein dichtes Ziel — es muss nicht bis zum Rundenende warten,
  //        um zu erfahren, ob etwas gut war.
  //        Die Punkte liegen dicht (jedes zweite Kästchen), der nächste
  //        ist also fast immer in Reichweite — die NÄHE sagt daher wenig,
  //        die RICHTUNG ist der nützliche Teil. Suchradius klein halten,
  //        sonst kostet es pro Tick unnötig viel.
  const PEL_R = 6;
  const pel = nearestPellet(view, PEL_R);
  if (pel) {
    const rel = toEgo(view, pel.x - x, pel.y - y);
    const dist = Math.abs(pel.x - x) + Math.abs(pel.y - y);
    out[k++] = rel.forward / PEL_R;
    out[k++] = rel.right / PEL_R;
    out[k++] = 1 - Math.min(dist / PEL_R, 1);
  } else { k += 3; }

  // 13-15: wie viele Gegner leben noch, Abstand zur Aussenmauer, Zeit.
  out[k++] = view.others.filter((o) => o.alive).length / 5;
  out[k++] = wallAhead(view) / span;
  out[k++] = Math.min(view.tick / 1000, 1);

  return out;
}

/* Weltkoordinaten → "vorn/rechts" aus Sicht des Bikes. */
function toEgo(view, dx, dy) {
  const d = DIRS[view.self.dir];
  return {
    forward: dx * d.x + dy * d.y,          // Skalarprodukt mit der Fahrtrichtung
    right:  -dx * d.y + dy * d.x,          // und mit der Rechts-Richtung
  };
}

function countFree(view) {
  let n = 0;
  for (let y = 0; y < view.rows; y++) {
    for (let x = 0; x < view.cols; x++) if (view.at(x, y) === 0) n++;
  }
  return n;
}

function nearestOther(view) {
  let best = null, bestD = Infinity;
  for (const o of view.others) {
    if (!o.alive) continue;
    const d = Math.abs(o.x - view.self.x) + Math.abs(o.y - view.self.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/* Nur im Kasten um das Bike suchen — das ganze Feld abzusuchen wäre pro
   Tick unnötig teuer, und ein Punkt am anderen Ende hilft ohnehin nicht. */
function nearestPellet(view, radius) {
  const { x, y } = view.self;
  let best = null, bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (!view.pellet(x + dx, y + dy)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d && d < bestD) { bestD = d; best = { x: x + dx, y: y + dy }; }
    }
  }
  return best;
}

function wallAhead(view) {
  const d = DIRS[view.self.dir];
  return d.x > 0 ? view.cols - 1 - view.self.x
       : d.x < 0 ? view.self.x
       : d.y > 0 ? view.rows - 1 - view.self.y
       :           view.self.y;
}


/* =========================================================================
   5. UMGEBUNG — der gedrehte Ausschnitt (die bessere Eingabe)
   =========================================================================
   Ein Quadrat um das eigene Bike, MITGEDREHT in Fahrtrichtung: oben im
   Bild ist immer "vorn". Dadurch heisst "links" wirklich immer links,
   und das Netz muss die vier Fahrtrichtungen nicht einzeln lernen. Das
   ist der bekannte Trick bei Snake-artigen Spielen.

   Fünf Kanäle, jeder so gross wie der Ausschnitt:
     0 blockiert   Wand, Rand oder irgendeine Spur — der Kanal fürs Überleben
     1 eigene Spur separat, weil man die eigene Wand anders nutzt
     2 fremde Spur
     3 Gegnerkopf  wo er JETZT ist, also wohin er als nächstes kann
     4 Punkt       0,5 normal, 1,0 der grosse

   Ausgabe ist ein flaches Float32Array in der Reihenfolge
   [kanal][zeile][spalte] — so, wie PyTorch ein Bild erwartet.
   ========================================================================= */
export const PATCH_CHANNELS = ["blockiert", "eigen", "fremd", "kopf", "punkt"];
export const PATCH_RADIUS = 7;                       // 7 → 15×15

export function encodePatch(view, radius = PATCH_RADIUS) {
  const side = 2 * radius + 1;
  const plane = side * side;
  const out = new Float32Array(PATCH_CHANNELS.length * plane);

  const { x, y, dir } = view.self;
  const f = DIRS[dir];                                // vorwärts
  const r = { x: -f.y, y: f.x };                      // rechts davon

  const heads = new Set();
  for (const o of view.others) if (o.alive) heads.add(o.x + "," + o.y);

  for (let row = 0; row < side; row++) {
    // Bildzeile 0 ist die vorderste: forward läuft von +radius nach -radius.
    const forward = radius - row;
    for (let col = 0; col < side; col++) {
      const right = col - radius;

      const wx = x + f.x * forward + r.x * right;
      const wy = y + f.y * forward + r.y * right;

      const cell = row * side + col;
      const what = view.at(wx, wy);

      if (what !== 0) out[0 * plane + cell] = 1;      // blockiert
      if (what === 1) out[1 * plane + cell] = 1;      // eigene Spur
      if (what === 2) out[2 * plane + cell] = 1;      // fremd (inkl. Rand)
      if (heads.has(wx + "," + wy)) out[3 * plane + cell] = 1;

      const p = view.pellet(wx, wy);
      if (p) out[4 * plane + cell] = p === 2 ? 1 : 0.5;
    }
  }
  return out;
}

/* Damit man beim Bauen des Netzes nicht rechnen muss. */
export function shapes(radius = PATCH_RADIUS) {
  const side = 2 * radius + 1;
  return {
    sensors: SENSOR_NAMES.length,
    patch: { channels: PATCH_CHANNELS.length, side, total: PATCH_CHANNELS.length * side * side },
    actions: ACTIONS.length,
    relActions: REL_ACTIONS.length,
  };
}


/* =========================================================================
   6. BELOHNUNG
   =========================================================================
   Der zweite Punkt, an dem alles hängt. Nur "Sieg = +1, Niederlage = −1"
   lernt sehr langsam, weil das Signal erst am Ende kommt. Also gibt es
   Zwischenschritte — und weil dieses Tron ein Hybrid mit Punkten ist,
   liegt ein dichtes Signal schon auf dem Boden.

   DIE GEWICHTE SIND DER KNOPF, AN DEM MAN DREHT. Darum stehen sie hier
   an einer Stelle und die Abrechnung kommt aufgeschlüsselt zurück —
   sonst weiss man nie, welcher Teil eine Marotte verursacht hat.

     RAUM     Mehr Raum als der Gegner zu kontrollieren. Das ist die
              Einkesselung, in eine Zahl gegossen (Flutfüllung beider
              Seiten, als Anteil). Der wichtigste Term.
     PUNKT    Pro gefressenem Punkt. Führt am Anfang, weil sofort da.
     LEBEN    Kleiner Bonus pro Tick, damit ein frisches Netz nicht
              absichtlich in die Wand fährt, um es hinter sich zu haben.
     ZEIT     Strafe pro Tick, sonst kreisen beide ewig herum. LEBEN und
              ZEIT ziehen absichtlich gegeneinander: netto bleibt kaum
              etwas übrig, Nichtstun lohnt also nicht — aber Sterben
              lohnt noch weniger.
     TOD      Der Preis fürs Crashen.
     SIEG     Der Preis fürs Gewinnen. Klein halten: wer nur den Sieg
              belohnt, lernt jahrelang nichts.

   ANSCHAUEN STATT RATEN: welcher Term eine Marotte auslöst, sieht man in
   arena.html in drei Sekunden — im Terminal nie.
   ========================================================================= */
export const REWARD = {
  RAUM:  1.0,
  PUNKT: 0.05,
  LEBEN: 0.004,
  ZEIT:  0.002,
  TOD:  -1.0,
  SIEG:  1.0,
};

/* Vor dem step aufnehmen … */
export function rewardSnapshot(view) {
  return {
    share: spaceShare(view).share,
    score: view.self.score,
    alive: view.self.alive !== false,
    others: view.others.filter((o) => o.alive).length,
  };
}

/* … und nach dem step abrechnen. `events` ist das Rückgabeobjekt von
   step(); ohne es wird aus dem Punktestand geschätzt. */
export function reward(before, viewAfter, events = null, weights = REWARD) {
  const after = rewardSnapshot(viewAfter);

  const died = before.alive && !after.alive;
  const won  = after.alive && before.others > 0 && after.others === 0;

  let pellets;
  if (events) {
    const id = viewAfter.self.id;
    pellets = events.eaten.filter((e) => (e.bike ? e.bike.id : e.id) === id).length;
  } else {
    const bonus = won ? CONFIG.SURVIVE_SCORE : 0;
    pellets = Math.max(0, Math.round(
      (after.score - before.score - bonus) / CONFIG.PELLET_SCORE));
  }

  const parts = {
    // Beim Crash sagt der Raum nichts mehr (das Bike steht ja) — dafür
    // ist TOD da. Sonst würde derselbe Zug zweimal bestraft.
    raum:  died ? 0 : weights.RAUM * (after.share - before.share),
    punkt: weights.PUNKT * pellets,
    leben: died ? 0 : weights.LEBEN,
    zeit:  died ? 0 : -weights.ZEIT,
    tod:   died ? weights.TOD : 0,
    sieg:  won ? weights.SIEG : 0,
  };

  let total = 0;
  for (const v of Object.values(parts)) total += v;

  return { total, parts, died, won, pellets };
}
