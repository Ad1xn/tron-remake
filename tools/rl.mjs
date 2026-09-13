#!/usr/bin/env node
/* =========================================================================
   RL — Verstärkungslernen: das Netz lernt aus der Belohnung, nicht aus
   einem Vorbild.
   =========================================================================
   Der Unterschied zu tools/train.mjs in einem Satz: dort stand in jedem
   Zug die richtige Antwort daneben, hier steht nur eine Zahl — und die
   kommt erst, nachdem gehandelt wurde.

   VERFAHREN: REINFORCE mit Grundlinie. Das einfachste, das funktioniert.

     1. Das Netz fährt und WÜRFELT seine Züge aus der eigenen Verteilung.
        Ohne Würfeln probiert es nie etwas Neues.
     2. Je Zug wird die Belohnung aufgeschrieben.
     3. Rückwärts wird daraus der Ertrag: was ab hier noch kommt,
        abgezinst mit gamma.
     4. Der Ertrag wird über den ganzen Durchgang auf Mittelwert 0 und
        Streuung 1 gebracht — das ist die GRUNDLINIE. Ohne sie zieht die
        Formel jeden Zug hoch, der überhaupt Belohnung brachte, statt nur
        die überdurchschnittlichen.
     5. Gradient: (p − gewürfelt) × Vorteil. Hat der Zug mehr gebracht
        als der Durchschnitt, wird er wahrscheinlicher.

   Die Ableitung selbst steht in src/net.js — dieselbe wie beim
   Nachahmen, nur mit anderem dRoh.

   BENUTZUNG

     node tools/rl.mjs --start out/netz-hunter.json
     node tools/rl.mjs --iterations 60 --matches 30
     node tools/rl.mjs --start out/netz-hunter.json --raum 1

   OPTIONEN
     --start <datei>    von einem nachgeahmten Netz aus starten. SEHR zu
                        empfehlen: aus dem Nichts würfelt das Netz sich
                        die ersten tausend Matches lang nur in Wände.
     --iterations <n>   Durchgänge                  (Standard 40)
     --matches <n>      Matches je Durchgang        (Standard 20)
     --players <n>      Fahrer je Match             (Standard 4)
     --netze <n>        davon vom Netz gesteuert    (Standard 2)
     --gamma <x>        Abzinsung                   (Standard 0.99)
     --lr <x>           Lernrate                    (Standard 0.002)
     --entropie <x>     Neugier-Bonus               (Standard 0.01)
     --raum 0|1         RAUM-Term benutzen          (Standard 0)
     --eval <n>         Matches je Gegner beim Messen (Standard 20)
     --evalEvery <n>    wie oft gemessen wird       (Standard 5)
     --seed <n>         Startwert                   (Standard 1)
     --out <datei>      wohin das BESTE Netz        (Standard out/netz-rl.json)

   WARUM --raum STANDARDMÄSSIG AUS IST
     Der RAUM-Term rastert 4 × 24 × 24 Zellen und kostet damit mehr als
     die halbe Rechenzeit: 38,5 µs je Agentenschritt statt 9,0. Er ist
     ausserdem eine reine DIFFERENZ eines Potentials — über ein ganzes
     Match hebt er sich bis auf Anfang und Ende weg und ändert deshalb
     nicht, welche Strategie die beste ist, nur wie schnell man sie
     findet. Viermal so viel Erfahrung pro Sekunde ist der bessere
     Tausch. Mit --raum 1 kann man es gegenprüfen.

   WORAUF MAN ACHTEN MUSS
     Die Belohnung ist nicht das Ziel — GEWINNEN ist das Ziel. Darum
     wird zwischendurch immer wieder GIERIG (ohne Würfeln) gegen die
     Bots gemessen, und gespeichert wird das Netz mit der besten
     Siegquote, nicht das letzte. Steigt die Belohnung und fällt die
     Siegquote, hat das Netz eine Marotte gefunden: dann in
     index.html?netz=… nachsehen, was es tatsächlich tut.
   ========================================================================= */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { createGame, step, makeRng } from "../src/engine.js";
import { collectActions, AGENTS } from "../src/agents.js";
import { RULES, COLORS } from "../src/config.js";
import { viewOfGame, encodeSensors, actionOf, rewardSnapshot, reward,
         REWARD, ACTIONS, SENSOR_NAMES } from "../src/features.js";
import { neuesNetz, ladeNetz, vorwaerts, softmax, netzAlsJson, netzAgent,
         neueGradienten, neuerZwischenspeicher, rueckwaerts, anwenden }
  from "../src/net.js";
import { runMatch } from "./selfplay.mjs";


function args(argv) {
  const o = { start: "", iterations: 40, matches: 20, players: 4, netze: 2,
              gamma: 0.99, lr: 0.002, entropie: 0.01, raum: 0,
              eval: 20, evalEvery: 5, seed: 1, hidden: 24,
              out: "out/netz-rl.json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--start") o.start = next();
    else if (a === "--out") o.out = next();
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("--") && a.slice(2) in o) o[a.slice(2)] = Number(next());
    else { console.error("Unbekannte Option: " + a); process.exit(1); }
  }
  return o;
}


/* ------------------------------------------------------------------
   EIN DURCHGANG ERFAHRUNG SAMMELN
   ------------------------------------------------------------------
   Das Netz wird als driver.fn eingehängt — dann fragt es dieselbe
   collectActions() wie jeden Bot, mit demselben Takt und derselben
   Zeitgrenze. Kein zweiter Spielablauf, der leise abweichen könnte.
   ------------------------------------------------------------------ */
function sammeln(netz, opt, rng, gewichte, iteration) {
  const zw = neuerZwischenspeicher(netz);
  const botListe = Object.keys(AGENTS);
  const mitRaum = opt.raum !== 0;

  const XS = [], AS = [], RS = [], enden = [];   // enden: Index nach jeder Bahn
  let siege = 0, tode = 0, matches = 0, sekunden = 0;

  for (let m = 0; m < opt.matches; m++) {
    /* Gegner rotieren, damit das Netz nicht einen einzigen Bot auswendig
       lernt. Der Startplatz rotiert mit. */
    const riders = [];
    for (let i = 0; i < opt.players; i++) {
      const istNetz = ((i + m) % opt.players) < opt.netze;
      const bot = botListe[(i + m + iteration) % botListe.length];
      riders.push({
        name: istNetz ? "NETZ" : bot.toUpperCase().slice(0, 6),
        color: COLORS[i % COLORS.length],
        driver: istNetz ? { type: "agent", agent: "netz" } : { type: "agent", agent: bot },
      });
    }

    const game = createGame({
      /* Trainings-Seeds: jeder Durchgang sieht andere Matches, und
         keiner davon kommt in die Nähe von MESS_SEED. */
      riders, seed: opt.seed + iteration * opt.matches + m, mode: "lms",
    });

    /* Je Netz-Bike eine Bahn. `letzter` zeigt auf den zuletzt
       aufgeschriebenen Zug — dorthin wandert die Belohnung. */
    const bahn = new Map();
    for (const c of game.cycles) {
      if (c.driver.agent !== "netz") continue;
      c.driver.fn = ({ game: g, cycle, rng: r }) => {
        const x = encodeSensors(viewOfGame(g, cycle.id));
        vorwaerts(netz, x, zw);
        softmax(zw.roh, zw.p);

        let w = (r ? r() : rng());
        let k = 0;
        for (; k < zw.p.length - 1; k++) { w -= zw.p[k]; if (w <= 0) break; }

        const b = bahn.get(cycle.id);
        b.xs.push(x); b.as.push(k); b.rs.push(0);
        b.letzter = b.rs.length - 1;
        return actionOf(k);
      };
      bahn.set(c.id, { xs: [], as: [], rs: [], letzter: -1,
                       vor: rewardSnapshot(viewOfGame(game, c.id), mitRaum) });
    }

    while (game.phase === "running" && game.tick < 20000) {
      const lebtVorher = new Map(game.cycles.map((c) => [c.id, c.alive]));
      const fragen = game.tick % RULES.AGENT_EVERY === 0;
      const events = step(game, collectActions(game));

      /* Abgerechnet wird im Agenten-Takt UND immer, wenn etwas
         Endgültiges passiert — sonst fällt gerade der Tod unter den
         Tisch, und das ist der Zug, aus dem am meisten zu lernen wäre. */
      if (!fragen && !events.deaths.length && !events.finished) continue;

      for (const c of game.cycles) {
        const b = bahn.get(c.id);
        if (!b || b.letzter < 0 || !lebtVorher.get(c.id)) continue;
        const v = viewOfGame(game, c.id);
        b.rs[b.letzter] += reward(b.vor, v, events, c, gewichte).total;
        b.vor = rewardSnapshot(v, mitRaum);
      }
    }

    matches++; sekunden += game.time;
    for (const c of game.cycles) {
      const b = bahn.get(c.id);
      if (!b) continue;
      if (game.winner === c) siege++;
      if (!c.alive) tode++;

      /* Ertrag rückwärts, dann anhängen. */
      let G = 0;
      const ertrag = new Float64Array(b.rs.length);
      for (let t = b.rs.length - 1; t >= 0; t--) {
        G = b.rs[t] + opt.gamma * G;
        ertrag[t] = G;
      }
      for (let t = 0; t < b.xs.length; t++) {
        XS.push(b.xs[t]); AS.push(b.as[t]); RS.push(ertrag[t]);
      }
      enden.push(XS.length);
    }
  }

  return { XS, AS, RS, siege, tode, matches, sekunden,
           netzBikes: enden.length };
}


/* ------------------------------------------------------------------
   EIN LERNSCHRITT
   ------------------------------------------------------------------ */
function lernen(netz, XS, AS, RS, opt, grad, zw) {
  /* GRUNDLINIE: Erträge auf Mittelwert 0, Streuung 1. Ohne sie wird
     jeder Zug wahrscheinlicher, der überhaupt Belohnung brachte — auch
     ein unterdurchschnittlicher. */
  let summe = 0;
  for (const r of RS) summe += r;
  const mittel = summe / RS.length;
  let quad = 0;
  for (const r of RS) quad += (r - mittel) * (r - mittel);
  const streu = Math.sqrt(quad / RS.length) || 1;

  let entropie = 0;
  for (let i = 0; i < XS.length; i++) {
    const x = XS[i], a = AS[i];
    const vorteil = (RS[i] - mittel) / streu;

    vorwaerts(netz, x, zw);
    softmax(zw.roh, zw.p);

    let H = 0;
    for (const q of zw.p) H -= q * Math.log(Math.max(q, 1e-12));
    entropie += H;

    for (let k = 0; k < netz.aus; k++) {
      const p = zw.p[k];
      /* Zwei Anteile: die Politik selbst, und ein Neugier-Bonus, der
         die Verteilung breit hält. Ohne ihn sagt das Netz nach wenigen
         Durchgängen nur noch eine einzige Aktion und lernt nichts mehr
         dazu — es kann ja nichts anderes mehr ausprobieren. */
      zw.dRoh[k] = (p - (k === a ? 1 : 0)) * vorteil
                 + opt.entropie * p * (Math.log(Math.max(p, 1e-12)) + H);
    }
    rueckwaerts(netz, x, zw, grad);
  }

  anwenden(netz, grad, opt.lr, 1 / XS.length);
  return { mittel, streu, entropie: entropie / XS.length };
}


/* ------------------------------------------------------------------
   MESSEN — gierig, gegen jeden Bot, immer dieselben Seeds
   ------------------------------------------------------------------ */
/* Die Mess-Seeds liegen weit weg von den Trainings-Seeds und ändern
   sich nie. Beides ist nötig: fest, damit Durchgang 5 und Durchgang 40
   überhaupt vergleichbar sind — und getrennt, damit nicht gemessen
   wird, was das Netz gerade geübt hat. Das ist dieselbe Regel wie das
   Teilen nach Matches in tools/train.mjs. */
const MESS_SEED = 900000;

async function messen(netz, opt) {
  const agent = netzAgent(netz, { name: "netz" });
  const zeile = {};
  let gesamt = 0;
  for (const gegner of Object.keys(AGENTS)) {
    let siege = 0;
    for (let m = 0; m < opt.eval; m++) {
      const paar = m % 2 === 0 ? [agent, gegner] : [gegner, agent];
      const res = await runMatch({ agents: paar, seed: MESS_SEED + m, mode: "lms" });
      if (res.winnerAgent === "netz") siege++;
    }
    zeile[gegner] = siege / opt.eval;
    gesamt += zeile[gegner];
  }
  return { zeile, schnitt: gesamt / Object.keys(AGENTS).length };
}


/* ------------------------------------------------------------------
   LOS
   ------------------------------------------------------------------ */
async function main() {
  const opt = args(process.argv.slice(2));
  if (opt.help) { console.log("Siehe Kopf von tools/rl.mjs"); return; }

  const rng = makeRng(opt.seed);
  const gewichte = { ...REWARD, RAUM: opt.raum !== 0 ? REWARD.RAUM : 0 };

  let netz;
  if (opt.start) {
    netz = ladeNetz(JSON.parse(readFileSync(opt.start, "utf8")));
    console.log("\n  Start von " + opt.start + "  (" + netz.ein + " → "
      + netz.verdeckt + " → " + netz.aus + ")");
  } else {
    netz = neuesNetz(SENSOR_NAMES.length, opt.hidden, ACTIONS.length, rng);
    console.log("\n  Start aus dem Nichts  (" + netz.ein + " → "
      + netz.verdeckt + " → " + netz.aus + ")");
  }

  console.log("  " + opt.iterations + " Durchgänge × " + opt.matches
    + " Matches × " + opt.netze + "/" + opt.players + " Netz-Bikes"
    + "   ·   gamma " + opt.gamma + "   ·   lr " + opt.lr
    + "   ·   RAUM " + (opt.raum ? "an" : "aus"));

  const grad = neueGradienten(netz);
  const zw = neuerZwischenspeicher(netz);

  const start = await messen(netz, opt);
  console.log("\n  VORHER   " + Object.entries(start.zeile)
    .map(([g, v]) => g + " " + (100 * v).toFixed(0) + "%").join("  ")
    + "   ·   Schnitt " + (100 * start.schnitt).toFixed(1) + " %");

  let bestes = netzAlsJson(netz), besterSchnitt = start.schnitt, besteIter = 0;

  console.log("\n  DURCHG.   ZÜGE   Ø LOHN   ENTROPIE   SIEGE   TODE"
    + "     ROOKIE GRINDER  HUNTER CRUISER  SCHNITT");
  console.log("  " + "-".repeat(88));

  const t0 = Date.now();
  for (let it = 1; it <= opt.iterations; it++) {
    const erf = sammeln(netz, opt, rng, gewichte, it);
    const st = lernen(netz, erf.XS, erf.AS, erf.RS, opt, grad, zw);

    let zeile = "  " + String(it).padStart(6)
      + String(erf.XS.length).padStart(8)
      + st.mittel.toFixed(2).padStart(9)
      + st.entropie.toFixed(3).padStart(11)
      + (erf.siege + "/" + erf.netzBikes).padStart(9)
      + String(erf.tode).padStart(7);

    if (it % opt.evalEvery === 0 || it === opt.iterations) {
      const m = await messen(netz, opt);
      zeile += ["rookie", "grinder", "hunter", "cruiser"]
        .map((g) => (100 * m.zeile[g]).toFixed(0).padStart(8) + "%").join("")
        .replace(/%/g, " ")
        + (100 * m.schnitt).toFixed(1).padStart(8) + " %";
      if (m.schnitt > besterSchnitt) {
        besterSchnitt = m.schnitt;
        bestes = netzAlsJson(netz);
        besteIter = it;
        zeile += "  ←";
      }
    }
    console.log(zeile);
  }

  console.log("  " + "-".repeat(88));
  console.log("  " + ((Date.now() - t0) / 1000).toFixed(0) + " s"
    + "   ·   bestes Netz aus Durchgang " + besteIter
    + " mit " + (100 * besterSchnitt).toFixed(1) + " %"
    + "   (Start: " + (100 * start.schnitt).toFixed(1) + " %)");

  mkdirSync(dirname(opt.out), { recursive: true });
  writeFileSync(opt.out, JSON.stringify({
    ...bestes, verfahren: "reinforce", durchgang: besteIter,
    schnitt: besterSchnitt, start: opt.start || null,
  }));
  console.log("  " + opt.out + "\n");
}

const direkt = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direkt) main();
