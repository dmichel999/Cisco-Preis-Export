# Releases

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.0.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.13.0] - 2026-09-18

### Added

- Klare Fehlermeldung, wenn eine bereits verarbeitete Datei (mit existierender "Price EUR"-Spalte) erneut hochgeladen wird, statt stillschweigend eine zweite, kollidierende "Price EUR"-Spalte danebenzusetzen. Bitte immer die ursprüngliche, unveränderte Cisco-Quote verarbeiten, nie eine bereits erzeugte Ausgabedatei.

## [0.12.0] - 2026-09-18

### Fixed

- Subscription-Zeilen (Pricing Term > 0) verwenden jetzt "Unit List Price" als Quellpreis statt "Unit Net Price Before Credits" — Cisco trägt bei Subscription-Lizenzen in letzterer Spalte nur `"--"` ein (der Netto-Preis pro Transaktion ist dort nicht aussagekräftig), den eigentlichen Lizenzpreis liefert "Unit List Price". Nicht-Subscription-Zeilen nutzen weiterhin "Unit Net Price Before Credits" wie bisher.
- `resolveCellText` gab für Zellen ohne `t`-Attribut (reine Zahl, z. B. "Pricing Term (in Months)" als echte Zahl statt Shared-String) `null` zurück. Dadurch wurden reale Subscription-Zeilen fälschlich als "keine Subscription" (Term = 0) erkannt, weil ihr numerischer Term-Wert nicht ausgelesen werden konnte. Betrifft auch die "Part Number"-Tabellenende-Erkennung, falls Part Numbers rein numerisch sind.

## [0.11.0] - 2026-09-18

### Fixed

- Echte Quotes können in "Unit Net Price Before Credits" einen Text-Platzhalter (`"--"`) statt einer Zahl enthalten (z. B. Bundle-Kindzeilen ohne eigenen Preis) — das ließ das Tool bisher sofort mit "Keine Artikelzeilen unterhalb der Kopfzeile gefunden" abbrechen, weil die erste nicht-numerische Quellzelle fälschlich als Tabellenende galt. Das Tabellenende wird jetzt stattdessen über die Spalte "Part Number" erkannt (neuer Pflicht-Ankertext); eine fehlende/textuelle/exakt-0 Quellzelle bedeutet nur noch "kein Preis für diese Zeile", nicht mehr "Ende der Tabelle".

### Changed

- Zeilen ohne verwertbaren Preis (Quellzelle fehlt, ist Text wie `"--"`, oder ist exakt 0) bekommen jetzt gar keine "Price EUR"-Zelle (statt vorher `0,00 €` bzw. Abbruch) — für sie wird nichts eingetragen, auch keine Subscription-Hinweis-Zelle.

## [0.10.0] - 2026-09-18

### Added

- Subscription-Zeilen (erkennbar an "Pricing Term (in Months)" > 0) bekommen eine zusätzliche Spalte "Preishinweis" mit dem Text "Der Einzelpreis pro X Monate = Y" (X = Pricing Term, Y = berechneter EUR-Preis der Zeile). Eigene Spalte statt Text in der "Price EUR"-Zelle selbst, damit deren Formel/Live-Neuberechnung bei Kursänderung erhalten bleibt (siehe docs/architecture.md).

## [0.9.0] - 2026-09-15

### Changed

- Ausblende-Bereich reicht jetzt bis zur Spalte direkt vor "Price EUR" (nicht mehr nur bis "Custom Name"). Dadurch verschwinden auch neu von Cisco eingefügte Zwischenspalten (z. B. "BPA No Subscription Line", siehe 0.8.0), und die EUR-Spalte folgt visuell direkt auf die USD-Preisspalte.

## [0.8.0] - 2026-09-15

### Fixed

- Neue Spalte "Price EUR" landete bisher hartkodiert direkt in "Custom Name"-Spalte + 1. Neuere Cisco-Quote-Exporte enthalten dort inzwischen eine zusätzliche, befüllte Spalte ("BPA No Subscription Line") — die neue Preis-Spalte kollidierte mit doppelten Zellreferenzen in derselben Zeile, wodurch Excel die Preise verwarf/ignorierte ("Preise werden nicht mehr eingetragen"). Die Zielspalte wird jetzt zur Laufzeit als erste tatsächlich freie Spalte ermittelt (geprüft über Kopfzeile, Kurs-/Datumszeile und alle Datenzeilen) statt per fester Positionsannahme.
- Erfolgsmeldung nannte immer hartkodiert "AF39" als Kurszelle, unabhängig davon, wo die Zelle tatsächlich landete. Wird jetzt aus der tatsächlich berechneten Zellreferenz gebaut.

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
