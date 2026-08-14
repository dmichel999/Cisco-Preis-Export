# Architektur

## Kern-Entscheidung: OOXML-Chirurgie statt Parse-Modify-Rewrite

`.xlsx` ist ein ZIP-Container aus XML-Dateien (OOXML). Die naheliegende Variante wäre eine JS-Bibliothek, die die Datei vollständig einliest, ein Objektmodell aufbaut und beim Schreiben neu serialisiert (z. B. SheetJS Community Edition, ExcelJS).

**Problem:** Cisco-Quote-Exporte sind stark formatiert (Farben, Rahmen, Merged Cells, Spaltenbreiten, Rich-Text). Freie JS-Bibliotheken für Browser-Einsatz verlieren beim Rewrite regelmäßig Formatierungsdetails, die in ihrem Objektmodell nicht 1:1 abgebildet sind — das Ergebnis sähe anders aus als das Original, obwohl nur zwei gezielte Änderungen gewünscht sind.

**Lösung:** Die Datei wird per [JSZip](https://stuk.github.io/jszip/) als ZIP geöffnet, aber nur die zwei betroffenen Dateien (`xl/worksheets/sheet<N>.xml` und `xl/styles.xml`) werden gezielt per `DOMParser`/`XMLSerializer` (native Browser-APIs) verändert:

- Neue `<col hidden="1">`-Einträge für den Ausblende-Bereich ergänzen
- Neue `<c>`-Zellen für die EUR-Preis-Spalte an jede Datenzeile anhängen (inkl. Kurs-Hinweis in der Zeile über der Kopfzeile)
- `dimension`-Referenz nachziehen
- In `xl/styles.xml`: einen neuen `<fill>` (gelb) sowie zwei darauf aufbauende `<cellXfs>`-Einträge ergänzen (siehe unten)

Alle anderen Dateien im ZIP (`sharedStrings.xml`, Merged-Cell-Definitionen, Themes, etc.) bleiben byteidentisch zum Original. Dadurch bleibt die Formatierung garantiert erhalten — es wird nichts "nachgebaut", nur gezielt ergänzt.

## Spalten-/Zeilenerkennung: Text-basiert, nicht Buchstaben-basiert

Im aktuell bekannten Export-Format sind die Spalten "Credits" bis "Custom Name" P–AE und die Quellspalte "Unit Net Price Before Credits" ist O. Diese Buchstaben werden **nicht** hartkodiert, sondern zur Laufzeit über die Kopfzeilen-Zelltexte ermittelt:

1. Suche die Zeile, die eine Zelle mit Text "Credits" enthält → Kopfzeile.
2. Innerhalb dieser Zeile: Spalte von "Credits" (Start Ausblende-Bereich), Spalte von "Custom Name" (Ende Ausblende-Bereich, zugleich letzte Bestandsspalte), Spalte von "Unit Net Price Before Credits" (Quellwert für Umrechnung).
3. Datenzeilen = alle Zeilen direkt nach der Kopfzeile, solange sie in der Quellspalte einen reinen Zahlenwert (kein Text) enthalten. Das erste Fehlen (z. B. Übergang zu "Adjustments"/"Note"-Abschnitt) beendet die Tabelle.

**Warum:** Cisco kann die Spaltenreihenfolge zwischen Portal-Versionen ändern, ohne die Struktur (Kopfzeilentexte) zu ändern. Text-basierte Erkennung ist robuster als feste Spaltenbuchstaben und degradiert kontrolliert (klare Fehlermeldung statt stillem Falsch-Ergebnis), falls sich die Kopfzeilentexte doch ändern.

## Style-Wiederverwendung + eine gezielte Style-Ergänzung

Basis-Styles werden von bestehenden `cellXfs`-Einträgen übernommen (Kopfzeile: gleicher Style wie andere rechtsbündige Preis-Header, Datenzeilen: gleicher Style wie Spalte O — Format `#,##0.00`) und per `cloneNode(true)` dupliziert. Für die gewünschte gelbe Hervorhebung (`#FFFF01`) wird auf dem Klon zusätzlich `fillId` (Verweis auf einen neu angelegten `<fill>`) und `applyFill="1"` gesetzt. Das bestehende Basis-`xf` selbst bleibt unverändert — nur der neue, angehängte Klon bekommt die Füllung. `fills`- und `cellXfs`-`count`-Attribute werden nach dem Anhängen neu berechnet (`getElementsByTagName(...).length`), damit sie nicht per Hand nachgeführt werden müssen und nicht aus dem Ruder laufen können.

Wichtig für OOXML-Fills: Bei `patternType="solid"` bestimmt **`fgColor`** (nicht `bgColor`) die sichtbare Füllfarbe der Zelle — ein häufiger Stolperstein.

## Kein Cent-Rundungsfehler durch Gleitkomma

Der Kurs wird als **USD pro EUR** verstanden (Cisco-Dealkurse werden so angegeben, z. B. `1.08`) — der USD-Preis wird also durch den Kurs geteilt, nicht multipliziert. Rundung erfolgt über `Math.round(value * 100) / 100` auf den bereits geteilten Wert — kaufmännische Rundung auf 2 Nachkommastellen, wie in der Quelltabelle (Format `#,##0.00`) üblich.

## Download: Overwrite-Semantik

Die File System Access API (`showSaveFilePicker`) erlaubt in Chromium-Browsern ein echtes Überschreiben der Originaldatei ohne zusätzlichen Download-Ordner-Eintrag. Firefox und Safari unterstützen diese API nicht (Stand 2026) — dort greift ein Fallback über `<a download>` mit identischem Dateinamen; die Kollisionsbehandlung (Nachfrage/Suffix) übernimmt dann der Browser selbst. Beide Pfade sind nötig, da Ziel-Umgebung alle Evergreen-Browser sind (siehe MASTERPROMPT.md).

## Warum keine Server-Komponente

Cisco-Quotes enthalten kundenbezogene und kommerziell sensible Preisdaten. Eine reine Client-Lösung schließt Datenabfluss technisch aus, statt sich auf Prozessdisziplin zu verlassen.
