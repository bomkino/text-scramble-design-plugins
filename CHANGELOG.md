# Changelog

## 1.0.1 — 2026-07-19

- Prevented punctuation-only and number-preserving selections from reporting a false success.
- Prevented overlapping Figma runs and stale selection summaries.
- Switched InDesign UXP undo transactions to the native UXP script language.
- Preflighted InDesign character edits before mutation to avoid partially changed frames.
- Corrected Adobe entrypoint metadata and Retina icon naming.
- Added grouped text-frame traversal to the classic InDesign companion.
- Made release versions and dependency ranges explicit and reproducible.

## 1.0.0 — 2026-07-18

- Added Figma selection and current-page workflows.
- Added InDesign UXP panel, command, UXP script, and immediately usable JSX companion.
- Preserved character-level formatting through style-inheriting or in-place character replacement.
- Added shape-ranked invented words, repeated-word consistency, number scrambling, Unicode combining-mark safety, and script-preserving decimal digits.
- Added locked, hidden, and missing-font safeguards.
- Added one-step undo behavior and fully local processing.
- Added polished host-native interfaces, original icon, installable developer artifacts, documentation, and automated verification.
