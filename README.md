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
| `Q` `E` `W` | nach links / rechts / hinten schauen |
| `C` | Kamera: Bike / Drohne / Cockpit |
| `F` | einem anderen Bike zusehen |
| `M` | Modus wechseln (vier, siehe unten) |
| `V` | die KI übernimmt dein Bike |
| `R` | Neustart |

## Die vier Regeln, die das Spiel ausmachen

- **Dünne Wände.** Eine Wand ist eine Strecke, kein Kästchen. Kollision heisst
  „Strahl gegen Strecke". Deshalb passt ein Bike durch jede Lücke, die es
  wirklich trifft — auch durch zwei Zentimeter.
- **Rubber.** Wer in eine Wand fährt, stirbt nicht sofort. Er drückt dagegen
  und verbraucht Gummi — und zwar **streckenbasiert**: `CYCLE_RUBBER` sind
  4 *Meter*, keine Sekunden. Ist der Vorrat leer, ist Schluss; er füllt sich
  langsam wieder auf. Das ist der Grund, warum man sich in Lücken quetschen
  kann, die zu knapp sind.
- **Grinden.** Nahe an einer Wand zu fahren macht **schneller**, ab
  `CYCLE_WALL_NEAR` = 6 m. Eigene und fremde Wand schieben gleich stark
  (`ACCEL_SELF` = `ACCEL_ENEMY` = 1); die **Aussenmauer schiebt gar nicht**
  (`ACCEL_RIM` = 0), Randfahren bringt also nichts. Gemessen über 270 000
  Schritte mit vier Bots: Median 30 m/s, p99 47, Spitzen um 60 — im Gedränge
  zu viert auch 80. Das ist der Kern des Spiels: Tempo holen und dabei genau
  das Gummi riskieren.
- **Endliche Wände und die Win-Zone.** Die eigene Wand verschwindet hinten
  wieder (`WALL_LENGTH`), die Arena füllt sich also nie. Gegen das Patt gibt
  es die **Win-Zone** — kein Ziel, sondern ein Patt-Brecher, und **keine**
  Todeszone: wer sie berührt, *gewinnt*. Sie braucht **zwei** Bedingungen
  (Rundenzeit über 60 s **und** 30 s ohne Toten) und erscheint dann mit 5 m
  Radius, wachsend um 1 m/s. Im Original ist sie im Einzelspieler ganz
  abgeschaltet (`SP_WIN_ZONE_MIN_ROUND_TIME 1000000`); hier stehen die
  Server-Werte, weil sonst 16 vorsichtige Bots gar nicht fertig werden —
  gemessen: 480 s und immer noch kein Ende.

Dazu die **Bremse** mit eigenem Vorrat (langsamer = engere Kurve) und eine
kürzeste Zeit zwischen zwei Kurven (`TURN_DELAY`).

### Vier Modi

| Modus | Mannschaften | Zonen | Idee |
| --- | --- | --- | --- |
| `lms` | jeder für sich | keine | Last Man Standing, das Grundspiel |
| `lts` | zwei | keine | Last Team Standing |
| `fortress` | zwei | eine je Team | die gegnerische Festung erobern |
| `sumo` | jeder für sich | eine je Fahrer | die eigene Zone halten |

Fortress und Sumo benutzen **dieselbe Formel**, nur mit anderen Vorzeichen:

```
erobert += (Gegner × CONQUEST − Besitzer × DEFEND − DECAY) × dt
```

Fortress 0,5 / 0,25 / 0,1 — Sumo 0 / 0,6 / −0,3. Der negative Verfall im Sumo
heisst: die eigene Zone erobert sich selbst, sobald man nicht darin steht.

Alle Zahlen stehen in `RULES` und `MODES` in
[src/config.js](src/config.js), mit einer Zeile Begründung an jeder — und mit
dem Originalnamen aus `settings.cfg` daneben.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Die ganze Seite: Canvas, Cockpit, Overlay, Wiedergabe-Leiste, Import-Map |
| `style.css` | Optik nach `classic.aacockpit.xml`: schwarz, rote Beschriftungen, cyan Zahlen |
| `src/config.js` | Alle Regeln als Zahlen, die vier Modi, Farben und Startplätze |
| `src/engine.js` | Die Physik. Kein DOM, keine Grafik, läuft auch in Node |
| `src/agents.js` | Die Bots und die Schnittstelle für eigene KIs |
| `src/features.js` | Was ein Netz sieht und wofür es belohnt wird |
| `src/replay.js` | Match aufnehmen und abspielen: seed + Eingaben, sonst nichts |
| `src/render3d.js` | Die 3D-Bühne: Arena, Wände, Bike-Modell, Bloom, Kamera |
| `src/input.js` | Tastatur; Kurven sind Ereignisse, nicht Zustände |
| `src/hud.js` | Rubber, Speed, Brakes, Punkte, Overlay |
| `src/main.js` | Steckt alle Teile zusammen, hält die Spielschleife, verzweigt auf `?replay` und `?netz` |
| `src/playback.js` | Der Zuschauerraum für Bänder — hängt an derselben Seite |
| `src/net.js` | Das Netz: Vorwärtsrechnung, Laden, und als Agent. Node *und* Browser |
| `tools/serve.py` | Entwicklungs-Server ohne Zwischenspeicher |
| `tools/selfplay.mjs` | Matches ohne Browser: Agenten vergleichen, Daten sammeln |
| `tools/train.mjs` | Nachahmungslernen: sammeln, lernen, antreten (siehe unten) |
| `tools/rl.mjs` | Verstärkungslernen (REINFORCE) auf der Belohnung aus `features.js` |
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

`turn` ist `+1` links, `-1` rechts, `0` geradeaus. Mitfahren lassen kannst du
ihn auf zwei Wegen — dauerhaft über die `LADDER` in
[src/main.js](src/main.js), aus der die Runde ihre Bots zieht:

```js
const LADDER = ["grinder", "hunter", "cruiser", "meinNetz"];
```

…oder zum Ausprobieren aus der Konsole, ohne Neustart:

```js
TRON.game.cycles[1].driver = { type: "agent", agent: "meinNetz" };
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
60 m/s die Hälfte davon:

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
node tools/selfplay.mjs --matches 50  --mode fortress --players 4
node tools/selfplay.mjs --matches 20  --replays out/replays     # zum Anschauen
node tools/selfplay.mjs --matches 50  --jsonl daten/spiele.jsonl --record grinder
node tools/selfplay.mjs --help
```

Am Ende steht eine Tabelle: Siege, Prozent, mittlere Platzierung, Punkte,
Abschüsse, verbrauchtes Gummi und Spitzentempo. Die Platzierung ist die
brauchbarste Spalte, sobald mehr als zwei mitfahren — „zweiter von vier" sagt
mehr als „nicht gewonnen".

Mit `--mode lts` oder `--mode fortress` fährt man Mannschaften. Die Engine
verteilt Fahrer *i* auf Team *i* % 2, `--agents a,b --players 4` stellt also
zweimal a gegen zweimal b. Die erste Spalte heisst dann **SEITE** statt SIEGE:
in wie vielen Matches der Agent auf der Siegerseite stand, pro Match höchstens
einmal gezählt.

Wer gewonnen hat, sagt die Engine — nicht „wer lebt noch". Der Unterschied ist
nicht akademisch: entscheidet die Win-Zone, leben noch alle, und die Zählung
nach Überlebenden erklärte 13 von 20 lms-Matches zum Unentschieden.

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

## Aufnahmen anschauen: `index.html?replay`

```bash
node tools/selfplay.mjs --matches 20 --replays out/replays
```

Dann <http://localhost:8123/index.html?replay> öffnen — **dieselbe Seite**,
nur fahren die Bikes vom Band statt von `agents.js`. Anhalten, Schritt für
Schritt vor und zurück, Tempo 0,25× bis 8×, Band wechseln, Regler zum
Springen — oder eine einzelne `.json` ins Fenster ziehen. Mit
`?replay=pfad/zum/ordner` liest sie einen anderen Ordner.

Es ist bewusst keine zweite Seite: die frühere `arena.html` hielt eine eigene
Kopie des Cockpit-Markups und ging beim ersten Umbau von `hud.js` kaputt, ohne
dass es jemandem auffiel. Ein Cockpit, ein Markup, eine Optik.

Ein Band speichert nur `seed` und Richtungen und wird mit der Engine von
**heute** nachgespielt. Ändert sich eine Regel, läuft eine alte Aufnahme
auseinander — die Wiedergabe vergleicht deshalb die Länge und sagt es, statt
dich ein anderes Match ansehen zu lassen.

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

Das ist keine Theorie. Beim Umbenennen der `RULES` auf die Originalnamen
verwaiste `RULES.SPEED_MIN`, und der Sensor `tempo` war danach in **jedem**
Schritt `NaN` — 11 370 Fehler bei 79 586 Prüfungen, und kein Mensch hätte es
beim Lesen gesehen.

Drei Meldungen bleiben und sind **richtig so**: `zone_naehe` und `zone_aktiv`
stehen konstant auf 0, weil die Win-Zone erst spät erscheint, und `bremse`
steht konstant auf 1, weil **kein einziger** der vier Bots je bremst. Der
Prüfer bleibt absichtlich laut — sonst verdeckt er den Tag, an dem eine
Konstante ein echter Fehler ist.

## Ein Netz trainieren: `tools/train.mjs`

```bash
node tools/train.mjs --matches 60 --epochs 40 --out out/netz-hunter.json
```

Nachahmen, nicht Verstärkungslernen — und das ist Absicht. Hier soll noch
kein gutes Netz entstehen, sondern bewiesen werden, dass die Kette geschlossen
ist: Matches fahren → Sensoren aus `features.js` → lernen → als Agent
mitfahren → im selben Messstand gemessen werden. Jede dieser Nahtstellen kann
still kaputt sein, und beim Verstärkungslernen merkt man es nach Stunden statt
nach Sekunden.

Das Netz ist absichtlich winzig: 16 → 24 → 3, **483 Parameter**, eine verdeckte
Schicht, keine Bibliothek. Ein Durchlauf mit 60 Matches dauert etwa 15 Sekunden.

Zwei Zahlen, auf die es dabei ankommt:

- **Treffergenauigkeit lügt hier.** 90 % aller Züge sind „geradeaus" — wer
  nichts anderes sagt, hat 90 % recht und fährt in die erste Wand. Gemessen
  wird die **ausgewogene** Genauigkeit, der Mittelwert der drei Trefferquoten
  je Klasse. Zufall und Immer-geradeaus liegen beide bei 33 %.
- **Geteilt wird nach Matches, nicht nach Zeilen.** Aufeinanderfolgende Züge
  sind sich fast gleich; bei zufälliger Zeilen-Teilung stünde zu fast jedem
  Prüfzug ein fast identischer Lernzug, und die Prüfzahl wäre geschönt.

Ein Lauf mit `--matches 60 --epochs 40`, `hunter` nachgeahmt:

```
  ausgewogen   87,8 % (Lernen)   87,4 % (Prüfen)      Zufall 33 %

  GEGNER        SIEGE NETZ       %
  rookie                  26    86.7
  grinder                 20    66.7
  hunter                   9    30.0
  cruiser                  8    26.7
```

Dass es seinen eigenen Lehrer nur zu 30 % schlägt, ist für Nachahmung normal:
kleine Abweichungen führen in Lagen, die der Lehrer nie zeigt, und dort ist
nichts gelernt. Genau da fängt Verstärkungslernen an.

### Zusehen

```
index.html?netz=out/netz-hunter.json
```

Dieselbe Seite, das Netz fährt einfach mit — seine Bikes heissen `NETZ`.
Möglich ist das, weil `src/net.js` dieselben `encodeSensors()` benutzt wie das
Training, und weil `features-check` genau diese Gleichheit prüft.

## Verstärkungslernen: `tools/rl.mjs`

```bash
node tools/rl.mjs --start out/netz-hunter.json --iterations 200 --matches 25
```

Ab hier gibt es kein Vorbild mehr: das Netz würfelt seine Züge aus der eigenen
Verteilung, bekommt die Belohnung aus `features.js`, und wird in die Richtung
geschoben, die **überdurchschnittlich** viel eingebracht hat. Verfahren ist
REINFORCE mit Grundlinie — das einfachste, das funktioniert.

Warm starten lohnt sich sehr. Aus dem Nichts würfelt sich ein Netz die ersten
tausend Matches lang nur in Wände; vom nachgeahmten Netz aus geht es sofort
aufwärts. Gemessen wird gierig (ohne Würfeln) gegen alle vier Bots, auf
**Mess-Seeds, die nie trainiert werden** — und gespeichert wird das Netz mit
der besten Siegquote, nicht das letzte.

Ein Lauf über 200 Durchgänge, 208 Sekunden:

```
  STUFE                        ROOKIE  GRINDER   HUNTER  CRUISER   SCHNITT
  --------------------------------------------------------------------------
  nachgeahmt (train.mjs)        97.5%    52.5%    32.5%    32.5%      53.8 %
  + RL (rl.mjs, 180 D.)         92.5%    72.5%    52.5%    62.5%      70.0 %
```

Gegen `rookie` verliert es ein wenig und holt das gegen alle drei anderen
mehrfach zurück — es ist nicht mehr auf einen Lehrer zugeschnitten. Auch
gemessen: es lebt länger (36,3 s statt 33,6) und fährt weiter (1103 m statt
1001).

### Zwei Schrauben, die (noch) nichts bringen

```bash
node tools/rl.mjs --start out/netz-hunter.json --entropieEnde 0.001
node tools/rl.mjs --start out/netz-hunter.json --entropieEnde 0.001 --selbst 0.4
```

**Der Neugier-Bonus** hält die Verteilung breit, damit das Netz überhaupt etwas
ausprobiert. Bleibt er konstant, schiebt er bis zum Schluss: über 200 Durchgänge
stieg die Entropie von 0,20 auf 0,44 — am Ende würfelte das Netz *mehr* als am
Anfang. `--entropieEnde` fährt ihn linear herunter. Klingt zwingend, ist aber
**gemessen schlechter**.

**Die Liga** (`--selbst`) stellt eingefrorene Kopien des Netzes als Gegner auf.
Eingefroren müssen sie sein: gegen sich selbst jagt die Politik ein bewegliches
Ziel, weil sich beide Seiten gleichzeitig ändern. Die Bots bleiben im Feld — sie
sind die Messlatte. Auch das bringt bisher nichts.

Je 200 Durchgänge, jede Variante mit **drei** Seeds:

```
  VARIANTE                  SEED 1  SEED 2  SEED 3    MITTEL   SPANNE
  --------------------------------------------------------------------
  A  Neugier konstant         66,3    68,3    65,4      66,7      2,9
  B  Neugier 0,01 → 0,001     64,6    59,6    62,9      62,4      5,0
  C  B + Liga 40 %            63,8    62,1    65,0      63,6      2,9
```

Ein einzelner Lauf vorher hatte genau das Gegenteil behauptet (A 70,0 · B 73,8 ·
C 66,3) — und das war Rauschen. **Die Spanne innerhalb einer Variante ist so
gross wie der Unterschied zwischen ihnen.** Wer hier aus einem Lauf schliesst,
schliesst falsch; dazu kommt, dass „bestes Netz aus 200 Durchgängen" ein
Maximum über mehrere Messungen ist und damit systematisch zu hoch liegt.

Beide Optionen bleiben drin, weil sie richtig gebaut und dokumentiert sind —
aber die Standardwerte schalten sie aus.

**Die Belohnung ist nicht das Ziel — Gewinnen ist das Ziel.** Darum steht
beides nebeneinander in der Tabelle. Steigt der Lohn und fällt die Siegquote,
hat das Netz eine Marotte gefunden, und dann sieht man in `?replay` oder
`?netz=…` in drei Sekunden, welche. Ein Beispiel aus der Praxis: das Netz macht
ein auffälliges Treppenmuster — gemessen lenkt es aber nur 4,3-mal pro Sekunde,
während `cruiser` und `grinder` auf 13–14 kommen. Keine Marotte, sondern die
ruhigste Fahrweise im Feld nach `hunter` und `rookie`.

## Noch offen

- **Der Neugier-Bonus müsste abklingen.** Über 200 Durchgänge stieg die
  Entropie von 0,20 auf 0,44 — der feste Bonus von 0,01 schiebt die Politik
  immer weiter Richtung Zufall und dürfte das Ergebnis deckeln. Ein
  abklingender Wert ist der nächste offensichtliche Griff.
- **Selbstspiel.** Bisher lernt das Netz gegen vier feste Bots; es kann also
  höchstens so gut werden, wie die es fordern.
- **Das Bild als Eingabe.** 4 × 24 × 24 liegt bereit, braucht aber Faltung;
  bisher fährt das Netz auf 16 Zahlen.
- **Die Belohnung ist nicht geprüft.** `features-check` weist sie nach Termen
  auf, und `leben` + `zeit` machen zusammen rund 80 % aus. Das ist genau die
  Form, die ein Netz zum Im-Kreis-Fahren erzieht — nachrechnen, bevor
  Rechenzeit hineinfliesst.
- **Kein Bot bremst.** Wer deren Züge nachahmt, lernt eine Bremse nie kennen.
- `aiplayers.cfg` und `models/*.mod` aus dem gekauften Spiel sind noch
  ungenutzt.
- Three.js kommt aus dem CDN. Ohne Netz zeigt die Seite einen Hinweis.
