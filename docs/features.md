# Feature-Spezifikation

## Kernfunktion

Eine Cisco-Quote-Exportdatei (`.xlsx`) wird im Browser geladen, verändert und wieder heruntergeladen — ohne Server, ohne Datenabfluss.

### Ablauf

1. **Datei laden** — Drag & Drop in die Drop-Zone oder Dateiauswahl per Klick. Nur `.xlsx` wird akzeptiert.
2. **Struktur erkennen** — das Tool sucht im ersten Tabellenblatt die Kopfzeile der Artikeltabelle anhand der Zelltexte "Credits", "Custom Name" und "Unit Net Price Before Credits" (siehe [architecture.md](architecture.md) für die Begründung dieses Ansatzes).
3. **Kurs abfragen** — Eingabefeld für den Wechselkurs als **USD pro EUR** (Dezimalzahl, z. B. `1.08` — so wie Cisco-Dealkurse üblicherweise angegeben werden). Validierung: positive Zahl, Komma wird als Dezimaltrennzeichen akzeptiert.
4. **Spalten ausblenden** — alle Spalten von "Credits" bis "Custom Name" (aktuell P–AE) werden als `hidden` markiert, nicht gelöscht.
5. **Kurs-Zelle** — in der Zeile direkt über der Kopfzeile (aktuell Zeile 39) wird in der neuen Spalte der verwendete Kurs als **echte, bearbeitbare Zahl** eingetragen (z. B. `1.58`). Ein Custom-Zahlenformat zeigt sie beschriftet an ("Kurs USD/EUR: 1,58"), ohne dass die Zelle eine Textzelle wird.
6. **EUR-Preis berechnen** — jede Artikelzeile bekommt in der neuen Spalte (direkt nach der letzten Bestandsspalte, aktuell AF, Kopfzeile "Price EUR") eine **Excel-Formel**: `=ROUND(<Quellzelle>/$AF$39,2)`. Ändert man den Kurs in AF39 direkt in Excel, rechnet Excel alle Preise automatisch neu — kein erneuter Durchlauf durchs Tool nötig. Die neue Spalte (Kurs-Zelle, Kopfzeile, alle Datenzeilen) wird gelb hinterlegt (`#FFFF01`).
7. **Download** — Dateiname bleibt identisch zum Original. Wo unterstützt (Chrome/Edge) wird die Originaldatei direkt überschrieben (File System Access API); sonst regulärer Download, der Browser übernimmt die Kollisionsbehandlung (z. B. Nachfrage "Datei ersetzen?" oder automatisches Anhängen von "(1)").

### Was bewusst NICHT verändert wird

- Bestehende Zellwerte, -formate, -farben, -rahmen, Merged Cells, Spaltenbreiten außerhalb des Zielbereichs
- Alle anderen Tabellenblätter/Bereiche außerhalb der Artikeltabelle (Kopfdaten, Finanz-Summary, Adjustments, Notes, AGB-Text)

## Fehlerbehandlung

- Fehlt eine der drei Ankertext-Spalten ("Credits", "Custom Name", "Unit Net Price Before Credits") im ersten Tabellenblatt, bricht das Tool mit einer klaren Fehlermeldung ab, statt eine falsche Spalte zu erraten.
- Ungültiger Kurs (leer, negativ, nicht-numerisch) wird vor der Verarbeitung abgefangen.
- Datei, die kein gültiges `.xlsx`/ZIP ist, wird mit Fehlermeldung abgelehnt.

## Nicht im Scope

- Keine automatische Kursabfrage aus dem Internet (bewusst manuell, siehe architecture.md — keine externen Nachladungen erlaubt).
- Keine Mehrfach-Datei-Verarbeitung (Batch) in v1 — jede Quote wird einzeln verarbeitet.
- Keine Unterstützung für `.xls` (altes Binärformat).
