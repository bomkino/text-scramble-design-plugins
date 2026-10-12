# Text Scramble for Figma + InDesign

Swap real copy for invented words of the same shape, so a layout can be shown before its words can.

Text Scramble keeps the composition alive: word lengths, capitals, punctuation, spacing, paragraph breaks and how long each number is all stay put. It picks invented words close to the width of the originals, so lines stay close to their length without falling back to lorem ipsum.

Everything runs on your computer. No text, document data or analytics leave Figma or InDesign.

## Download

Get the latest files from [Releases](https://github.com/bomkino/text-scramble-design-plugins/releases/latest):

| File | For |
|---|---|
| `Text-Scramble-Figma-<version>.zip` | The Figma plugin. [How to install it](docs/INSTALL-FIGMA.md) |
| `Text-Scramble-InDesign-<version>.zip` | The InDesign panel, plus both InDesign scripts. [How to install it](docs/INSTALL-INDESIGN.md) |
| `Text-Scramble-InDesign-<version>.jsx` | Just the quick InDesign script, the fastest way to start |
| `SHA256SUMS.txt` | Checksums, to confirm a download arrived intact |

There's also [Text Scramble for Raycast](https://www.raycast.com/kumail_changezi/text-scramble), which scrambles selected text in any Mac app.

## What stays the same

- Fonts, sizes, weights, colours and character styles
- Paragraph styles, spacing, tabs, punctuation and line breaks
- Repeated words: the same word becomes the same invented word everywhere in one run
- Accents, and the kind of digits (Arabic-Indic digits stay Arabic-Indic, for example)
- Link styling. The web address behind a link stays real; see [Before you share](PRIVACY.md).

Email addresses and web addresses typed as text are scrambled too, and always end in a made-up ending such as `.test` or `.example` that can never belong to a real site.

Fonts vary in width, so automatic line breaks can shift a little. [Formatting](docs/FORMATTING.md) has the details.

## Use it safely

- Work on a copy: duplicate the Figma page or the InDesign document first.
- One **Undo** (⌘Z) puts the whole run back.
- Type the same **Seed** to get the same invented words again.
- Scrambled copy is a disguise for drafts, not redaction. Before a file leaves the studio, go through [Before you share](PRIVACY.md).

## More

- [Install in Figma](docs/INSTALL-FIGMA.md)
- [Install in InDesign](docs/INSTALL-INDESIGN.md)
- [Formatting](docs/FORMATTING.md)
- [Before you share](PRIVACY.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md), for developers
- [Publishing](docs/PUBLISHING.md), for maintainers

MIT licensed. Made with care by [pitch.dog](https://pitch.dog). See [acknowledgements](ACKNOWLEDGEMENTS.md).
