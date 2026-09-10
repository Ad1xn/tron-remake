# TRON Remake

Ein Tron-Lightcycle-Spiel in reinem HTML, CSS und JavaScript — kein Build, keine
Bibliotheken. Gezeichnet wird auf ein `<canvas>`. Der Code ist auf Deutsch
kommentiert und zum Mitlernen gedacht.

## Starten

```bash
python3 -m http.server 8123
```

Dann <http://localhost:8123> öffnen. (Die `index.html` direkt per Doppelklick zu
öffnen funktioniert auch.)

## Steuerung

| Taste | Aktion |
| --- | --- |
| Pfeiltasten / `WASD` | Fahren |
| `Leertaste` | Start / Neustart |

## Wie es funktioniert

- Das Spielfeld ist ein Raster aus 48 × 32 Kästchen (`CONFIG` in `game.js`).
- Alle 90 ms passiert ein Zeitschritt: jedes Bike rückt ein Kästchen vor und
  hinterlässt eine Spur. Wer in eine Wand oder eine Spur fährt, ist raus.
- Die Gegner sind einfache Bots: sie schauen ein paar Kästchen voraus
  (`freeAhead`) und biegen ab, bevor sie irgendwo hineinfahren (`botThink`).

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Aufbau der Seite: Kopfzeile, Canvas, Overlay |
| `style.css` | Neon-Optik |
| `game.js` | Das ganze Spiel: Raster, Bewegung, Bots, Zeichnen |
