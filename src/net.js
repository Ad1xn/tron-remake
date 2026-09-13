/* =========================================================================
   NETZ — ein winziges Netz, das ein Bike fährt.
   =========================================================================
   Absichtlich klein und ohne Bibliothek: 16 Sensoren → eine verdeckte
   Schicht → drei Ausgänge (geradeaus / links / rechts). Das ist keine
   Sparmassnahme, sondern die Reihenfolge. Erst muss die KETTE stehen —
   Daten sammeln, lernen, mitfahren, gemessen werden — und die prüft man
   mit dem kleinsten Netz, das durchläuft, nicht mit dem besten.

   Das Bild (4 × 24 × 24 aus features.js) kommt später. Dafür braucht es
   Faltung, und Faltung von Hand ist eine eigene Baustelle.

   Dieselbe Datei läuft in Node (Training, Messstand) und im Browser
   (zusehen) — sie kennt weder Dateien noch DOM.

       import { ladeNetz, netzAgent } from "./net.js";
       AGENTS.netz = netzAgent(ladeNetz(gewichteAlsJson));
   ========================================================================= */

import { viewOfGame, encodeSensors, actionOf, SENSOR_NAMES, ACTIONS }
  from "./features.js";

export const NETZ_VERSION = 1;

/* ------------------------------------------------------------------
   AUFBAU
   ------------------------------------------------------------------
   Gewichte liegen flach in einem Array, Zeile für Zeile. Das ist nicht
   hübsch, aber es ist genau das Format, das sich als JSON speichern und
   ohne Umbau wieder laden lässt.
   ------------------------------------------------------------------ */
export function neuesNetz(ein = SENSOR_NAMES.length, verdeckt = 24,
                          aus = ACTIONS.length, rng = Math.random) {
  /* He-Initialisierung: Streuung sqrt(2/ein). Mit zu kleinen Startwerten
     bewegt sich am Anfang nichts, mit zu grossen sättigt tanh sofort. */
  const streu = (n) => Math.sqrt(2 / n);
  const wuerfel = (n, s) => Float64Array.from({ length: n },
    () => (rng() * 2 - 1) * s);

  return {
    version: NETZ_VERSION,
    ein, verdeckt, aus,
    w1: wuerfel(verdeckt * ein, streu(ein)),
    b1: new Float64Array(verdeckt),
    w2: wuerfel(aus * verdeckt, streu(verdeckt)),
    b2: new Float64Array(aus),
  };
}

/* Vorwärts. `zwischen` wird beim Training für die Ableitung gebraucht;
   beim Fahren interessiert nur `roh`. */
export function vorwaerts(netz, x, zwischen = null) {
  const { ein, verdeckt, aus, w1, b1, w2, b2 } = netz;

  const h = zwischen ? zwischen.h : new Float64Array(verdeckt);
  for (let j = 0; j < verdeckt; j++) {
    let s = b1[j];
    const off = j * ein;
    for (let i = 0; i < ein; i++) s += w1[off + i] * x[i];
    h[j] = Math.tanh(s);
  }

  const roh = zwischen ? zwischen.roh : new Float64Array(aus);
  for (let k = 0; k < aus; k++) {
    let s = b2[k];
    const off = k * verdeckt;
    for (let j = 0; j < verdeckt; j++) s += w2[off + j] * h[j];
    roh[k] = s;
  }
  return roh;
}

/* Softmax, numerisch stabil (erst das Maximum abziehen — sonst kippt
   Math.exp bei grossen Werten ins Unendliche). */
export function softmax(roh, out = new Float64Array(roh.length)) {
  let max = -Infinity;
  for (const v of roh) if (v > max) max = v;
  let summe = 0;
  for (let i = 0; i < roh.length; i++) { out[i] = Math.exp(roh[i] - max); summe += out[i]; }
  for (let i = 0; i < roh.length; i++) out[i] /= summe;
  return out;
}

export const groesster = (a) => {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
  return b;
};


/* ------------------------------------------------------------------
   SPEICHERN UND LADEN
   ------------------------------------------------------------------ */
export function netzAlsJson(netz, zusatz = {}) {
  return {
    version: NETZ_VERSION,
    ...zusatz,
    ein: netz.ein, verdeckt: netz.verdeckt, aus: netz.aus,
    w1: Array.from(netz.w1), b1: Array.from(netz.b1),
    w2: Array.from(netz.w2), b2: Array.from(netz.b2),
  };
}

export function ladeNetz(json) {
  if (json.version !== NETZ_VERSION) {
    throw new Error("Netz-Version " + json.version + ", erwartet " + NETZ_VERSION);
  }
  if (json.ein !== SENSOR_NAMES.length) {
    /* Der Fehler, der sonst NIE auffällt: die Sensorliste wächst, das
       gespeicherte Netz kennt die neue Zahl nicht, und es fährt
       trotzdem — nur eben mit verschobenen Eingängen. */
    throw new Error("Netz erwartet " + json.ein + " Sensoren, features.js"
      + " liefert " + SENSOR_NAMES.length);
  }
  return {
    version: json.version,
    ein: json.ein, verdeckt: json.verdeckt, aus: json.aus,
    w1: Float64Array.from(json.w1), b1: Float64Array.from(json.b1),
    w2: Float64Array.from(json.w2), b2: Float64Array.from(json.b2),
  };
}


/* ------------------------------------------------------------------
   ALS AGENT
   ------------------------------------------------------------------
   Die Schnittstelle aus agents.js: ({ game, cycle, rng }) → { turn,
   brake }. Damit läuft das Netz überall, wo auch ein Bot läuft — im
   Browser, im Messstand, in einem Band.

   `temperatur` > 0 würfelt aus der Verteilung statt den höchsten Wert zu
   nehmen. Beim BEWERTEN will man 0 (immer dasselbe, also vergleichbar),
   beim Datensammeln etwas Streuung.
   ------------------------------------------------------------------ */
export function netzAgent(netz, { temperatur = 0, name = "netz" } = {}) {
  const p = new Float64Array(netz.aus);

  const agent = ({ game, cycle, rng }) => {
    const x = encodeSensors(viewOfGame(game, cycle.id));
    const roh = vorwaerts(netz, x);

    if (temperatur <= 0) return actionOf(groesster(roh));

    for (let i = 0; i < roh.length; i++) roh[i] /= temperatur;
    softmax(roh, p);
    let w = (rng ? rng() : Math.random());
    for (let i = 0; i < p.length; i++) { w -= p[i]; if (w <= 0) return actionOf(i); }
    return actionOf(p.length - 1);
  };

  /* selfplay.mjs liest diesen Namen für die Tabelle. */
  agent.agentName = name;
  return agent;
}
