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
import { ladeNetz, netzAlsJson } from "./net.js";
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
let reiter = "schau";             // "schau" | "schwarm"
let schwarmDaten = null;
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

  if (m.typ === "galerie") { zeichneGalerie(m.zeilen); return; }
  if (m.typ === "schwarm") { schwarmDaten = m; zeichneSchwarm(); return; }

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

  if (schau && el("zusehen").checked && reiter === "schau") {
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

  if (reiter === "schau") view.render(dt);

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

/* ------------------------------------------------------------------
   SICHERN UND LADEN
   ------------------------------------------------------------------
   Gesichert wird in den localStorage DIESES Ursprungs — und weil
   werkstatt.html und index.html auf demselben Server liegen, findet das
   Spiel es dort wieder:

       index.html?netz=werkbank

   Zusätzlich fällt eine Datei heraus, damit man ein Netz behalten oder
   weitergeben kann. Der Speicher ist der verlässliche Weg: ein
   Herunterladen kann die Vorschau-Kachel blockieren, localStorage nie.
   ------------------------------------------------------------------ */
export const SPEICHER = "tron-netz-werkbank";

el("sichern").onclick = () => {
  const netz = zustand.spitze[0];
  if (!netz) return;
  const daten = {
    ...netzAlsJson(netz),
    verfahren: "evolution",
    generation: zustand.generation,
    fitness: zustand.verlauf[zustand.verlauf.length - 1]?.beste ?? null,
    gesichert: new Date().toISOString(),
  };
  const text = JSON.stringify(daten);
  try { localStorage.setItem(SPEICHER, text); } catch { /* privates Fenster */ }

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = "netz-gen" + zustand.generation + ".json";
  a.click();
  URL.revokeObjectURL(a.href);

  el("sicher-info").textContent =
    "gesichert · Generation " + zustand.generation + " → index.html?netz=werkbank";
};

el("laden").onclick = () => el("datei").click();
el("datei").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const json = JSON.parse(await f.text());
    worker.postMessage({ typ: "saatgut", netz: json });
    el("sicher-info").textContent = "geladen: " + f.name + " — Population neu gesät";
  } catch (err) {
    el("sicher-info").textContent = "geht nicht: " + err.message;
  }
  e.target.value = "";
};

el("galerie-messen").onclick = () => {
  el("galerie").innerHTML = '<span class="hinweis">misst …</span>';
  worker.postMessage({ typ: "galerie", matches: 12 });
};

/* Die Galerie: je Ahn eine Kachel mit der Quote der aktuellen Spitze
   gegen ihn. Gegen alte Ahnen soll sie hoch sein, gegen junge niedrig —
   liest sich das Bild andersherum, steht die Population still. */
function zeichneGalerie(zeilen) {
  if (!zeilen.length) {
    el("galerie").innerHTML =
      '<span class="hinweis">Noch keine Vorfahren eingefroren — das passiert alle '
      + (zustand.optionen?.ahnenAlle ?? 10) + " Generationen.</span>";
    return;
  }
  el("galerie").innerHTML = zeilen.map((z) => `
    <div class="ahn${z.urahn ? " urahn" : ""}">
      <span class="gen">GEN ${z.generation}${z.urahn ? " · URAHN" : ""}</span>
      <span class="quote" style="color:${farbe(z.quote)}">${(100 * z.quote).toFixed(0)} %</span>
      <span class="balken"><i style="width:${(100 * z.quote).toFixed(0)}%"></i></span>
    </div>`).join("");
}

/* ------------------------------------------------------------------
   DER SCHWARM — viele Matches übereinandergelegt
   ------------------------------------------------------------------
   Das Bild aus Trackmania, für ein Spiel übersetzt, in dem es so nicht
   geht: dort fahren die Geister ein Zeitfahren und berühren einander
   nie, hier verändert jede Wand die Welt für alle anderen. Fünfhundert
   Netze in EINE Arena zu setzen wäre ein Match mit fünfhundert
   Spielern, kein Blick auf fünfhundert Versuche.

   Also: getrennt fahren, gemeinsam zeichnen. Was man sieht, ist die
   VERTEILUNG des Verhaltens — wohin diese Population fährt, wo sie
   endet, und ob sie überhaupt etwas anderes tut als immer dasselbe.

   Eingefärbt wie das Vorbild: grün hat gewonnen, gelb hielt lange
   durch, rot starb früh. Und eine eigene Draufsicht ist es obendrein —
   die drei Kameras im Spiel folgen immer nur einem Bike.
   ------------------------------------------------------------------ */
const schwarmCanvas = el("schwarm");
const sctx = schwarmCanvas.getContext("2d");

function zeichneSchwarm() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = schwarmCanvas.clientWidth, h = schwarmCanvas.clientHeight;
  if (!w || !h) return;
  if (schwarmCanvas.width !== w * dpr || schwarmCanvas.height !== h * dpr) {
    schwarmCanvas.width = w * dpr; schwarmCanvas.height = h * dpr;
  }
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.fillStyle = "#04060c";
  sctx.fillRect(0, 0, w, h);

  if (!schwarmDaten) {
    sctx.fillStyle = "#3d4d70";
    sctx.font = "11px ui-monospace, monospace";
    sctx.fillText("„fahren\" drücken — dann fahren die Netze der aktuellen", 14, 24);
    sctx.fillText("Generation viele Matches getrennt, und alle Linien", 14, 40);
    sctx.fillText("werden übereinandergelegt.", 14, 56);
    return;
  }

  const A = schwarmDaten.arena || 500;
  const rand = 10;
  const k = Math.min(w - rand * 2, h - rand * 2) / A;
  const ox = (w - A * k) / 2, oy = (h - A * k) / 2;
  const PX = (x) => ox + x * k, PY = (y) => oy + y * k;

  /* Die Arena als dünner Rahmen — sonst schwebt der Schwarm im Nichts. */
  sctx.strokeStyle = "#16233f";
  sctx.lineWidth = 1;
  sctx.strokeRect(PX(0), PY(0), A * k, A * k);

  const maxZeit = Math.max(...schwarmDaten.bahnen.map((b) => b.zeit), 1);
  sctx.lineWidth = 1;
  sctx.lineJoin = "round";

  for (const b of schwarmDaten.bahnen) {
    const p = b.punkte;
    if (p.length < 4) continue;
    const t = Math.min(b.zeit / maxZeit, 1);
    /* grün = gewonnen, sonst gelb→rot nach Lebensdauer */
    sctx.strokeStyle = b.gewonnen
      ? "rgba(125,255,160,0.55)"
      : `hsla(${55 * t} 90% 55% / ${0.10 + 0.22 * t})`;
    sctx.beginPath();
    sctx.moveTo(PX(p[0]), PY(p[1]));
    for (let i = 2; i < p.length; i += 2) sctx.lineTo(PX(p[i]), PY(p[i + 1]));
    sctx.stroke();

    /* Das Ende markieren: dort steckt die eigentliche Information. */
    const ex = PX(p[p.length - 2]), ey = PY(p[p.length - 1]);
    sctx.fillStyle = b.gewonnen ? "rgba(125,255,160,0.9)" : "rgba(255,80,90,0.45)";
    sctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
  }

  sctx.fillStyle = "#4d5f85";
  sctx.font = "10px ui-monospace, monospace";
  sctx.fillText(schwarmDaten.matches + " Matches · " + schwarmDaten.bahnen.length
    + " Bahnen · Generation " + schwarmDaten.generation, 12, h - 24);
  sctx.fillStyle = "#7dffa0"; sctx.fillText("gewonnen", 12, h - 10);
  sctx.fillStyle = "#e8d44a"; sctx.fillText("lange durchgehalten", 78, h - 10);
  sctx.fillStyle = "#ff5a5a"; sctx.fillText("früh gestorben", 200, h - 10);
}

function setzeReiter(welcher) {
  reiter = welcher;
  el("tab-schau").classList.toggle("an", welcher === "schau");
  el("tab-schwarm").classList.toggle("an", welcher === "schwarm");
  el("board").hidden = welcher !== "schau";
  el("labels").hidden = welcher !== "schau";
  schwarmCanvas.hidden = welcher !== "schwarm";
  el("schwarm-messen").hidden = welcher !== "schwarm";
  if (welcher === "schau") { view.resize(); }
  else zeichneSchwarm();
}

el("tab-schau").onclick = () => setzeReiter("schau");
el("tab-schwarm").onclick = () => setzeReiter("schwarm");
el("schwarm-messen").onclick = () => {
  schwarmDaten = null;
  zeichneSchwarm();
  sctx.fillStyle = "#7dffa0";
  sctx.font = "11px ui-monospace, monospace";
  sctx.fillText("fährt …", 14, 24);
  worker.postMessage({ typ: "schwarm", matches: 40 });
};

window.addEventListener("resize", () => {
  view.resize(); zeichneKurve();
  if (reiter === "schwarm") zeichneSchwarm();
});

aufsetzen();
requestAnimationFrame(schleife);

window.WERKBANK = {
  get zustand() { return zustand; },
  get schau() { return schau; },
  start: () => el("start").click(),
  generation: () => el("schritt").click(),
};
