/* =========================================================================
   AGENTEN — alles, was ein Bike steuern kann, ohne Mensch zu sein.
   =========================================================================
   Ein Agent ist eine Funktion:

       agent(ctx) -> { turn: -1 | 0 | 1, brake: bool }
                  -> oder ein Promise davon

       ctx = { game, cycle, rng }     ← rng gehört DIESEM Fahrer

   Zwei Regeln, und daran hängt der ganze Plan mit den eigenen KIs:

     • Der Rückgabewert darf ein Promise sein. Die Spielschleife wartet
       (bis RULES.AGENT_BUDGET_MS) auf alle Agenten. Ein Agent darf also
       ein lokales Modell fragen, über HTTP gehen oder in einem Worker
       rechnen.
     • Ein Agent bekommt nie die Grafik zu sehen, nur den Zustand. Darum
       läuft jeder Agent unverändert im Kopf-los-Match in Node
       (tools/selfplay.mjs) — dort entstehen die Trainingsdaten.

   WAS SICH GEGENÜBER DEM RASTER-TRON GEÄNDERT HAT
   Flutfüllung ("wie viele Kästchen bleiben mir") gibt es nicht mehr,
   weil es keine Kästchen gibt. Die Währung ist jetzt ZEIT: dist/speed
   sagt, wie viele Sekunden bis zum Einschlag bleiben. Bei 30 m/s sind
   3 m eine Zehntelsekunde — bei 90 m/s ein Drittel davon. Ein Bot, der
   in Metern denkt, stirbt beim Grinden.
   ========================================================================= */

import { AXES, turnLeft, turnRight, castRay, look, observe } from "./engine.js";
import { RULES } from "./config.js";

const STRAIGHT = { turn: 0, brake: false };

/* Muss ich JETZT etwas tun? Gibt eine Aktion zurück oder null.
   Zwei Notfälle, in dieser Reihenfolge: Entgegenkommer, dann Wand.

   Die Zone ist KEIN Notfall mehr. In der ersten Fassung habe ich sie als
   Todeszone gebaut, vor der man wegmuss — im Original ist die Win-Zone
   ein ZIEL: wer hineinfährt, gewinnt. Sie steht deshalb weiter unten
   beim Wollen, nicht hier beim Müssen. */
function emergency(game, c, s, react) {
  const tHead = headOnTime(game, c);
  if (tHead < 0.7) {
    const best = options(game, c, s).find((o) => o.turn !== 0 && o.t > 0.3);
    if (best) return { turn: best.turn, brake: false };
  }

  if (s.tFront < react) {
    const best = options(game, c, s)[0];
    // Bremsen macht die Kurve enger — und im Original kostet eine Kurve
    // Tempo, ein gebremster Bogen ist also kein doppelter Verlust.
    return { turn: best.turn, brake: s.tFront < 0.2 && best.t < 0.6 };
  }
  return null;
}

/* WOLLEN: auf ein Ziel zusteuern, wenn nebenbei Platz ist. Gibt eine
   Aktion zurück oder null. Genau so wird aus "überleben" ein Spiel. */
function steerTo(game, c, s, tx, ty, minRoom = 0.6) {
  const d = AXES[c.dir];
  const dx = tx - c.x, dy = ty - c.y;
  const forward = dx * d.x + dy * d.y;
  const right = -dx * d.y + dy * d.x;

  // Liegt es vor mir und mittig genug? Dann einfach weiterfahren.
  if (forward > 0 && Math.abs(right) < 6) return null;

  const want = right > 0 ? -1 : 1;              // -1 = rechts, 1 = links
  const room = want === 1 ? s.tLeft : s.tRight;
  if (room < minRoom) return null;
  return { turn: want, brake: false };
}


/* ------------------------------------------------------------------
   WERKZEUGE, die sich alle Agenten teilen
   ------------------------------------------------------------------ */

/* Die Lage in Sekunden statt Metern. Das ist die Sicht, in der dieses
   Spiel Sinn ergibt. */
export function situation(game, c) {
  const reach = game.arena;
  const l = look(game, c, reach);
  const tti = (r) => r.dist / Math.max(c.speed, 1);      // time to impact

  return {
    front: l.front, left: l.left, right: l.right,
    tFront: tti(l.front), tLeft: tti(l.left), tRight: tti(l.right),
    rubberSecs: c.rubber / RULES.RUBBER_BURN,
    rubberFrac: c.rubber / RULES.RUBBER,
  };
}

/* Wohin kann ich, ohne sofort zu sterben? Mit Zeitfenster statt
   Abstand, und die Seite mit mehr Luft zuerst. */
export function options(game, c, s = situation(game, c)) {
  return [
    { turn: 0,  t: s.tFront, dist: s.front.dist },
    { turn: 1,  t: s.tLeft,  dist: s.left.dist  },
    { turn: -1, t: s.tRight, dist: s.right.dist },
  ].sort((a, b) => b.t - a.t);
}

/* FRONTALFAHRT — der Anfängerfehler, der zwei Bikes gleichzeitig tötet.
   Wenn einer entgegenkommt (heading 2) und auf meiner Spur liegt, zählt
   nicht sein Abstand, sondern die ZEIT bis wir uns treffen: beide Tempi
   addieren sich. Wer das nicht rechnet, stirbt im Unentschieden. */
export function headOnTime(game, c, rival = nearestRival(game, c)) {
  if (!rival || rival.heading !== 2) return Infinity;
  if (Math.abs(rival.right) > 3) return Infinity;     // nicht auf meiner Spur
  if (rival.forward <= 0) return Infinity;            // hinter mir
  return rival.forward / Math.max(c.speed + rival.cycle.speed, 1);
}

/* ENDSPIEL. Sind nur noch wenige übrig, hört das Kreisen auf: dann
   sucht jeder Bot die Entscheidung. Ohne das passiert in den letzten
   30 Sekunden gar nichts mehr, und die Runde endet an der Win-Zone
   statt an einer Wand — im Original entscheiden dort Fehler von
   Menschen, die meine Bots nicht machen. */
export function endgame(game) {
  const alive = game.cycles.filter((c) => c.alive).length;
  /* Die Schwelle ist gemessen, nicht geraten: bei 0,28 blieben in Last
     Man Standing sechs bis sieben Fahrer übrig, die sich nie trafen —
     7 von 8 Runden entschied dann die Win-Zone. Bei 0,45 fangen sie
     früh genug an, sich zu suchen. */
  return alive > 1 && alive <= Math.max(3, Math.ceil(game.cycles.length * 0.45));
}

/* Der nächste lebende Gegner, egozentrisch (vorn/rechts in Metern). */
export function nearestRival(game, c, enemiesOnly = false) {
  const d = AXES[c.dir];
  let best = null, bestD = Infinity;
  for (const o of game.cycles) {
    if (o.id === c.id || !o.alive) continue;
    if (enemiesOnly && c.team >= 0 && o.team === c.team) continue;
    const dx = o.x - c.x, dy = o.y - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist < bestD) {
      bestD = dist;
      best = {
        cycle: o, dist,
        forward: dx * d.x + dy * d.y,
        right: -dx * d.y + dy * d.x,
        heading: ((o.dir - c.dir) + 4) % 4,      // 0 gleich, 2 entgegen
      };
    }
  }
  return best;
}


/* Wohin will dieser Bot gerade? Das hängt am Modus, und seit es vier
   davon gibt, an den ZONEN statt am Modusnamen:

     eigene Zone, die kippt  → sofort zurück (Sumo: sonst stirbt man)
     eigene Zone, Verteidiger→ in der Nähe bleiben
     fremde Zone             → erobern
     Win-Zone aktiv          → hin, wer zuerst da ist, gewinnt

   Im Sumo besitzt jeder seine eigene Zone und der Verfall ist negativ:
   wer nicht drinsteht, verliert sie von selbst. Darum steht "eigene
   Zone retten" ganz oben. */
export function goal(game, c) {
  const own = game.zones.find((z) => z.team === c.team && !z.conquered);
  const foe = game.zones.find((z) => z.team !== c.team && !z.conquered);

  if (own) {
    const drin = Math.hypot(c.x - own.x, c.y - own.y) < own.r * 0.8;

    /* Kippt sie gerade, oder bin ich draussen und sie verfällt von
       selbst? Dann zurück, egal was sonst ansteht. */
    const kippt = own.conquest > 0.12 || (!drin && game.modeDef.zone.decay < 0);
    if (kippt) return { x: own.x, y: own.y, why: "retten", dringend: true };

    /* Drin und sicher: in der Nähe bleiben, nicht wegfahren. */
    if (game.modeDef.zone.decay < 0) {
      return drin ? null : { x: own.x, y: own.y, why: "halten" };
    }

    // Fortress: die Hälfte der Mannschaft bleibt hinten.
    if (c.id % 2 === 0) return { x: own.x, y: own.y, why: "halten" };
  }

  if (foe) return { x: foe.x, y: foe.y, why: "stürmen" };

  const z = game.winZone;
  if (z.active) return { x: z.x, y: z.y, why: "win-zone" };
  return null;
}


/* ==================================================================
   1. CRUISER — fährt vernünftig und wird alt.
   ==================================================================
   Reagiert auf Zeit, nicht auf Abstand, und biegt zur freieren Seite
   ab. Bremst, wenn es wirklich knapp wird — eine langsamere Kurve ist
   eine engere Kurve.
   ================================================================== */
function cruiser({ game, cycle, rng }) {
  const s = situation(game, cycle);
  const now = emergency(game, cycle, s, 0.40);
  if (now) return now;

  const g = goal(game, cycle);
  if (g) {
    const go = steerTo(game, cycle, s, g.x, g.y, g.dringend ? 0.35 : 0.7);
    if (go && (g.dringend || rng() < 0.5)) return go;
  }

  // Im Endspiel nicht mehr abwarten, sondern den Gegner suchen.
  if (endgame(game)) {
    const rival = nearestRival(game, cycle, true);
    if (rival && rival.dist > 12) {
      const go = steerTo(game, cycle, s, rival.cycle.x, rival.cycle.y, 0.55);
      if (go && rng() < 0.6) return go;
    }
  }

  // Freie Fahrt. Nicht ewig geradeaus — sonst endet jede Runde am Rand.
  if (s.front.rim && s.tFront < 1.2 && rng() < 0.05) return sideTurn(s);
  return STRAIGHT;
}

/* Zur freieren Seite. */
function sideTurn(s) {
  return { turn: s.tLeft >= s.tRight ? 1 : -1, brake: false };
}


/* ==================================================================
   2. GRINDER — holt Tempo an Wänden und lebt vom Gummi.
   ==================================================================
   Das ist die Spielweise, um die es im Original geht: dicht an einer
   Wand entlang beschleunigt man. Also sucht dieser Bot die Nähe einer
   Wand, hält ~1-2 m Abstand und biegt so spät ab, wie das Gummi es
   noch verzeiht. Er fährt schnell und stirbt spektakulär.
   ================================================================== */
function grinder({ game, cycle, rng }) {
  const s = situation(game, cycle);

  // Wie viel Vorwarnung ich mir leiste, hängt am Gummi: voller Vorrat =
  // ich darf spät sein, denn ich kann mich notfalls in die Wand drücken.
  const REACT = 0.16 + 0.24 * (1 - s.rubberFrac);

  const now = emergency(game, cycle, s, REACT);
  if (now) return now;

  /* Grinden: die nähere Seite ist mein Schleifstein. WICHTIG seit der
     Umstellung auf die echten Werte: die AUSSENMAUER schiebt nicht
     (ACCEL_RIM = 0). Am Rand zu kleben bringt also nichts — Tempo gibt
     es nur an Spielerwänden. */
  const nearLeft = s.left.rim ? Infinity : s.left.dist;
  const nearRight = s.right.rim ? Infinity : s.right.dist;
  const near = Math.min(nearLeft, nearRight);
  const toWall = nearLeft < nearRight ? 1 : -1;

  if (near > 6 && s.tFront > 0.8 && rng() < 0.05) {
    return { turn: toWall, brake: false };
  }

  const g = goal(game, cycle);
  if (g && (g.dringend || rng() < 0.3)) {
    const go = steerTo(game, cycle, s, g.x, g.y, g.dringend ? 0.3 : 0.5);
    if (go) return go;
  }

  if (endgame(game)) {
    const rival = nearestRival(game, cycle, true);
    if (rival && rival.dist > 10 && rng() < 0.5) {
      const go = steerTo(game, cycle, s, rival.cycle.x, rival.cycle.y, 0.5);
      if (go) return go;
    }
  }

  return STRAIGHT;
}


/* ==================================================================
   3. HUNTER — schneidet dem Gegner den Weg ab.
   ==================================================================
   Zwei Ideen, mehr braucht es nicht: vor den Gegner ziehen, wenn er
   quer zu mir fährt, und ihm die Seite wegnehmen, wenn er neben mir
   fährt. Überlebt schlechter als der Cruiser, gewinnt aber Duelle.
   ================================================================== */
function hunter({ game, cycle, rng }) {
  const s = situation(game, cycle);
  const now = emergency(game, cycle, s, 0.32);
  if (now) return now;

  const g = goal(game, cycle);
  if (g && (g.dringend || (g.why !== "stürmen" && rng() < 0.4))) {
    const go = steerTo(game, cycle, s, g.x, g.y, g.dringend ? 0.35 : 0.7);
    if (go) return go;
  }

  const rival = nearestRival(game, cycle, true);
  const reach = endgame(game) ? game.arena : game.arena * 0.4;
  if (!rival || rival.dist > reach) return cruiser({ game, cycle, rng });

  // Er fährt quer (heading 1 oder 3): vor ihn ziehen, damit er in meine
  // Wand läuft. Dafür in seine Richtung abbiegen, wenn dort Luft ist.
  if (rival.heading === 1 || rival.heading === 3) {
    const want = rival.right > 0 ? -1 : 1;                 // zu ihm hin
    const room = want === 1 ? s.tLeft : s.tRight;
    if (room > 0.5 && Math.abs(rival.forward) < game.arena * 0.25) {
      return { turn: want, brake: false };
    }
  }

  // Er fährt neben mir in dieselbe Richtung: näher ran, das schiebt uns
  // beide — aber ihn in Bedrängnis.
  if (rival.heading === 0 && Math.abs(rival.right) > 4) {
    const want = rival.right > 0 ? -1 : 1;
    const room = want === 1 ? s.tLeft : s.tRight;
    if (room > 0.8 && rng() < 0.15) return { turn: want, brake: false };
  }

  return STRAIGHT;
}


/* ==================================================================
   4. ROOKIE — Trainingsfutter.
   ==================================================================
   Weicht erst im letzten Moment aus und würfelt dabei. Gut als erster
   Gegner für ein frisches Netz, das noch alles verliert.
   ================================================================== */
function rookie({ game, cycle, rng }) {
  const s = situation(game, cycle);
  const g = goal(game, cycle);
  if (g && g.dringend && s.tFront > 0.3) {
    const go = steerTo(game, cycle, s, g.x, g.y, 0.3);
    if (go) return go;
  }
  if (headOnTime(game, cycle) < 0.35) return { turn: rng() < 0.5 ? 1 : -1, brake: false };
  if (s.tFront < 0.22) {
    return { turn: rng() < 0.5 ? 1 : -1, brake: rng() < 0.3 };
  }
  if (rng() < 0.01) return { turn: rng() < 0.5 ? 1 : -1, brake: false };
  return STRAIGHT;
}


export const AGENTS = { cruiser, grinder, hunter, rookie };


/* ------------------------------------------------------------------
   BRÜCKE ZU EINER LOKALEN KI
   ------------------------------------------------------------------
   Erwartet einen kleinen Server (Python, was auch immer), der auf POST
   eine Antwort { "turn": -1, "brake": false } schickt:

       AGENTS.myNet = makeRemoteAgent("http://localhost:8000/act");

   Antwortet er nicht rechtzeitig, fährt das Bike geradeaus weiter —
   ein hängendes Modell darf das Spiel nicht anhalten.
   ------------------------------------------------------------------ */
export function makeRemoteAgent(url, budgetMs = RULES.AGENT_BUDGET_MS) {
  return async function remote({ game, cycle }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(observe(game, cycle.id)),
        signal: controller.signal,
      });
      const data = await res.json();
      return { turn: Math.sign(data.turn | 0), brake: !!data.brake };
    } catch {
      return STRAIGHT;
    } finally {
      clearTimeout(timer);
    }
  };
}


/* ------------------------------------------------------------------
   ENTSCHEIDUNGEN EINSAMMELN
   ------------------------------------------------------------------
   Die Physik läuft mit 125 Hz — so oft muss niemand denken. Agenten
   werden nur jeden RULES.AGENT_EVERY-ten Schritt gefragt; dazwischen
   bleibt die Bremse, wie sie war, und gelenkt wird nicht. (Eine Kurve
   zweimal zu schicken wäre schlimmer als sie zu verpassen: nach
   TURN_DELAY würde sie ein zweites Mal ausgeführt.)

   humanActions sind die Tastendrücke und haben immer Vorrang.
   ------------------------------------------------------------------ */
export function collectActions(game, humanActions = {}, budgetMs = RULES.AGENT_BUDGET_MS) {
  const actions = { ...humanActions };
  const askNow = game.tick % RULES.AGENT_EVERY === 0;
  const pending = [];

  for (const c of game.cycles) {
    if (!c.alive) continue;
    if (c.driver.type !== "agent") continue;
    if (actions[c.id]) continue;                    // Mensch hat Vorrang

    if (!askNow) {
      actions[c.id] = { turn: 0, brake: !!c.braking };
      continue;
    }

    const agent = c.driver.fn || AGENTS[c.driver.agent];
    if (!agent) { actions[c.id] = STRAIGHT; continue; }

    let result;
    try {
      result = agent({ game, cycle: c, rng: c.rng || game.rng });
    } catch (err) {
      console.warn("Agent", c.name, "hat geworfen:", err);
      result = STRAIGHT;
    }

    if (result && typeof result.then === "function") {
      pending.push(
        Promise.race([
          result,
          new Promise((r) => setTimeout(() => r(STRAIGHT), budgetMs)),
        ]).then((a) => { actions[c.id] = clean(a); })
      );
    } else {
      actions[c.id] = clean(result);
    }
  }

  if (pending.length === 0) return actions;          // der Normalfall
  return Promise.all(pending).then(() => actions);
}

function clean(a) {
  if (!a) return STRAIGHT;
  return { turn: Math.max(-1, Math.min(1, a.turn | 0)), brake: !!a.brake };
}
