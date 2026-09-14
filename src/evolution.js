/* =========================================================================
   EVOLUTION — viele Netze, die gegeneinander fahren und sich vererben.
   =========================================================================
   WARUM NICHT GRADIENTEN (wie in tools/rl.mjs)

   Weil man einem Gradienten nicht zusehen kann. Eine Population schon:
   vierundzwanzig Netze, jedes ein Kästchen, nach Fitness eingefärbt,
   Generation für Generation. Was hier passiert, ist auf dem Schirm zu
   sehen statt in einer Verlustkurve zu erahnen.

   Der Preis ist Ehrlichkeit: Evolution ist bei gleichem Rechenaufwand
   meist schlechter als ein Gradientenverfahren. Sie braucht keine
   Ableitung, keine Belohnung je Schritt und keinen Lehrer — nur die
   Frage "wer hat gewonnen". Dafür braucht sie viele Versuche.

   KEINE HANDGESCHRIEBENEN GEGNER

   Die Netze fahren ausschliesslich gegeneinander. Das ist der Punkt:
   niemand gibt vor, wie Tron gespielt wird. Nur — dann fehlt die
   Messlatte. "Besser als die anderen in dieser Generation" kann auch
   heissen, dass alle gemeinsam schlechter geworden sind.

   Dagegen die AHNENGALERIE: alle paar Generationen wird der Beste
   eingefroren. Die aktuelle Spitze tritt gegen ihre eigenen Vorfahren
   an, und DAS ist der absolute Fortschritt. Steigt er nicht, dreht sich
   die Population im Kreis, egal wie gut die Rangliste aussieht.

   Diese Datei kennt weder DOM noch Dateien — sie läuft im Browser und
   in Node.
   ========================================================================= */

import { createGame, step, makeRng } from "./engine.js";
import { collectActions } from "./agents.js";
import { RULES, COLORS, arenaFor, spawnFor } from "./config.js";
import { ACTIONS, SENSOR_NAMES } from "./features.js";
import { neuesNetz, netzAgent, netzAlsJson, ladeNetz } from "./net.js";

export const STANDARD = {
  groesse: 24,          // Netze in der Population
  proMatch: 4,          // wie viele davon in einem Match
  matches: 36,          // Matches je Generation
  elite: 6,             // so viele überleben unverändert
  mutation: 0.08,       // Streuung des Rauschens auf die Gewichte
  mutationEnde: 0.02,   // … am Ende, linear (siehe unten)
  generationen: 300,    // wofür "Ende" gilt
  verdeckt: 24,
  ahnenAlle: 10,        // alle n Generationen einen Vorfahren einfrieren
  ahnenMatches: 12,     // so viele Matches gegen die Galerie
  maxTicks: 12000,      // Notbremse je Match
};


/* ------------------------------------------------------------------
   EIN MATCH ZWISCHEN NETZEN
   ------------------------------------------------------------------
   Kopflos, ohne Grafik. Gibt zurück, wer gewonnen hat und wie lange
   jeder überlebt hat — mehr braucht die Fitness nicht.
   ------------------------------------------------------------------ */
/* STARTPLÄTZE STREUEN.
   Zwei Netze sind deterministisch: gleiche Gewichte, gleicher Start,
   gleiches Match — Zentimeter für Zentimeter. Zwölf Messmatches mit
   verschiedenen Seeds waren deshalb ein einziges Match, zwölfmal
   wiederholt, und die Quote sprang zwischen 0 % und 100 % statt
   irgendetwas dazwischen zu zeigen. Der Seed allein reicht nicht: er
   verwackelt nur die Win-Zone, und die erscheint erst nach 60 s.

   Darum werden die Plätze aus einem Ring mit acht Positionen gezogen.
   Das gibt echte Varianz, ohne an der Politik zu drehen. */
const RING = 8;
export function plaetze(variante, anzahl, arena) {
  return Array.from({ length: anzahl }, (_, i) =>
    spawnFor((variante * 3 + i * 2) % RING, RING, arena));
}

export function kampf(netze, seed, maxTicks = STANDARD.maxTicks, variante = null) {
  const arena = arenaFor();
  const spawns = variante === null ? null : plaetze(variante, netze.length, arena);
  const riders = netze.map((n, i) => ({
    name: "N" + i,
    color: COLORS[i % COLORS.length],
    spawn: spawns ? spawns[i] : undefined,
    driver: { type: "agent", agent: "netz" + i, fn: netzAgent(n, { name: "netz" + i }) },
  }));

  const game = createGame({ riders, seed, arena, mode: "lms" });
  while (game.phase === "running" && game.tick < maxTicks) {
    step(game, collectActions(game));
  }

  const sieger = game.winner ? game.cycles.indexOf(game.winner) : -1;
  return {
    sieger,
    dauer: game.time,
    fahrer: game.cycles.map((c) => ({
      lebt: c.alive,
      zeit: c.alive ? game.time : c.deathTime,
      strecke: c.distance,
      tempo: c.topSpeed,
    })),
  };
}


/* ------------------------------------------------------------------
   DIE POPULATION
   ------------------------------------------------------------------ */
export function erzeugeEvolution(optionen = {}) {
  const opt = { ...STANDARD, ...optionen };
  const rng = makeRng(opt.seed ?? 1);

  /* Gauss aus zwei Gleichverteilten (Box-Muller). Math.random() allein
     würde nur einen Kasten mutieren, keine Glocke — kleine Änderungen
     wären dann genauso häufig wie grosse. */
  let reserve = null;
  const gauss = () => {
    if (reserve !== null) { const r = reserve; reserve = null; return r; }
    const u = Math.max(rng(), 1e-12), v = rng();
    const betrag = Math.sqrt(-2 * Math.log(u));
    reserve = betrag * Math.sin(2 * Math.PI * v);
    return betrag * Math.cos(2 * Math.PI * v);
  };

  const neu = () => ({
    netz: neuesNetz(SENSOR_NAMES.length, opt.verdeckt, ACTIONS.length, rng),
    fitness: 0, siege: 0, matches: 0, zeit: 0, strecke: 0,
    herkunft: "neu", alter: 0,
  });

  let population = Array.from({ length: opt.groesse }, neu);
  let generation = 0;
  let matchNr = 0;
  const ahnen = [];                 // eingefrorene Vorfahren (für die Galerie)
  let urahn = null;                 // der Beste der Generation 0 — FÜR IMMER
  const verlauf = [];               // je Generation eine Zeile für die Kurve

  /* Die Mutationsstärke fällt über die Generationen: am Anfang grob
     suchen, später fein. Ein fester Wert macht beides schlecht. */
  const staerke = () => {
    const t = Math.min(generation / Math.max(opt.generationen, 1), 1);
    return opt.mutation + (opt.mutationEnde - opt.mutation) * t;
  };

  const mutiere = (eltern) => {
    const kind = ladeNetz(netzAlsJson(eltern.netz));
    const s = staerke();
    for (const feld of ["w1", "b1", "w2", "b2"]) {
      const a = kind[feld];
      for (let i = 0; i < a.length; i++) a[i] += gauss() * s;
    }
    return { netz: kind, fitness: 0, siege: 0, matches: 0, zeit: 0, strecke: 0,
             herkunft: "kind", alter: 0 };
  };

  /* Wer fährt im nächsten Match? Zufällig gezogen, aber ohne
     Wiederholung innerhalb eines Matches — sonst fährt ein Netz gegen
     sich selbst und die Fitness sagt nichts. */
  function besetzung() {
    const frei = population.map((_, i) => i);
    const raus = [];
    for (let k = 0; k < opt.proMatch && frei.length; k++) {
      raus.push(frei.splice(Math.floor(rng() * frei.length), 1)[0]);
    }
    return raus;
  }

  return {
    get generation() { return generation; },
    get population() { return population; },
    get ahnen() { return ahnen; },
    get urahn() { return urahn; },
    get verlauf() { return verlauf; },
    get optionen() { return opt; },
    get matchNr() { return matchNr; },
    get mutationsstaerke() { return staerke(); },
    get fertig() { return matchNr >= opt.matches; },

    /* EIN Match. Der Aufrufer bestimmt, wie viele davon er pro Bild
       rechnet — so kann die Oberfläche zwischendurch zeichnen, statt
       den Browser für eine Sekunde einzufrieren. */
    naechsterKampf() {
      if (matchNr >= opt.matches) return null;
      const wer = besetzung();
      const erg = kampf(wer.map((i) => population[i].netz),
                        1000 + generation * opt.matches + matchNr, opt.maxTicks,
                        matchNr);

      wer.forEach((idx, platz) => {
        const e = population[idx];
        const f = erg.fahrer[platz];
        e.matches++;
        e.zeit += f.zeit;
        e.strecke += f.strecke;
        if (platz === erg.sieger) e.siege++;
      });

      matchNr++;
      return { wer, ...erg };
    },

    /* Generation abschliessen: bewerten, sortieren, vererben. */
    abschliessen() {
      /* FITNESS: Siege zählen, Überlebenszeit bricht NUR den
         Gleichstand. Nur Siege wäre in frühen Generationen fast überall
         0 — dann gäbe es nichts zu sortieren und die Auswahl wäre
         Zufall.

         DIE GEWICHTUNG IST DER GANZE PUNKT. Hier stand erst
         "+ 0,02 × Sekunden". Bei bis zu 96 s Rundenzeit trug die Zeit
         damit bis zu 1,92 bei, ein perfekter Sieganteil nur 1,0 — die
         Fitness belohnte Im-Kreis-Fahren mehr als Gewinnen. Genau
         dieser Fehler steckte schon in der Belohnung in features.js.
         Jetzt ist die Zeit auf die Rundenlänge normiert und auf 0,3
         gedeckelt: sie kann eine Reihenfolge entscheiden, aber niemals
         einen Sieg aufwiegen. */
      const maxZeit = opt.maxTicks * (RULES.TICK_MS / 1000);
      for (const e of population) {
        const m = Math.max(e.matches, 1);
        e.fitness = e.siege / m + 0.3 * Math.min((e.zeit / m) / maxZeit, 1);
      }
      population.sort((a, b) => b.fitness - a.fitness);

      const beste = population[0];
      const schnitt = population.reduce((s, e) => s + e.fitness, 0) / population.length;

      /* DER URAHN — der einzige absolute Massstab ohne handgeschriebene
         Gegner. Er ist der Beste der Generation 0 und ändert sich NIE.

         Gegen die wachsende Ahnengalerie zu messen war nutzlos: die
         Ahnen werden selbst besser, also fällt die Quote, obwohl die
         Population sich verbessert. Gegen einen eingefrorenen Gegner
         muss sie steigen — und wenn nicht, dreht sich die Population im
         Kreis, egal wie gut die Rangliste aussieht. */
      let gegenUrahn = null;
      if (urahn) {
        let siege = 0;
        for (let m = 0; m < opt.ahnenMatches; m++) {
          /* 1v1 und feste Seeds: sonst misst man den Zufall mit. Die
             Seiten tauschen, damit der Startplatz nicht entscheidet. */
          const feld = m % 2 === 0 ? [beste.netz, urahn.netz] : [urahn.netz, beste.netz];
          const erg = kampf(feld, 800000 + m, opt.maxTicks, m);
          if (erg.sieger === (m % 2 === 0 ? 0 : 1)) siege++;
        }
        gegenUrahn = siege / opt.ahnenMatches;
      }

      verlauf.push({
        generation, beste: beste.fitness, schnitt,
        siegeBeste: beste.siege, matchesBeste: beste.matches,
        gegenUrahn, mutation: staerke(),
      });

      if (!urahn) urahn = { generation, netz: ladeNetz(netzAlsJson(beste.netz)) };
      if (generation % opt.ahnenAlle === 0) {
        ahnen.push({ generation, netz: ladeNetz(netzAlsJson(beste.netz)) });
        if (ahnen.length > 8) ahnen.shift();      // die ältesten fallen raus
      }

      /* VERERBEN: die Elite bleibt unverändert, der Rest sind mutierte
         Kinder der Elite. Die Elite unverändert zu lassen ist wichtig —
         sonst kann eine Generation schlechter enden als die davor. */
      const elite = population.slice(0, opt.elite);
      for (const e of elite) e.alter++;
      const kinder = [];
      while (elite.length + kinder.length < opt.groesse) {
        /* Je weiter vorn, desto häufiger Elternteil. */
        const i = Math.floor(Math.pow(rng(), 2) * elite.length);
        kinder.push(mutiere(elite[i]));
      }

      population = [...elite.map((e) => ({ ...e, fitness: e.fitness,
                                           siege: 0, matches: 0, zeit: 0, strecke: 0,
                                           herkunft: "elite" })), ...kinder];
      generation++;
      matchNr = 0;

      return verlauf[verlauf.length - 1];
    },

    /* Für die Anzeige: ein Match als LAUFENDES Spiel, das die
       Oberfläche Schritt für Schritt zeichnen kann. */
    schaukampf(indizes, seed) {
      const wer = indizes || besetzung();
      const riders = wer.map((i, platz) => ({
        name: "N" + i,
        color: COLORS[platz % COLORS.length],
        driver: { type: "agent", agent: "netz" + i,
                  fn: netzAgent(population[i].netz, { name: "netz" + i }) },
      }));
      return {
        wer,
        game: createGame({ riders, seed: seed ?? (7000 + generation),
                           arena: arenaFor(), mode: "lms" }),
      };
    },
  };
}
