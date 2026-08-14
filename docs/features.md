# Feature-Spezifikation

## Kernfunktion

Eine Cisco-Quote-Exportdatei (`.xlsx`) wird im Browser geladen, verändert und wieder heruntergeladen — ohne Server, ohne Datenabfluss.

### Ablauf

1. **Datei laden** — Drag & Drop in die Drop-Zone oder Dateiauswahl per Klick. Nur `.xlsx` wird akzeptiert.
2. **Struktur erkennen** — das Tool sucht im ersten Tabellenblatt die Kopfzeile der Artikeltabelle anhand der Zelltexte "Credits", "Custom Name" und "Unit Net Price Before Credits" (siehe [architecture.md](architecture.md) für die Begründung dieses Ansatzes).
3. **Kurs abfragen** — Eingabefeld für den Wechselkurs als **USD pro EUR** (Dezimalzahl, z. B. `1.08` — so wie Cisco-Dealkurse üblicherweise angegeben werden). Validierung: positive Zahl, Komma wird als Dezimaltrennzeichen akzeptiert.
4. **Spalten ausblenden** — alle Spalten von "Credits" bis "Custom Name" (aktuell P–AE) werden als `hidden` markiert, nicht gelöscht.
5. **EUR-Preis berechnen** — für jede Artikelzeile: Wert aus "Unit Net Price Before Credits" ÷ Kurs (Kurs = USD pro EUR), kaufmännisch gerundet auf 2 Nachkommastellen. Ergebnis landet in einer neuen Spalte direkt nach der letzten bestehenden Spalte (aktuell AF), Kopfzeile "Price EUR". Die neue Spalte (Kopfzeile + alle Datenzeilen) wird gelb hinterlegt (`#FFFF01`).
6. **Kurs-Hinweis** — in der Zeile direkt über der Kopfzeile (aktuell Zeile 39) wird in derselben neuen Spalte der verwendete Kurs vermerkt ("Kurs: 1,58 USD/EUR"), ebenfalls gelb hinterlegt.
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
