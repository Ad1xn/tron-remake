/* =========================================================================
   WERKSTATT — die Oberfläche: zusehen, bedienen, verstehen.
   =========================================================================
   ARBEITSTEILUNG

     Worker (src/werkstatt-worker.js)   rechnet die Evolution, ohne Bild
     Hauptfaden (diese Datei)           zeichnet, was dabei herauskommt

   Warum getrennt: erst hing das Training an requestAnimationFrame. In
   der Vorschau-Kachel lief das mit 1,0 Bild pro Sekunde — statt der
   möglichen 75 Matches je Sekunde kamen 1 bis 2 an. Rechenleistung darf
   nicht davon abhängen, ob der Browser gerade zeichnen mag.

   Der Hauptfaden bekommt je Generation die Kennzahlen der ganzen
   Population und die GEWICHTE der Spitze. Daraus baut er den
   Schaukampf und das Netzbild — beides also echte Netze aus dem
   laufenden Training, keine Nachbildung.
   ========================================================================= */

import { schaukampfSpiel } from "./evolution.js";
import { createRenderer } from "./render3d.js";
import { collectActions } from "./agents.js";
import { step } from "./engine.js";
import { viewOfGame, encodeSensors } from "./features.js";
import { ladeNetz } from "./net.js";
import { erzeugeNetzbild } from "./netzbild.js";
import { RULES } from "./config.js";

const el = (id) => document.getElementById(id);

const view = createRenderer(el("board"));
const netzbild = erzeugeNetzbild(el("netzbild"));
const kurve = el("kurve");
const kctx = kurve.getContext("2d");

const worker = new Worker(new URL("./werkstatt-worker.js", import.meta.url),
                          { type: "module" });

/* Der Hauptfaden hält nur ein ABBILD dessen, was im Worker steht. */
const zustand = {
  generation: 0, matchNr: 0, matchesGesamt: 0,
  population: [], verlauf: [], spitze: [], optionen: null,
  mutation: 0, urahn: null,
};

let laeuft = false;
let schau = null;
let gewaehlt = 0;
let schauAcc = 0;
let letzte = performance.now();
let tempoFenster = [];


/* ------------------------------------------------------------------
   NACHRICHTEN AUS DEM WORKER
   ------------------------------------------------------------------ */
worker.onmessage = (e) => {
  const m = e.data;
  zustand.generation = m.generation;
  zustand.matchNr = m.matchNr;

  if (m.matchesGesamt > zustand.matchesGesamt) {
    tempoFenster.push({ t: performance.now(), n: m.matchesGesamt - zustand.matchesGesamt });
  }
  zustand.matchesGesamt = m.matchesGesamt;

  if (m.typ === "aufgesetzt" || m.typ === "generation") {
    zustand.population = m.population;
    zustand.verlauf = m.verlauf;
    zustand.spitze = m.spitze.map(ladeNetz);
    zustand.mutation = m.mutation;
    if (m.optionen) zustand.optionen = m.optionen;
    if (m.urahn !== undefined) zustand.urahn = m.urahn;
    if (gewaehlt >= zustand.population.length) gewaehlt = 0;
    zeichnePopulation();
    zeichneKurve();
    neuerSchaukampf();
  }
};

function aufsetzen() {
  laeuft = false;
  el("start").textContent = "▶ TRAINIEREN";
  el("start").classList.remove("laeuft");
  schau = null;
  gewaehlt = 0;
  tempoFenster = [];
  worker.postMessage({ typ: "aufsetzen", optionen: {
    groesse: Number(el("groesse").value) || 24,
    matches: Number(el("matches").value) || 36,
    elite: Number(el("elite").value) || 6,
    mutation: Number(el("mutation").value) || 0.08,
    seed: 1,
  }});
}


/* ------------------------------------------------------------------
   SCHAUKAMPF
   ------------------------------------------------------------------
   Die Spitze der aktuellen Generation gegeneinander — das ist das
   Sehenswerte. Die Netze kommen als Gewichte aus dem Worker, fahren
   hier also genau so wie dort.
   ------------------------------------------------------------------ */
function neuerSchaukampf() {
  const wieViele = Math.min(zustand.optionen?.proMatch ?? 4, zustand.spitze.length);
  if (!wieViele) return;
  const netze = zustand.spitze.slice(0, wieViele);
  const game = schaukampfSpiel(netze, 7000 + zustand.generation, 0,
                               netze.map((_, i) => "#" + (i + 1)));
  schau = { game };
  view.setGame(game);
  view.setMode("drone");
  view.follow(game.cycles[0].id);
  schauAcc = 0;
  el("schaukampf-info").textContent =
    "Generation " + zustand.generation + " · die besten " + wieViele + " gegeneinander";
}


/* ------------------------------------------------------------------
   DIE ZEICHEN-SCHLEIFE — rechnet nichts mehr, zeigt nur
   ------------------------------------------------------------------ */
function schleife(jetzt) {
  const dt = Math.min(jetzt - letzte, 100);
  letzte = jetzt;

  if (schau && el("zusehen").checked) {
    schauAcc += dt;
    let schritte = 0;
    while (schauAcc >= RULES.TICK_MS && schritte < 8
           && schau.game.phase === "running") {
      schauAcc -= RULES.TICK_MS;
      schritte++;
      const ev = step(schau.game, collectActions(schau.game));
      for (const d of ev.deaths) view.explode(d.cycle);
    }
    if (schau.game.phase !== "running") neuerSchaukampf();
  }

  view.render(dt);

  /* Das Netzbild zeigt das GEWÄHLTE Netz, gefüttert mit den Sensoren
     des Bikes, dem die Kamera folgt. Sind beide dasselbe Netz, sieht
     man genau die Entscheidung, die gerade gefahren wird. */
  const netz = zustand.spitze[gewaehlt] || zustand.spitze[0];
  if (netz) {
    netzbild.setNetz(netz);
    let x = null;
    if (schau) {
      const c = schau.game.cycles.find((k) => k.id === view.followId && k.alive);
      if (c) x = encodeSensors(viewOfGame(schau.game, c.id));
    }
    netzbild.zeichne(x);
  }

  anzeigen();
  requestAnimationFrame(schleife);
}


/* ------------------------------------------------------------------
   ANZEIGE
   ------------------------------------------------------------------ */
function anzeigen() {
  const v = zustand.verlauf[zustand.verlauf.length - 1];
  el("z-gen").textContent = zustand.generation;
  el("z-match").textContent = zustand.matchNr + " / " + (zustand.optionen?.matches ?? "–");
  el("z-beste").textContent = v ? v.beste.toFixed(3) : "–";
  el("z-schnitt").textContent = v ? v.schnitt.toFixed(3) : "–";
  el("z-mut").textContent = zustand.mutation ? zustand.mutation.toFixed(3) : "–";
  el("z-total").textContent = zustand.matchesGesamt;

  const jetzt = performance.now();
  tempoFenster = tempoFenster.filter((e) => jetzt - e.t < 2000);
  const n = tempoFenster.reduce((s, e) => s + e.n, 0);
  el("z-tempo").textContent = laeuft ? (n / 2).toFixed(0) : "–";

  const e = zustand.population[gewaehlt];
  el("netz-info").textContent = e
    ? "Platz " + (gewaehlt + 1) + " · " + e.herkunft
      + (gewaehlt < zustand.spitze.length ? "" : " (nur Spitze wird gezeigt)")
    : "–";
}

/* Fitness → Farbe. Rot schlecht, grün gut — dieselbe Sprache wie in den
   Trackmania-Bildern, an denen die Idee hängt. */
const farbe = (t) =>
  `hsl(${130 * Math.max(0, Math.min(t, 1))} 70% ${18 + 22 * Math.max(0, Math.min(t, 1))}%)`;

function zeichnePopulation() {
  const pop = zustand.population;
  if (!pop.length) return;
  const max = Math.max(...pop.map((e) => e.fitness), 0.001);
  el("pop").innerHTML = pop.map((e, i) => `
    <div class="kachel${i === gewaehlt ? " gewaehlt" : ""}" data-i="${i}"
         style="background:${farbe(Math.max(e.fitness, 0) / max)}"
         title="${e.siege}/${e.matches} Siege">
      <span class="nr">#${String(i + 1).padStart(2, "0")}</span>
      <b class="fit">${e.fitness.toFixed(2)}</b>
      <span class="art">${e.herkunft}${e.alter ? " ×" + e.alter : ""}</span>
    </div>`).join("");
  el("pop-info").textContent =
    "nach Fitness sortiert · " + (zustand.optionen?.elite ?? "–")
    + " Elite bleibt unverändert"
    + (zustand.urahn !== null ? " · Urahn aus Generation " + zustand.urahn : "");
}

function zeichneKurve() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = kurve.clientWidth, h = kurve.clientHeight;
  if (!w || !h) return;
  if (kurve.width !== w * dpr || kurve.height !== h * dpr) {
    kurve.width = w * dpr; kurve.height = h * dpr;
  }
  kctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  kctx.clearRect(0, 0, w, h);

  const V = zustand.verlauf;
  if (V.length < 2) {
    kctx.fillStyle = "#3d4d70";
    kctx.font = "10px ui-monospace, monospace";
    kctx.fillText("… noch keine zwei Generationen abgeschlossen", 10, 18);
    return;
  }

  const pad = 22;
  const maxF = Math.max(...V.map((e) => e.beste), 0.1) * 1.1;
  const X = (i) => pad + (w - pad - 8) * (i / Math.max(V.length - 1, 1));
  const Y = (f) => h - pad + (pad - 8 - (h - pad - 8) * (f / maxF));

  kctx.strokeStyle = "#0e1729";
  kctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const y = Y(maxF * k / 4);
    kctx.beginPath(); kctx.moveTo(pad, y); kctx.lineTo(w - 8, y); kctx.stroke();
  }

  const linie = (feld, stil, breite) => {
    kctx.strokeStyle = stil; kctx.lineWidth = breite;
    kctx.beginPath();
    let auf = false;
    V.forEach((e, i) => {
      const val = feld(e);
      if (val === null || val === undefined) { auf = false; return; }
      if (!auf) { kctx.moveTo(X(i), Y(val)); auf = true; } else kctx.lineTo(X(i), Y(val));
    });
    kctx.stroke();
  };

  linie((e) => e.schnitt, "#3f6fb0", 1.5);
  linie((e) => e.beste, "#11ffff", 2);
  /* Gegen den Urahn ist ein ANTEIL, keine Fitness — auf dieselbe Höhe
     gelegt, damit beides in ein Bild passt, und gestrichelt, damit man
     die verschiedenen Einheiten nicht verwechselt. */
  kctx.setLineDash([3, 3]);
  linie((e) => (e.gegenUrahn == null ? null : e.gegenUrahn * maxF), "#7dffa0", 1.5);
  kctx.setLineDash([]);

  kctx.font = "9px ui-monospace, monospace";
  kctx.fillStyle = "#11ffff"; kctx.fillText("beste", 4, 12);
  kctx.fillStyle = "#3f6fb0"; kctx.fillText("mittel", 4, 24);
  kctx.fillStyle = "#7dffa0"; kctx.fillText("vs Urahn", 4, 36);
  kctx.fillStyle = "#3d4d70";
  kctx.fillText("Gen " + V[V.length - 1].generation, w - 52, h - 6);
}


/* ------------------------------------------------------------------
   BEDIENUNG
   ------------------------------------------------------------------ */
el("start").onclick = () => {
  laeuft = !laeuft;
  worker.postMessage({ typ: laeuft ? "start" : "stop" });
  el("start").textContent = laeuft ? "⏸ ANHALTEN" : "▶ TRAINIEREN";
  el("start").classList.toggle("laeuft", laeuft);
  if (!laeuft) tempoFenster = [];
};

el("schritt").onclick = () => worker.postMessage({ typ: "eineGeneration" });
el("zuruck").onclick = aufsetzen;

el("pop").onclick = (e) => {
  const k = e.target.closest(".kachel");
  if (!k) return;
  gewaehlt = Number(k.dataset.i);
  zeichnePopulation();
};

el("board").onclick = () => {
  if (!schau) return;
  const lebend = schau.game.cycles.filter((c) => c.alive);
  if (!lebend.length) return;
  const i = lebend.findIndex((c) => c.id === view.followId);
  view.follow(lebend[(i + 1) % lebend.length].id);
};

window.addEventListener("resize", () => { view.resize(); zeichneKurve(); });

aufsetzen();
requestAnimationFrame(schleife);

window.WERKBANK = {
  get zustand() { return zustand; },
  get schau() { return schau; },
  start: () => el("start").click(),
  generation: () => el("schritt").click(),
};
