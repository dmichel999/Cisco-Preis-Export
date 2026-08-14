# Releases

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.0.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.2.0] - 2026-08-14

### Changed

- **Breaking:** Kurs-Konvention von "EUR pro USD" (multiplizieren) auf "USD pro EUR" (dividieren) umgestellt — entspricht der Angabe von Cisco-Dealkursen (z. B. `1,08`) und der tatsächlichen Erwartung des Users. Formel: EUR-Preis = USD-Preis ÷ Kurs.

## [0.1.1] - 2026-08-14

### Fixed

- Doppelte XML-Deklaration in der erzeugten Datei behoben: Safaris `XMLSerializer` gibt `<?xml ...?>` bereits selbst aus, der Code hat sie zusätzlich vorangestellt → ungültiges XML → Excel zeigte den "Reparieren?"-Dialog. Die Deklaration wird jetzt nur ergänzt, wenn sie fehlt.
- Zip-Kompression von STORE auf DEFLATE umgestellt (Dateigröße war unnötig ~5× größer als nötig).

## [0.1.0] - 2026-08-14

### Added

- Initiale Version: Drag & Drop einer Cisco-Quote-`.xlsx`, Abfrage des USD→EUR-Kurses, Ausblenden der Spalten "Credits" bis "Custom Name", neue Spalte "Price EUR" mit umgerechnetem Preis
- Formatierungserhalt durch gezielte OOXML-Bearbeitung statt vollständigem Parse/Rewrite (siehe docs/architecture.md)
- Download mit Overwrite-Semantik (File System Access API mit Fallback)
