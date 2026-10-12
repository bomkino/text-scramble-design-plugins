# Text Scramble for InDesign

There are three ways to run it. All three use the same scrambling engine and offer the same options.

| | What it is | Needs |
|---|---|---|
| **Quick script** (`.jsx`) | A dialog you run from the Scripts panel | Any recent InDesign |
| **Panel** | A panel that stays open, with a live summary | InDesign 18.5 or newer and Adobe UXP Developer Tool |
| **UXP script** (`.idjs`) | The panel's options in a dialog, from the Scripts panel | A recent InDesign that runs UXP scripts |

Duplicate the document first. Text Scramble never saves a document, but it does change the one you run it on.

## Quick script

1. Download `Text-Scramble-InDesign-<version>.jsx` from [Releases](https://github.com/bomkino/text-scramble-design-plugins/releases/latest). It's also in the InDesign ZIP, as `dist/Text Scramble.jsx`.
2. In InDesign, choose **Window › Utilities › Scripts**.
3. In the Scripts panel, right-click **User** and choose **Reveal in Finder**.
4. Copy the `.jsx` file into the folder that opens. If it doesn't show up in the Scripts panel, restart InDesign.
5. Double-click it in the Scripts panel, choose your options and click **Scramble**.

## Panel

1. Download `Text-Scramble-InDesign-<version>.zip` from [Releases](https://github.com/bomkino/text-scramble-design-plugins/releases/latest) and double-click it to unzip. Keep the `Text Scramble - InDesign` folder somewhere it can stay.
2. Install **Adobe UXP Developer Tool** from the Creative Cloud app.
3. In the Developer Tool, click **Add Plugin** and pick `manifest.json` inside the `Text Scramble - InDesign` folder. Then click **Load**.
4. In InDesign, open **Plugins › Text Scramble**.

If the panel is missing after you restart InDesign, open the Developer Tool and click **Load** again.

## UXP script

Copy `dist/Text Scramble.idjs` from the InDesign ZIP into the Scripts panel's **User** folder, the same way as the quick script, and double-click it.

## Options

All three ask the same things:

- **Scope.** **Selection** (text, frames or table cells), **Page** (every frame on the page, including overset text), or **Document**: every story, table, footnote, parent page and text on a path, plus bookmarks, text anchors and text variables.
- **Scramble numbers** (on). Numbers keep their digit count.
- **Include locked items** (on). Locked frames still print, so they're scrambled, then locked again.
- **Include hidden items** (off). Hidden items don't print, but they stay in the file.
- **Keep readable.** Pick paragraph styles to leave as they are, such as captions or page numbers. Words in **Always scramble these words** change even there, so you can keep a style readable but hide a name in it.
- **Clean links and document info** (off). Points every web link at `example.com`, every email link at `hello@example.com`, gives links plain names, and empties the title, author and other document info.
- **Seed** (empty). Type any word to get the same invented words every time.

In the panel, click **Scramble with soul**. Afterwards a report says what changed, what was skipped and why, and which pages now have text that overflows its frame.

One **Edit › Undo Text Scramble** (⌘Z) puts the whole run back.

Everything happens on your computer. Before you share the file, read [Before you share](https://github.com/bomkino/text-scramble-design-plugins/blob/main/PRIVACY.md).

## Adobe Marketplace

The ZIP is a developer build for loading by hand. A Marketplace version needs a plugin ID from Adobe, so it isn't listed there yet.
