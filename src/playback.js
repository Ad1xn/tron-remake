/* =========================================================================
   PLAYBACK — der Zuschauerraum für aufgezeichnete Matches.
   =========================================================================
   Warum das existiert: eine Verlustkurve im Terminal sieht gleich aus,
   egal ob ein Netz Tron gelernt hat oder ob es gelernt hat, im Kreis zu
   fahren, um den Überlebens-Bonus abzugrasen. Zuschauen zeigt den
   Unterschied in drei Sekunden. Das hier ist kein Spielzeug, sondern
   das Werkzeug, mit dem man später die Belohnung debuggt.

   WARUM ES KEINE EIGENE SEITE MEHR IST
   Vorher lag das in arena.html mit einer zweiten Kopie des Cockpits.
   Als style.css und hud.js umgebaut wurden, zog die zweite Kopie nicht
   mit — die Seite starb in der ersten Zeile von hud.setRiders(), weil
   ihr zehn DOM-Ids fehlten. Jetzt gibt es ein Cockpit, ein Markup, eine
   Optik: die Wiedergabe hängt sich an index.html an und benutzt
   denselben Renderer und dasselbe HUD wie das Spiel.

       index.html?replay                 → out/replays
       index.html?replay=pfad/zum/ordner → dieser Ordner

   Die Fahrer kommen nicht aus agents.js, sondern vom Band (replay.js).
   Deshalb braucht die Wiedergabe keine einzige neue Zeile in der Engine.
   ========================================================================= */

import { RULES, MODES } from "./config.js";
import { step } from "./engine.js";
import { tapeToGame, tapeActions } from "./replay.js";

const el = (id) => document.getElementById(id);

export function startPlayback(dir, { view, hud }) {
  let entries = [];            // Inhaltsverzeichnis: { file, label, ticks, winner }
  const cache = new Map();     // file -> Band (Bänder sind winzig, also merken)

  let tape   = null;
  let cursor = -1;
  let game   = null;

  let playing  = false;
  let rate     = 1;
  let acc      = 0;
  let last     = performance.now();
  let frame    = 0;
  let autoNext = true;

  const tickMs = () => RULES.TICK_MS / rate;
  const modeOf = () => (tape && tape.mode) || "lms";

  /* Das Cockpit zeigt beim Zusehen das Bike, dem die Kamera folgt —
     genau wie im Spiel. */
  const shown = () => {
    if (!game) return null;
    const id = view.followId;
    return game.cycles.find((c) => c.id === id)
      || game.cycles.find((c) => c.alive)
      || game.cycles[0];
  };


  /* ----------------------------------------------------------------
     BÄNDER LADEN
     ----------------------------------------------------------------
     Ein statischer Webserver kann keinen Ordner auflisten — darum
     schreibt tools/selfplay.mjs eine index.json mit der Liste.
     ---------------------------------------------------------------- */
  async function loadIndex() {
    try {
      const res = await fetch(dir + "/index.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      entries = (await res.json()).files || [];
    } catch {
      entries = [];
    }

    fillSelect();

    if (!entries.length) {
      hud.show("KEINE AUFNAHMEN",
        "In <b>" + dir + "</b> liegt keine index.json.<br>"
        + "Einzelne .json-Bänder kannst du auch ins Fenster ziehen.",
        "node tools/selfplay.mjs --matches 20 --replays " + dir);
      return;
    }
    await load(0);
  }

  async function getTape(entry) {
    if (cache.has(entry.file)) return cache.get(entry.file);
    const res = await fetch(dir + "/" + entry.file, { cache: "no-store" });
    const t = await res.json();
    cache.set(entry.file, t);
    return t;
  }

  function fillSelect() {
    el("rp-select").innerHTML = entries.map((e, i) =>
      `<option value="${i}">${String(i + 1).padStart(3, "0")} · ${e.label || e.file}`
      + ` · ${e.ticks} Ticks · ${e.winner || "unentschieden"}</option>`).join("");
  }


  /* ----------------------------------------------------------------
     EIN BAND AUFLEGEN
     ---------------------------------------------------------------- */
  async function load(i, { play = true } = {}) {
    if (!entries.length) return;
    cursor = (i + entries.length) % entries.length;
    tape = await getTape(entries[cursor]);

    el("rp-select").value = String(cursor);
    build();
    hud.hide();
    playing = play;
    refresh();
  }

  /* Frisches Spiel aus dem Band. Das ist die ganze Wiedergabe-Logik:
     die Fahrer sind Agenten, die ihre Antwort nachschlagen. */
  function build() {
    game = tapeToGame(tape);
    view.setGame(game);
    view.follow(game.cycles[0].id);
    hud.setRiders(game.cycles, modeOf());
    el("rp-scrub").max = String(tape.ticks.length);
    el("rp-scrub").value = "0";
    acc = 0;
    refresh();
  }

  /* Ein Tick. visual=false beim Spulen: sonst knallt es beim Ziehen am
     Regler dutzende Mal hintereinander. */
  function tickOnce(visual = true) {
    if (!game || game.phase !== "running") return null;

    const events = step(game, tapeActions(tape, game));
    if (visual) for (const d of events.deaths) view.explode(d.cycle);
    if (events.finished) finish(events.survivors);
    return events;
  }

  function finish(survivors) {
    playing = false;
    const winner = survivors.length === 1 ? survivors[0] : null;

    /* PASST DAS BAND NOCH ZUR PHYSIK?
       Ein Band speichert nur seed + Richtungen; nachgespielt wird es mit
       der Engine von HEUTE. Ändert sich eine Regel, läuft eine alte
       Aufnahme auseinander — und zwar lautlos. Genau das darf beim
       Zuschauen nicht passieren: man hielte das Auseinanderlaufen sonst
       für schlechtes Fahren und suchte den Fehler im Netz.
       Die Aufnahme weiss, wie lang sie war — das ist die Probe. */
    const soll = tape.result?.ticks;
    const abgewichen = Number.isFinite(soll) && game.tick !== soll;

    if (abgewichen) {
      playing = false;
      hud.show("BAND PASST NICHT ZUR PHYSIK",
        "Aufgenommen mit <b>" + soll + "</b> Ticks, nachgespielt endet es "
        + "nach <b>" + game.tick + "</b>. Seit der Aufnahme hat sich eine "
        + "Regel geändert — was du gesehen hast, ist nicht das "
        + "aufgenommene Match.<br>Neu aufnehmen:",
        "node tools/selfplay.mjs --matches 20 --replays " + dir);
      return;                                   // kein Weiterschalten
    }

    hud.show(
      winner ? winner.name + " GEWINNT" : "UNENTSCHIEDEN",
      (winner ? winner.driver.agent + " · " : "") + game.time.toFixed(1) + " s",
      autoNext && entries.length > 1 ? "gleich weiter …" : "N = nächstes Band",
    );
    if (autoNext && entries.length > 1) setTimeout(() => {
      if (!playing) load(cursor + 1);
    }, 1400);
  }

  /* Zu einem Tick springen: neu aufbauen und stumm vorspulen. Geht, weil
     das Band deterministisch ist — es gibt keinen anderen Weg zu Tick 120
     als die 120 Schritte, aber die kosten nichts. */
  function seek(target) {
    build();
    hud.hide();
    for (let i = 0; i < target && game.phase === "running"; i++) tickOnce(false);
    refresh();
  }


  /* ----------------------------------------------------------------
     ANZEIGE — das Cockpit macht hud.js, hier nur die Bandleiste
     ---------------------------------------------------------------- */
  function refresh() {
    if (!game || !tape) return;

    hud.update({ me: shown(), cycles: game.cycles, mode: modeOf() });

    el("rp-tick").textContent  = game.tick + " / " + tape.ticks.length;
    el("rp-count").textContent = (cursor + 1) + " / " + entries.length;
    el("rp-scrub").value = String(Math.min(game.tick, tape.ticks.length));
    el("rp-play").textContent  = playing ? "❚❚" : "▶";
    el("rp-rate-label").textContent = rate.toFixed(2).replace(/0$/, "") + "×";
    el("rp-meta").innerHTML =
      "<b>" + (tape.label || entries[cursor]?.file || "–") + "</b>"
      + " · " + (MODES[modeOf()]?.name || modeOf())
      + " · Seed " + tape.seed + " · Arena " + tape.arena + " m";
  }


  /* ----------------------------------------------------------------
     BEDIENUNG
     ---------------------------------------------------------------- */
  el("rp-play").onclick = () => {
    if (game && game.phase !== "running") { build(); hud.hide(); }
    playing = !playing;
    refresh();
  };
  el("rp-step").onclick    = () => { playing = false; tickOnce(); refresh(); };
  el("rp-back").onclick    = () => { playing = false; seek(Math.max(0, game.tick - 1)); };
  el("rp-restart").onclick = () => { build(); hud.hide(); playing = true; };
  el("rp-prev").onclick    = () => load(cursor - 1);
  el("rp-next").onclick    = () => load(cursor + 1);
  el("rp-reload").onclick  = () => { cache.clear(); loadIndex(); };

  el("rp-select").onchange = (e) => load(Number(e.target.value));
  el("rp-scrub").oninput   = (e) => { playing = false; seek(Number(e.target.value)); };
  el("rp-rate").oninput    = (e) => { rate = Number(e.target.value); refresh(); };
  el("rp-auto").onchange   = (e) => { autoNext = e.target.checked; refresh(); };

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    const keys = {
      Space:      () => el("rp-play").click(),
      ArrowRight: () => el("rp-step").click(),
      ArrowLeft:  () => el("rp-back").click(),
      KeyN:       () => load(cursor + 1),
      KeyP:       () => load(cursor - 1),
      KeyR:       () => el("rp-restart").click(),
      KeyC:       () => view.toggleMode(),
      KeyF:       () => {
        if (!game) return;
        const alive = game.cycles.filter((c) => c.alive);
        if (!alive.length) return;
        const i = alive.findIndex((c) => c.id === view.followId);
        view.follow(alive[(i + 1) % alive.length].id);
      },
    };
    if (keys[e.code]) { e.preventDefault(); keys[e.code](); }
  });

  /* Bänder auch per Drag & Drop, damit man eine einzelne Datei anschauen
     kann, ohne einen Server zu starten. */
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.name.endsWith(".json"));
    if (!files.length) return;

    entries = [];
    cache.clear();
    for (const f of files) {
      const t = JSON.parse(await f.text());
      if (!t.ticks) continue;                        // keine index.json annehmen
      cache.set(f.name, t);
      entries.push({
        file: f.name, label: t.label || f.name,
        ticks: t.result?.ticks ?? t.ticks.length, winner: t.result?.winner,
      });
    }
    fillSelect();
    if (entries.length) load(0);
  });


  /* ----------------------------------------------------------------
     DIE SCHLEIFE — gleiche zwei Uhren wie main.js, nur dass der
     Tempo-Regler bestimmt, wie lang ein Tick dauert.
     ---------------------------------------------------------------- */
  function loop(now) {
    const dt = Math.min(now - last, 100);
    last = now;
    frame++;

    if (playing && game && game.phase === "running") {
      acc += dt;
      let guard = 0;
      while (acc >= tickMs() && game.phase === "running" && guard++ < 8) {
        acc -= tickMs();
        tickOnce();
      }
      refresh();
    }

    view.render(dt);
    /* Erst wenn ein Band liegt: hud.tags() setzt Namensschilder, die es
       vor dem ersten build() noch gar nicht gibt. */
    if (game && frame % 2 === 0) hud.tags(view.project, view.followId);
    requestAnimationFrame(loop);
  }

  el("replay-bar").hidden = false;
  document.body.classList.add("replaying");
  hud.show("ARENA", "Aufnahmen werden geladen …", "Leertaste = abspielen");

  loadIndex();
  requestAnimationFrame(loop);

  /* Für die Konsole — dieselbe Rolle wie window.TRON im Spiel. */
  return {
    get game() { return game; },
    get tape() { return tape; },
    get view() { return view; },
    load, seek, tickOnce,
  };
}
