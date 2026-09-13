/* =========================================================================
   FEATURES — was ein Netz SIEHT und wofür es BELOHNT wird.
   =========================================================================
   Das ist die Datei, an der am meisten hängt. Der Algorithmus (DQN, PPO)
   sind zwanzig Zeilen aus einer Bibliothek; ob eine KI dieses Spiel
   lernt oder im Kreis fährt, entscheidet sich hier.

   DIE WICHTIGSTE REGEL: EINE WAHRHEIT.
   Das Training rechnet in Node direkt auf dem `game`-Objekt (schnell).
   Ein Modell in einem anderen Prozess bekommt observe()-JSON über die
   Brücke. Wären das zwei Kodierungen, sähe das Netz im Spiel andere
   Zahlen als beim Lernen — der Klassiker unter den stillen Fehlern.

   Darum gibt es hier den BLICK ("view"), der beides gleich aussehen
   lässt. Alle Kodierer arbeiten nur auf dem Blick.

       viewOfGame(game, cycleId)     ← im Training, ohne Kopie
       viewOfObs(observe(game, id))  ← am anderen Ende einer Leitung

   WAS ANDERS IST ALS IM RASTER-TRON
   Es gibt keine Kästchen mehr. Die Währung ist ZEIT (Abstand geteilt
   durch Tempo) und die Wahrnehmung ist ein selbst gerastertes Bild der
   Umgebung — mitgedreht in Fahrtrichtung, damit "links" immer links
   heisst.
   ========================================================================= */

import { RULES } from "./config.js";
import { AXES, turnLeft, turnRight, castRay, look } from "./engine.js";


/* =========================================================================
   1. DER BLICK
   ========================================================================= */
export function viewOfGame(game, cycleId) {
  const me = game.cycles.find((c) => c.id === cycleId);
  if (!me) throw new Error("viewOfGame: kein Bike mit id " + cycleId);

  const l = look(game, me, game.arena);
  const segs = [];
  const push = (s) => {
    if (Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1) < 0.01) return;
    segs.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, cid: s.cid });
  };
  for (const s of game.rim) push(s);
  for (const c of game.cycles) for (const s of c.walls) push(s);

  return blick({
    arena: game.arena, time: game.time,
    self: {
      id: me.id, x: me.x, y: me.y, dir: me.dir, speed: me.speed,
      rubber: me.rubber, brake: me.brake, alive: me.alive,
    },
    others: game.cycles.filter((c) => c.id !== cycleId).map((c) => ({
      x: c.x, y: c.y, dir: c.dir, speed: c.speed, alive: c.alive,
    })),
    walls: segs,
    zone: { active: game.winZone.active, x: game.winZone.x, y: game.winZone.y, r: game.winZone.r },
    rays: { front: l.front.dist, left: l.left.dist, right: l.right.dist },
  });
}

export function viewOfObs(obs) {
  const segs = [];
  for (let i = 0; i + 4 < obs.walls.length; i += 5) {
    segs.push({
      x1: obs.walls[i], y1: obs.walls[i + 1],
      x2: obs.walls[i + 2], y2: obs.walls[i + 3], cid: obs.walls[i + 4],
    });
  }

  return blick({
    arena: obs.arena, time: obs.time,
    self: { ...obs.self, alive: true },
    others: obs.others.map((o) => ({
      // observe() liefert den Gegner egozentrisch — hier zurückrechnen,
      // damit beide Wege dieselbe Welt beschreiben. Auch die
      // Blickrichtung: observe() schickt sie RELATIV zu mir (heading),
      // absolut ist sie (heading + meine Richtung).
      ...worldOf(obs.self, o),
      dir: (o.heading + obs.self.dir) % 4,
      speed: o.speed, alive: o.alive,
    })),
    walls: segs,
    zone: { active: obs.winZone.active, x: obs.winZone.x, y: obs.winZone.y, r: obs.winZone.r },
    rays: { front: obs.front.dist, left: obs.left.dist, right: obs.right.dist },
  });
}

/* Egozentrisch → Welt (Gegenstück zu observe()). */
function worldOf(self, o) {
  const d = AXES[self.dir];
  return {
    x: self.x + d.x * o.forward - d.y * o.right,
    y: self.y + d.y * o.forward + d.x * o.right,
  };
}

/* Gemeinsame Rechenhilfen an den Blick hängen. */
function blick(v) {
  const d = AXES[v.self.dir];
  v.ego = (dx, dy) => ({
    forward: dx * d.x + dy * d.y,
    right: -dx * d.y + dy * d.x,
  });
  v.zoneDist = () =>
    Math.hypot(v.self.x - v.zone.x, v.self.y - v.zone.y) - v.zone.r;
  return v;
}


/* =========================================================================
   2. AKTIONEN
   =========================================================================
   Drei Ausgänge, nicht vier: geradeaus, links, rechts. Ein Rückwärtsgang
   existiert nicht, und relativ zu lernen ist einfacher, weil "links"
   immer dasselbe bedeutet — genau wie beim gedrehten Bild unten.
   Die Bremse ist ein vierter, unabhängiger Ausgang (0/1).
   ========================================================================= */
export const ACTIONS = ["straight", "left", "right"];
export const actionOf = (i) => ({ turn: i === 1 ? 1 : i === 2 ? -1 : 0, brake: false });
export const indexOf = (turn) => (turn > 0 ? 1 : turn < 0 ? 2 : 0);

/* Was führt nicht sofort in den Tod? Als 0/1-Maske — praktisch als
   Notbremse um ein halb gelerntes Netz. "Sofort" heisst hier: innerhalb
   der Zeit, die das Gummi durchhält. */
export function safeMask(view, horizonSecs = 0.25) {
  const need = Math.max(view.self.speed, 1) * horizonSecs;
  return Float32Array.from([view.rays.front, view.rays.left, view.rays.right],
    (d) => (d > need ? 1 : 0));
}


/* =========================================================================
   3. SENSOREN — die kleine Eingabe (16 Zahlen)
   =========================================================================
   Damit fängt man an: trainiert in Minuten, man versteht jede Zahl.
   Alles ist auf 0…1 bzw. -1…1 gebracht und EGOZENTRISCH.

   Die drei Zeitwerte vorn sind die wichtigsten: bei 30 m/s sind 3 m eine
   Zehntelsekunde, bei 90 m/s ein Drittel davon. Ein Netz, das Meter
   sieht, lernt das Grinden nie.
   ========================================================================= */
export const SENSOR_NAMES = [
  "zeit_vorn", "zeit_links", "zeit_rechts",
  "gummi", "tempo", "bremse",
  "gegner_vorn", "gegner_rechts", "gegner_naehe", "gegner_kurs",
  "zone_naehe", "zone_aktiv",
  "wand_links", "wand_rechts",
  "rand_naehe", "zeit",
];

const T_MAX = 2.0;          // Sekunden, ab da ist "frei" einfach frei
const D_MAX = 12.0;         // Meter für die Wandnähe (Grinden spielt hier)

export function encodeSensors(view) {
  const s = view.self;
  const speed = Math.max(s.speed, 1);
  const A = view.arena;
  const out = new Float32Array(SENSOR_NAMES.length);
  let k = 0;

  const t = (dist) => Math.min(dist / speed, T_MAX) / T_MAX;
  out[k++] = t(view.rays.front);
  out[k++] = t(view.rays.left);
  out[k++] = t(view.rays.right);

  out[k++] = s.rubber / RULES.RUBBER;

  /* Tempo als VIELFACHES des Grundtempos — NICHT gegen SPEED_MAX.
     Gemessen über 270000 Schritte (4 Bots, 12 Seeds): p50 = 30,0 (also
     genau SPEED), p99 = 46,8, hoechster Wert 61,3. SPEED_MAX ist 200,
     weil das Original dort "unbegrenzt" meint — gegen 200 normiert
     laege das ganze Signal zwischen 0,07 und 0,31, und das Netz muesste
     jeden Unterschied aus einem Viertel des Wertebereichs lesen.
     Drei Grundtempi als Vollausschlag: p50 ~ 0,33, in der Messung nie
     gesaettigt. */
  out[k++] = Math.min(s.speed / (RULES.SPEED * 3), 1);

  /* Der Bremsvorrat, 0…1 — BRAKE_MAX. RULES.BRAKE ist die
     Verzoegerung in m/s2 und hat hier nichts zu suchen. */
  out[k++] = s.brake / RULES.BRAKE_MAX;

  const near = nearestOther(view);
  if (near) {
    const rel = view.ego(near.x - s.x, near.y - s.y);
    out[k++] = Math.max(-1, Math.min(1, rel.forward / (A / 2)));
    out[k++] = Math.max(-1, Math.min(1, rel.right / (A / 2)));
    out[k++] = 1 - Math.min(Math.hypot(near.x - s.x, near.y - s.y) / (A / 2), 1);
    out[k++] = ((near.dir - s.dir + 4) % 4) / 3;
  } else { k += 4; }

  const zd = view.zoneDist();
  out[k++] = view.zone.active ? 1 - Math.min(Math.max(zd, 0) / (A / 2), 1) : 0;
  out[k++] = view.zone.active ? 1 : 0;

  // Wie dicht ist die Wand neben mir? Das ist die Grind-Anzeige: nahe 1
  // heisst "ich schrubbe und werde schneller".
  out[k++] = 1 - Math.min(view.rays.left / D_MAX, 1);
  out[k++] = 1 - Math.min(view.rays.right / D_MAX, 1);

  const edge = Math.min(s.x, s.y, A - s.x, A - s.y);
  out[k++] = 1 - Math.min(edge / (A / 4), 1);
  out[k++] = Math.min(view.time / 60, 1);

  return out;
}

function nearestOther(view) {
  let best = null, bestD = Infinity;
  for (const o of view.others) {
    if (!o.alive) continue;
    const d = Math.hypot(o.x - view.self.x, o.y - view.self.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}


/* =========================================================================
   4. DAS BILD — die Umgebung, gerastert und mitgedreht
   =========================================================================
   Die bessere Eingabe. Ein Quadrat um das eigene Bike wird in Zellen
   von CELL Metern eingeteilt, MITGEDREHT in Fahrtrichtung: oben im Bild
   ist immer "vorn".

   Der Trick, warum das billig ist: das Spiel dreht nur um 90°-Schritte.
   Eine achsenparallele Wand bleibt darum auch im gedrehten Bild
   achsenparallel — man muss keine Linien schräg zeichnen, sondern nur
   eine Reihe Zellen füllen.

   Vier Kanäle:
     0 eigene Wand   (kennt man, kann man einplanen)
     1 fremde Wand   (die gefährliche)
     2 Aussenmauer
     3 Todeszone
   ========================================================================= */
export const PATCH_CHANNELS = ["eigen", "fremd", "rand", "zone"];
export const PATCH_N = 24;          // Zellen je Kante (gerade Zahl ist ok)
export const PATCH_CELL = 2.5;      // Meter pro Zelle → 60 m Sichtfeld

export function encodePatch(view, n = PATCH_N, cell = PATCH_CELL) {
  const plane = n * n;
  const out = new Float32Array(PATCH_CHANNELS.length * plane);
  const R = n / 2;
  const s = view.self;

  /* Welt → Bildzelle. forward wächst nach oben (Zeile 0 = am weitesten
     vorn), right nach rechts. */
  const toCell = (x, y) => {
    const e = view.ego(x - s.x, y - s.y);
    return {
      col: Math.round(e.right / cell) + R,
      row: R - Math.round(e.forward / cell),
    };
  };

  const mark = (ch, col, row, v = 1) => {
    if (col < 0 || row < 0 || col >= n || row >= n) return;
    out[ch * plane + row * n + col] = v;
  };

  for (const w of view.walls) {
    const ch = w.cid === 0 ? 2 : w.cid === s.id ? 0 : 1;
    const a = toCell(w.x1, w.y1), b = toCell(w.x2, w.y2);

    // Achsenparallel geblieben → eine der beiden Achsen ist konstant.
    if (a.col === b.col) {
      const lo = Math.min(a.row, b.row), hi = Math.max(a.row, b.row);
      for (let r = Math.max(lo, -1); r <= Math.min(hi, n); r++) mark(ch, a.col, r);
    } else if (a.row === b.row) {
      const lo = Math.min(a.col, b.col), hi = Math.max(a.col, b.col);
      for (let c = Math.max(lo, -1); c <= Math.min(hi, n); c++) mark(ch, c, a.row);
    } else {
      // Kann nur durch Rundung entstehen: beide Enden setzen genügt.
      mark(ch, a.col, a.row); mark(ch, b.col, b.row);
    }
  }

  /* Die Zone als Fläche. Nur wenn sie da ist — sonst 576 Rechnungen für
     nichts. */
  if (view.zone.active && view.zone.r > 0) {
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const f = (R - row) * cell, r = (col - R) * cell;
        const d = AXES[s.dir];
        const wxp = s.x + d.x * f - d.y * r;
        const wyp = s.y + d.y * f + d.x * r;
        if (Math.hypot(wxp - view.zone.x, wyp - view.zone.y) <= view.zone.r) {
          mark(3, col, row);
        }
      }
    }
  }

  return out;
}

/* Wie viel Platz habe ich hier noch? Flutfüllung auf dem GERASTERTEN
   Bild — im echten, stufenlosen Raum gibt es keine Kästchen zum Zählen,
   auf dem Bild schon. Reicht als Maß für "sperre ich mich gerade ein".
   Gibt den Anteil der erreichbaren Zellen zurück (0…1). */
export function localRoom(patch, n = PATCH_N) {
  const plane = n * n;
  const blocked = (i) => patch[i] || patch[plane + i] || patch[2 * plane + i]
    || patch[3 * plane + i];

  const seen = new Uint8Array(plane);
  const queue = new Int32Array(plane);
  const start = (n / 2) * n + n / 2;              // die Bildmitte = ich
  let head = 0, tail = 0, count = 0;
  queue[tail++] = start; seen[start] = 1;

  while (head < tail) {
    const i = queue[head++];
    count++;
    const col = i % n, row = (i - col) / n;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= n || r >= n) continue;
      const j = r * n + c;
      if (seen[j] || blocked(j)) continue;
      seen[j] = 1; queue[tail++] = j;
    }
  }
  return count / plane;
}

export function shapes(n = PATCH_N) {
  return {
    sensors: SENSOR_NAMES.length,
    patch: { channels: PATCH_CHANNELS.length, side: n,
             total: PATCH_CHANNELS.length * n * n, metres: n * PATCH_CELL },
    actions: ACTIONS.length,
  };
}


/* =========================================================================
   5. BELOHNUNG
   =========================================================================
   DIE GEWICHTE SIND DER KNOPF, AN DEM MAN DREHT. Darum stehen sie hier
   an einer Stelle, und die Abrechnung kommt aufgeschlüsselt zurück —
   sonst weiss man nie, welcher Teil eine Marotte verursacht hat.

     RAUM    Mehr Platz um mich als vorher (Flutfüllung auf dem Bild).
             Das ist "sperr dich nicht selbst ein", in eine Zahl gegossen.
     TEMPO   Schneller als die Grundgeschwindigkeit zu sein. Der einzige
             Weg dahin ist, dicht an Wänden zu fahren — man belohnt also
             das Grinden, ohne es dem Netz zu erklären.
     GUMMI   Verbrauchtes Gummi kostet. Nicht viel: drücken DARF sich
             lohnen, es soll nur nicht gratis sein.
     LEBEN   Kleiner Bonus pro Schritt, damit ein frisches Netz nicht in
             die Wand fährt, um es hinter sich zu haben.
     ZEIT    Strafe pro Schritt, sonst kreist es ewig herum. LEBEN und
             ZEIT ziehen absichtlich gegeneinander.
     KILL    Jemand ist an meiner Wand gestorben.
     TOD     Der Preis fürs Sterben.
     SIEG    Der Preis fürs Gewinnen.

   ANSCHAUEN STATT RATEN: welcher Term eine Marotte auslöst, sieht man
   in index.html?replay in drei Sekunden — im Terminal nie.
   ========================================================================= */
export const REWARD = {
  RAUM:  0.6,
  TEMPO: 0.05,
  GUMMI: -0.15,
  LEBEN: 0.004,
  ZEIT:  0.002,
  KILL:  1.0,
  TOD:  -1.0,
  SIEG: 10.0,
};

/* WARUM SIEG SO VIEL GRÖSSER IST ALS DER REST
   =========================================================================
   Mit SIEG 1,0 war diese Formel über den Ausgang einer Runde praktisch
   uninformiert. Gemessen an 24 Matches mit den vier Bots (jeder Satz auf
   DENSELBEN Matches abgerechnet, die Bots hängen ja nicht an der
   Belohnung):

     Hatte der Sieger die höchste Summe?      SIEG 1,0 →  7/24 = 29 %
                                              SIEG 10  → 18/24 = 75 %
     (Zufall wäre 25 %.)

   Noch deutlicher an der Rangfolge. Sortiert man die vier Bots nach
   mittlerem Lohn, ergab SIEG 1,0

       cruiser > grinder > hunter > rookie

   während die tatsächliche Siegreihenfolge

       hunter (13 Siege) > cruiser (7) > grinder (2) > rookie (0)

   ist. Die Belohnung setzte grinder mit 2 Siegen ÜBER hunter mit 13 —
   ein Netz, das sie maximiert, lernt zu grinden, nicht zu gewinnen. Mit
   SIEG 10 stimmen Lohn- und Siegreihenfolge überein.

   Der Grund ist ein Grössenvergleich, den man leicht übersieht: LEBEN
   minus ZEIT ist ein NETTO-Plus von 0,002 pro Agenten-Schritt, bei
   31,25 Hz also 0,0625 pro Sekunde. Eine Runde von 60 s trägt damit
   rund 3,8 ein — bei SIEG 1,0 war Herumfahren fast viermal so viel wert
   wie Gewinnen. LEBEN und ZEIT sollen gegeneinander ziehen, aber sie
   sind kein Ziel, sondern Anschub für ein frisches Netz.

   NOCH OFFEN, bewusst nicht geändert: TEMPO auf 0,025 zu halbieren hebt
   die Trefferquote auf 21/24 = 88 %. Das ist aber kein Fehler mehr,
   sondern eine Entscheidung — TEMPO ist der Term, der das Grinden
   beibringt, und das ist der Kern des Spiels. Wer ihn halbiert, bekommt
   ein braveres Netz.

   UND EINE GRENZE: gemessen ist das gegen vier handgeschriebene Bots.
   Dass die Belohnung deren Können richtig ordnet, heisst nicht, dass ein
   Netz sie nicht doch aushebelt. Darum gibt es index.html?replay.
   ========================================================================= */

/* Vor dem Schritt aufnehmen …

   `mitRaum` kann das teuerste Stück abschalten: der RAUM-Term rastert
   4 × 24 × 24 Zellen, und das kostet mehr als die halbe Rechenzeit
   (gemessen: 35,7 µs je Agentenschritt mit, 13,7 µs ohne — die Physik
   selbst braucht 5,6). Beim Verstärkungslernen wird diese Funktion
   millionenfach gerufen, da lohnt sich die Wahl. Wer sie abschaltet,
   MUSS auch RAUM auf 0 setzen, sonst rechnet reward() mit room = 0 und
   die Differenz ist Unsinn. */
export function rewardSnapshot(view, mitRaum = true) {
  return {
    room: mitRaum ? localRoom(encodePatch(view)) : 0,
    rubberUsedTotal: RULES.RUBBER - view.self.rubber,
    alive: view.self.alive !== false,
    others: view.others.filter((o) => o.alive).length,
    /* Kein kills mehr: viewOfGame() legt das Feld gar nicht an, der Wert
       war immer 0 — und gelesen hat ihn nie jemand. Abschüsse kommen aus
       events.deaths. */
  };
}

/* … und danach abrechnen. `events` ist der Rückgabewert von step(). */
export function reward(before, viewAfter, events = null, cycle = null,
                       weights = REWARD) {
  /* Kostet RAUM nichts, muss auch nichts dafür gerechnet werden. */
  const after = rewardSnapshot(viewAfter, weights.RAUM !== 0);

  const died = before.alive && !after.alive;

  /* GEWONNEN — die Engine fragen, nicht zählen, wer noch lebt.
     "alle anderen sind tot" stimmt nur beim Ausscheiden. Entscheidet die
     Win-Zone, leben noch alle; in lts und fortress gewinnt eine SEITE und
     die Mitspieler leben auch. In beiden Fällen fiel der Siegbonus
     lautlos aus — ein Netz hätte fürs Gewinnen nie etwas bekommen.
     events.survivors ist genau die Menge, die finish() als Sieger
     eingetragen hat, in allen vier Modi. */
  const won = events && events.finished
    ? !!cycle && events.survivors.includes(cycle)
    : after.alive && before.others > 0 && after.others === 0;

  let kills = 0;
  if (events) {
    for (const d of events.deaths) {
      if (d.by === viewAfter.self.id && !d.mutual) kills++;
    }
  }

  const rubberNow = Math.max(0, after.rubberUsedTotal - before.rubberUsedTotal);
  const overSpeed = (viewAfter.self.speed - RULES.SPEED) / RULES.SPEED;

  const parts = {
    raum:  died ? 0 : weights.RAUM * (after.room - before.room),
    tempo: died ? 0 : weights.TEMPO * Math.max(0, overSpeed),
    gummi: weights.GUMMI * rubberNow,
    leben: died ? 0 : weights.LEBEN,
    zeit:  died ? 0 : -weights.ZEIT,
    kill:  weights.KILL * kills,
    tod:   died ? weights.TOD : 0,
    sieg:  won ? weights.SIEG : 0,
  };

  let total = 0;
  for (const v of Object.values(parts)) total += v;
  return { total, parts, died, won, kills };
}
