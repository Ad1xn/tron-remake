/* =========================================================================
   KONFIGURATION — alle Regeln als Zahlen, an einer Stelle.
   =========================================================================
   Vorbild ist Retrocycles, also die Steam-Fassung von Armagetron
   Advanced. Was von dort kommt, ist hier mit dem ORIGINALNAMEN der
   Einstellung markiert — dann kann man nachlesen und vergleichen.

   Die vier eingebauten Modi des Originals sind Last Man Standing,
   Last Team Standing, Fortress und Sumo. Gebaut werden hier die zwei,
   um die es geht: LMS und Fortress.

   EINHEITEN: Meter und Sekunden. Grundtempo 30 m/s (CYCLE_SPEED),
   beim Grinden geht es auf 70 und mehr.
   ========================================================================= */

/* =========================================================================
   Die Werte mit ORIGINALNAMEN sind aus dem Quellcode von Armagetron
   Advanced abgelesen (src/tron/gCycleMovement.cpp, gWinZone.cpp), nicht
   geschätzt. Wo ich absichtlich abweiche, steht der echte Wert daneben.
   ========================================================================= */
export const RULES = {
  /* --- Arena und Uhr ------------------------------------------------ */
  /* FEST, nicht nach Spielerzahl skaliert. Das Original hat eine
     Kartengrösse, die vom Server kommt — 16 Fahrer darauf sind eng, und
     genau das ist der Punkt. (Mein Mitwachsen war erfunden.) */
  ARENA: 500,           // Kantenlänge in Metern. In den Bildern aus dem
                        // Video ist das Labyrinth RIESIG — man sieht ein
                        // Feld voller Wände und die Aussenmauer gar
                        // nicht. 250 m fühlten sich zu klein an, 500 m
                        // passen zu 16 Fahrern.
  TICK_MS: 8,           // Physik-Schritt (125 Hz). Fest, sonst nicht
                        // reproduzierbar; klein, weil die Kollision auf
                        // Zentimeter genau sein muss.
  AGENT_EVERY: 4,       // Nur jeden n-ten Schritt denkt ein Bot (≈31 Hz)

  /* --- Wie viele fahren mit ----------------------------------------- */
  /* Das Original lässt 16 auf einen Server (hartes Limit der fertigen
     Version). Hier ist es die Zahl, an der man dreht, wenn es ruckelt. */
  PLAYERS: 16,
  HUMANS: 1,

  /* --- Tempo (CYCLE_SPEED …) ---------------------------------------- */
  SPEED: 30,            // CYCLE_SPEED — 30, aus der settings.cfg des
                        // gekauften Spiels. (Im Quellcode steht 10; das
                        // ist der eingebaute Wert, ausgeliefert wird 30.)
  START_SPEED: 20,      // CYCLE_START_SPEED (echt: 20) — man startet ÜBER
                        // dem Grundtempo und fällt darauf ab.
  SPEED_MIN_RATIO: 0.25,// CYCLE_SPEED_MIN ist ein VERHÄLTNIS zu CYCLE_SPEED,
                        // kein absoluter Wert: 0,25 × 30 = 7,5 m/s.
  SPEED_MAX: 200,       // CYCLE_SPEED_MAX (echt: 0 = unbegrenzt)
  /* Der Grund, warum sich das Original schnell anfühlt: über dem
     Grundtempo verfällt es KAUM (0,1), darunter zieht es stark hoch (5).
     Erarbeitetes Tempo behält man also. Meine 0,45 in beide Richtungen
     waren der Grund für das zähe Gefühl. */
  DECAY_ABOVE: 0.1,     // CYCLE_SPEED_DECAY_ABOVE
  DECAY_BELOW: 5.0,     // CYCLE_SPEED_DECAY_BELOW

  /* --- Beschleunigung an Wänden = das Grinden ----------------------- */
  /* Pro Seite: ACCEL * Faktor / (Abstand + OFFSET). */
  ACCEL: 10,            // CYCLE_ACCEL
  ACCEL_OFFSET: 2.0,    // CYCLE_ACCEL_OFFSET
  ACCEL_SELF: 1.0,      // CYCLE_ACCEL_SELF
  ACCEL_ENEMY: 1.0,     // CYCLE_ACCEL_ENEMY
  ACCEL_RIM: 0.0,       // CYCLE_ACCEL_RIM — die Aussenmauer schiebt NICHT.
                        // Meine 0,6 war erfunden; im Original ist sie 0,
                        // deshalb bringt Randfahren dort kein Tempo.
  /* Zwei Wände gleichzeitig sind mehr als eine — das ist die eigentliche
     Tempoquelle im Original:
       SLINGSHOT  fremde Wand + eigene Wand  → (einzeln + eigen) × Faktor
       TUNNEL     zwei fremde Wände          → einzeln × Faktor          */
  ACCEL_SLINGSHOT: 1.0, // CYCLE_ACCEL_SLINGSHOT
  ACCEL_TUNNEL: 1.0,    // CYCLE_ACCEL_TUNNEL
  WALL_NEAR: 6.0,       // CYCLE_WALL_NEAR — "the distance from a wall
                        // below which wall-acceleration kicks in". Ich
                        // hatte 12; man muss also doppelt so dicht ran.

  /* --- Gummi (CYCLE_RUBBER …) --------------------------------------- */
  /* STRECKENBASIERT, so wie im Original standardmässig: verbraucht wird
     die Strecke, die man NICHT fahren konnte. Damit frisst hohes Tempo
     mehr Gummi — genau deshalb ist schnell auch schwer. (Vorher war es
     zeitbasiert und dadurch tempo-unabhängig und viel zu gnädig.) */
  RUBBER: 4,            // CYCLE_RUBBER. Eingebaut 1 (+3 Ping-Bonus), aber
                        // die mitgelieferten Fortress-Konfigurationen
                        // setzen 4 bzw. 5 — das ist der Wert, mit dem
                        // wirklich gespielt wird. So viele METER darf man
                        // in Wände drücken.
  RUBBER_TIME: 10,      // CYCLE_RUBBER_TIME: Zeitskala fürs Nachfüllen
  RUBBER_HOLD: 0.2,     // so lange nach dem Drücken kein Nachfüllen
  RUBBER_SPEED: 40,     // CYCLE_RUBBER_SPEED: das Tempo zur Wand wird auf
                        // RUBBER_SPEED × Abstand begrenzt — daraus kommt
                        // das weiche Anschmiegen statt eines Stopps.
  /* Jede Kurve macht das Gummi kurzzeitig schlechter. Im Original ist das
     standardmässig AUS (0) und wird von Servern eingeschaltet; genau das
     macht schnelles Kurvenfahren dort tödlich. */
  RUBBER_MALUS_TURN: 0.0,   // CYCLE_RUBBER_MALUS_TURN (echt: 0)
  RUBBER_MALUS_TIME: 5.0,   // CYCLE_RUBBER_MALUS_TIME (echt: 5)
  /* Und das hatte ich komplett vergessen: eine Kurve KOSTET Tempo. */
  TURN_SPEED_FACTOR: 0.95,  // CYCLE_TURN_SPEED_FACTOR
  SKIN: 0.03,               // Abstand, den ein Bike zur Wand immer hält

  /* --- Bremse (CYCLE_BRAKE …) --------------------------------------- */
  /* Im Original ist der Vorrat standardmässig UNENDLICH: REFILL und
     DEPLETE sind beide 0, die Anzeige steht deshalb immer auf 1. Erst
     Server schalten den Verbrauch ein. Mein sich leerender Vorrat war
     also falsch — und ein negatives BRAKE macht aus der Bremse einen
     Booster, das gibt es dort wirklich. */
  BRAKE: 30,            // CYCLE_BRAKE: Verzögerung in m/s²
  BRAKE_MAX: 1.0,       // Vorrat als Anteil 0…1 (die Anzeige zeigt genau das)
  BRAKE_REFILL: 0.0,    // CYCLE_BRAKE_REFILL (echt: 0)
  BRAKE_DEPLETE: 0.0,   // CYCLE_BRAKE_DEPLETE (echt: 0)

  /* --- Kurven und Wände --------------------------------------------- */
  TURN_DELAY: 0.1,      // CYCLE_DELAY (echt: 0.1)
  /* CYCLE_WALLS_LENGTH. Im Quellcode steht als Standard -1 (unendlich),
     aber Server setzen praktisch immer eine endliche Länge — und im
     Video sieht man ja auch, dass die Wand hinten weggeht. 600 m sind
     lang genug, dass ein Labyrinth entsteht, und kurz genug, dass sich
     die Arena wieder öffnet. 0 = unendlich.

     600 waren zu kurz: bei einer 500-m-Arena ist das gut eine
     Überquerung, es stand nie mehr als ein Dutzend Strecken pro Fahrer.
     Die mitgelieferten Konfigurationen setzen WALLS_LENGTH auf 400 bzw.
     800 ("cycle trail length") — 800 ist der Wert aus der
     Fortress-Konfiguration. */
  WALL_LENGTH: 800,

  /* WALLS_STAY_UP_DELAY, im Quellcode 8.0 Sekunden: stirbt ein Fahrer,
     bleiben seine Wände noch so lange stehen und verschwinden DANN
     komplett. Das ist der zweite Weg, wie sich die Arena wieder öffnet —
     und der fehlte mir ganz. (negativ = sie bleiben für immer) */
  WALLS_STAY_UP_DELAY: 8,

  /* EXPLOSIONEN SPRENGEN LÖCHER. gCycle::explosionRadius = 4.0 im
     Quellcode, mit dem Kommentar "the radius of the holes blewn in by an
     explosion". Stirbt jemand, wird aus JEDER Wand in diesem Umkreis ein
     Stück herausgeschnitten — auch aus den eigenen. Genau daher kommen
     die Lücken, die man ab und zu in einem Trail aufgehen sieht: sie
     sind nicht zufällig, dort ist jemand gestorben. */
  EXPLOSION_RADIUS: 4.0,   // EXPLOSION_RADIUS, "blast radius of cycle
                           // explosions" — steht so in fortress.cfg

  /* CYCLE_TURN_MEMORY: so viele Kurvenbefehle merkt sich ein Bike im
     Voraus. Ich hatte zwei gepuffert, das Spiel merkt sich drei. */
  TURN_MEMORY: 3,

  /* CYCLE_RUBBER_WALL_SHRINK: verbrauchtes Gummi verkürzt die eigene
     Wand. Im Grundspiel 0, auf Fortress-Servern 1. */
  RUBBER_WALL_SHRINK: 0,

  /* --- Punkte (SCORE_…) --------------------------------------------- */
  /* Das Original zählt SEHR sparsam: für einen Abschuss gibt es
     standardmässig NICHTS, fürs Sterben Abzug, fürs Gewinnen der Runde
     ein paar Punkte. Genau so hier — mein voriges Punktesystem
     (10 pro Abschuss, 20 pro Sieg, Rekord im localStorage) war
     erfunden. Der Stand steht unten links, wie im Original. */
  /* Aus der settings.cfg des gekauften Spiels — und damit ist meine
     letzte Aussage widerlegt: fürs Abschiessen gibt es SEHR WOHL Punkte.
     Im Quellcode steht SCORE_KILL 0, ausgeliefert wird 3. */
  SCORE_WIN: 10,        // "points you gain for being last one alive"
  SCORE_KILL: 3,        // "points you gain for everyone racing into your wall"
  SCORE_DIE: -2,        // "points you gain for every time you race into"
  SCORE_SUICIDE: -4,    // "points you gain for every stupid death"

  /* --- Kamera (settings_visual.cfg des gekauften Spiels) ------------ */
  CAM_BACK: 6,          // CAMERA_CUSTOM_BACK
  CAM_BACK_SPEED: 0.5,  // CAMERA_CUSTOM_BACK_FROMSPEED  (je m/s)
  CAM_RISE: 4,          // CAMERA_CUSTOM_RISE
  CAM_RISE_SPEED: 0.4,  // CAMERA_CUSTOM_RISE_FROMSPEED  (je m/s)
  CAM_PITCH: -0.58,     // CAMERA_CUSTOM_PITCH. KEIN Winkel, sondern die
                        // senkrechte Komponente des Blickvektors, dessen
                        // waagerechter Teil 1 lang ist — also eine
                        // Steigung: atan(0,58) = 30,1° nach unten.
  /* Die Draufsicht gibt es im Original nicht — die ist deine Idee, und
     für den Überblick über ein Labyrinth ist sie deutlich besser als
     jede Schulterkamera. */
  CAM_DRONE_BACK: 55,       // wie weit hinter dem Bike
  CAM_DRONE_BACK_SPEED: 0.6,
  CAM_DRONE_HIGH: 95,       // Grundhöhe in Metern
  CAM_DRONE_HIGH_SPEED: 0.9,// bei 30 m/s also 122 m hoch, 73 m hinten
  CAM_DRONE_AHEAD: 45,      // Blickpunkt so weit VOR dem Bike — dadurch
                            // sitzt man selbst im unteren Drittel und
                            // sieht nach vorn am meisten

  FOV: 90,              // START_FOV, und zwar WAAGERECHT gemessen. Ich
                        // bin mit 56 gefahren; das war der Hauptgrund,
                        // warum die Kamera nie gepasst hat.

  AGENT_BUDGET_MS: 60,  // So lange darf ein Agent denken

  /* ==================================================================
     MODI
     ==================================================================
     Die vier eingebauten Modi von Retrocycles. Alle Werte unten stammen
     aus den mitgelieferten Konfigurationen des gekauften Spiels
     (etc/examples/…), nicht aus meiner Fantasie.

     DIE WICHTIGSTE KORREKTUR: die Win-Zone ist im EINZELSPIELER
     abgeschaltet. In settings_dedicated.cfg steht

         SP_WIN_ZONE_MIN_ROUND_TIME 1000000
         SP_WIN_ZONE_MIN_LAST_DEATH 1000000

     Man gewinnt also NICHT, indem man in einen Ring fährt — man gewinnt,
     indem man übrig bleibt. Nur im Mehrspieler erscheint die Zone, und
     auch dort erst, wenn die Runde lange läuft UND eine Weile niemand
     mehr gestorben ist. Sie ist ein Patt-Brecher, kein Ziel.

     Und Sumo ist bemerkenswert gebaut: es benutzt dieselbe Zonenlogik
     wie Fortress, nur mit umgedrehten Vorzeichen. Erobern = 0,
     Verteidigen = 0,6 und ein NEGATIVER Verfall: die eigene Zone erobert
     sich selbst, sobald man nicht drin steht. Wer sie verliert, stirbt.
     ================================================================== */
  MODE: "lms",

  /* Gemeinsame Zonen-Optik */
  ZONE_HEIGHT: 5.0,             // ZONE_HEIGHT (echt: 5.0)
  FORTRESS_COLLAPSE: 0.5,       // ZONE_COLLAPSE_SPEED (echt: 0.5)
};

/* =========================================================================
   DIE VIER MODI
   =========================================================================
   Jeder Eintrag kann RULES überschreiben (`rules`), sagt wie Teams und
   Zonen gebildet werden, und bringt seine eigenen Zonen-Raten mit.

     teams   "solo"  jeder für sich
             2       zwei Mannschaften
     zones   "none"  keine
             "team"  eine Zone je Mannschaft
             "solo"  eine Zone je Fahrer
   ========================================================================= */
export const MODES = {
  /* --- Last Man Standing ------------------------------------------- */
  lms: {
    name: "Last Man Standing",
    teams: "solo",
    zones: "none",
    /* HIER STECKT EINE ENTSCHEIDUNG. Das Original kennt zwei Sätze:

         SP_WIN_ZONE_MIN_ROUND_TIME 1000000   (Einzelspieler: nie)
         WIN_ZONE_MIN_ROUND_TIME 60 / 30      (Server)

       Im Einzelspieler ist die Zone aus, weil dort ein Mensch mitfährt
       und irgendwann stirbt. Bei 15 Bots, die alle vorsichtig fahren,
       endet dann GAR NICHTS — gemessen: 480 s und immer noch kein Ende.
       Eine Rundenzeit gibt es im Original nicht, die Win-Zone IST der
       einzige Patt-Brecher.

       Deshalb stehen hier die Server-Werte: 60 s Rundenzeit UND 30 s
       ohne Toten. Solange jemand stirbt, kommt sie nie — man gewinnt
       also weiterhin nicht dadurch, dass man in einen Ring fährt.
       Für die Originaltreue: auf Infinity setzen. */
    winZone: { round: 60, lastDeath: 30, randomness: 0.8 },
    rules: {},
  },

  /* --- Last Team Standing ------------------------------------------ */
  lts: {
    name: "Last Team Standing",
    teams: 2,
    zones: "none",
    winZone: { round: 120, lastDeath: 60, randomness: 0.4 },
    rules: {},
  },

  /* --- Fortress ----------------------------------------------------- */
  /* Zonen-Raten aus settings.cfg, Physik aus
     examples/cvs_test/fortress_physics.cfg, Punkte aus
     fortress_scoring.cfg, Zeiten aus fortress_complete.cfg. */
  fortress: {
    name: "Fortress",
    teams: 2,
    zones: "team",
    zone: {
      radius: 20,
      conquest: 0.5,        // FORTRESS_CONQUEST_RATE
      defend: 0.25,         // FORTRESS_DEFEND_RATE
      decay: 0.1,           // FORTRESS_CONQUEST_DECAY_RATE
      timeout: 0,           // FORTRESS_CONQUEST_TIMEOUT
      killRatio: 0,         // FORTRESS_CONQUERED_KILL_RATIO
      killMin: 0,           // FORTRESS_CONQUERED_KILL_MIN
      conqueredWin: false,  // FORTRESS_CONQUERED_WIN 0
      surviveWin: true,     // FORTRESS_SURVIVE_WIN 1
      conqueredScore: 0,    // FORTRESS_CONQUERED_SCORE
    },
    winZone: { round: 120, lastDeath: 60, randomness: 0.4 },
    rules: {
      RUBBER: 5,            // CYCLE_RUBBER 5
      ACCEL: 20,            // CYCLE_ACCEL 20 — doppelt so viel Schub an
                            // Wänden wie im Grundspiel
      EXPLOSION_RADIUS: 2,  // EXPLOSION_RADIUS 2
      WALL_LENGTH: 400,     // WALLS_LENGTH 400
      RUBBER_WALL_SHRINK: 1,// CYCLE_RUBBER_WALL_SHRINK 1 — verbrauchtes
                            // Gummi VERKÜRZT die eigene Wand
      SCORE_WIN: 10, SCORE_KILL: 2, SCORE_DIE: 0, SCORE_SUICIDE: 0,
    },
  },

  /* --- Sumo ---------------------------------------------------------- */
  /* Aus examples/cvs_test/sumo_complete.cfg. Jeder besitzt eine Zone und
     muss DRIN BLEIBEN: Erobern 0, Verteidigen 0,6, Verfall −0,3. Der
     negative Verfall heisst, die Zone erobert sich selbst, sobald
     niemand von ihren Besitzern drinsteht. Wird sie erobert, stirbt der
     Besitzer (KILL_RATIO 1). */
  sumo: {
    name: "Sumo",
    teams: "solo",
    zones: "solo",
    zone: {
      radius: 26,
      conquest: 0,          // FORTRESS_CONQUEST_RATE 0
      defend: 0.6,          // FORTRESS_DEFEND_RATE .6
      decay: -0.3,          // FORTRESS_CONQUEST_DECAY_RATE -.3
      timeout: 5,           // FORTRESS_CONQUEST_TIMEOUT 5
      killRatio: 1,         // FORTRESS_CONQUERED_KILL_RATIO 1
      killMin: 1,           // FORTRESS_CONQUERED_KILL_MIN 1
      conqueredWin: false,
      surviveWin: true,
      conqueredScore: 60,   // FORTRESS_CONQUERED_SCORE 60
    },
    /* Eine RIESIGE Zone, die SCHRUMPFT — negative Ausdehnung. */
    winZone: { round: 40, lastDeath: 20, randomness: 0,
               initial: 56.56, expansion: -0.5656 },
    rules: {
      RUBBER: 5, ACCEL: 20, EXPLOSION_RADIUS: 2, WALL_LENGTH: 400,
      RUBBER_WALL_SHRINK: 1,
      SCORE_WIN: 0, SCORE_SUICIDE: -30,
    },
  },
};

export const MODE_LIST = Object.keys(MODES);

/* Die Arena ist FEST. Im Original kommt die Kartengrösse vom Server und
   hängt nicht an der Spielerzahl — 16 Fahrer auf 400 m sind eng, und das
   soll so sein. (Vorher wuchs sie mit, das war meine Erfindung.) */
export function arenaFor() {
  return RULES.ARENA;
}

export const CONFIG = RULES;          // manche Dateien fragen so


/* Farben. Erst als Zahl (0x…) weil Three.js das so mag; das HUD macht
   daraus CSS. */
export const PALETTE = {
  BACKGROUND: 0x000000,     // Das Original ist schwarz, nicht blau-dunkel
  FLOOR:      0x03040a,
  GRID:       0x1a2a5c,
  RIM:        0x2440ff,
  RUBBER:     0xff3355,
  ZONE_WIN:   0x4ade80,     // Win-Zone: grün, man WILL hinein
  TEAM: [0x22d3ee, 0xfb923c],   // Fortress: zwei Teams, zwei Farben
};

/* Farben für die Fahrer im Alle-gegen-alle. Sechzehn müssen
   unterscheidbar bleiben, darum durchgehend durch den Farbkreis. */
export const COLORS = [
  0x22d3ee, 0xfb923c, 0xa855f7, 0x4ade80, 0xf472b6, 0xfacc15,
  0x38bdf8, 0xf87171, 0x34d399, 0xc084fc, 0xfb7185, 0x2dd4bf,
  0x60a5fa, 0xfbbf24, 0x818cf8, 0xa3e635,
];

/* Namen für die Bots. Reine Deko, aber ein Feld voller "BOT 7" sieht
   nach nichts aus. */
export const BOT_NAMES = [
  "CLU", "RINZLER", "GEM", "TRON", "QUORRA", "CASTOR", "JARVIS", "ZUSE",
  "SARK", "YORI", "DUMONT", "CROM", "RAM", "BIT", "MCP", "ABRAXAS",
];

/* Startplätze als Anteil der Arena, plus Blickrichtung als Achsen-Index
   (0 = +x rechts, 1 = -y hoch, 2 = -x links, 3 = +y runter).
   Für viele Fahrer reicht keine Liste mehr — spawnFor() unten verteilt
   sie gleichmässig auf einem Ring, so wie das Original seine Startplätze
   auf den Rand legt. */
/* FORTRESS: jedes Team steht in einer Reihe VOR der eigenen Festung und
   schaut zum Gegner. Das ist die Aufstellung im Original — und sie ist
   nicht Deko: verteilt man die Teams rundherum, startet die halbe
   Mannschaft neben der feindlichen Zone und die Runde ist nach sechs
   Sekunden vorbei. Der Weg über die Arena IST das Spiel. */
export function spawnForTeam(indexInTeam, teamSize, team, arena) {
  const rows = [
    { fy: 0.24, dir: 3 },     // Team 0 steht oben, fährt nach unten
    { fy: 0.76, dir: 1 },     // Team 1 steht unten, fährt nach oben
  ];
  const row = rows[team % rows.length];
  const per = Math.max(teamSize, 1);
  const spread = 0.62;                       // Breite der Reihe
  const t = per === 1 ? 0.5 : indexInTeam / (per - 1);
  return {
    x: (0.5 - spread / 2 + spread * t) * arena,
    y: row.fy * arena,
    dir: row.dir,
  };
}

export function spawnFor(index, count, arena) {
  const per = Math.max(count, 2);
  const t = (index + 0.5) / per;                 // 0…1 auf dem Ring
  const margin = 0.14;

  // Auf einem Rechteck-Ring verteilen: unten, rechts, oben, links.
  const side = Math.floor(t * 4) % 4;
  const u = (t * 4) % 1;
  const lo = margin, hi = 1 - margin;
  const lerp = (a, b, k) => a + (b - a) * k;

  /* TANGENTIAL, nicht nach innen. Das ist kein Geschmack, sondern ein
     gemessener Fehler: liessen alle nach innen fahren, kreuzten sich die
     Wege der Ecken-Paare auf den Zentimeter gleichzeitig — Fahrer 0 und
     15 starben zuverlässig nach 1,1 Sekunden frontal. So fahren alle im
     Kreis in dieselbe Richtung und laufen hintereinander her. */
  const spots = [
    { fx: lerp(lo, hi, u), fy: lo, dir: 0 },     // oben,   fährt nach rechts
    { fx: hi, fy: lerp(lo, hi, u), dir: 3 },     // rechts, fährt nach unten
    { fx: lerp(hi, lo, u), fy: hi, dir: 2 },     // unten,  fährt nach links
    { fx: lo, fy: lerp(hi, lo, u), dir: 1 },     // links,  fährt nach oben
  ];
  const s = spots[side];
  return { x: s.fx * arena, y: s.fy * arena, dir: s.dir };
}
