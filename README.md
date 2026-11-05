# NomadTactics

Ein Echtzeit-Strategiespiel mit Basisbau als Hommage an **C&C Generals / Zero Hour**. Daniel und Ava bauen es, als privates Hobbyprojekt, nie kommerziell.
Spielzeug-Armeen aus Voxeln auf einer Modellbau-Platte, zerstörbare Städte und Brücken, Lockstep-Multiplayer für LAN-Partys und eine Daten-Werkstatt, in der Fraktionen, Generäle, Techbäume und Spielregeln einstellbar sind.

```bash
npm install
npm test                  # Regeln, Welt, Erfahrung, Netz
node tools/nt.js check    # Spieldaten prüfen
npm run serve             # dann http://localhost:8765/tactics.html (Werkstatt)
npm run party             # LAN-Party-Server (unter Windows: start_party.bat)
```

Die Geschmackstests (Spielwiese, Härtetest, Voxel-Diorama) liegen in [`prototypes/nomadtactics/`](prototypes/nomadtactics/README.md).
Die ausführliche Anleitung mit Formaten, Befehlen und Arbeitsweise steht in [CLAUDE.md](CLAUDE.md). Code und Datenfelder sind englisch, die Begriffe stehen im [Glossar](docs/glossary.md).

## Lizenz

GPL v3 oder später, siehe [LICENSE](LICENSE). Bibliotheken, Schriften und Icons von Dritten stehen in [THIRD_PARTY.md](THIRD_PARTY.md).
NomadTactics ist ein Fanprojekt und hat keine Verbindung zu Electronic Arts. „Command & Conquer“ und „Generals“ sind Marken von Electronic Arts.
