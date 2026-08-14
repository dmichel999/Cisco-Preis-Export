# Releases

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.0.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.1.0] - 2026-08-14

### Added

- Initiale Version: Drag & Drop einer Cisco-Quote-`.xlsx`, Abfrage des USD→EUR-Kurses, Ausblenden der Spalten "Credits" bis "Custom Name", neue Spalte "Price EUR" mit umgerechnetem Preis
- Formatierungserhalt durch gezielte OOXML-Bearbeitung statt vollständigem Parse/Rewrite (siehe docs/architecture.md)
- Download mit Overwrite-Semantik (File System Access API mit Fallback)
