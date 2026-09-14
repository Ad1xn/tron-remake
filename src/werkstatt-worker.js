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

import { erzeugeEvolution } from "./evolution.js";
import { netzAlsJson } from "./net.js";

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

/* Die Arbeitsschleife. setTimeout(0) statt while(true), damit
   Nachrichten (etwa "anhalten") überhaupt ankommen können. */
function arbeite() {
  if (!laeuft || !evo) return;

  /* Ein Zeitscheibchen rechnen, dann die Warteschlange abarbeiten
     lassen. 40 ms ist lang genug, dass der Aufwand je Scheibe nicht
     auffällt, und kurz genug für eine flüssige Anzeige. */
  const bis = performance.now() + 40;
  let seit = 0;
  while (performance.now() < bis) {
    if (evo.fertig) { generationFertig(); break; }
    evo.naechsterKampf();
    matchesGesamt++;
    if (++seit >= MELDE_ALLE) { melde("fortschritt"); seit = 0; }
  }
  if (seit) melde("fortschritt");

  setTimeout(arbeite, 0);
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
};
