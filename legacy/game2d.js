/* =========================================================================
   TRON — Runde 1
   =========================================================================
   Die Idee des Spiels in einem Satz:
   Das Spielfeld ist ein Gitter aus Kästchen. Jedes Bike fährt jeden
   "Tick" (Zeitschritt) ein Kästchen weiter und färbt es ein. Fährt ein
   Bike auf ein bereits gefärbtes Kästchen oder aus dem Feld heraus,
   ist es tot.

   Deshalb ist Tron ein perfektes erstes Spiel: die ganze Physik ist
   "ein Kästchen weiter" und die ganze Kollisionsprüfung ist
   "ist dieses Kästchen schon belegt?".
   ========================================================================= */


/* ------------------------------------------------------------------
   1. KONFIGURATION
   Alle Zahlen, an denen man drehen will, an einer Stelle.
   Spiel damit rum! COLS/ROWS ändern die Feldgrösse, TICK_MS das Tempo.
   ------------------------------------------------------------------ */
const CONFIG = {
  COLS: 48,      // Kästchen waagerecht
  ROWS: 32,      // Kästchen senkrecht
  CELL: 16,      // Wie viele Bildschirm-Pixel ein Kästchen breit ist
  TICK_MS: 90,   // Millisekunden pro Zeitschritt. Kleiner = schneller.
};


/* ------------------------------------------------------------------
   2. RICHTUNGEN
   Eine Richtung ist einfach "wie verändert sich x und y".
   Bildschirm-Koordinaten: x geht nach rechts, y geht nach UNTEN.
   Darum ist "oben" y: -1.
   ------------------------------------------------------------------ */
const DIRS = {
  up:    { x:  0, y: -1 },
  down:  { x:  0, y:  1 },
  left:  { x: -1, y:  0 },
  right: { x:  1, y:  0 },
};


/* ------------------------------------------------------------------
   3. VERBINDUNG ZUM HTML
   document.getElementById holt uns ein Element aus der index.html,
   damit JavaScript es verändern kann.
   ------------------------------------------------------------------ */
const canvas       = document.getElementById("board");
const ctx          = canvas.getContext("2d"); // ctx = unser "Pinsel"
const hudEl        = document.getElementById("hud");
const overlayEl    = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText  = document.getElementById("overlay-text");

// Canvas-Grösse aus der Konfiguration berechnen.
canvas.width  = CONFIG.COLS * CONFIG.CELL;
canvas.height = CONFIG.ROWS * CONFIG.CELL;


/* ------------------------------------------------------------------
   4. DER SPIELZUSTAND (state)
   Alles, was sich während des Spiels ändert, lebt hier drin.
   Wichtiges Prinzip: Zustand und Darstellung trennen.
   Wir rechnen erst alles aus, DANN malen wir es einmal hin.
   ------------------------------------------------------------------ */
let phase = "ready";   // "ready" = warten auf Start, "running", "over"
let bikes = [];        // Die Liste aller Fahrer
let occupied = [];     // Belegte Kästchen: 0 = frei, sonst die id des Bikes


/* Ein Gitter ist eigentlich zweidimensional (Spalte, Zeile), aber wir
   speichern es als EINE lange Liste. Diese Funktion rechnet die
   Koordinaten in die Position in der Liste um. Klassischer Trick. */
function idx(x, y) {
  return y * CONFIG.COLS + x;
}

/* Liegt (x,y) überhaupt noch im Feld? */
function inside(x, y) {
  return x >= 0 && x < CONFIG.COLS && y >= 0 && y < CONFIG.ROWS;
}

/* Ist das Kästchen frei UND im Feld? Das ist die Frage, die das
   ganze Spiel ausmacht — sowohl für dich als auch für die Bots. */
function isFree(x, y) {
  return inside(x, y) && occupied[idx(x, y)] === 0;
}


/* ------------------------------------------------------------------
   5. EINE RUNDE VORBEREITEN
   ------------------------------------------------------------------ */
function resetRound() {
  // Ein frisches, komplett leeres Gitter. fill(0) = alles auf 0 setzen.
  occupied = new Array(CONFIG.COLS * CONFIG.ROWS).fill(0);

  bikes = [
    {
      id: 1,                    // id > 0, weil 0 im Gitter "frei" bedeutet
      name: "DU",
      color: "#22d3ee",         // Cyan
      isBot: false,
      x: 8, y: 16,              // Startposition (Kästchen, nicht Pixel!)
      dir: DIRS.right,          // Fahrtrichtung JETZT
      nextDir: DIRS.right,      // Richtung, die beim nächsten Tick gilt
      alive: true,
    },
    {
      id: 2,
      name: "BOT",
      color: "#fb923c",         // Orange
      isBot: true,
      x: 39, y: 16,
      dir: DIRS.left,
      nextDir: DIRS.left,
      alive: true,
    },
  ];

  // Startkästchen sofort als belegt markieren, sonst könnte man
  // rückwärts in seinen eigenen Startpunkt fahren.
  for (const b of bikes) {
    occupied[idx(b.x, b.y)] = b.id;
  }

  phase = "running";
  hideOverlay();
  updateHud();
}


/* ------------------------------------------------------------------
   6. EINGABE (Tastatur)
   "Event Listener" heisst: Browser, sag mir Bescheid, wenn X passiert.
   ------------------------------------------------------------------ */
const KEY_MAP = {
  ArrowUp: "up",    w: "up",    W: "up",
  ArrowDown: "down", s: "down", S: "down",
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right",
};

window.addEventListener("keydown", (event) => {
  // Leertaste startet bzw. startet neu.
  if (event.key === " ") {
    event.preventDefault();          // verhindert Runterscrollen der Seite
    if (phase !== "running") resetRound();
    return;
  }

  const wanted = KEY_MAP[event.key];
  if (!wanted) return;               // irgendeine andere Taste → ignorieren
  event.preventDefault();

  const player = bikes.find((b) => !b.isBot);
  if (!player || !player.alive) return;

  const dir = DIRS[wanted];

  // 180°-Wende verbieten: sonst fährst du direkt in deinen eigenen
  // Trail und stirbst sofort. Trick: die Gegenrichtung hat genau
  // umgekehrte Vorzeichen.
  if (dir.x === -player.dir.x && dir.y === -player.dir.y) return;

  player.nextDir = dir;
});


/* ------------------------------------------------------------------
   7. DIE BOT-KI
   Absichtlich simpel, aber nicht dumm:
   "Wie viel freier Platz liegt in dieser Richtung vor mir?"
   Der Bot wählt die Richtung mit dem meisten Platz und bleibt
   ansonsten gerne geradeaus.
   ------------------------------------------------------------------ */

/* Zählt, wie viele freie Kästchen ab (x,y) in Richtung dir liegen,
   maximal 'limit' Stück. Das ist die "Weitsicht" des Bots. */
function freeAhead(bike, dir, limit = 10) {
  let count = 0;
  let x = bike.x;
  let y = bike.y;
  for (let step = 0; step < limit; step++) {
    x += dir.x;
    y += dir.y;
    if (!isFree(x, y)) break;   // Wand oder Trail → hier ist Schluss
    count++;
  }
  return count;
}

function botThink(bike) {
  // Nur die drei sinnvollen Optionen: geradeaus, links, rechts.
  // (Rückwärts wäre sofortiger Selbstmord.)
  const options = [
    bike.dir,
    { x: -bike.dir.y, y:  bike.dir.x },  // 90° gedreht (Rotationstrick)
    { x:  bike.dir.y, y: -bike.dir.x },  // in die andere Richtung
  ];

  let best = null;
  let bestScore = -1;

  for (const dir of options) {
    // Direkt vor der Nase blockiert? Dann fällt die Option weg.
    if (!isFree(bike.x + dir.x, bike.y + dir.y)) continue;

    let score = freeAhead(bike, dir);

    // Bonus für geradeaus → der Bot zappelt nicht sinnlos herum.
    if (dir === bike.dir) score += 2;

    // Eine Prise Zufall, damit er nicht jede Runde identisch fährt.
    score += Math.random();

    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }

  // best === null heisst: alle Optionen blockiert. Dann fährt er
  // geradeaus weiter und stirbt. Passiert, ist korrekt so.
  bike.nextDir = best || bike.dir;
}


/* ------------------------------------------------------------------
   8. EIN ZEITSCHRITT — die wichtigste Funktion im ganzen Spiel
   ------------------------------------------------------------------ */
function step() {
  const living = bikes.filter((b) => b.alive);

  // (a) Bots entscheiden, wohin sie wollen.
  for (const b of living) {
    if (b.isBot) botThink(b);
  }

  // (b) Für jedes Bike das Zielkästchen ausrechnen.
  //     Wichtig: erst ALLE Ziele berechnen, dann bewerten. Sonst hätte
  //     das Bike, das zufällig zuerst dran ist, einen Vorteil.
  const moves = living.map((b) => {
    b.dir = b.nextDir;                       // gewünschte Richtung gilt jetzt
    return { bike: b, x: b.x + b.dir.x, y: b.y + b.dir.y };
  });

  // (c) Wer stirbt? Zwei Gründe:
  const doomed = new Set();

  for (const m of moves) {
    // Grund 1: Wand oder ein Trail (auch der eigene).
    if (!isFree(m.x, m.y)) doomed.add(m.bike);
  }

  for (const a of moves) {
    for (const b of moves) {
      // Grund 2: Frontal-Crash — zwei Bikes wollen ins gleiche Kästchen.
      if (a !== b && a.x === b.x && a.y === b.y) {
        doomed.add(a.bike);
        doomed.add(b.bike);
      }
    }
  }

  // (d) Ergebnis anwenden: Tote sterben, Überlebende fahren weiter
  //     und färben ihr neues Kästchen ein.
  for (const m of moves) {
    if (doomed.has(m.bike)) {
      m.bike.alive = false;
      continue;
    }
    m.bike.x = m.x;
    m.bike.y = m.y;
    occupied[idx(m.x, m.y)] = m.bike.id;
  }

  // (e) Ist die Runde vorbei?
  const stillAlive = bikes.filter((b) => b.alive);
  if (stillAlive.length <= 1) endRound(stillAlive);

  updateHud();
}


function endRound(survivors) {
  phase = "over";

  const playerAlive = survivors.some((b) => !b.isBot);

  if (survivors.length === 0) {
    showOverlay("UNENTSCHIEDEN", "Beide gleichzeitig gecrasht.");
  } else if (playerAlive) {
    showOverlay("GEWONNEN", "Du hast überlebt.");
  } else {
    showOverlay("VERLOREN", survivors[0].name + " hat überlebt.");
  }
}


/* ------------------------------------------------------------------
   9. ZEICHNEN
   Jedes Bild wird komplett neu gemalt: erst alles löschen, dann
   Gitter, dann Trails, dann Köpfe. Wie bei einem Daumenkino.
   ------------------------------------------------------------------ */
function draw() {
  const C = CONFIG.CELL;

  // Hintergrund
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Gitterlinien — nur Deko, hilft aber beim Einschätzen von Abständen.
  ctx.strokeStyle = "#0d1a2b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= CONFIG.COLS; x++) {
    ctx.moveTo(x * C, 0);
    ctx.lineTo(x * C, canvas.height);
  }
  for (let y = 0; y <= CONFIG.ROWS; y++) {
    ctx.moveTo(0, y * C);
    ctx.lineTo(canvas.width, y * C);
  }
  ctx.stroke();

  // Trails: das Gitter einmal durchgehen und jedes belegte
  // Kästchen in der Farbe seines Besitzers füllen.
  for (let y = 0; y < CONFIG.ROWS; y++) {
    for (let x = 0; x < CONFIG.COLS; x++) {
      const owner = occupied[idx(x, y)];
      if (owner === 0) continue;

      const bike = bikes.find((b) => b.id === owner);
      ctx.fillStyle = bike.color;
      ctx.globalAlpha = 0.55;                     // leicht transparent
      ctx.fillRect(x * C + 1, y * C + 1, C - 2, C - 2);
      ctx.globalAlpha = 1;
    }
  }

  // Die Köpfe (die Bikes selbst): heller, mit Leuchten.
  for (const b of bikes) {
    if (!b.alive) continue;
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 18;
    ctx.fillRect(b.x * C, b.y * C, C, C);
    ctx.shadowBlur = 0;                            // Leuchten wieder aus
  }
}


/* ------------------------------------------------------------------
   10. HUD & OVERLAY (die Anzeige aussen herum)
   ------------------------------------------------------------------ */
function updateHud() {
  hudEl.innerHTML = bikes
    .map((b) =>
      `<span class="chip ${b.alive ? "" : "dead"}" style="color:${b.color}">
         ${b.name}
       </span>`
    )
    .join("");
}

function showOverlay(title, text) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlayEl.classList.remove("hidden");
}

function hideOverlay() {
  overlayEl.classList.add("hidden");
}


/* ------------------------------------------------------------------
   11. DIE GAME LOOP
   Ein Spiel ist eine Endlosschleife: rechnen, malen, warten, wieder.
   setInterval ruft unsere Funktion alle TICK_MS Millisekunden auf.
   ------------------------------------------------------------------ */
setInterval(() => {
  if (phase === "running") step();
  draw();
}, CONFIG.TICK_MS);

// Startbild: Runde vorbereiten, aber noch nicht losfahren.
resetRound();
phase = "ready";
showOverlay("TRON", "Pfeiltasten oder WASD zum Fahren");
draw();
