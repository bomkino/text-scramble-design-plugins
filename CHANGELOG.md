# Changelog

## 1.1.0 — 2026-10-12

### InDesign

- New **Document** scope: every story, overset text, table (nested ones too), footnote, parent page, text on a path and pasteboard frame, plus bookmarks, text anchors and custom text variables, in one run and one undo.
- **Include locked items** (on by default) scrambles locked frames and layers, then locks them again. **Include hidden items** (off by default) decides whether hidden items change; skipped items are counted in the report.
- **Keep readable** leaves chosen paragraph styles alone, and **Always scramble these words** still changes names inside them.
- **Clean links and document info** (off by default) points links at `example.com` addresses, gives them plain names, and empties the title, author and other document info.
- A report after each run says what changed, what was skipped and why, and which pages now have overflowing text.
- The classic script has a proper dialog with the same options, and now runs the same engine as the panel. It loads in InDesign 2026, which refused 1.0.2's script, and no longer stops on words such as "watch".

### Figma

- **Include hidden layers** switch, off by default. Locked layers are now scrambled, because locked text still exports, and the plugin counts them.
- When an instance and its main component are both scrambled, the instance follows its main component instead of gaining overrides, and the plugin warns when a main component's instances on other pages will change.
- Text layers whose names repeat their text get the new text as their name.
- Clearer panel: **This page** (was "Current page"), counts of skipped layers, and a result that stays open when something needs a look.

### Both

- **Seed:** type any word to get the same invented words every time, in Figma, InDesign and the Raycast extension.
- A word becomes the same invented word everywhere in one run, across every frame, cell and layer.
- Accents: "é" typed as one character or as "e" plus an accent mark now scramble the same way, and accented letters stay accented.
- Email and web addresses always end in a made-up ending such as `.test` or `.example` that can never belong to a real site.
- A sentence missing a space after its full stop ("the end.Next week") is no longer mistaken for a web address, so words like "Test" or "Alt" no longer turn up in scrambled copy.
- Many more everyday words are kept out of the invented copy.
- New [Before you share](https://github.com/bomkino/text-scramble-design-plugins/blob/main/PRIVACY.md) checklist, and shorter install guides written for designers.
- Building and packaging now work on Linux as well as macOS.

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
