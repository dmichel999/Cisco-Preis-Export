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

### Neue Zellen müssen an sortierter Position eingefügt werden, nicht angehängt

OOXML verlangt, dass `<c>`-Elemente innerhalb einer `<row>` in aufsteigender Spaltenreihenfolge stehen. Bis v0.13.0 wurden neue Zellen per `rowEl.appendChild(cell)` immer als letztes Element eingefügt — das brach bei Quotes, die *nach* der neu eingefügten Spalte noch weitere, bereits vorhandene Spalten mit Inhalt haben (z. B. eine Cisco-eigene Berechnungsspalte hinter "Custom Name", siehe "BPA No Subscription Line"/`findFirstFreeColumn`). Excel zeigte dann beim Öffnen den Reparieren-Dialog ("Wir haben ein Problem bei einigen Inhalten erkannt").

Seit v0.14.0 übernimmt `insertCellInOrder(rowEl, cellEl, colIndex)` das Einfügen: Es sucht die erste vorhandene Zelle mit größerem Spaltenindex und fügt per `insertBefore` davor ein, statt blind anzuhängen. Jede Stelle, die eine neue `<c>`-Zelle in eine bestehende `<row>` einfügt (Kurs-Zelle, Datums-Zelle, Kopfzellen, Preis-Datenzellen, Preishinweis-Zellen), muss diese Funktion verwenden statt `appendChild`.

## Spalten-/Zeilenerkennung: Text-basiert, nicht Buchstaben-basiert

Im aktuell bekannten Export-Format sind die Spalten "Credits" bis "Custom Name" P–AE und die Quellspalte "Unit Net Price Before Credits" ist O. Diese Buchstaben werden **nicht** hartkodiert, sondern zur Laufzeit über die Kopfzeilen-Zelltexte ermittelt:

1. Suche die Zeile, die eine Zelle mit Text "Credits" enthält → Kopfzeile.
2. Innerhalb dieser Zeile: Spalte von "Credits" (Start Ausblende-Bereich), Spalte von "Custom Name" (Ende Ausblende-Bereich, zugleich letzte Bestandsspalte), Spalte von "Unit Net Price Before Credits" (Quellwert für Umrechnung), Spalte von "Part Number" (Tabellenende-Anker, siehe unten).
3. Datenzeilen = alle Zeilen direkt nach der Kopfzeile, solange sie in der Spalte "Part Number" einen nicht-leeren Wert haben. Die erste Zeile mit leerer "Part Number"-Zelle (z. B. Übergang zu "Adjustments"/"Note"-Abschnitt) beendet die Tabelle.

### Tabellenende: "Part Number" statt "erste nicht-numerische Quellzelle"

Bis v0.10.0 galt die erste Zeile ohne reinen Zahlenwert in der Quellspalte ("Unit Net Price Before Credits") als Tabellenende. Das brach im September 2026 an echten Quotes: Cisco schreibt für Zeilen ohne eigenen Preis (z. B. Kindzeilen eines Bundles, deren Preis in der Bundle-Zeile steckt) dort einen Text-Platzhalter (`"--"`) statt eine `0` oder eine leere Zelle — die allererste solche Zeile ließ das Tool sofort mit "Keine Artikelzeilen gefunden" abbrechen, obwohl danach noch reguläre Artikelzeilen folgten (in dem konkreten Fall sogar ausschließlich solche Zeilen, siehe Release 0.11.0).

Das Tabellenende wird seit v0.11.0 stattdessen über die Spalte "Part Number" erkannt — jede echte Artikelzeile (auch eine ohne eigenen Preis) hat dort einen Wert, während Zeilen jenseits der Tabelle (Leerzeilen, "Note"-Zeile, AGB-Text) dort leer sind. Eine fehlende, textuelle oder exakt-`0`-Quellzelle bedeutet dadurch nur noch "Preis für diese Zeile ist 0" (der Wert fällt seit v0.15.0 auf `0` zurück statt die Zelle ganz auszulassen), nicht mehr "Ende der Tabelle". Nur eine Zeile ganz ohne Quellzelle (kein `sourceCell`, z. B. eine reine Notizzeile ohne eigene Preisspalte) bekommt ihren `0,00 €`-Wert ohne Formelbezug — jede Zeile mit einer Quellzelle bekommt weiterhin die Live-Formel, auch wenn deren Ergebnis 0 ist.

### "Unit List Price" nur für den Subscription-Hinweistext, nicht für die Haupt-Preis-Spalte

Die Haupt-Spalte "Price EUR" berechnet sich **immer** aus "Unit Net Price Before Credits" — für jede Zeile, auch wenn Cisco dort für Subscription-Lizenzen nur den Platzhalter `"--"` einträgt (dann wird der Wert 0). v0.12.0 hatte versucht, die Quellspalte pro Zeile umzuschalten (`pricingTermMonths > 0` → "Unit List Price" statt "Unit Net Price Before Credits") — das wurde in v0.16.0 zurückgenommen, weil die Haupt-Spalte weiterhin konsistent "Unit Net Price Before Credits" abbilden soll.

"Unit List Price" (optionale Ankertext-Spalte, wie "Pricing Term") wird stattdessen ausschließlich für den Y-Wert im Subscription-Hinweistext verwendet ("Der Einzelpreis pro X Monate = Y") — der tatsächliche Lizenzpreis pro Abrechnungszeitraum steht dort, nicht in "Unit Net Price Before Credits" (das ist für eine Lizenz mit Laufzeit kein aussagekräftiger Netto-Transaktionspreis). Y kann sich deshalb bewusst vom Wert in "Price EUR" unterscheiden — beide Spalten bilden unterschiedliche Cisco-Preisfelder ab. `dataRows` führt dafür `value` (aus "Unit Net Price Before Credits", für "Price EUR") und `listPriceValue` (aus "Unit List Price", nur für den Hinweistext) getrennt.

**Stolperfalle beim Pricing-Term-Auslesen:** "Pricing Term (in Months)" ist in echten Exporten mal ein Shared-String (oft mit einem *leeren* String — "kein Term gesetzt", kein numerischer Fallback), mal eine reine Zahl (`t`-Attribut fehlt komplett). `resolveCellText` deckte den letzteren Fall bis v0.12.0 nicht ab (gab `null` zurück) — ein rein numerischer Zellwert ohne `t`-Attribut wird jetzt ebenfalls über `<v>` aufgelöst statt fälschlich als "kein Wert" zu gelten. Das betrifft auch die "Part Number"-Erkennung, falls eine Part Number rein numerisch wäre.

Kurs- und Datumszeile werden relativ zur Kopfzeile adressiert (`previousElementSibling`, bzw. dessen Zeilennummer − 1), nicht über feste Zeilennummern — funktioniert auch, wenn der Header in einer anderen Quote-Datei in einer anderen Zeile liegt.

**Warum:** Cisco kann die Spaltenreihenfolge zwischen Portal-Versionen ändern, ohne die Struktur (Kopfzeilentexte) zu ändern. Text-basierte Erkennung ist robuster als feste Spaltenbuchstaben und degradiert kontrolliert (klare Fehlermeldung statt stillem Falsch-Ergebnis), falls sich die Kopfzeilentexte doch ändern.

### Zielspalte für "Price EUR": erste tatsächlich freie Spalte, nicht "Custom Name" + 1

Naheliegend wäre, die neue Spalte fest bei `customNameCol + 1` einzufügen (direkt hinter "Custom Name", vor dem Ausblende-Bereich-Ende). Das brach im September 2026, als Cisco im Export-Format zusätzlich eine befüllte Spalte "BPA No Subscription Line" direkt hinter "Custom Name" ergänzte — die neue Preis-Spalte kollidierte dort mit doppelten Zellreferenzen (`<c r="AE41">` zweimal in derselben Zeile), Excel verwarf die Preis-Zellen kommentarlos.

Seit v0.8.0 wird die Zielspalte stattdessen zur Laufzeit gesucht (`findFirstFreeColumn` in `js/app.js`): ausgehend von `customNameCol + 1` wird hochgezählt, bis eine Spalte gefunden ist, die in **allen** relevanten Zeilen frei ist — Kopfzeile, Kurszeile, Datumszeile (falls vorhanden) und jede Datenzeile. Das degradiert kontrolliert: taucht künftig eine weitere Zusatzspalte auf, rutscht die Preis-Spalte einfach eine weiter nach rechts, statt zu kollidieren.

Seit v0.9.0 reicht der Ausblende-Bereich (`<col hidden="1">`) entsprechend bis `newColIndex - 1`, nicht mehr nur bis `customNameCol`. Damit verschwinden auch Zwischenspalten wie "BPA No Subscription Line" automatisch mit, und "Price EUR" folgt visuell direkt auf die USD-Preisspalte — unabhängig davon, wie viele zusätzliche Spalten Cisco zwischen "Custom Name" und der tatsächlich freien Spalte einfügt.

## Style-Wiederverwendung + gezielte Style-Ergänzungen

Basis-Styles werden von bestehenden `cellXfs`-Einträgen übernommen (Kopfzeile: gleicher Style wie andere rechtsbündige Preis-Header, Datenzeilen: gleicher Style wie Spalte O — Format `#,##0.00`) und per `cloneNode(true)` dupliziert. Für die gewünschte gelbe Hervorhebung (`#FFFF01`) wird auf dem Klon zusätzlich `fillId` (Verweis auf einen neu angelegten `<fill>`) und `applyFill="1"` gesetzt. Das bestehende Basis-`xf` selbst bleibt unverändert — nur der neue, angehängte Klon bekommt die Füllung. `fills`- und `cellXfs`-`count`-Attribute werden nach dem Anhängen neu berechnet (`getElementsByTagName(...).length`), damit sie nicht per Hand nachgeführt werden müssen und nicht aus dem Ruder laufen können.

Wichtig für OOXML-Fills: Bei `patternType="solid"` bestimmt **`fgColor`** (nicht `bgColor`) die sichtbare Füllfarbe der Zelle — ein häufiger Stolperstein.

Für die Preis-Zellen wird zusätzlich ein **Custom-Zahlenformat** angelegt (`<numFmts>`, ID ab 164 — der konventionelle Startpunkt für benutzerdefinierte IDs, da 0–163 für eingebaute Formate reserviert sind): `#,##0.00" €"` für die Euro-Anzeige. `<numFmts>` existierte in der Originaldatei nicht und muss laut Schema als erstes Kind von `<styleSheet>` eingefügt werden (vor `<fonts>`). Die Kurs-Zelle selbst bekommt bewusst **kein** Custom-Format (bleibt General) — reine, unbeschriftete Zahl zum direkten Bearbeiten.

## Sparse Rows: die Datumszeile existiert oft nicht

OOXML lässt leere Zeilen in `sheetData` komplett weg (sparse XML) — die Zeile über der Kurs-Zeile (aktuell 38) ist in der Beispieldatei nicht als `<row>`-Element vorhanden. Vor dem Einfügen der Datums-Zelle wird daher erst per Zeilennummer gesucht, ob die Zeile existiert; falls nicht, wird ein neues `<row>`-Element angelegt und per `insertBefore` exakt an der richtigen Stelle (vor der Kurs-Zeile) einsortiert — `<row>`-Elemente müssen in aufsteigender `r`-Reihenfolge stehen, Lücken sind erlaubt, doppelte/unsortierte Einträge nicht.

## Live-Neuberechnung statt fester Werte

Statt eines fest berechneten Werts bekommt jede Preiszeile eine echte Formel: `<f>ROUND(O41/$AF$39,2)</f>` (Quellzelle relativ, Kurszelle mit `$`-Absolutbezug). Der mitgelieferte `<v>`-Cache-Wert entspricht dem zum Verarbeitungszeitpunkt berechneten Ergebnis, wird von Excel aber automatisch neu berechnet, sobald sich AF39 (oder eine andere abhängige Zelle) ändert — Standardverhalten bei automatischem Berechnungsmodus (`calcPr` in `workbook.xml` setzt keinen `calcMode="manual"`). Dadurch kann der Kurs direkt in Excel angepasst werden, ohne die Datei erneut durchs Tool zu schicken.

## Kein Cent-Rundungsfehler durch Gleitkomma

Der Kurs wird als **USD pro EUR** verstanden (Cisco-Dealkurse werden so angegeben, z. B. `1.08`) — der USD-Preis wird also durch den Kurs geteilt, nicht multipliziert. Rundung erfolgt über `Math.round(value * 100) / 100` auf den bereits geteilten Wert — kaufmännische Rundung auf 2 Nachkommastellen, wie in der Quelltabelle (Format `#,##0.00`) üblich.

## Subscription-Hinweis: eigene Spalte statt Text in der Preis-Zelle

Der Hinweistext für Subscription-Zeilen ("Der Einzelpreis pro X Monate = Y") landet bewusst in einer eigenen Spalte rechts neben "Price EUR", nicht in derselben Zelle. Die "Price EUR"-Zelle trägt eine echte Formel (siehe "Live-Neuberechnung" oben) — würde man dort zusätzlich Text anhängen, müsste die Zelle zu einem festen `inlineStr`-Textwert werden und die Formel (und damit die automatische Neuberechnung bei Kursänderung) ginge für genau diese Zeilen verloren. Die neue Spalte wird wie "Price EUR" per `findFirstFreeColumn` ermittelt (ausgehend von der Spalte direkt nach "Price EUR"), damit sie nicht mit weiteren, künftig von Cisco eingefügten Spalten kollidiert. Sie entsteht nur, wenn mindestens eine Zeile der Quote tatsächlich eine Subscription-Lizenz ist (`"Pricing Term (in Months)"` > 0) — ist die Spalte "Pricing Term (in Months)" im Export gar nicht vorhanden, bleibt das Feature ein stiller No-op statt eines Fehlers (siehe Spaltenerkennung oben).

## Download: Overwrite-Semantik

Die File System Access API (`showSaveFilePicker`) erlaubt in Chromium-Browsern ein echtes Überschreiben der Originaldatei ohne zusätzlichen Download-Ordner-Eintrag. Firefox und Safari unterstützen diese API nicht (Stand 2026) — dort greift ein Fallback über `<a download>` mit identischem Dateinamen; die Kollisionsbehandlung (Nachfrage/Suffix) übernimmt dann der Browser selbst. Beide Pfade sind nötig, da Ziel-Umgebung alle Evergreen-Browser sind (siehe MASTERPROMPT.md).

## Warum keine Server-Komponente

Cisco-Quotes enthalten kundenbezogene und kommerziell sensible Preisdaten. Eine reine Client-Lösung schließt Datenabfluss technisch aus, statt sich auf Prozessdisziplin zu verlassen.
