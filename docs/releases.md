# Releases

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.0.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.19.1] - 2026-09-22

### Fixed

- `api.frankfurter.app` (die in 0.19.0 verwendete Domain) leitet per 301 auf `api.frankfurter.dev` um — mit dieser CSP-Lücke (Redirect-Ziel nicht in `connect-src`) schlug der automatische Kursabruf mit "Load failed" fehl, sowohl unter `file://` als auch über GitHub Pages (https). Tool ruft jetzt direkt `api.frankfurter.dev/v1/...` auf, CSP entsprechend angepasst. Live gegen GitHub Pages + lokalen HTTP-Server verifiziert (Safari, kein file://-Sonderfall).

## [0.19.0] - 2026-09-22

### Added

- Automatischer Wechselkurs-Vorschlag beim Öffnen des Tools: lädt den aktuellen EUR/USD-Referenzkurs der Europäischen Zentralbank über die [Frankfurter API](https://frankfurter.dev) (kostenlos, kein API-Key, CORS-offen) und trägt ihn ins Kurs-Feld ein. Jederzeit von Hand überschreibbar; über einen Refresh-Button neben dem Feld erneut abrufbar. Schlägt der Abruf fehl (kein Netzwerk, API nicht erreichbar), bleibt die bisherige manuelle Eingabe unverändert möglich — kein Blocker.
- **Nicht finanzen.net:** Ursprünglich als Quelle angefragt, blockt aber automatisierte Zugriffe hart per Akamai-Bot-Schutz (403 "Access Denied", auch mit regulärem Browser-User-Agent — verifiziert per curl). Die Frankfurter API liefert denselben Zweck (öffentlicher, tagesaktueller Referenzkurs) ohne dieses Problem.
- **Bekannte Einschränkung:** Funktioniert nur in Chromium-Browsern (Chrome/Edge). Safari blockt `fetch()` von `file://`-Seiten zu externen Servern grundsätzlich (WebKit-Sicherheitsrestriktion, nicht umgehbar) — dort erscheint zuverlässig der Fehlerhinweis und die manuelle Eingabe bleibt der einzige Weg. Das ist eine bewusst in Kauf genommene Verschlechterung nur des Komfort-Features, nicht der Kernfunktion.

### Changed

- CSP `connect-src` von `'none'` auf `'self' https://api.frankfurter.app` erweitert — einzige externe Verbindung des Tools, ausschließlich ein GET auf eine öffentliche Kurs-API. Keine Quote-/Kundendaten verlassen dabei den Browser; das ursprüngliche "keine Server-Komponente"-Prinzip (siehe architecture.md) bezieht sich auf ausgehende Kundendaten, nicht auf eingehende öffentliche Referenzdaten.

## [0.18.0] - 2026-09-22

Erneuter, diesmal verifizierter Anlauf für die Subscription-Hinweis-Spalte. v0.17.0 (18.09.) hatte die Tabellenende-Erkennung von "erste nicht-numerische Quellzelle" auf "Spalte Part Number" umgestellt — das war keine reine Ergänzung, sondern eine Änderung der von "Price EUR" genutzten Kernlogik, die in der Praxis zu falschen/fehlenden Berechnungen führte. `js/app.js` wurde daher exakt auf den zuletzt bestätigt funktionierenden Stand v0.9.0 zurückgesetzt; die Subscription-Spalte wurde als komplett separater, additiver Layer obendrauf neu gebaut (eigene Lese-Funktion für "Pricing Term", eigener Berechnungsblock nach der unveränderten Preis-Schleife) und diesmal vor dem Release per Test-Harness gegen zwei synthetische Quotes verifiziert (mit und ohne Pricing-Term-Spalte).

### Added

- Enthält "Pricing Term (in Months)" für eine Zeile eine Zahl (Subscription-Lizenz statt Einmalkauf), bekommt sie in einer neuen Spalte "Preishinweis" direkt hinter "Price EUR" den Text "Der Einzelpreis pro X Monate = Y" (X = Pricing Term, Y = der für diese Zeile bereits berechnete "Price EUR"-Wert). Die Spalte fehlt komplett, wenn keine Zeile eine Subscription-Lizenz enthält oder die Spalte "Pricing Term (in Months)" im Export gar nicht vorkommt.

### Changed

- **Revert:** Tabellenende-Erkennung ist wieder "erste Zeile mit nicht-numerischer/fehlender Quellzelle" (Stand v0.9.0), nicht mehr über "Part Number". Der damit verbundene Bundle-Kindzeilen-Fix ("--"-Platzhalter) aus v0.17.0 ist damit ebenfalls zurückgenommen — kann bei Bedarf separat und einzeln verifiziert wieder ergänzt werden.

## [0.17.0] - 2026-09-18 (zurückgenommen, siehe 0.18.0)

Sauberer Neuaufbau der Subscription-Hinweis-Spalte auf Basis von v0.9.0, mit klarer Trennregel: Alles, was in v0.9.0 funktionierte (insbesondere die Berechnung von "Price EUR" aus "Unit Net Price Before Credits"), bleibt unangetastet. Neu ist ausschließlich die additive Hinweis-Spalte.

### Added

- Enthält "Pricing Term (in Months)" für eine Zeile eine Zahl (Subscription-Lizenz statt Einmalkauf), bekommt sie in einer neuen Spalte direkt hinter "Price EUR" den Text "Der Einzelpreis pro X Monate = Y" (X = Pricing Term, Y = der für diese Zeile bereits berechnete "Price EUR"-Wert — keine andere/zusätzliche Spalte wird dafür herangezogen). Die Spalte fehlt komplett, wenn keine Zeile eine Subscription-Lizenz enthält.

### Fixed

- Tabellenende wird über die Spalte "Part Number" erkannt statt über die erste Zeile mit nicht-numerischem Preis — reale Quotes können in "Unit Net Price Before Credits" einen Text-Platzhalter (`"--"`) für Zeilen ohne eigenen Preis enthalten (z. B. Bundle-Kindzeilen), was die alte Erkennung sofort mit "Keine Artikelzeilen gefunden" abbrechen ließ. Die Berechnung selbst (`ROUND(<Quellzelle>/Kurs,2)`) bleibt unverändert; eine nicht-numerische/fehlende/exakt-0 Quellzelle ergibt jetzt `0,00 €` statt eines Abbruchs.
- Neue Zellen werden jetzt an der laut OOXML korrekten, sortierten Position in die Zeile eingefügt statt immer ans Ende angehängt — bei Quotes mit weiteren, bereits vorhandenen Spalten nach der neuen Preis-Spalte verletzte das sonst die geforderte aufsteigende Spaltenreihenfolge und Excel zeigte beim Öffnen den Reparieren-Dialog.

## Revert auf v0.9.0 - 2026-09-18

Alle Änderungen aus den Versionen 0.10.0–0.16.0 (Subscription-Hinweis-Spalte, "Part Number"-Tabellenende-Erkennung, "Unit List Price"-Umschaltung, Zell-Reihenfolge-Fix, "bereits verarbeitet"-Prüfung) wurden vollständig zurückgenommen — sie funktionierten in der Praxis nicht zuverlässig. `js/app.js` und die Doku entsprechen wieder exakt dem Stand von v0.9.0.

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
