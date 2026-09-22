# Bekannte Bugs

Aktuell keine bekannten Bugs.

**Historie:** Bundle-/Subscription-Kindzeilen mit "--"-Platzhalter in "Unit Net Price Before Credits" beendeten die Tabellenerkennung zu früh (Fix-Versuch am 18.09.2026 hat dabei die "Price EUR"-Berechnung kaputt gemacht, am 22.09.2026 zurückgenommen, siehe docs/releases.md 0.18.0). Am 22.09.2026 erneut und diesmal isoliert/verifiziert gefixt (Tabellenende über "Part Number", siehe 0.20.0) — ausgelöst durch eine reale EA-/Subscription-Quote, bei der das Tool sonst komplett mit "Keine Artikelzeilen gefunden" abgebrochen wäre.

**Historie:** Direkt im Anschluss zeigte dieselbe reale Quote beim Öffnen der Ausgabedatei in Excel den "Reparieren"-Dialog — eine Störzelle aus einem früheren, nicht abgeschlossenen Verarbeitungsversuch stand direkt hinter der neuen "Price EUR"-Spalte, neue Zellen wurden aber blind ans Zeilenende gehängt statt sortiert eingefügt. Am 22.09.2026 gefixt (`insertCellInOrder`, siehe 0.20.1, docs/architecture.md).

**Historie:** Nach dem Reparieren-Dialog-Fix zeigte "Price EUR" bei derselben Quote weiterhin `0,00 €` für die Subscription-Zeilen — "Unit Net Price Before Credits" ist bei diesem Quote-Typ durchgängig `"--"`, der reale Preis steht bei Subscription-Zeilen stattdessen in "Unit Net Price". Am 22.09.2026 gefixt: Quellzelle wird jetzt pro Zeile anhand von "Pricing Term (in Months)" gewählt (siehe 0.21.0, docs/architecture.md).
