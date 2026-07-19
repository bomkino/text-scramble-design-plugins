# Text Scramble for Figma + InDesign

Beautifully invented placeholder copy for decks that need to look finished before the real words can be shown.

Text Scramble replaces readable copy with pronounceable, shape-matched language while keeping the composition alive: character count, casing, punctuation, whitespace, paragraph breaks, and digit structure stay put. Candidate words are ranked by estimated visual width, so line measure remains close without falling back to lorem ipsum.

The plugins run entirely on device. No text, document data, or analytics leave Figma or InDesign.

## What survives

- Fonts, sizes, weights, fills, links, and character-level styling
- Paragraph styles, spacing, tabs, punctuation, and explicit line breaks
- Repeated-word consistency across the current run
- Unicode combining marks and decimal digits in their original writing system
- One clean undo step

Glyph widths vary by font, so automatic line wraps can move slightly. The engine minimizes that drift; it cannot promise pixel-identical reflow in every typeface.

## Use it safely

Text Scramble changes the current selection or page. Duplicate the Figma page or InDesign document first, then run it on the duplicate. If the result is not right, press **Command–Z** once.

## Install

- [Figma installation](docs/INSTALL-FIGMA.md)
- [InDesign installation](docs/INSTALL-INDESIGN.md)
- [Formatting contract](docs/FORMATTING.md)
- [Publishing notes](docs/PUBLISHING.md)

## Develop

Requires Node.js 20 or newer. Release packaging currently uses macOS `sips` and `ditto`; the plugin runtime remains compatible with Figma and InDesign on macOS and Windows.

```bash
npm install
npm run verify
npm run package
```

`npm run verify` type-checks, runs the deterministic test suite, builds both hosts, and validates the manifests, privacy boundary, formatting paths, UI copy, legacy Unicode indexing, and bundle sizes.

## Project map

```text
packages/core/       Shared scrambling engine and replacement runs
plugins/figma/       Figma plugin
plugins/indesign/    InDesign UXP panel, command, UXP script, and JSX companion
tests/               Deterministic engine tests
scripts/             Build, verification, local-install, and release packaging
```

MIT licensed. Made with care by [pitch.dog](https://pitch.dog). See [acknowledgements](ACKNOWLEDGEMENTS.md).
