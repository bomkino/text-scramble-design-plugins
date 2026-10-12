# Formatting

Text Scramble changes the letters and numbers people can read. It doesn't change how the document is built.

## Kept exactly

- The number of characters, so every character keeps its own formatting
- Where the capitals are
- Spaces, tabs, punctuation, paragraph breaks and line breaks
- How many digits each number has, and the kind of digits (Arabic-Indic digits stay Arabic-Indic, for example)
- Accents: an accented letter becomes another accented letter where one exists
- Layers, frames, stories and pages

## What changes

- Every word becomes an invented, pronounceable word of the same length. A word that repeats becomes the same invented word every time it appears in one run, and in every run with the same **Seed**.
- Words in other alphabets, such as Greek or Cyrillic, become invented words in Latin letters of the same length.
- Email addresses and web addresses typed as text are scrambled, and their ending (such as `.com`) becomes one that can never be registered, such as `.test`, `.example` or `.alt`, at the same length. `https://`, `mailto:` and `www.` stay as they are.

## Kept by Figma and InDesign

Figma adds each new character next to the old one, so it inherits the old one's style, then removes the old one. InDesign replaces each character in place. Either way, fonts, sizes, weights, colours, character styles, paragraph styles and mixed formatting within a line all stay. So do links: the linked words change, but the address behind the link doesn't. See [Before you share](../PRIVACY.md).

## Kept approximately

Line breaks depend on the exact font, kerning and layout engine. Text Scramble tries many invented words for each original and picks one close to its width, so lines stay close to their length. It can't promise every line breaks in the same place.

## Skipped on purpose

**Figma**

- Hidden layers, unless you turn on **Include hidden layers**
- Text with missing fonts, because Figma can't edit it

Locked layers are scrambled, because locked text still exports. The plugin says how many layers it skipped and why.

**InDesign**

- Hidden items, unless you turn on **Include hidden items**
- Locked items, only when you turn off **Include locked items**. Otherwise they're scrambled and locked again.
- Paragraph styles you chose under **Keep readable**, apart from any words listed in **Always scramble these words**
- Text that can't be lined up safely, such as some emoji. The report says so.

The report after each run lists what was skipped.

## Undo

Text Scramble never duplicates or saves your document. Duplicate it yourself first. One **Undo** (⌘Z) puts back a whole run.
