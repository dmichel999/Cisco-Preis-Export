# Feature-Spezifikation

## Kernfunktion

Eine Cisco-Quote-Exportdatei (`.xlsx`) wird im Browser geladen, verändert und wieder heruntergeladen — ohne Server, ohne Datenabfluss.

### Ablauf

1. **Datei laden** — Drag & Drop in die Drop-Zone oder Dateiauswahl per Klick. Nur `.xlsx` wird akzeptiert.
2. **Struktur erkennen** — das Tool sucht im ersten Tabellenblatt die Kopfzeile der Artikeltabelle anhand der Zelltexte "Credits", "Custom Name", "Unit Net Price Before Credits" und "Part Number" (siehe [architecture.md](architecture.md) für die Begründung dieses Ansatzes). Die Artikelzeilen selbst enden dort, wo die Spalte "Part Number" leer ist (nicht mehr an der ersten Zeile ohne numerischen Preis, siehe unten).
3. **Kurs abfragen** — Eingabefeld für den Wechselkurs als **USD pro EUR** (Dezimalzahl, z. B. `1.08` — so wie Cisco-Dealkurse üblicherweise angegeben werden). Validierung: positive Zahl, Komma wird als Dezimaltrennzeichen akzeptiert.
4. **Spalten ausblenden** — alle Spalten von "Credits" bis "Custom Name" (aktuell P–AE) werden als `hidden` markiert, nicht gelöscht.
5. **Kurs-Zelle** — in der Zeile direkt über der Kopfzeile (aktuell Zeile 39) wird in der neuen Spalte der verwendete Kurs als **reine, bearbeitbare Zahl** eingetragen (z. B. `1.58`), ohne Beschriftung/Text. Eine Zeile darüber (aktuell Zeile 38, im Original meist leer/nicht vorhanden und wird bei Bedarf neu angelegt) wird zusätzlich das aktuelle Datum eingetragen (`TT.MM.JJJJ`), damit ersichtlich ist, von wann der Kurs stammt — passt man den Kurs später von Hand in Excel an, muss man dieses Datum ebenfalls von Hand nachziehen.
6. **EUR-Preis berechnen** — jede Artikelzeile bekommt in der neuen Spalte (direkt nach der letzten Bestandsspalte, aktuell AF, Kopfzeile "Price EUR") eine **Excel-Formel**: `=ROUND(<Quellzelle>/$AF$39,2)`, angezeigt im Euro-Zahlenformat (`#,##0.00 €`). Ändert man den Kurs in AF39 direkt in Excel, rechnet Excel alle Preise automatisch neu — kein erneuter Durchlauf durchs Tool nötig. Die neue Spalte (Kurs-Zelle, Kopfzeile, alle Datenzeilen) wird gelb hinterlegt (`#FFFF01`). Eine Quellzelle ohne verwertbaren Preis — fehlt, enthält Text (z. B. Ciscos `"--"`-Platzhalter für Bundle-Kindzeilen ohne eigenen Preis) oder ist exakt `0` — führt zu `0,00 €` in dieser Zelle, nicht zu einer leeren Zelle. Nur Zeilen ganz ohne Quellzelle (z. B. eine reine "Requested Start Date"-Notizzeile ohne eigene Preisspalte) bekommen einen festen `0,00 €`-Wert ohne Formelbezug.
   - **Quellspalte je Zeile:** Ist "Pricing Term (in Months)" > 0 (Subscription-Lizenz), wird "Unit List Price" als Quellpreis verwendet, nicht "Unit Net Price Before Credits" — Cisco trägt dort bei Subscription-Zeilen nur `"--"` ein, der eigentliche Lizenzpreis steht in "Unit List Price". Alle anderen Zeilen nutzen weiterhin "Unit Net Price Before Credits".
7. **Subscription-Hinweis** — enthält die Zeile eine Spalte "Pricing Term (in Months)" mit einem Wert > 0 (Subscription-Lizenz statt Einmalkauf), bekommt sie zusätzlich eine Zelle in einer neuen Spalte "Preishinweis" mit dem Text "Der Einzelpreis pro X Monate = Y" (X = Pricing Term in Monaten, Y = der berechnete EUR-Preis dieser Zeile, auch wenn Y = 0,00 €). Diese Spalte fehlt komplett, wenn keine Zeile der Quote eine Subscription-Lizenz enthält.
8. **Download** — Dateiname bleibt identisch zum Original. Wo unterstützt (Chrome/Edge) wird die Originaldatei direkt überschrieben (File System Access API); sonst regulärer Download, der Browser übernimmt die Kollisionsbehandlung (z. B. Nachfrage "Datei ersetzen?" oder automatisches Anhängen von "(1)").

### Was bewusst NICHT verändert wird

- Bestehende Zellwerte, -formate, -farben, -rahmen, Merged Cells, Spaltenbreiten außerhalb des Zielbereichs
- Alle anderen Tabellenblätter/Bereiche außerhalb der Artikeltabelle (Kopfdaten, Finanz-Summary, Adjustments, Notes, AGB-Text)

## Fehlerbehandlung

- Fehlt eine der vier Ankertext-Spalten ("Credits", "Custom Name", "Unit Net Price Before Credits", "Part Number") im ersten Tabellenblatt, bricht das Tool mit einer klaren Fehlermeldung ab, statt eine falsche Spalte zu erraten.
- Enthält die Datei bereits eine Spalte "Price EUR" (wurde also schon einmal mit diesem Tool verarbeitet), bricht das Tool mit klarer Fehlermeldung ab, statt eine zweite, kollidierende Spalte danebenzusetzen.
- Ungültiger Kurs (leer, negativ, nicht-numerisch) wird vor der Verarbeitung abgefangen.
- Datei, die kein gültiges `.xlsx`/ZIP ist, wird mit Fehlermeldung abgelehnt.

## Nicht im Scope

- Keine automatische Kursabfrage aus dem Internet (bewusst manuell, siehe architecture.md — keine externen Nachladungen erlaubt).
- Keine Mehrfach-Datei-Verarbeitung (Batch) in v1 — jede Quote wird einzeln verarbeitet.
- Keine Unterstützung für `.xls` (altes Binärformat).
