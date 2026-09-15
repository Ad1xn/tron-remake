/* =========================================================================
   WORKER — hier läuft das Training, und zwar unabhängig vom Bild.
   =========================================================================
   WARUM ÜBERHAUPT EIN WORKER

   Erst hing das Training an requestAnimationFrame: pro Bild ein paar
   Millisekunden rechnen. Gemessen in der Vorschau-Kachel des Editors:
   1,0 Bild pro Sekunde. Ein Match kostet 13 ms, es wären also 75 Matches
   pro Sekunde drin — angekommen sind 1 bis 2. Die Rechenleistung hing
   daran, ob und wie oft der Browser zeichnen mag.

   Im Worker läuft die Evolution in eigenem Takt weiter, auch wenn das
   Fenster im Hintergrund liegt oder gar nicht gezeichnet wird. Der
   Hauptfaden bekommt nur noch Ergebnisse und zeichnet sie.

   Er darf NICHTS aus render3d.js importieren — Three.js kommt über eine
   importmap, und die gilt im Worker nicht. Alles hier ist reine Logik.
   ========================================================================= */

import { erzeugeEvolution, kampf } from "./evolution.js";
import { netzAlsJson, ladeNetz } from "./net.js";

let evo = null;
let laeuft = false;
let matchesGesamt = 0;

/* Wie oft der Hauptfaden einen Zwischenstand bekommt. Jede Nachricht
   kostet, und 36 Nachrichten je Generation braucht niemand. */
const MELDE_ALLE = 12;

function melde(typ, zusatz = {}) {
  postMessage({ typ, generation: evo?.generation ?? 0,
                matchNr: evo?.matchNr ?? 0, matchesGesamt, ...zusatz });
}

/* Was der Hauptfaden über die Population wissen muss — Netze sind
   gross, also gehen nur die Kennzahlen raus. Die Gewichte kommen extra
   und nur für die, die wirklich gezeigt werden.

   Nach einer abgeschlossenen Generation wird die BEWERTUNG geschickt,
   nicht die frisch aufgestellte Population: deren Kinder sind noch
   nicht gefahren und stünden alle auf 0,00. */
const kennzahlen = () => (evo.bewertung.length ? evo.bewertung
  : evo.population.map((e) => ({
      fitness: e.fitness, siege: e.siege, matches: e.matches,
      herkunft: e.herkunft, alter: e.alter,
    })));

function generationFertig() {
  const z = evo.abschliessen();
  melde("generation", {
    verlauf: evo.verlauf,
    population: kennzahlen(),
    /* Nur die Spitze als Gewichte: daraus baut der Hauptfaden den
       Schaukampf und das Netzbild. */
    spitze: evo.population.slice(0, Math.max(evo.optionen.proMatch, 8))
      .map((e) => netzAlsJson(e.netz)),
    urahn: evo.urahn ? evo.urahn.generation : null,
    mutation: evo.mutationsstaerke,
  });
}

/* NACHGEBEN, OHNE GEDROSSELT ZU WERDEN.
   Eine Endlosschleife würde keine Nachricht mehr durchlassen — "anhalten"
   käme nie an. Also muss zwischen den Zeitscheiben die Warteschlange
   drankommen.

   Der naheliegende Weg, setTimeout(…, 0), ist der falsche: Browser
   dehnen Timer in Tabs, die im Hintergrund liegen, auf bis zu eine
   Sekunde. Gemessen ist der Durchsatz dadurch von 25 auf 7 Matches je
   Sekunde gefallen, sobald das Fenster nicht mehr sichtbar war — und
   genau dann soll das Training ja durchlaufen.

   Ein MessageChannel wird nicht gedrosselt: die Nachricht an den
   eigenen Port kommt sofort zurück und lässt die Warteschlange trotzdem
   dazwischen. */
const kanal = new MessageChannel();
kanal.port1.onmessage = () => arbeite();
const gleichWieder = () => kanal.port2.postMessage(0);

function arbeite() {
  if (!laeuft || !evo) return;

  /* Ein Zeitscheibchen rechnen, dann die Warteschlange abarbeiten
     lassen. Lang genug, dass der Aufwand je Scheibe nicht auffällt,
     kurz genug für eine flüssige Anzeige. */
  const bis = performance.now() + 60;
  let seit = 0;
  while (performance.now() < bis) {
    if (evo.fertig) { generationFertig(); break; }
    evo.naechsterKampf();
    matchesGesamt++;
    if (++seit >= MELDE_ALLE) { melde("fortschritt"); seit = 0; }
  }
  if (seit) melde("fortschritt");

  gleichWieder();
}

onmessage = (e) => {
  const m = e.data;

  if (m.typ === "aufsetzen") {
    evo = erzeugeEvolution(m.optionen);
    matchesGesamt = 0;
    melde("aufgesetzt", {
      population: kennzahlen(),
      spitze: evo.population.slice(0, Math.max(evo.optionen.proMatch, 8))
        .map((x) => netzAlsJson(x.netz)),
      optionen: evo.optionen,
      verlauf: [],
      mutation: evo.mutationsstaerke,
    });
    return;
  }

  if (m.typ === "start") { if (!laeuft) { laeuft = true; arbeite(); } return; }
  if (m.typ === "stop") { laeuft = false; return; }

  if (m.typ === "eineGeneration") {
    if (!evo) return;
    while (!evo.fertig) { evo.naechsterKampf(); matchesGesamt++; }
    generationFertig();
    return;
  }

  /* DIE AHNENGALERIE — die aktuelle Spitze gegen jeden eingefrorenen
     Vorfahren einzeln. Das ist der ehrliche Fortschrittsbericht ohne
     handgeschriebene Gegner: gegen einen Ahnen aus Generation 10 sollte
     man besser abschneiden als gegen einen aus Generation 60.

     Läuft auf Zuruf und nicht bei jeder Generation — es sind Ahnen mal
     Matches zusätzliche Spiele, und die würden das Training bremsen. */
  if (m.typ === "galerie") {
    if (!evo || !evo.ahnen.length) { postMessage({ typ: "galerie", zeilen: [] }); return; }
    const beste = evo.population[0].netz;
    const proAhn = m.matches || 12;
    const zeilen = [];

    const messe = (gegner) => {
      let siege = 0;
      for (let k = 0; k < proAhn; k++) {
        /* 1v1, Seiten getauscht, Startplätze gestreut — dieselbe
           Sorgfalt wie beim Urahn, sonst misst man ein Match mehrfach. */
        const feld = k % 2 === 0 ? [beste, gegner] : [gegner, beste];
        const erg = kampf(feld, 700000 + k, evo.optionen.maxTicks, k);
        if (erg.sieger === (k % 2 === 0 ? 0 : 1)) siege++;
      }
      return siege / proAhn;
    };

    if (evo.urahn) {
      zeilen.push({ generation: evo.urahn.generation, quote: messe(evo.urahn.netz), urahn: true });
    }
    for (const a of evo.ahnen) {
      if (evo.urahn && a.generation === evo.urahn.generation) continue;
      zeilen.push({ generation: a.generation, quote: messe(a.netz), urahn: false });
    }
    zeilen.sort((a, b) => a.generation - b.generation);
    postMessage({ typ: "galerie", zeilen, generation: evo.generation,
                  matchNr: evo.matchNr, matchesGesamt });
    return;
  }

  /* Ein gespeichertes Netz als Startpunkt: die ganze Population wird
     aus Mutationen davon aufgebaut. So kann man an einem Netz
     weiterarbeiten, statt immer bei Zufall anzufangen. */
  if (m.typ === "saatgut") {
    if (!evo) return;
    const saat = ladeNetz(m.netz);
    evo.saeen(saat);
    melde("aufgesetzt", {
      population: kennzahlen(),
      spitze: evo.population.slice(0, Math.max(evo.optionen.proMatch, 8))
        .map((x) => netzAlsJson(x.netz)),
      optionen: evo.optionen, verlauf: evo.verlauf, mutation: evo.mutationsstaerke,
    });
    return;
  }
};
