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
2. Innerhalb dieser Zeile: Spalte von "Credits" (Start Ausblende-Bereich), Spalte von "Custom Name" (Ende Ausblende-Bereich, zugleich letzte Bestandsspalte), Spalte von "Unit Net Price Before Credits" (Quellwert für Umrechnung), Spalte von "Part Number" (Tabellenende-Anker, siehe unten).
3. Datenzeilen = alle Zeilen direkt nach der Kopfzeile, solange die Spalte "Part Number" einen nicht-leeren Wert hat. Die erste Zeile mit leerer "Part Number"-Zelle (z. B. Übergang zu "Adjustments"/"Note"-Abschnitt) beendet die Tabelle.

### Tabellenende: "Part Number" statt "erste nicht-numerische Quellzelle" (0.20.0, zweiter Anlauf)

Reale Quotes können in "Unit Net Price Before Credits" einen Text-Platzhalter (`"--"`) statt einer Zahl enthalten — z. B. bei Bundle-Kindzeilen, oder komplett bei EA-/Subscription-Quotes (z. B. Cisco-ISE-Lizenzen), wo **jede einzelne** Artikelzeile `"--"`/0 hat, weil der reale Gesamtpreis nicht pro Zeile, sondern nur als "Quote Total" in einem separaten Financial-Summary-Block steht (siehe unten). Die erste solche Zeile als Tabellenende zu werten ließ das Tool bei solchen Quotes sofort mit "Keine Artikelzeilen gefunden" abbrechen.

Das Tabellenende wird deshalb über die Spalte "Part Number" erkannt — jede echte Artikelzeile (auch eine ohne eigenen Preis) hat dort einen Wert. **Die Berechnung von "Price EUR" selbst ändert sich dadurch nicht** — sie bleibt exakt `ROUND(<Quellzelle>/Kurs,2)`; eine fehlende/textuelle/`0`-Quellzelle ergibt weiterhin `0,00 €` statt eines Abbruchs. Eine Zeile ganz ohne Quellzelle (z. B. eine "Requested Start Date"-Unterzeile ohne eigene Preisspalte) bekommt ihren `0,00 €`-Wert ohne Formelbezug.

### Preisquelle pro Zeile: "Unit Net Price" für Subscription-Zeilen (0.21.0)

Bei EA-/Subscription-Quotes (z. B. Cisco-ISE-Lizenzen) steht in "Unit Net Price Before Credits" für **jede** Artikelzeile `"--"` — nicht nur bei einzelnen Bundle-Kindzeilen. Der reale (Monats-)Preis solcher Zeilen steht stattdessen in der Spalte "Unit Net Price". Für Einmalkauf-Zeilen ist es umgekehrt: dort ist "Unit Net Price Before Credits" die korrekte, befüllte Quelle.

Die Quellzelle wird deshalb pro Zeile anhand von "Pricing Term (in Months)" gewählt: eine Zahl ≥ 1 markiert eine Subscription-Zeile → Quelle ist "Unit Net Price"; leer/0/nicht vorhanden → Einmalkauf-Zeile → Quelle bleibt "Unit Net Price Before Credits" wie ursprünglich. Ist "Unit Net Price" im Export gar nicht vorhanden, fällt eine Subscription-Zeile auf "Unit Net Price Before Credits" zurück (identisch zum bisherigen Verhalten) statt eines Fehlers.

Die gewählte Quellzelle wird in `dataRow.sourceCell` abgelegt — dieselbe Zelle, auf die später sowohl die "Price EUR"-Formel (`ROUND(<sourceCell>/Kurs,2)`) als auch, für Subscription-Zeilen, der "Preishinweis"-Text (via `dataRow.value`) verweisen. Beide Features mussten dadurch nicht selbst angepasst werden.

**Zweiter Anlauf, diesmal isoliert:** Ein erster Fix-Versuch am 18.09.2026 hat dieselbe Idee mit mehreren anderen, nicht getesteten Änderungen (`resolveCellText`-Erweiterung, sortierte Zell-Einfüge-Reihenfolge statt `appendChild`) in einem Rutsch gebündelt — das Ergebnis war in der Praxis kaputt und wurde am 22.09.2026 komplett zurückgenommen (siehe Release 0.18.0). Der jetzige Fix (0.20.0) ändert **ausschließlich** das Tabellenende-Kriterium plus eine direkt daraus folgende Absicherung (Formel-Zelle nur bei vorhandener Quellzelle — ohne die kann's jetzt wieder Zeilen ganz ohne Quellzelle geben), sonst nichts. Verifiziert gegen eine reale EA-Quote sowie zwei synthetische Regressions-Quotes.

### Subscription-Hinweis: eigene Spalte statt Text in der Preis-Zelle

Ist "Pricing Term (in Months)" für eine Zeile eine Zahl > 0 (Subscription-Lizenz statt Einmalkauf), bekommt sie eine zusätzliche Zelle in einer neuen Spalte direkt hinter "Price EUR" mit dem Text "Der Einzelpreis pro X Monate = Y". Der Hinweistext landet bewusst in einer **eigenen Spalte**, nicht in der "Price EUR"-Zelle selbst: Diese trägt eine echte Formel (siehe oben) — würde man dort zusätzlich Text anhängen, müsste die Zelle zu einem festen Textwert werden und die Formel (und damit die automatische Neuberechnung bei Kursänderung) ginge verloren.

**Y ist exakt der für diese Zeile bereits berechnete "Price EUR"-Wert** — keine andere Spalte (insbesondere nicht "Unit List Price") wird eigens dafür herangezogen. Die Quellzelle dahinter ist bei Subscription-Zeilen seit 0.21.0 "Unit Net Price" statt "Unit Net Price Before Credits" (siehe oben) — für den Hinweistext selbst ändert das nichts, Y bleibt einfach der bereits berechnete Wert.

Sie entsteht nur, wenn mindestens eine Zeile der Quote tatsächlich eine Subscription-Lizenz ist — ist die Spalte "Pricing Term (in Months)" im Export gar nicht vorhanden, bleibt das Feature ein stiller No-op statt eines Fehlers.

**Position: immer exakt eine Spalte hinter "Price EUR" (0.22.0), keine Freie-Spalte-Suche.** Anders als "Price EUR" wird die Position *nicht* per `findFirstFreeColumn` gesucht — "Preishinweis" soll immer direkt neben "Price EUR" stehen, auch wenn dort schon eine Zelle steht. Grund: Läuft das Tool erneut über eine bereits verarbeitete Datei, landet die *neue* "Price EUR"-Spalte weiter rechts als beim letzten Mal (siehe unten) — eine Freie-Spalte-Suche für "Preishinweis" würde dann an der *alten* "Preishinweis"-Spalte vorbeilaufen und eine dritte, noch weiter rechts liegende Spalte anlegen, mit wachsender Lücke bei jedem weiteren Lauf.

Steht an der Zielposition schon eine Zelle, wird sie überschrieben (`upsertCellInOrder` statt `insertCellInOrder`) — typischerweise die eigene "Preishinweis"-Spalte aus dem letzten Lauf, die durch die verschobene "Price EUR"-Spalte jetzt genau dort läge. Liegt die *alte* "Preishinweis"-Spalte dagegen an einer anderen Stelle (z. B. weil dazwischen weitere alte "Price EUR"-Spalten aus noch früheren Läufen stehen), wird sie stattdessen komplett aus jeder Zeile entfernt — sonst blieben zwei "Preishinweis"-Spalten gleichzeitig bestehen.

### "Price EUR": Suche startet hinter der letzten vorhandenen "Price EUR"-Spalte (0.22.0)

Läuft das Tool über eine bereits verarbeitete Datei, beginnt `findFirstFreeColumn` für die neue "Price EUR"-Spalte nicht mehr immer bei `customNameCol + 1`, sondern bei `max(customNameCol + 1, letzte-vorhandene-"Price EUR"-Spalte + 1)` — die neue Spalte landet dadurch direkt hinter der letzten, statt bei jedem erneuten Lauf wieder ab "Custom Name" zu suchen (was durch die dazwischenliegenden alten Spalten ohnehin zum selben Ergebnis geführt hätte, aber unnötig lange sucht). Alte "Price EUR"-Spalten aus früheren Läufen werden bewusst **nicht** überschrieben, sondern bleiben stehen — nur "Preishinweis" wird wiederverwendet (siehe oben).

**`<cols>`-Bereinigung vor dem Einfügen:** Der Ausblende-Bereich (`<col hidden="1">`) reicht bei jedem Lauf bis `newColIndex - 1` — bei einem erneuten Lauf ist das zwangsläufig weiter rechts als beim letzten Mal und überlappt daher mit dem alten Ausblende-Bereich sowie mit der `<col>`-Breite der alten "Price EUR"-Spalte (die jetzt mit in den Ausblende-Bereich fällt). Zwei überlappende `<col min="X" max="Y">`-Bereiche sind ungültiges OOXML — derselbe Fehlerklasse, die in 0.20.1 schon bei `<row>`-Zellen den Reparieren-Dialog auslöste. `removeOverlappingColRanges` entfernt deshalb vor dem Einfügen jeden bestehenden `<col>`-Bereich, der die neue Zielspanne (`creditsCol` bis `noteColIndex`/`newColIndex`) berührt.

**Stolperfalle beim Pricing-Term-Auslesen:** "Pricing Term (in Months)" ist in echten Exporten mal ein Shared-String (oft mit einem *leeren* String — "kein Term gesetzt"), mal eine reine Zahl (`t`-Attribut fehlt komplett). Dafür gibt es die eigene, lokale Funktion `resolvePricingTermMonths` — bewusst getrennt von `resolveCellText`, damit diese für "Credits"/"Custom Name"/"Unit Net Price Before Credits" genutzte Kernfunktion unverändert bleibt (siehe Release 0.18.0: das war genau der Fehler beim ersten Anlauf am 18.09.).

Kurs- und Datumszeile werden relativ zur Kopfzeile adressiert (`previousElementSibling`, bzw. dessen Zeilennummer − 1), nicht über feste Zeilennummern — funktioniert auch, wenn der Header in einer anderen Quote-Datei in einer anderen Zeile liegt.

**Warum:** Cisco kann die Spaltenreihenfolge zwischen Portal-Versionen ändern, ohne die Struktur (Kopfzeilentexte) zu ändern. Text-basierte Erkennung ist robuster als feste Spaltenbuchstaben und degradiert kontrolliert (klare Fehlermeldung statt stillem Falsch-Ergebnis), falls sich die Kopfzeilentexte doch ändern.

### Quote-Total-Umrechnung: eigener, komplett unabhängiger Pfad (0.20.0)

EA-/Subscription-Quotes (z. B. Cisco-ISE-Lizenzen) haben in der Artikeltabelle oft **gar keinen** brauchbaren Zeilenpreis (siehe oben) — der reale Gesamtpreis steht stattdessen in einem separaten "Financial Summary"-Block weiter oben im Blatt, als eigene kleine Tabelle mit Kopfzeile (u. a. Spalten "... List Price", "Discount %", "Special Items Total") und mehreren Ergebniszeilen (Product-/Service-/Subscription-SubTotal, "Quote Total").

`findQuoteTotalCell` (`js/app.js`) sucht dafür zwei unabhängige Textanker über das gesamte Blatt: eine Zeile mit Zelltext "Quote Total" (Zeilen-Anker) und eine Spalte mit Kopftext "Special Items Total" (Spalten-Anker — bewusst **nicht** "... List Price", das ist der Betrag vor Rabatt). Nur der Schnittpunkt beider Anker — plain-numerisch, kein Text — wird als Quelle akzeptiert. Fehlt einer der beiden Anker (normale Quotes ohne diesen Block), bleibt das Feature stiller No-op, komplett unabhängig von `findQuoteTable`/der Artikeltabelle.

Die Umrechnung selbst folgt exakt demselben Muster wie "Price EUR": eine neue Spalte "Quote Total (EUR)" in der Kopfzeile des Financial-Summary-Blocks, eine echte `ROUND(<Quellzelle>/<Kurszelle>,2)`-Formel in der "Quote Total"-Zeile, dieselbe Kurs-Zelle wie überall sonst im Dokument (ein Kurs, eine Änderung in Excel aktualisiert alles).

### Zielspalte für "Price EUR": erste tatsächlich freie Spalte, nicht "Custom Name" + 1

Naheliegend wäre, die neue Spalte fest bei `customNameCol + 1` einzufügen (direkt hinter "Custom Name", vor dem Ausblende-Bereich-Ende). Das brach im September 2026, als Cisco im Export-Format zusätzlich eine befüllte Spalte "BPA No Subscription Line" direkt hinter "Custom Name" ergänzte — die neue Preis-Spalte kollidierte dort mit doppelten Zellreferenzen (`<c r="AE41">` zweimal in derselben Zeile), Excel verwarf die Preis-Zellen kommentarlos.

Seit v0.8.0 wird die Zielspalte stattdessen zur Laufzeit gesucht (`findFirstFreeColumn` in `js/app.js`): ausgehend von `customNameCol + 1` wird hochgezählt, bis eine Spalte gefunden ist, die in **allen** relevanten Zeilen frei ist — Kopfzeile, Kurszeile, Datumszeile (falls vorhanden) und jede Datenzeile. Das degradiert kontrolliert: taucht künftig eine weitere Zusatzspalte auf, rutscht die Preis-Spalte einfach eine weiter nach rechts, statt zu kollidieren.

Seit v0.9.0 reicht der Ausblende-Bereich (`<col hidden="1">`) entsprechend bis `newColIndex - 1`, nicht mehr nur bis `customNameCol`. Damit verschwinden auch Zwischenspalten wie "BPA No Subscription Line" automatisch mit, und "Price EUR" folgt visuell direkt auf die USD-Preisspalte — unabhängig davon, wie viele zusätzliche Spalten Cisco zwischen "Custom Name" und der tatsächlich freien Spalte einfügt.

### Neue Zellen müssen an sortierter Position eingefügt werden, nicht angehängt (0.20.1)

OOXML verlangt, dass `<c>`-Elemente innerhalb einer `<row>` in aufsteigender Spaltenreihenfolge stehen. Neue Zellen per `appendChild` immer ans Zeilenende zu hängen bricht, sobald *nach* der neu eingefügten Spalte noch eine weitere, bereits vorhandene Zelle mit Inhalt in derselben Zeile steht (z. B. eine Cisco-eigene Berechnungsspalte, oder — real aufgetreten — eine Störzelle aus einem früheren, nicht abgeschlossenen Verarbeitungsversuch derselben Datei) — Excel zeigt dann beim Öffnen den Reparieren-Dialog ("Wir haben ein Problem bei einigen Inhalten erkannt").

`insertCellInOrder(rowEl, cellEl, colIndex)` übernimmt deshalb jedes Einfügen einer neuen `<c>`-Zelle in eine bestehende `<row>` (Kurs-Zelle, Datums-Zelle, Kopfzellen, Preis-/Preishinweis-/Quote-Total-Datenzellen): Es sucht die erste vorhandene Zelle mit größerem Spaltenindex und fügt per `insertBefore` davor ein, statt blind anzuhängen.

**Historie:** Dieselbe Lösung war bereits Teil des am 22.09.2026 verworfenen v0.17.0-Anlaufs, wurde beim Revert auf v0.9.0-Kernlogik (0.18.0) aber pauschal mitentfernt, weil unklar war, ob sie zur damaligen Regression beigetragen hatte. Direkt beim ersten Test von v0.20.0 (Part-Number-Anker-Fix, siehe oben) gegen eine reale Quote trat der Reparieren-Dialog tatsächlich auf — diesmal mit konkretem Reproduktionsfall verifiziert (alle 61 Zeilen der realen Datei nach dem Fix korrekt aufsteigend sortiert), reine Struktur-Änderung ohne Auswirkung auf berechnete Werte oder Formeln.

## Style-Wiederverwendung + gezielte Style-Ergänzungen

Basis-Styles werden von bestehenden `cellXfs`-Einträgen übernommen (Kopfzeile: gleicher Style wie andere rechtsbündige Preis-Header, Datenzeilen: gleicher Style wie Spalte O — Format `#,##0.00`) und per `cloneNode(true)` dupliziert. Für die gewünschte gelbe Hervorhebung (`#FFFF01`) wird auf dem Klon zusätzlich `fillId` (Verweis auf einen neu angelegten `<fill>`) und `applyFill="1"` gesetzt. Das bestehende Basis-`xf` selbst bleibt unverändert — nur der neue, angehängte Klon bekommt die Füllung. `fills`- und `cellXfs`-`count`-Attribute werden nach dem Anhängen neu berechnet (`getElementsByTagName(...).length`), damit sie nicht per Hand nachgeführt werden müssen und nicht aus dem Ruder laufen können.

Wichtig für OOXML-Fills: Bei `patternType="solid"` bestimmt **`fgColor`** (nicht `bgColor`) die sichtbare Füllfarbe der Zelle — ein häufiger Stolperstein.

Für die Preis-Zellen wird zusätzlich ein **Custom-Zahlenformat** angelegt (`<numFmts>`, ID ab 164 — der konventionelle Startpunkt für benutzerdefinierte IDs, da 0–163 für eingebaute Formate reserviert sind): `#,##0.00" €"` für die Euro-Anzeige. `<numFmts>` existierte in der Originaldatei nicht und muss laut Schema als erstes Kind von `<styleSheet>` eingefügt werden (vor `<fonts>`). Die Kurs-Zelle selbst bekommt bewusst **kein** Custom-Format (bleibt General) — reine, unbeschriftete Zahl zum direkten Bearbeiten.

## Sparse Rows: die Datumszeile existiert oft nicht

OOXML lässt leere Zeilen in `sheetData` komplett weg (sparse XML) — die Zeile über der Kurs-Zeile (aktuell 38) ist in der Beispieldatei nicht als `<row>`-Element vorhanden. Vor dem Einfügen der Datums-Zelle wird daher erst per Zeilennummer gesucht, ob die Zeile existiert; falls nicht, wird ein neues `<row>`-Element angelegt und per `insertBefore` exakt an der richtigen Stelle (vor der Kurs-Zeile) einsortiert — `<row>`-Elemente müssen in aufsteigender `r`-Reihenfolge stehen, Lücken sind erlaubt, doppelte/unsortierte Einträge nicht.

## Live-Neuberechnung statt fester Werte

Statt eines fest berechneten Werts bekommt jede Preiszeile eine echte Formel: `<f>ROUND(O41/$AF$39,2)</f>` (Quellzelle relativ, Kurszelle mit `$`-Absolutbezug). Der mitgelieferte `<v>`-Cache-Wert entspricht dem zum Verarbeitungszeitpunkt berechneten Ergebnis, wird von Excel aber automatisch neu berechnet, sobald sich AF39 (oder eine andere abhängige Zelle) ändert — Standardverhalten bei automatischem Berechnungsmodus (`calcPr` in `workbook.xml` setzt keinen `calcMode="manual"`). Dadurch kann der Kurs direkt in Excel angepasst werden, ohne die Datei erneut durchs Tool zu schicken.

**Formel nur bei plain-numerischer Quellzelle (0.22.1).** Eine Formel wird nur erzeugt, wenn die Quellzelle sowohl existiert *als auch* plain-numerisch ist (`!sourceCell.getAttribute('t')`) — nicht nur "existiert". Grund: Eine Einmalkauf-Zeile ohne Pricing Term nutzt "Unit Net Price Before Credits" als Quelle (siehe oben); enthält diese Zelle `"--"` (Text, z. B. weil die Zeile Teil einer gemischten Quote mit sowohl Hardware- als auch Subscription-Zeilen ist), würde `ROUND("--"/Kurs,2)` in Excel beim Öffnen zu `#WERT!` neu berechnet und den korrekt gecachten `0,00 €`-Wert überschreiben — Excel führt die Formel beim Öffnen wirklich aus, der `<v>`-Cache-Wert ist nur ein Platzhalter bis zur ersten Neuberechnung. Betrifft ausschließlich die "Price EUR"-Formel; die "Quote Total (EUR)"-Formel ist davon nicht betroffen, da `findQuoteTotalCell` von vornherein nur plain-numerische Quellzellen akzeptiert.

## Kein Cent-Rundungsfehler durch Gleitkomma

Der Kurs wird als **USD pro EUR** verstanden (Cisco-Dealkurse werden so angegeben, z. B. `1.08`) — der USD-Preis wird also durch den Kurs geteilt, nicht multipliziert. Rundung erfolgt über `Math.round(value * 100) / 100` auf den bereits geteilten Wert — kaufmännische Rundung auf 2 Nachkommastellen, wie in der Quelltabelle (Format `#,##0.00`) üblich.

## Download: Overwrite-Semantik

Die File System Access API (`showSaveFilePicker`) erlaubt in Chromium-Browsern ein echtes Überschreiben der Originaldatei ohne zusätzlichen Download-Ordner-Eintrag. Firefox und Safari unterstützen diese API nicht (Stand 2026) — dort greift ein Fallback über `<a download>` mit identischem Dateinamen; die Kollisionsbehandlung (Nachfrage/Suffix) übernimmt dann der Browser selbst. Beide Pfade sind nötig, da Ziel-Umgebung alle Evergreen-Browser sind (siehe MASTERPROMPT.md).

## Warum keine Server-Komponente

Cisco-Quotes enthalten kundenbezogene und kommerziell sensible Preisdaten. Eine reine Client-Lösung schließt Datenabfluss technisch aus, statt sich auf Prozessdisziplin zu verlassen.

**Der automatische Kursabruf (siehe unten) ist davon unberührt:** Es ist ein reiner GET auf eine öffentliche Kurs-API, ohne jede Quote-/Kundendaten im Request. Das Prinzip bezieht sich auf *ausgehende* Daten, nicht auf das Nachladen einer öffentlichen Referenzinformation.

## Automatischer Wechselkurs: Frankfurter API statt finanzen.net

Ursprünglich wurde finanzen.net als Quelle für den automatischen USD/EUR-Kurs angefragt. Das scheitert an harter Bot-Erkennung (Akamai): Selbst ein einfacher `curl` mit regulärem Browser-User-Agent bekommt `403 Access Denied` — programmatischer Zugriff ist dort nicht vorgesehen, ein Client-seitiger `fetch()` aus dem Tool wäre denselben Weg gegangen.

Stattdessen liefert die [Frankfurter API](https://frankfurter.dev) (`api.frankfurter.dev`) den täglichen EUR/USD-Referenzkurs der Europäischen Zentralbank: kostenlos, ohne API-Key, mit offenem `Access-Control-Allow-Origin: *` — verifiziert per `curl -I`. Der Kurs wird beim Öffnen des Tools automatisch geladen und als Vorschlag ins Kurs-Feld eingetragen (`bindRateAutoFetch` in `js/app.js`), bleibt aber jederzeit von Hand überschreibbar — er ersetzt nur den Ausgangswert, nicht die manuelle Eingabe als Fallback.

Dafür musste die CSP (`connect-src`) von `'none'` auf `'self' https://api.frankfurter.dev` erweitert werden — die einzige externe Verbindung, die dieses Tool überhaupt aufbaut.

**Stolperfalle: `api.frankfurter.app` (die ursprünglich dokumentierte, ältere Domain) leitet inzwischen per 301 auf `api.frankfurter.dev` weiter** (Domain-Umzug des Anbieters, per `curl -v` entdeckt). Eine CSP `connect-src`-Allowlist deckt nur exakt gelistete Hosts ab, auch das Redirect-Ziel — mit nur der alten Domain in der Allowlist schlug `fetch()` mit einem nicht-aussagekräftigen "Load failed" fehl, sowohl unter `file://` als auch über GitHub Pages (https). Deshalb referenziert das Tool jetzt direkt `api.frankfurter.dev/v1/...` statt der umleitenden `.app`-Domain.

**Bekannte Einschränkung: funktioniert nur in Chromium-Browsern.** Safari (WebKit) blockt `fetch()`/`XMLHttpRequest` von `file://`-Seiten zu externen Hosts grundsätzlich — unabhängig von CORS-Headern des Ziels, unabhängig von der CSP. Verifiziert mit einer isolierten Minimal-Testseite (nur `fetch()`, kein sonstiger Code): identischer `Load failed`-Fehler wie im echten Tool. Das ist keine Fehlkonfiguration, sondern eine bewusste WebKit-Sicherheitsrestriktion für lokale Dateien und nicht umgehbar, ohne das "kein Server"-Grundprinzip aufzugeben. In Safari degradiert das Feature deshalb kontrolliert: `bindRateAutoFetch` fängt den Fehler ab und zeigt "Kurs konnte nicht automatisch geladen werden — bitte manuell eingeben"; das Tool bleibt voll funktionsfähig, nur ohne den Komfort-Vorschlag.
