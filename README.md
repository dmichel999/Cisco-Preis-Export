# Cisco Preis Export

Browser-basiertes Tool zur Umrechnung von Cisco-Preisangeboten (Quote-Export als `.xlsx`) von USD in EUR. Komplett clientseitig, keine Installation, kein Server, keine Daten verlassen den Browser.

## Zweck

Aus dem Cisco-Portal heruntergeladene Preisangebote (`Quote_*.xlsx`) enthalten unter anderem die Spalten "Credits" bis "Custom Name" mit internen Rabatt-/Credit-Details, die für die Weitergabe an Kunden nicht relevant sind, sowie den Nettopreis in USD. Bisher wurde von Hand:

1. Die Spalten "Credits" bis "Custom Name" ausgeblendet
2. Der aktuelle Wechselkurs (USD pro EUR) recherchiert
3. Eine neue Spalte mit dem umgerechneten Preis in EUR ergänzt

Dieses Tool automatisiert alle drei Schritte.

## Nutzung

1. Ordner kopieren oder Repository klonen
2. `Cisco Preis Export.html` im Browser öffnen
3. Quote-Datei per Drag & Drop in die Drop-Zone ziehen (oder per Klick auswählen)
4. Wechselkurs eingeben (USD pro EUR, z. B. `1,08`)
5. Bearbeitete Datei herunterladen

Details zur Spalten-/Zeilenerkennung: siehe [docs/architecture.md](docs/architecture.md).

## Setup

Kein Build-Schritt nötig. Einzige Abhängigkeit ([JSZip](https://stuk.github.io/jszip/)) liegt lokal vendort unter `vendor/`, siehe [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md).

## Datenschutz

Die Verarbeitung findet vollständig im Browser statt (keine Uploads, kein Server). Das ist bewusst so gewählt, da Cisco-Preisangebote kundenbezogene und kommerziell sensible Daten enthalten.
