# Übergabe — Tron/Retrocycles-Remake

Text zum Einfügen in einen neuen Chat. Stand: 12.09.2026.

---

## Projekt

`/Users/adrian/aiguru/tron-remake`, Branch `armagetron-remake`.
Ein Remake von **Retrocycles** (= die Steam-Fassung von *Armagetron Advanced*)
in reinem HTML/CSS/JS, Three.js vom CDN, **kein Build**. Alle Kommentare auf
Deutsch. Ziel war ursprünglich: eine KI darauf trainieren.

Start: `python3 tools/serve.py 8123` → <http://localhost:8123>

---

## WICHTIGSTE REGEL: nicht raten, nachlesen

Das gekaufte Spiel liegt lokal. **Jede Regel, jede Zahl, jede Farbe steht dort
drin.** Ich habe wochenlang geraten und lag reihenweise daneben, bis der Nutzer
mich darauf gestossen hat.

```
~/Library/Application Support/Steam/steamapps/common/Retrocycles/Retrocycles.app/Contents/
  etc/Retrocycles-0.2.9.3.0/
    settings.cfg            ← JEDE Einstellung mit Standardwert UND Erklärung
    settings_visual.cfg     ← Kamera, Boden, Rim-Wand
    settings_dedicated.cfg  ← die SP_*-Werte (Einzelspieler!)
    default.cfg             ← Tastenbelegung
    aiplayers.cfg           ← wie das Original seine Bots einstellt (NOCH UNGENUTZT)
    examples/               ← death_zone.cfg, teamsumo.cfg, fortress_soccer.cfg
    examples/cvs_test/      ← fortress_physics/scoring/politics.cfg, sumo_complete.cfg
  Resources/Retrocycles-0.2.9.3.0/
    textures/               ← dir_wall.png, rim_wall.png, floor.png, font_s.png, sky.png
    models/                 ← cycle_body.mod, cycle_front.mod, cycle_rear.mod (UNGENUTZT)
    resource/included/      ← .aamap.xml-Karten (Sumo/Fortress-Layouts)
```

Quellcode dazu: `gh api "repos/ArmagetronAd/armagetronad/contents/<pfad>?ref=trunk" --jq '.content' | base64 -d`
Nützlich waren: `src/tron/gCycleMovement.cpp`, `gCycle.cpp`, `gWall.cpp`,
`gWinZone.cpp`, `gGame.cpp`, `src/engine/eCamera.cpp`, `ePlayer.cpp`,
`src/render/rViewport.cpp`.

**Nichts davon ins Projekt kopieren.** Texturen sind im Code nachgemalt
(`stripeTexture()`, `wallTexture()` in render3d.js). Das Spiel ist gekauft, das
Repo öffentlich.

---

## Arbeitsweise, die sich bewährt hat

1. **Messen statt vermuten.** Jede Behauptung mit einem Skript belegen.
   Beispiele: „Ruckeln in Kurven" → 2,6 ms/Schritt gemessen → Gitter-Index →
   0,03 ms. „Linien gehen weiter als der Fahrer" → Zusicherungen geprüft →
   30.017 schräge Strecken, alle bei toten Fahrern.
2. **Gegenproben schreiben.** Zwei Wege, ein Ergebnis: Index-Strahl gegen
   vollständige Suche (77.096 Strahlen, 0 Abweichungen); `viewOfGame` gegen
   `viewOfObs` in `tools/features-check.mjs`. Beide haben echte Fehler gefunden.
3. **Screenshots des Nutzers sind mehr wert als jede Recherche.** Zwei Bilder
   aus dem Video haben vier Fehler gleichzeitig aufgedeckt.
4. Die Vorschau pausiert `requestAnimationFrame`, wenn das Fenster im
   Hintergrund ist → zum Prüfen `TRON.tickOnce()` in einer Schleife und dann
   `TRON.view.render(16)` aufrufen, sonst ist der Screenshot veraltet.

---

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `src/config.js` | `RULES` (alle Zahlen, mit Originalnamen kommentiert) + `MODES` (die vier Modi) |
| `src/engine.js` | Physik. Rein, kein DOM. Gitter-Index für Strahlen. Läuft in Node |
| `src/agents.js` | Vier Bots: `cruiser`, `grinder`, `hunter`, `rookie`. Denken in ZEIT, nicht Metern |
| `src/features.js` | KI-Wahrnehmung: 16 Sensoren + gerastertes Bild 4×24×24, Belohnung |
| `src/replay.js` | Match = seed + ein Buchstabe je Bike und Schritt |
| `src/render3d.js` | Three.js. Drei Kameras, Instanz-Netze für Wände |
| `src/hud.js` | Cockpit nach `classic.aacockpit.xml` |
| `src/input.js` | Relative Lenkung, Kurvenpuffer, Glance-Tasten |
| `src/main.js` | Schleife, 125 Hz Physik, Modus-/Kamerawechsel, verzweigt auf `?replay` und `?netz` |
| `src/playback.js` | Replay-Betrachter, hängt an `index.html?replay` (löste `arena.html` ab) |
| `src/net.js` | Das Netz: 16 → 24 → 3, als Agent. Läuft in Node *und* im Browser |
| `tools/selfplay.mjs` | Matches ohne Bildschirm, Messstand, alle vier Modi über `--mode` |
| `tools/train.mjs` | Nachahmungslernen: sammeln, lernen, antreten |
| `tools/rl.mjs` | Verstärkungslernen (REINFORCE) auf der Belohnung |
| `tools/features-check.mjs` | Prüft die KI-Wahrnehmung |
| `legacy/` | Das alte Raster-Tron, eingefroren |

---

## Verifizierte Werte (aus settings.cfg des gekauften Spiels)

| Einstellung | Wert | Bemerkung |
| --- | --- | --- |
| `CYCLE_SPEED` | 30 | Quellcode sagt 10, ausgeliefert wird 30 |
| `CYCLE_START_SPEED` | 20 | man startet ÜBER dem Grundtempo |
| `CYCLE_SPEED_MIN` | 0,25 | **Verhältnis** zu CYCLE_SPEED, kein absoluter Wert |
| `CYCLE_SPEED_DECAY_ABOVE/BELOW` | 0,1 / 5 | erarbeitetes Tempo bleibt |
| `CYCLE_ACCEL` | 10 (Fortress: **20**) | Wandbeschleunigung |
| `CYCLE_ACCEL_RIM` | **0** | die Aussenmauer schiebt NICHT |
| `CYCLE_ACCEL_SLINGSHOT/TUNNEL` | 1 / 1 | zwei Wände sind mehr als eine |
| `CYCLE_WALL_NEAR` | 6 | erst ab hier wirkt Grinden |
| `CYCLE_RUBBER` | 1 (+3 Ping), Fortress: **5** | in METERN, streckenbasiert |
| `CYCLE_RUBBER_SPEED` | 40 | Tempo zur Wand ≤ 40 × Abstand |
| `CYCLE_RUBBER_WALL_SHRINK` | 0, Fortress: **1** | Gummi verkürzt die eigene Wand |
| `CYCLE_DELAY` | 0,1 | kürzeste Zeit zwischen Kurven |
| `CYCLE_TURN_SPEED_FACTOR` | 0,95 | **jede Kurve kostet 5 % Tempo** |
| `CYCLE_TURN_MEMORY` | 3 | gepufferte Kurvenbefehle |
| `CYCLE_BRAKE` | 30 | Vorrat standardmässig UNENDLICH (Refill/Deplete 0) |
| `WALLS_LENGTH` | 400 / 800 | „cycle trail length" |
| `WALLS_STAY_UP_DELAY` | 8 (Beispiel: 7) | Wände Verstorbener verschwinden danach |
| `EXPLOSION_RADIUS` | 4 (Fortress: 2) | **sprengt Löcher in alle Wände** |
| Wandhöhe | `REAL h=1;` in gWall.cpp | eine Einheit |
| `SCORE_WIN/KILL/DIE/SUICIDE` | 10 / 3 / −2 / −4 | Fortress: 10 / 2 / 0 / 0 |
| `START_FOV` | **90, waagerecht** | Umrechnung: `ymul = max(aspect/1.5,1)·tan(fov/2)/aspect` |
| `CAMERA_CUSTOM_BACK/RISE` | 6 + 0,5·v / 4 + 0,4·v | bei 30 m/s: 21 m hinten, 16 m hoch |
| `CAMERA_CUSTOM_PITCH` | −0,58 | **Steigung, kein Winkel** → 30,1° nach unten |
| `startCamera` | `CAMERA_CUSTOM` | nicht die Smart-Kamera |
| `FLOOR_RED/GREEN/BLUE` | 0,2 | floor.png selbst ist schwarz mit heller Kante |

### Die vier Modi

| | Teams | Zonen | Win-Zone | Physik |
| --- | --- | --- | --- | --- |
| `lms` | jeder für sich | keine | 60 s / 30 s (siehe unten) | Grundspiel |
| `lts` | zwei | keine | 120 s / 60 s | Grundspiel |
| `fortress` | zwei | je eine, erobern | 120 s / 60 s | Accel 20, Gummi 5 |
| `sumo` | jeder für sich | je eine, **drin bleiben** | 40 s / 20 s, schrumpfend | wie Fortress |

Eine Formel für Fortress **und** Sumo:
`erobert += (Gegner × CONQUEST − Besitzer × DEFEND − DECAY) × dt`
Fortress 0,5 / 0,25 / 0,1 — Sumo 0 / 0,6 / **−0,3** (negativ = die Zone erobert
sich selbst, wenn man nicht drinsteht; wer sie verliert, stirbt).

**Win-Zone:** sie erscheint nur, wenn `Rundenzeit > X` **UND** `Zeit seit letztem
Tod > Y`. Im Einzelspieler steht beides auf 1.000.000, dort gibt es sie also
nicht — **man gewinnt nicht durch Hineinfahren, sondern indem man übrig bleibt.**
In `MODES.lms` stehen trotzdem die Server-Werte (60/30), weil 15 vorsichtige Bots
sonst ewig kreisen (gemessen: 480 s ohne Ende, eine Rundenzeit kennt das Original
nicht). Für volle Originaltreue: `winZone: { round: Infinity, lastDeath: Infinity }`.

---

## Fehler, die ich gemacht habe — bitte nicht wiederholen

- Wände 5 m hoch und durchscheinend gebaut → **sind 1 Einheit hoch und deckend**
- Kamera auf einen Punkt vorne gezielt → **fester Neigungswinkel**
- Sichtfeld 56° senkrecht → **90° waagerecht** (grösster Kamera-Fehler)
- Todeszone gebaut → es ist eine **Win**-Zone, und im Einzelspieler gar keine
- Vogelperspektive erfunden → gibt es nicht (die Drohnenansicht ist eine
  bewusste eigene Zutat des Nutzers, kein Original)
- Punkte fürs Abschiessen auf 0 gesetzt → **SCORE_KILL 3**
- Arena mit der Spielerzahl wachsen lassen → sie ist fest
- Gummi zeitbasiert → **streckenbasiert**, hohes Tempo frisst mehr
- Sieger daran erkannt, wer noch lebt → **die Engine fragen**; bei Win-Zone und
  in Mannschaftsmodi leben mehrere, und einer davon hat gewonnen
- Auf denselben Seeds trainiert und gemessen → **Mess-Seeds trennen** (in
  `rl.mjs` bei 900000) und nie trainieren, sonst misst man das Geübte

---

## Erledigt (Stand 13.09.2026)

Die Werkbank-Frage ist entschieden: **sie bleibt** — sie *ist* das Ziel. Kaputt
war nur der Betrachter, und der war eine zweite Seite mit einer zweiten Kopie
des Cockpits. Eine Seite, ein Markup.

1. ✅ Committet. Acht Commits, alles aus dem Arbeitsverzeichnis.
2. ✅ **Werkbank bleibt.** `arena.html` + `src/arena.js` gelöscht, Wiedergabe als
   `index.html?replay` an dieselbe Seite gehängt (`src/playback.js`).
3. ✅ README auf den Stand gebracht.
4. ✅ `--mode` im Messstand, alle vier Modi messbar.
5. ✅ **Trainings-Prototyp: die Kette ist geschlossen.** Ein nachgeahmtes Netz
   (483 Parameter) schlägt `rookie` zu 86,7 % und `grinder` zu 66,7 %.
   Zusehen: `index.html?netz=out/netz-hunter.json`.
6. ✅ **Verstärkungslernen.** REINFORCE mit Grundlinie auf der reparierten
   Belohnung, 208 Sekunden für 200 Durchgänge:

   | Stufe | rookie | grinder | hunter | cruiser | Schnitt |
   | --- | --- | --- | --- | --- | --- |
   | nachgeahmt | 97,5 % | 52,5 % | 32,5 % | 32,5 % | **53,8 %** |
   | + RL | 92,5 % | 72,5 % | 52,5 % | 62,5 % | **70,0 %** |

   Zusehen: `index.html?netz=out/netz-rl.json`.

### Fehler, die dabei gefunden wurden

Alle fünf waren still — keiner davon warf eine Fehlermeldung:

- **6 tote `RULES`-Schlüssel** aus der Umbenennung auf die Originalnamen. Der
  Sensor `tempo` war in *jedem* Schritt NaN. Der Win-Zone-Radius war NaN,
  wodurch der Standardmodus bei exakt 60 s mit willkürlichem Sieger endete —
  alle vier Fahrer noch am Leben.
- **Der Messstand zählte falsch.** Der Sieger kam aus „wer lebt noch"; das gilt
  nur beim Ausscheiden. 13 von 20 `lms`-Matches galten als unentschieden,
  obwohl es jedes Mal einen Sieger gab.
- **Der Siegbonus feuerte nie.** „Gewonnen" hiess `alle anderen sind tot` —
  bei Win-Zone und in Mannschaftsmodi nie wahr.
- **Die Belohnung wusste nichts über Gewinnen.** Gemessen an 24 Matches hatte
  der Sieger in 29 % der Fälle die höchste Summe (Zufall: 25 %), und die Formel
  setzte `grinder` mit 2 Siegen über `hunter` mit 13. Ursache: `LEBEN − ZEIT`
  trug über eine 60-s-Runde rund 3,8 ein, ein Sieg nur 1,0. `SIEG` steht jetzt
  auf 10 → 75 %.
- **`features-check` verschluckte das Rundenende** und zeigte KILL/TOD/SIEG als
  0,00 — im selben Lauf, der „10 Tode, 5 Siege" meldete.

Die Lehre daraus ist dieselbe wie im Kopf dieses Dokuments, nur schärfer: **jede
Zahl, die niemand nachrechnet, ist vermutlich falsch.** Alle fünf fielen erst
auf, als ein Skript sie gegen etwas anderes hielt.

---

## Offene Punkte

1. **Der Neugier-Bonus müsste abklingen.** Über 200 Durchgänge stieg die
   Entropie von 0,20 auf 0,44 — der feste Bonus (`--entropie 0.01`) schiebt die
   Politik immer weiter Richtung Zufall und deckelt damit vermutlich das
   Ergebnis. Ein abklingender Wert ist der nächste offensichtliche Griff.
2. **Selbstspiel.** Das Netz lernt gegen vier feste Bots und kann darum
   höchstens so gut werden, wie die es fordern.
3. **`TEMPO` halbieren?** 0,05 → 0,025 hebt die Belohnungs-Trefferquote von
   75 % auf 88 %. Bewusst offengelassen: `TEMPO` bringt das Grinden bei, und
   das ist der Kern des Spiels. Eine Entscheidung, kein Fehler.
4. **Das Bild als Eingabe.** 4 × 24 × 24 liegt bereit, braucht aber Faltung.
5. **`aiplayers.cfg` und `models/*.mod` sind ungenutzt** — dort steht, wie das
   Original seine Bots einstellt und wie das Fahrzeug wirklich aussieht.
6. **Kein Bot bremst** (1,5 % der Züge, Vorrat konstant voll). Wer deren Züge
   nachahmt, lernt die Bremse nie kennen.
7. **Keine Übersichtskamera.** Jede der drei Kameras folgt genau einem Bike;
   zum Zuschauen bei 16 Fahrern fehlt eine Ansicht der ganzen Arena.

---

## Leistung (gemessen, 16 Fahrer)

- Physik: **0,021–0,035 ms pro Schritt** (125 Hz gebraucht) = unter 0,5 % eines Kerns
- Browser: ~1,5–3,4 ms pro Bild
- Der Gitter-Index in `engine.js` ist der Grund — ohne ihn waren es 2,6 ms mit
  Ausschlägen, und genau die waren als Ruckeln zu spüren.

## Steuerung

`← →` drehen · `↓` bremsen · `Q E W` links/rechts/hinten schauen ·
`C` Kamera (Bike / Drohne / Cockpit) · `M` Modus · `F` zuschauen ·
`V` KI übernimmt · `R` Neustart · `Leertaste` Start

Konsole: `TRON.mode('sumo')`, `TRON.players(8)`, `TRON.tickOnce()`,
`TRON.view.setMode('drone')`
