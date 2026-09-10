# legacy — die Vorgänger

Nur zum Nachschauen. **Nichts hier läuft mehr**, weil `src/config.js` jetzt
die Regeln des durchgehenden Spiels enthält (Meter, Sekunden, Rubber) und
nicht mehr die des Rasters (Kästchen, Punkte, Level).

| Datei | Was es war |
| --- | --- |
| `game2d.js` | Die erste Fassung: alles in einer Datei, 2D-Canvas |
| `engine-grid.js` | Raster-Tron: 32×32 Kästchen, Licht-Punkte, Level |
| `agents-grid.js` | Die Bots dazu — `greedy`, `survivor`, `aggressor`, `wanderer`, mit Flutfüllung über die Kästchen |
| `features-grid.js` | Die KI-Wahrnehmung dazu: Sensoren und ein gedrehter 15×15-Ausschnitt |

Aufbewahrt, weil zwei Dinge daran lehrreich bleiben:

1. **Die Flutfüllung.** Im Raster kann man „wie viel Welt bleibt mir" exakt
   ausrechnen, indem man Kästchen zählt. Im stufenlosen Raum gibt es nichts zu
   zählen — deshalb rastert `src/features.js` heute erst ein Bild der Umgebung
   und füllt darauf.
2. **Ein Fehler, der beides betrifft.** Eine Flutfüllung, die auf dem Kästchen
   startet, auf dem das Bike STEHT, gibt immer 0 zurück — das Kästchen ist ja
   vom Bike selbst belegt. In `agents-grid.js` steckt er noch drin: der
   `aggressor` zieht „den Platz des Gegners" ab, und dieser Wert ist konstant
   0. Sein wirksamer Teil war nur „fahre auf den Gegner zu".
