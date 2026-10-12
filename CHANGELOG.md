# Changelog

## 1.0.3 — 2026-10-12

- Fixed the classic InDesign JSX, which ExtendScript refused to load because reserved words (`for`, `in`, `new`) were used as unquoted object keys.
- Fixed a crash in the classic JSX when copy contained words such as "watch" or "reflect", which collided with members ExtendScript adds to every object.
- Moved the common-word and unwelcome-fragment lists into `packages/core/src/word-lists.ts`. The build now injects them into the JSX, so every host blocks the same words.
- Added about 200 everyday words the generator was observed to produce (such as "ten", "rose" and "rude") to the common-word list.
- Verification now parses the JSX as ES3 and runs its engine in a sandbox that mimics ExtendScript's inherited object members.

## 1.0.2 — 2026-08-12

- Preserved Unicode titlecase letters as uppercase-shaped invented copy.
- Added regression coverage and rebuilt both Figma and InDesign artifacts from the shared core.

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
