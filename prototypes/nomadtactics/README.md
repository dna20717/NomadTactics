# NomadTactics – Prototypen (Stand 04.11.2026)

Geschmackstests für das RTS-Projekt **NomadTactics** (Generals-Hommage). Noch keine Engine, nur Optik- und Effekt-Tests. Die Entscheidungen und den Fahrplan beschreibt die Anleitung im claude.ai-Projekt „NOMADTacticts“ (`claude/nomadtactics-anleitung.md`).

## Einrichten

```
cd prototypes/nomadtactics
npm install                     # three 0.170.0, esbuild
# Playwright liegt global; falls `import 'playwright'` fehlt:
ln -s "$(npm root -g)/playwright" node_modules/playwright
```

## Dateien

| Datei | Was |
|---|---|
| `leopard.js` + `index.html` | Low-Poly-Panzer (Leopard-2A7-artig, ~1.900 Dreiecke), Turm und Kanone als eigene Gruppen, Teamfarbe |
| `voxel.js` + `voxel.html` | Derselbe Panzer als feine Voxel (0,2 m), Flecktarn per Rauschen |
| `voxel2.js` + `kaserne.html` | Grobe Voxel (0,4 m): `tank()` und `kaserne()` als Funktionen → Map `"x,y,z" → ColorName` |
| `kaserne_ts.html` | Gleiche Szene mit Himmelsverlauf, Voxel-Wolken, Tilt-Shift |
| `voxel3.js` + `diorama.html` | **Diorama-Look**: Ecken-AO je Würfel, weiche Kanten (Shader über Attribut `edge`), Palette mit Varianten, Baum/Laterne/Kiste, GTAO + Bloom + Tilt-Shift + Farblook |
| `playground.js` + `playground.html` | **Spielwiese** (veröffentlicht als Artifact): Gelände in 16er-Brocken, Objekte zerstörbar, Trümmer-Physik (InstancedMesh), Feuer/Rauch/Staub/Pilz-Partikel, Brandherde, Druckwelle, Licht-Blitz, Kamerawackeln, synthetischer Ton, Granate/Rakete/Superwaffe, Qualitätsstufen |
| `stress_test.js` + `stress_test.html` | **Härtetest** (veröffentlicht als Artifact): Schlacht mit 40–300 Voxel-Einheiten (Kampfpanzer, Raketenwerfer, Spähwagen, Infanterie-Trupps, Dozer), InstancedMesh je Typ/Teil/Team, drehbare Türme, Geschosse, Wracks, Krater, Gelände als Höhenfeld (361² Säulen, 32er-Brocken), RTS-Kamera (Detail/Nah/Spielhöhe/Weit, WASD, Q/E), FPS-Anzeige und 20-s-Messung. Schalter **Licht Weich/Hart** (Hart: PCF-Schatten 4096, tiefere stärkere Sonne, weniger Himmelslicht, auf Texel eingerastete Schattenkamera) und **Oberfläche Aus/An** (`vehicleMaterial`: Attribute `mat` = Oberflächen-Art je Voxel und `outer` = echte Außenkanten je Fläche → Tarnflecken je Würfel, Fase und Kantenabrieb nur an Außenkanten, Dreck von unten, Metall/Glas mit Umgebungsspiegelung). `test_look.mjs` macht Vergleichsbilder. **Stadt und Waffen:** Stadt am Westrand (6 Hochhäuser/Wohnblöcke: Glas, Beton, Backstein, bis 66 Lagen) und 2 Häuser am Weg, Kasernen; alle zerstörbar (`buildingAssign`, Scheiben zu 10 Lagen, nur getroffene werden neu gebaut). Lose Teile stürzen, ab 33 % Verlust oder zerstörtem Sockel sackt das Gebäude in einer Staubwolke in den Boden (`collapse`), danach bleibt ein Schutthaufen. Einheiten umfahren Gebäude (Rechteck-Hindernisse). Waffenleiste unten: Granate, Rakete, Superwaffe (Countdown, Blitz, Pilzwolke, Krater bis 7 Lagen tief). `stressTest.fastForward(s)` und `test_stadt.mjs` für kopflose Tests. **Live-Fenster** (Version 4, 04.11., Transport-Tycoon-Idee): Klick-Modus „Auswählen“ öffnet bei einer Einheit ein Fenster, das ihr folgt (gelber Ring, Lebensbalken, Zustand); „Wachposten“ setzt ein festes Fenster; Ereignisse abseits der Kamera (Einsturz, Superwaffe, verlorener blauer Panzer, max. alle 25 s) ploppen 8–10 s auf, Anheften behält sie. Jedes Fenster = eigene Kamera, per Scissor ohne Nachbearbeitung gezeichnet, Schattenkarte der Hauptansicht wird mitbenutzt; max. 4. Im Fenster: Ziehen = schieben (Wachposten) bzw. drehen (Verfolger), rechts = drehen, Rad = Zoom, Tippen = Klick in die Welt (Waffen, Einheit wählen). Fenster am Kopf verschieben, an der Ecke vergrößern. Version 5: Fenster rendern in ein kleines Ziel (0,4–0,6 der Auflösung je Qualität, jedes 2. Bild) und werden mit **Scanlines**, Vignette und laufendem Balken hochgezogen (`blitMat`). Zerstörte Einheit → **„Verbindung verloren“**: Bild friert ein, Rauschen und verrutschende Zeilen, Funkrauschen, schließt nach 7 s (Anheften = Wachposten am Wrack). `test_pane.mjs`. **Wetter** (Version 5): Klar, Bewölkt, Regen, Nebel, Schnee, Sturm, Wind (Werte in `WEATHER`, Übergang ~3 s, `setWeather(kind, instant)`). `weatherMaterial(m, snowShare)` spritzt in alle beleuchteten Materialien ein: **Wolkenschatten** (Rauschfeld in 90 m Höhe, entlang der Sonne projiziert, zieht mit dem Wind), Nässe (dunkler, glänzende Oberseiten, trocknet langsam), Schneedecke auf Oberseiten (Einheiten nur 20 %). Regen als Linien, Schnee als Punkte in einem weltfesten Kasten um den Blickpunkt der jeweils zeichnenden Kamera (auch in Live-Fenstern). Sturm: Blitze mit Donner, Regenrauschen. `test_weather.mjs`. **Einsturz-Labor** (Version 6, 04.11., Daniels Wunsch „strukturelle Varianz“): Fluss quer durch die Stadt (`RIVER`, Wasserfläche, Sandufer), 8 Hochhäuser mit **Tragwerk** (`towerModel`: Stützen alle 4 Würfel, Geschossdecken, Kern, Eckpfeiler = tragend; Fassade = Füllung) und 5 Brücken (`bridgesModel`: Balken auf Pfeilern, Steinbogen (zäh), Hängebrücke, Fachwerk, Ponton). Tragende Voxel gehören zu **Teilen** (`g.tw.parts`: Stockwerks-Viertel `q0–3:k`, Kern `k:k`, Pfeiler, Felder, Seile, Pontons …); fällt ein Teil unter seine Schwelle, entscheiden die Regeln (`towerRules`, `bridgesRules`): **Puppenhaus** (eine Ecke weg, Rest steht), **Umkippen/Abknicken** (zwei Viertel einer Seite; tief = ganzer Turm, hoch = Spitze), **Pfannkuchen** (Kern oder ≥3 Viertel; der obere Block sackt Etage für Etage durch, `verticalStep`), **Vorwarnung** (Knarzen, rieselnder Staub, leichtes Neigen, `towerWarning`), Gerippe durch **Brand** (Füllung brennt weg, Glastürme sacken nach ~16 s zusammen). Brücken: Pfeiler weg → Felder kippen am anderen Auflager ins Wasser und bleiben als Wrack liegen; Bogen-Scheitel → alles fällt; ein Seil → Fahrbahn hängt schief („nur Infanterie“), beide Seile/Pylon → Bruch; Fachwerk-Felder knicken einzeln, ab zwei bricht die Brücke; Pontons sinken. **Fallkörper** (`fallen`: kippen um ein Auflager, frei fallen, sinken) treffen andere Gebäude (Domino) und Einheiten und hinterlassen **Schuttstreifen** (Hindernis, nicht im Wasser). Werkzeuge unten: Sprengladung (4 s, sprengt das nächste tragende Teil), Brand, Reparieren (Brücke wächst in 5 s nach), Zeitlupe, Flussstadt-Kamera; Brücken-Liste mit Zustand rechts unten (frei, beschädigt, nur Infanterie, gesperrt). `test_collapse.mjs` → `inp_*.png`. **Version 7 (04.11.):** Maßstab „Groß“ als Standard (Daniel: Brücken und Gebäude dürfen größer sein): Hochhäuser 8–9 m → 8,4–9,2 m breit und bis 110 Lagen (44 m), Fluss 11,6 m statt 9,2 m, Brücken 1,33-fach länger und 6 m breit (`BZ`, `BL`, `rs()`), Stadt bis x = −33. Knopf **Maßstab** bzw. `?scale=small` lädt den alten Stand zum Vergleich. Fix: Kippende Teile, die kürzer sind als ihr Drehpunkt hoch liegt (abgeknickte Spitzen), werden nach ~65° losgelassen (`release`: Drehpunkt in die Mitte, Schwung mitnehmen) statt ewig um die Kante zu kreisen; Notbremse nach 12 s. |
| `hud_test.js` | **Spiel-HUD im Härtetest** (seit Härtetest 8 fest eingebaut, Einstieg von `npm run build:stress`): Härtetest + HUD aus `game/tactics/hud/`. Der Adapter ist der einzige Teil, der den Härtetest kennt. **Daten aus der Werkstatt** (`projects/nomadtactics`, per esbuild eingebunden): Team 0 = USA, Team 1 = Ukraine; Einheiten werden über ihr Modell zugeordnet (`models.json › prototype:<name>`, `daniel_tank` → panzer), Datenschlüssel `u.kind = "usa:kampfpanzer"`. Aus der Werkstatt kommen Namen, Kosten, Bauzeit, Stichwörter, Erfahrungsstufen (Faktoren über `tiersFactors`, Stichwörter wie `selfRepair` wirken), Erfahrungsquellen, Gebäudenamen und Baulisten (Kaserne, Waffenfabrik, Hauptquartier), Oberfläche (Stimmungen, HUD-Standards, Funk) und Stimmung/Akzent der Nation. Kampfwerte bleiben die des Härtetests. Geld/Strom/Rang sind Attrappen, General-Fähigkeiten Luftschlag, Nebelwand, Superwaffe. **Testpult** (alte Leisten): Knopf im HUD, `?testDesk`, automatisch unter Testautomatik (außer `?hud`), damit die älteren Tests laufen. Haken: `hooks.hit/die/new/event/afterImage/hudActive`, `u.command`, `u.hold`, `u.mDamage/mTank/mSpeed`, `newUnit()`. `node test_hud.mjs` → `/tmp/hud_*.png` |
| `vox_read.py` | MagicaVoxel/Voxel-Max-`.vox` → JSON (`size`, `voxel [x,y,z,farbindex]`, `palette`) |
| `vox_view.html` | Zeigt eine eingelesene `.vox` (JSON) im Diorama-Licht aus 4 Winkeln |
| `render.mjs` | Kopfloses Rendern: `node render.mjs <page without .html> <ausgabename>` → PNG (und bei `index` eine GLB) |
| `test_playground.mjs`, `test_super.mjs` | Spielwiese kopflos testen (Explosionen auslösen, Screenshots) |
| `models/` | `daniel_tank.vox` (Daniels erstes Modell aus Voxel Max, 176 Würfel, eine Farbe) + JSON, `leopard_lowpoly.glb` |
| `images/` | Renderings aller Tests (JPG) |

## Härtetest bauen und veröffentlichen

```
npm run build:stress            # → nomadtactics_stress_test.html
node test_stress_test.mjs [measure]   # kopflos: Screenshots ht_*.png, optional Messung
```

Artifact: https://claude.ai/artifact/FU6vGfNr7KpgPGqDHPu9j4 (Slug `7528ab9f-9035-43ea-ae65-110b26171e27`). Einheiten im Durchschnitt: Panzer ~2.100 Dreiecke, Werfer ~1.600, Spähwagen ~770, Dozer ~1.200, Soldat ~100. Bei 80 Einheiten ~900k Dreiecke pro Bild (inkl. Schatten), ~130–180 Draw Calls.

## Spielwiese bauen und veröffentlichen

```
npm run build                   # → nomadtactics_playground.html (eine Datei, ~590 KB, alles eingebettet)
```

Artifact: https://claude.ai/artifact/RJZ64hUco8UkK9mPN5t8vj (Slug `c4cebf16-5907-49dc-a808-cae400e2c000`). Neu veröffentlichen mit `publish_files` (slug + base_version, Datei als `index.html`).

## Technische Notizen

- Voxel-Schlüssel in der Spielwiese sind Zahlen: `K(x,y,z) = ((x+512)*1024 + (y+512))*1024 + (z+512)`, `D(k)` zurück.
- Voxel (x,y,z) liegt lokal bei `(x·V, (y+0,5)·V, z·V)`; Flächen von `x·V − V/2` bis `x·V + V/2`.
- .vox hat z nach oben: beim Einlesen `(x, y, z) → (x, z, −y)`.
- Swiftshader (ohne GPU) schafft ruhig ~14 fps, im Chaos ~1 fps. Echte Geräte sind ungetestet. Simulationsschritt ist auf 0,05 s gedeckelt, bei wenig fps läuft die Zeit also langsamer.
- Bekannte Schwächen: Grün etwas knallig, Rauch sind flache graue Würfel, Trümmer kollidieren nur mit dem Boden, Tilt-Shift arbeitet nach Bildstreifen statt nach Tiefe.
