# Releases

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.0.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.7.0] - 2026-08-15

### Changed

- Bechtle Design System (`design-system/`) ausgerollt: Appbar mit Logo/Signet und Hell/Automatisch/Dunkel-Theme-Toggle, Card-/Field-/Button-/Status-Komponenten, einheitlicher Footer (Bechtle Freiburg · Version · AI-Label). `css/style.css` enthält nur noch projektspezifische Ergänzungen (Dropzone, Status-Icons), keine rohen Farbwerte mehr.
- Bisher rein `prefers-color-scheme`-basiertes Dark Mode ersetzt durch manuellen Theme-Toggle (`data-theme`-Attribut, persistiert in `localStorage`).

## [0.6.0] - 2026-08-14

### Added

- Datum der Kursermittlung in der Zeile über der Kurs-Zelle (aktuell AF38, Format `TT.MM.JJJJ`) — die Zeile existiert im Original oft nicht und wird bei Bedarf neu angelegt.

## [0.5.0] - 2026-08-14

### Changed

- AF39 zeigt jetzt nur die reine Kurszahl an, ohne Beschriftung ("Kurs USD/EUR: ..." entfernt).
- Die berechneten Preise in Spalte AF werden im Euro-Zahlenformat angezeigt (`#,##0.00 €`).

## [0.4.0] - 2026-08-14

### Changed

- **Breaking:** AF39 enthält jetzt die Kurszahl selbst (echte, editierbare Zahl mit Beschriftungs-Zahlenformat "Kurs USD/EUR: 1,58") statt eines reinen Textvermerks. Alle Preise in Spalte AF sind jetzt echte Excel-Formeln (`=ROUND(<Quelle>/$AF$39,2)`) statt fester Werte — Kurs direkt in Excel ändern berechnet alle Preise automatisch neu, ohne erneuten Durchlauf durchs Tool.

## [0.3.0] - 2026-08-14

### Added

- Kurs-Hinweis in der Zeile direkt über der Kopfzeile (aktuell AF39): "Kurs: {Kurs} USD/EUR"
- Neue Spalte "Price EUR" (Kopfzeile + alle Datenzeilen + Kurs-Hinweis-Zeile) wird gelb hinterlegt (`#FFFF01`) — dafür wird `xl/styles.xml` jetzt ebenfalls gezielt ergänzt (neuer `fill` + zwei `cellXfs`-Klone), siehe docs/architecture.md

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
