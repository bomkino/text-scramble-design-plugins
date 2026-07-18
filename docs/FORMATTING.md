# Formatting contract

Text Scramble changes textual glyphs, not document structure.

## Preserved exactly

- Unicode code-point count and combining marks
- Uppercase and lowercase positions
- Whitespace, punctuation, tabs, paragraph breaks, and explicit line breaks
- Decimal digit count and writing system
- Layer, frame, story, and page structure

## Preserved by the host

Figma inserts each replacement character beside the source character with style inheritance, then removes the source character. InDesign replaces each character in place. These paths retain fonts, sizes, weights, fills, links, character styles, paragraph styles, and mixed formatting.

## Preserved approximately

Automatic line wrapping depends on the exact font, OpenType features, kerning, and layout engine. The generator scores many pronounceable candidates against the source word’s estimated width and character-width profile, which keeps measure close but cannot make every line break mathematically identical.

## Intentionally skipped

- Hidden or locked Figma content
- Figma text with missing fonts
- Locked or hidden InDesign frames and layers
- Empty selections

The original document is never duplicated or saved by the plugin. Duplicate it yourself before use, and use one **Command–Z** to revert a completed run.
