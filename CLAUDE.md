# Cisco Preis Export — Projektkontext

Browser-basiertes Tool zur USD→EUR-Umrechnung von Cisco-Preisangeboten (`.xlsx`-Quote-Export). Komplett clientseitig, kein Server. Ordner kopieren → `Cisco Preis Export.html` öffnen → läuft.

## Kernidee

Die Datei wird **nicht** vollständig neu geschrieben (Formatierungsverlust-Risiko), sondern per JSZip + DOMParser gezielt an genau zwei Stellen chirurgisch verändert: Spalten ausblenden, eine Spalte ergänzen. Details und Begründung: [docs/architecture.md](docs/architecture.md).

## Spalten-/Header-Erkennung ist text-basiert, nicht buchstaben-basiert

Nicht auf feste Spaltenbuchstaben (aktuell P–AE, Quelle O) verlassen — diese werden zur Laufzeit über die Kopfzeilen-Zelltexte "Credits" / "Custom Name" / "Unit Net Price Before Credits" im ersten Tabellenblatt ermittelt. Bei Änderungen an der Erkennungslogik in `js/app.js`: immer gegen eine echte Beispieldatei testen, nicht nur gegen angenommene Spaltenpositionen.

## Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [docs/features.md](docs/features.md) | Feature-Spezifikation, Ablauf, Fehlerbehandlung |
| [docs/architecture.md](docs/architecture.md) | OOXML-Ansatz, Style-Wiederverwendung, Download-Strategie |
| [docs/releases.md](docs/releases.md) | Versionshistorie |
| [docs/bugs.md](docs/bugs.md) | Bekannte Bugs |
| [docs/changes.md](docs/changes.md) | Eingangskorb offener Änderungswünsche |

## Regeln für Änderungen

1. Vor Änderungen an der Erkennungs-/Umrechnungslogik: `docs/architecture.md` lesen.
2. Nach jeder Änderung: `docs/releases.md` per SemVer aktualisieren (Version lebt als einzige Konstante in `js/app.js`).
3. Änderungen an `js/app.js`, die die Spaltenerkennung betreffen, immer gegen eine reale Cisco-Quote-Datei verifizieren. Testdateien mit echten Kundendaten gehören nie ins Repo.

## Weitere Regeln

Sprache, Secrets-Handling, Subagenten-Modellwahl etc.: siehe root-`CLAUDE.md` und root-`MASTERPROMPT.md`.
