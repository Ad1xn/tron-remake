# TRON — Lightcycles

Ein Lightcycle-Spiel in reinem HTML, CSS und JavaScript — kein Build, keine
Bibliothek ausser Three.js aus dem CDN. Der Code ist auf Deutsch kommentiert
und zum Mitlernen gedacht.

Vorbild ist **nicht** das Raster-Tron mit Kästchen, sondern das echte Spiel
(Armagetron Advanced / Retrocycles): die Bikes fahren durchgehend, eine Wand
ist eine dünne Linie, und durch eine schmale Lücke passt man durch.

## Starten

```bash
python3 tools/serve.py 8123
```

Dann <http://localhost:8123> öffnen.

## Steuerung

| Taste | Aktion |
| --- | --- |
| `←` `→` | um 90° drehen (relativ, wie im Original) |
| `↓` | bremsen |
| `Leertaste` | Start und weiter |
| `C` | Kamera: Verfolger / Übersicht |
| `F` | einem anderen Bike zusehen |
| `V` | die KI übernimmt dein Bike |
| `R` | Neustart |

## Die vier Regeln, die das Spiel ausmachen

- **Dünne Wände.** Eine Wand ist eine Strecke, kein Kästchen. Kollision heisst
  „Strahl gegen Strecke". Deshalb passt ein Bike durch jede Lücke, die es
  wirklich trifft — auch durch zwei Zentimeter.
- **Rubber.** Wer in eine Wand fährt, stirbt nicht sofort. Er drückt dagegen
  und verbraucht Gummi (`RULES.RUBBER`, gut eine Sekunde Dauerdruck). Ist der
  Vorrat leer, ist Schluss. Er füllt sich langsam wieder auf. Das ist der
  Grund, warum man sich in Lücken quetschen kann, die zu knapp sind.
- **Grinden.** Nahe an einer Wand zu fahren macht **schneller** — an einer
  fremden mehr als an der eigenen. Aus 30 m/s werden so schnell 60 oder 90.
  Das ist der Kern des Spiels: Tempo holen und dabei genau das Gummi
  riskieren.
- **Endliche Wände und eine Todeszone.** Die eigene Wand verschwindet hinten
  wieder (`WALL_LENGTH`). Die Arena füllt sich also nie — darum wächst nach
  `ZONE_DELAY` Sekunden in der Mitte eine Zone, die tötet und die Fahrer nach
  aussen treibt. Ohne sie würde eine Runde nie enden; das ist nachgemessen,
  nicht vermutet.

Dazu die **Bremse** mit eigenem Vorrat (langsamer = engere Kurve) und eine
kürzeste Zeit zwischen zwei Kurven (`TURN_DELAY`).

Alle Zahlen dazu stehen in `RULES` in [src/config.js](src/config.js), mit
einer Zeile Begründung an jeder.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Aufbau der Seite: HUD, Canvas, Messer, Overlay, Import-Map |
| `style.css` | Arcade-Optik, inklusive der Balken für Rubber/Speed/Brakes |
| `src/config.js` | Alle Regeln als Zahlen, plus die Fahrerliste |
| `src/engine.js` | Die Physik. Kein DOM, keine Grafik, läuft auch in Node |
| `src/agents.js` | Die Bots und die Schnittstelle für eigene KIs |
| `src/features.js` | Was ein Netz sieht und wofür es belohnt wird |
| `src/replay.js` | Match aufnehmen und abspielen: seed + Eingaben, sonst nichts |
| `src/render3d.js` | Die 3D-Bühne: Arena, Wände, Bike-Modell, Bloom, Kamera |
| `src/input.js` | Tastatur; Kurven sind Ereignisse, nicht Zustände |
| `src/hud.js` | Rubber, Speed, Brakes, Punkte, Overlay |
| `src/main.js` | Steckt alle Teile zusammen und hält die Spielschleife |
| `src/arena.js` | Die Steuerung des Zuschauerraums |
| `arena.html` | Aufgenommene Matches anschauen, Schritt für Schritt |
| `tools/serve.py` | Entwicklungs-Server ohne Zwischenspeicher |
| `tools/selfplay.mjs` | Matches ohne Browser: Agenten vergleichen, Daten sammeln |
| `tools/features-check.mjs` | Prüft die Wahrnehmung der KI (siehe unten) |
| `tools/bike-preview.html` | Das Bike-Modell gross und drehbar |
| `legacy/` | Die Vorgänger: 2D in einer Datei, und das komplette Raster-Tron |

Die wichtigste Grenze im Projekt: **`engine.js`, `agents.js` und `features.js`
wissen nichts von Grafik, `render3d.js` ändert nie den Spielzustand.** Deshalb
läuft dasselbe Spiel im Browser *und* tausendfach ohne Bild — und genau das
braucht man, um KIs zu trainieren.

## Wie es läuft

- **Zwei Uhren.** Die Physik tickt in festen Schritten (`TICK_MS` = 8 ms, also
  125 Hz) — nur so ist das Spiel fair und reproduzierbar. Gezeichnet wird bei
  jedem Bildschirmbild. Einen Zwischenschritt zum Glätten braucht es nicht:
  bei 125 Hz und Kommazahlen bewegt sich alles ohnehin flüssig.
- **Vier Achsen, stufenlose Position.** Ein Bike fährt entlang einer von vier
  Richtungen und dreht auf Befehl um 90°. Position und Wände sind Kommazahlen.
- **Agenten werden seltener gefragt** als die Physik rechnet
  (`AGENT_EVERY` = jeder 4. Schritt, ≈31 Hz). Menschen jeden Schritt.
- Gleicher `seed` + gleiche Eingaben = **dasselbe Spiel**, Zentimeter für
  Zentimeter. Darauf beruhen die Replays.

## Eigene KI einbauen

Ein Agent ist eine Funktion, die sagt, ob gedreht und gebremst wird:

```js
import { AGENTS } from "./src/agents.js";

AGENTS.meinNetz = ({ game, cycle, rng }) => ({ turn: 1, brake: false });
```

`turn` ist `+1` links, `-1` rechts, `0` geradeaus. Dann in
[src/config.js](src/config.js) bei `ROSTER` eintragen:

```js
{ name: "NETZ", color: 0x22d3ee, driver: { type: "agent", agent: "meinNetz" } }
```

Zwei Dinge halten den Weg zu einem lokalen Modell frei:

- **Der Rückgabewert darf ein Promise sein.** Die Spielschleife wartet bis
  `RULES.AGENT_BUDGET_MS` auf alle Agenten. Ein Agent kann also ein Modell
  fragen, über HTTP gehen oder in einem Worker rechnen. Antwortet er nicht
  rechtzeitig, fährt sein Bike geradeaus weiter — ein hängendes Modell hält
  das Spiel nicht an.
- **`observe(game, cycleId)`** in `engine.js` liefert den Zustand als reines
  JSON: die drei Strahlen (vorn/links/rechts), Gummi, Tempo, Bremse, die
  Gegner egozentrisch, die Zone und alle Wände flach als Zahlenliste.

Für ein Modell in einem anderen Prozess liegt die Brücke schon da:

```js
AGENTS.meinNetz = makeRemoteAgent("http://localhost:8000/act");
```

Sie schickt die Beobachtung als POST und erwartet `{ "turn": -1, "brake": false }`.

Die vier eingebauten Bots sind absichtlich eine Leiter. Sie denken alle in
**Zeit**, nicht in Metern — bei 30 m/s sind 3 m eine Zehntelsekunde, bei
90 m/s ein Drittel davon:

| Agent | Idee |
| --- | --- |
| `rookie` | weicht erst im letzten Moment aus, würfelt dabei |
| `cruiser` | reagiert früh, biegt zur freieren Seite ab, bremst im Notfall |
| `hunter` | schneidet dem Gegner den Weg ab |
| `grinder` | sucht die Wandnähe fürs Tempo und biegt so spät ab, wie das Gummi es verzeiht |

## Agenten vergleichen und Trainingsdaten sammeln

```bash
node tools/selfplay.mjs --matches 500
node tools/selfplay.mjs --matches 200 --agents grinder,hunter
node tools/selfplay.mjs --matches 150 --matrix                  # jeder gegen jeden
node tools/selfplay.mjs --matches 100 --players 3               # 1v1v1
node tools/selfplay.mjs --matches 20  --replays out/replays     # zum Anschauen
node tools/selfplay.mjs --matches 50  --jsonl daten/spiele.jsonl --record grinder
node tools/selfplay.mjs --help
```

Am Ende steht eine Tabelle: Siege, Prozent, mittlere Platzierung, Punkte,
Abschüsse, verbrauchtes Gummi und Spitzentempo. Die Platzierung ist die
brauchbarste Spalte, sobald mehr als zwei mitfahren — „zweiter von vier" sagt
mehr als „nicht gewonnen".

Gleicher `--seed` ergibt exakt dieselben Matches. Die Startplätze rotieren von
Match zu Match, sonst gewinnt am Ende nur die bessere Ecke. Zum **Bewerten**
immer dieselben Seeds nehmen, sonst sind „Generation 5" und „Generation 20"
nicht vergleichbar.

Ein eigener Agent muss dafür nicht in `AGENTS` stehen, eine Funktion reicht:

```js
import { runMatch } from "./tools/selfplay.mjs";
const res = await runMatch({ agents: ["grinder", meinNetz], seed: 7 });
```

Zwei Sorten Aufnahme, die man nicht verwechseln darf:

- `--jsonl` schreibt pro Zug eine Zeile `{ match, tick, t, agent, obs, action }`
  — direkt brauchbar fürs Nachahmungslernen, wird aber schnell gross.
- `--replays <ordner>` schreibt **Bänder**: nur `seed` plus ein Buchstabe pro
  Bike und Schritt (`S`/`L`/`R`, klein = mit Bremse). Ein Match sind ein paar
  Kilobyte — zum Anschauen, nicht zum Lernen. Dazu entsteht eine `index.json`,
  weil ein statischer Webserver keinen Ordner auflisten kann.

## Aufnahmen anschauen: `arena.html`

```bash
node tools/selfplay.mjs --matches 20 --replays out/replays
```

Dann `arena.html` öffnen. Die Seite spielt die Bänder in derselben 3D-Arena
ab: anhalten, Schritt für Schritt vor und zurück, Tempo 0,25× bis 8×, Band
wechseln, Regler zum Springen — oder eine einzelne `.json` per Drag & Drop.
Mit `arena.html?dir=…` liest sie einen anderen Ordner.

Das ist nicht Deko, sondern das Werkzeug, mit dem man später eine Belohnung
debuggt: eine Verlustkurve im Terminal sieht gleich aus, egal ob ein Netz das
Spiel gelernt hat oder nur, im Kreis zu fahren, um den Überlebens-Bonus
abzugrasen. Im Bild sieht man den Unterschied in drei Sekunden.

Möglich ist die Wiedergabe, weil die Physik deterministisch ist. Ein
Band-Fahrer ist darum einfach ein Agent, der seine Antwort nachschlägt
(`src/replay.js`) — Engine, Renderer und HUD merken nichts davon.
`verifyTape()` prüft bei jedem Aufnahme-Lauf, dass ein Band wirklich dasselbe
Match ergibt, auf 5 cm Fahrstrecke genau.

## Was ein Netz sieht: `src/features.js`

Der Teil, an dem am meisten hängt — der Algorithmus selbst sind zwanzig Zeilen
aus einer Bibliothek. Zwei Eingaben stehen bereit:

- **16 Sensoren.** Zeit bis zum Einschlag vorn/links/rechts, Gummi, Tempo,
  Bremse, der nächste Gegner egozentrisch, die Zone, die Wandnähe links und
  rechts (die Grind-Anzeige) und die Zeit. Alles auf 0…1 bzw. -1…1.
- **Ein Bild.** 4 × 24 × 24 Zahlen: die Umgebung gerastert (2,5 m pro Zelle,
  60 m Sichtfeld), **mitgedreht in Fahrtrichtung** — oben ist immer vorn,
  „links" heisst damit immer links. Kanäle: eigene Wand, fremde Wand,
  Aussenmauer, Zone. Weil das Spiel nur in 90°-Schritten dreht, bleiben die
  Wände auch im gedrehten Bild achsenparallel; rastern kostet deshalb fast
  nichts.

Ausgänge sind drei (`geradeaus`/`links`/`rechts`) plus die Bremse.

Die Belohnung liegt ebenfalls dort, mit den Gewichten an einer Stelle und
aufgeschlüsselter Abrechnung: Raum, Tempo (= Grinden), Gummi, Leben, Zeit,
Abschuss, Tod, Sieg.

```bash
node tools/features-check.mjs --matches 3
```

Dieses Skript prüft die eine Regel, an der alles hängt: **egal ob die Zahlen
direkt aus dem Spiel kommen (Training in Node) oder als `observe()`-JSON über
eine Leitung (Modell in Python) — es muss dasselbe herauskommen.** Sonst sieht
ein Netz im Spiel andere Zahlen als beim Lernen, und niemand merkt es. Dazu
prüft es die Wertebereiche und ob sich jede Eingabe überhaupt bewegt: eine
Zahl, die nie wechselt, ist Ballast — und meistens ein Fehler.

## Noch offen

- Das Training selbst. Alles darunter steht: Physik ohne Bildschirm,
  Messstand, Bänder, Wahrnehmung, Belohnung.
- Die Bots sterben meist an der Todeszone, nicht an einer Wand. Sie fahren
  also sauber, aber zu zahm — als Messlatte für ein Netz taugen sie, als
  Vorbild für gutes Spiel noch nicht.
- Mehr als vier Fahrer: `SPAWNS` in `config.js` hat sechs Plätze, Engine und
  HUD kommen damit klar; kopflos ist es mit sechs geprüft.
- Three.js kommt aus dem CDN. Ohne Netz zeigt die Seite einen Hinweis.
