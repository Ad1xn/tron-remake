/* =========================================================================
   AGENTEN — alles, was ein Bike steuern kann, ohne Mensch zu sein.
   =========================================================================
   Ein Agent ist eine Funktion:

       agent(ctx) -> "up" | "down" | "left" | "right"
                  -> oder ein Promise davon

       ctx = { game, bike, rng }

   Zwei Regeln, und daran hängt der ganze Plan mit den eigenen KIs:

     • Der Rückgabewert darf ein Promise sein. Die Spielschleife wartet
       (bis CONFIG.AGENT_BUDGET_MS) auf alle Agenten, bevor sie einen
       Schritt rechnet. Ein Agent darf also ein lokales Modell fragen,
       über HTTP gehen oder in einem Worker rechnen.
     • Ein Agent bekommt nie die Grafik zu sehen, nur den Zustand. Darum
       läuft jeder Agent unverändert auch im Kopf-los-Match in Node
       (tools/selfplay.mjs) — dort entstehen die Trainingsdaten.

   Wer selbst ein Netz trainiert, nimmt observe(game, bike.id) als Eingabe
   und "up"/"down"/"left"/"right" als die vier Ausgabeklassen.
   ========================================================================= */

import {
  DIRS, DIR_NAMES, OPPOSITE, isFree, idx, inside, freeAhead, observe,
} from "./engine.js";
import { CONFIG } from "./config.js";


/* ------------------------------------------------------------------
   WERKZEUGE, die sich alle Agenten teilen
   ------------------------------------------------------------------ */

/* Welche Richtungen sind überhaupt erlaubt (keine 180°-Wende) und führen
   nicht schon im nächsten Kästchen in den Tod? */
export function safeMoves(game, bike) {
  const options = DIR_NAMES.filter((d) => d !== OPPOSITE[bike.dir]);
  const safe = options.filter((d) =>
    isFree(game, bike.x + DIRS[d].x, bike.y + DIRS[d].y));
  // Nichts frei? Dann ist es egal — wir geben die legalen Züge zurück,
  // damit der Aufrufer nie ohne Antwort dasteht.
  return safe.length ? safe : options;
}

/* FLUTFÜLLUNG ("flood fill"): wie viele Kästchen kann ich von hier aus
   überhaupt noch erreichen? Das ist DIE entscheidende Zahl in Tron —
   viel wichtiger als "wie weit sehe ich geradeaus". Wer sich selbst in
   eine kleine Kammer einsperrt, hat verloren, auch wenn direkt vor der
   Nase noch alles frei ist.

   Umgesetzt als Breitensuche mit einem wiederverwendeten Puffer, damit
   pro Tick kein neues Array entsteht (wichtig für schnelle Trainings). */
const scratch = { seen: null, queue: null, stamp: 0, size: 0 };

function prepareScratch(size) {
  if (scratch.size !== size) {
    scratch.seen = new Int32Array(size);
    scratch.queue = new Int32Array(size);
    scratch.size = size;
    scratch.stamp = 0;
  }
  scratch.stamp++;
  return scratch;
}

export function reachableArea(game, startX, startY, cap = Infinity) {
  if (!isFree(game, startX, startY)) return 0;

  const size = game.cols * game.rows;
  const s = prepareScratch(size);
  const { seen, queue, stamp } = s;

  let head = 0, tail = 0, count = 0;
  const start = idx(game, startX, startY);
  queue[tail++] = start;
  seen[start] = stamp;

  while (head < tail && count < cap) {
    const cell = queue[head++];
    count++;
    const cx = cell % game.cols;
    const cy = (cell - cx) / game.cols;

    for (const d of DIR_NAMES) {
      const nx = cx + DIRS[d].x;
      const ny = cy + DIRS[d].y;
      if (!inside(game, nx, ny)) continue;
      const n = idx(game, nx, ny);
      if (seen[n] === stamp) continue;
      if (game.occupied[n] !== 0) continue;
      seen[n] = stamp;
      queue[tail++] = n;
    }
  }
  return count;
}

/* Wie viele Punkte liegen in Reichweite von r Kästchen? Nur Deko für die
   Bewertung — sorgt dafür, dass die Bots die Licht-Punkte einsammeln
   statt sie zu ignorieren. */
function pelletsNear(game, x, y, r = 4) {
  let sum = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!inside(game, x + dx, y + dy)) continue;
      const p = game.pellets[idx(game, x + dx, y + dy)];
      if (p) sum += (p === 2 ? 3 : 1) / (1 + Math.abs(dx) + Math.abs(dy));
    }
  }
  return sum;
}

/* Lebende Gegner, nach Luftlinie sortiert. */
function rivals(game, bike) {
  return game.bikes
    .filter((b) => b.alive && b.id !== bike.id)
    .map((b) => ({ bike: b, dist: Math.abs(b.x - bike.x) + Math.abs(b.y - bike.y) }))
    .sort((a, b) => a.dist - b.dist);
}

/* Droht im nächsten Tick ein Frontal-Crash auf diesem Kästchen? Ein
   Gegner, der direkt daneben steht, könnte genau dort hinfahren — aber
   nur, wenn das für ihn keine 180°-Wende wäre. Genau das prüfen wir:
   welche Richtung müsste er nehmen, und darf er die überhaupt? */
function headOnRisk(game, bike, x, y) {
  for (const b of game.bikes) {
    if (!b.alive || b.id === bike.id) continue;
    if (Math.abs(b.x - x) + Math.abs(b.y - y) !== 1) continue;

    const needed = DIR_NAMES.find((d) => b.x + DIRS[d].x === x && b.y + DIRS[d].y === y);
    if (needed && needed !== OPPOSITE[b.dir]) return true;
  }
  return false;
}


/* ------------------------------------------------------------------
   1. GREEDY — der Bot aus der ersten Version.
   "Wie weit sehe ich in diese Richtung?" Simpel, aber nicht dumm.
   Guter, schlagbarer Sparringspartner.
   ------------------------------------------------------------------ */
function greedy({ game, bike, rng }) {
  let best = bike.dir, bestScore = -1;

  for (const d of safeMoves(game, bike)) {
    let score = freeAhead(game, bike, d);
    if (d === bike.dir) score += 2;         // bleibt gern geradeaus
    score += rng() * 1.5;                   // eine Prise Zufall
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}


/* ------------------------------------------------------------------
   2. SURVIVOR — spielt auf Platz.
   Bewertet jede Richtung mit der Flutfüllung: "wie viel Welt bleibt mir
   danach?" Das ist die klassische, überraschend starke Tron-Strategie.
   ------------------------------------------------------------------ */
function survivor({ game, bike, rng }) {
  let best = bike.dir, bestScore = -Infinity;

  for (const d of safeMoves(game, bike)) {
    const nx = bike.x + DIRS[d].x;
    const ny = bike.y + DIRS[d].y;

    let score = reachableArea(game, nx, ny);
    if (d === bike.dir) score += 1.5;
    score += pelletsNear(game, nx, ny) * 1.2;
    if (headOnRisk(game, bike, nx, ny)) score -= 25;
    score += rng();

    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}


/* ------------------------------------------------------------------
   3. AGGRESSOR — will abschneiden.
   Wie SURVIVOR, aber er zieht vom eigenen Platz den Platz des nächsten
   Gegners ab. Züge, die dem Gegner Raum wegnehmen, gewinnen. Deshalb
   fährt er auf Gegner zu und schneidet Kurven ab.
   ------------------------------------------------------------------ */
function aggressor({ game, bike, rng }) {
  const near = rivals(game, bike)[0];
  let best = bike.dir, bestScore = -Infinity;

  for (const d of safeMoves(game, bike)) {
    const nx = bike.x + DIRS[d].x;
    const ny = bike.y + DIRS[d].y;

    const mine = reachableArea(game, nx, ny);
    let score = mine;

    if (near) {
      // Platz des Gegners — je kleiner, desto besser für mich.
      const theirs = reachableArea(game, near.bike.x, near.bike.y);
      score -= theirs * 0.9;

      // Und: näher ran ist gut, aber nicht in den Frontal-Crash.
      const dist = Math.abs(near.bike.x - nx) + Math.abs(near.bike.y - ny);
      score -= dist * 0.8;
      if (headOnRisk(game, bike, nx, ny)) score -= 40;
    }

    if (mine < 12) score -= 60;              // niemals selbst einmauern
    if (d === bike.dir) score += 1;
    score += rng();

    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}


/* ------------------------------------------------------------------
   4. WANDERER — sammelt Punkte, weicht nur im letzten Moment aus.
   Schwächster Gegner, gut als Trainingsfutter für Runde eins.
   ------------------------------------------------------------------ */
function wanderer({ game, bike, rng }) {
  let best = bike.dir, bestScore = -Infinity;

  for (const d of safeMoves(game, bike)) {
    const nx = bike.x + DIRS[d].x;
    const ny = bike.y + DIRS[d].y;
    let score = pelletsNear(game, nx, ny) * 3 + Math.min(freeAhead(game, bike, d), 4);
    if (d === bike.dir) score += 1;
    score += rng() * 2;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}


/* ------------------------------------------------------------------
   DAS REGISTER
   Namen aus diesem Objekt stehen in CONFIG.ROSTER.
   Ein eigenes trainiertes Netz trägt sich hier mit einer Zeile ein.
   ------------------------------------------------------------------ */
export const AGENTS = { greedy, survivor, aggressor, wanderer };


/* ------------------------------------------------------------------
   BRÜCKE ZU EINER LOKALEN KI
   ------------------------------------------------------------------
   Erwartet einen kleinen Server (Python, Ollama-Wrapper, was auch
   immer), der auf POST eine Antwort { "action": "left" } schickt:

       AGENTS.myNet = makeRemoteAgent("http://localhost:8000/act");

   Antwortet er nicht rechtzeitig, fährt das Bike geradeaus weiter —
   ein hängendes Modell darf das Spiel nicht anhalten.
   ------------------------------------------------------------------ */
export function makeRemoteAgent(url, budgetMs = CONFIG.AGENT_BUDGET_MS) {
  return async function remote({ game, bike }) {
    const body = JSON.stringify(observe(game, bike.id));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
      const data = await res.json();
      return DIRS[data.action] ? data.action : bike.dir;
    } catch {
      return bike.dir;               // Timeout, Server weg, kaputtes JSON
    } finally {
      clearTimeout(timer);
    }
  };
}


/* ------------------------------------------------------------------
   ENTSCHEIDUNGEN EINSAMMELN
   ------------------------------------------------------------------
   Fragt für alle lebenden Bikes den passenden Agenten. Sind alle
   synchron (so wie die vier oben), kommt das Ergebnis SOFORT zurück —
   ohne Promise, ohne verlorenes Bild. Nur wenn wirklich ein langsamer
   Agent mitspielt, wird daraus ein Promise mit Zeitlimit.

   humanActions sind die Tastendrücke, die immer Vorrang haben.
   ------------------------------------------------------------------ */
export function collectActions(game, humanActions = {}, budgetMs = CONFIG.AGENT_BUDGET_MS) {
  const actions = { ...humanActions };
  const pending = [];

  for (const bike of game.bikes) {
    if (!bike.alive) continue;
    if (bike.driver.type !== "agent") continue;

    const agent = bike.driver.fn || AGENTS[bike.driver.agent];
    if (!agent) { actions[bike.id] = bike.dir; continue; }

    let result;
    try {
      result = agent({ game, bike, rng: game.rng });
    } catch (err) {
      console.warn("Agent", bike.name, "hat geworfen:", err);
      result = bike.dir;
    }

    if (result && typeof result.then === "function") {
      pending.push(
        Promise.race([
          result,
          new Promise((r) => setTimeout(() => r(bike.dir), budgetMs)),
        ]).then((dir) => { actions[bike.id] = DIRS[dir] ? dir : bike.dir; })
      );
    } else {
      actions[bike.id] = DIRS[result] ? result : bike.dir;
    }
  }

  if (pending.length === 0) return actions;          // der Normalfall
  return Promise.all(pending).then(() => actions);
}
