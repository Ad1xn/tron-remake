/* =========================================================================
   KONFIGURATION — alle Zahlen, an denen man drehen will, an einer Stelle.
   =========================================================================
   Das ist kein Raster-Tron mehr. Vorbild ist das echte Spiel (Armagetron
   Advanced / Retrocycles): die Bikes fahren DURCHGEHEND, nicht von
   Kästchen zu Kästchen. Eine Wand ist eine dünne Linie, und durch eine
   schmale Lücke zwischen zwei Linien passt man durch.

   Daraus folgen die Regeln, die das Spiel erst ausmachen:

     RUBBER    Wer in eine Wand fährt, stirbt nicht sofort. Er drückt
               dagegen und verbraucht Gummi. Ist der Vorrat leer, ist
               Schluss. Deshalb kann man sich in Lücken hineinquetschen,
               die eigentlich zu knapp sind.
     GRINDEN   Nahe an einer Wand zu fahren macht SCHNELLER. Das ist der
               Kern des Spiels: man schrubbt an Wänden, um Tempo zu
               holen, und riskiert dabei genau das Gummi.
     BREMSE    Ein eigener Vorrat. Verlangsamt, um enger zu kurven.
     WANDLÄNGE Die eigene Wand ist endlich und verschwindet hinten.

   Die Datei kennt weder Browser noch Grafik und wird auch vom
   Trainings-Skript importiert.

   EINHEITEN: Meter und Sekunden. Die Arena ist 200 m breit, ein Bike
   fährt 30 m/s — eine Überfahrt dauert also knapp sieben Sekunden.
   ========================================================================= */

export const RULES = {
  /* --- Arena und Uhr ------------------------------------------------ */
  ARENA: 200,           // Seitenlänge der quadratischen Arena in Metern
  TICK_MS: 8,           // Physik-Schritt (125 Hz). Fest, sonst nicht
                        // reproduzierbar. Klein, weil die Kollision auf
                        // Bruchteile eines Meters genau sein soll.
  AGENT_EVERY: 4,       // Nur jeden n-ten Schritt wird ein Agent gefragt
                        // (≈31 Hz). Menschen werden jeden Schritt gelesen.

  /* --- Tempo -------------------------------------------------------- */
  SPEED: 30,            // Grundgeschwindigkeit, auf die alles zurückfällt
  SPEED_MIN: 8,
  SPEED_MAX: 140,
  DECAY: 0.45,          // Wie stark es zur Grundgeschwindigkeit zurückzieht

  /* --- Beschleunigung an Wänden (das Grinden) ----------------------- */
  ACCEL_WALL: 55,       // Schub direkt an einer Wand
  ACCEL_OFFSET: 2.0,    // Dämpfer, damit es bei Abstand 0 nicht explodiert
  ACCEL_RANGE: 10,      // Ab hier ist eine Wand zu weit weg zum Schieben
  ACCEL_SELF: 0.55,     // Die eigene Wand schiebt schwächer …
  ACCEL_ENEMY: 1.0,     // … die fremde voll. Darum grindet man am Gegner.

  /* --- Gummi -------------------------------------------------------- */
  RUBBER: 5,            // Vorrat
  RUBBER_BURN: 5,       // Verbrauch pro Sekunde, wenn man voll drückt
                        // → RUBBER/RUBBER_BURN = eine Sekunde Dauerdruck
  RUBBER_TIME: 12,      // Sekunden für einen komplett neuen Vorrat
  RUBBER_HOLD: 0.35,    // So lange nach dem Drücken wird nicht nachgefüllt
  GRIND_DRAG: 45,       // Wie stark das Schrubben bremst
  SKIN: 0.05,           // Abstand, den ein Bike zur Wand immer hält

  /* --- Bremse ------------------------------------------------------- */
  BRAKE: 12,
  BRAKE_REFILL: 0.7,    // pro Sekunde
  BRAKE_DEPLETE: 2.6,   // pro Sekunde beim Bremsen
  BRAKE_FORCE: 26,      // Verzögerung

  /* --- Todeszone ---------------------------------------------------- */
  /* Ohne sie endet eine Runde nie: die Wände verschwinden hinten wieder,
     die Arena füllt sich also nicht. Im Original löst das dieselbe Sache
     — nach einer Weile wächst in der Mitte eine Zone, die tötet. Sie
     treibt die Fahrer nach aussen und erzwingt eine Entscheidung. */
  ZONE_DELAY: 12,       // Sekunden, bis sie auftaucht
  ZONE_GROW: 8,         // Meter pro Sekunde, die sie wächst
  ZONE_JITTER: 0.12,    // Sie sitzt nicht exakt in der Mitte, sondern bis
                        // zu diesem Anteil der Arena daneben. Klingt nach
                        // Deko, ist aber nötig: genau in der Mitte ist sie
                        // von zwei spiegelbildlichen Fahrern gleich weit
                        // weg und tötet beide im selben Moment — jede
                        // Runde endete unentschieden. (Im Original heisst
                        // der Schalter WIN_ZONE_RANDOMNESS.)

  /* --- Kurven und Wände --------------------------------------------- */
  TURN_DELAY: 0.055,    // Kürzeste Zeit zwischen zwei Kurven
  WALL_LENGTH: 420,     // Meter. 0 = unendlich lange Wände.

  /* --- Punkte (Armagetron-Art: für Abschüsse, nicht fürs Sammeln) --- */
  SCORE_KILL: 10,       // Jemand stirbt an MEINER Wand
  SCORE_WIN: 20,        // Runde gewonnen
  SCORE_SUICIDE: -2,    // An der eigenen Wand oder am Rand gestorben

  AGENT_BUDGET_MS: 60,  // So lange darf ein Agent denken (auch ein
                        // entferntes Modell). Danach: weiter wie bisher.
};

/* Die Arena wächst mit der Spielerzahl, damit jeder gleich viel Fläche
   hat — 1v1 auf 200 m, und bei sechs Fahrern entsprechend mehr. Sonst
   ist die Runde vorbei, bevor jemand eine Strategie fahren konnte.

     Fahrer | Arena
        2   | 200 m
        3   | 245 m
        4   | 283 m
        6   | 346 m                                                     */
export function arenaFor(players) {
  const n = Math.max(2, players || 2);
  const areaPerPlayer = (RULES.ARENA * RULES.ARENA) / 2;
  return Math.round(Math.sqrt(n * areaPerPlayer));
}

/* Rückwärtskompatibel: manche Dateien fragen noch CONFIG.TICK_MS ab. */
export const CONFIG = RULES;


/* Farben. Erst als Zahl (0x…) weil Three.js das so mag, das HUD macht
   daraus automatisch CSS. */
export const PALETTE = {
  BACKGROUND: 0x04060f,
  FLOOR:      0x070c22,
  GRID:       0x14224a,
  RIM:        0x2440ff,   // die Aussenmauer
  RUBBER:     0xff3355,   // Warnfarbe, wenn das Gummi knapp wird
};


/* -------------------------------------------------------------------------
   DIE FAHRER
   -------------------------------------------------------------------------
   driver.type === "human"  → Tastatur, controls sagt welche Belegung
   driver.type === "agent"  → ein Agent aus agents.js

   Für ein reines KI-Match den ersten Fahrer auch auf "agent" stellen.
   Zwei Einträge = 1v1, die Arena schrumpft dann von allein.
   ------------------------------------------------------------------------- */
export const ROSTER = [
  { name: "DU",   color: 0x22d3ee, driver: { type: "human", controls: "arrows" } },
  { name: "CLU",  color: 0xfb923c, driver: { type: "agent", agent: "grinder" } },
  { name: "RINZ", color: 0xa855f7, driver: { type: "agent", agent: "hunter" } },
  { name: "GEM",  color: 0x4ade80, driver: { type: "agent", agent: "cruiser" } },
];

/* Startplätze als Anteil der Arena, plus Blickrichtung als Achsen-Index
   (0 = +x rechts, 1 = -y hoch, 2 = -x links, 3 = +y runter).
   Schön symmetrisch, damit niemand einen Vorteil hat. */
export const SPAWNS = [
  { fx: 0.20, fy: 0.50, dir: 0 },
  { fx: 0.80, fy: 0.50, dir: 2 },
  { fx: 0.50, fy: 0.20, dir: 3 },
  { fx: 0.50, fy: 0.80, dir: 1 },
  { fx: 0.20, fy: 0.20, dir: 3 },
  { fx: 0.80, fy: 0.80, dir: 1 },
];
