# Before you share a scrambled file

Text Scramble swaps the words people can read. It doesn't clean a whole file. Run through this list before a scrambled file leaves the studio.

Everything happens on your computer. Text Scramble sends nothing anywhere and keeps no copy of your text.

## What it keeps on purpose

To protect your layout, it keeps the shape of the text: word lengths, capitals, punctuation, how long each number is, line breaks, and which words repeat. Someone who knows the original might recognise a short, distinctive line from its shape alone. Treat the result as a disguise for drafts, not as redaction.

## What it never changes

- [ ] **File names.** Rename the file, and any PDF or images you export from it.
- [ ] **Link addresses.** Linked words get scrambled, but the web address or email behind them stays real. In InDesign, **Clean links and document info** fixes this for you (see below). Anywhere else, remove or edit links by hand. Never swap in a made-up address that looks real, because it could belong to a stranger.
- [ ] **Pictures of words.** Images, screenshots, logos, charts pasted as pictures, and text converted to outlines aren't text any more. Replace or blur them.
- [ ] **Image details.** Placed photos can carry their own hidden details (XMP metadata such as captions, keywords and the photographer's name) and Content Credentials (C2PA), which can name a person or a company. Use clean exports of the images.
- [ ] **Names you typed yourself.** Layer, page, frame, style, swatch and component names, alt text, notes and comments.

## InDesign

- [ ] **Use the Document scope.** **Selection** and **Page** only change what they say. **Document** covers every story, overset text, table, footnote, parent page and text on a path, plus bookmarks, text anchors and text variables, which can show up in an exported PDF.
- [ ] **Hidden items are skipped** unless you turn on **Include hidden items**. They don't print, but they stay in the file. Locked items are scrambled and locked again, unless you turn off **Include locked items**. The report after each run says what it skipped.
- [ ] **Kept styles stay readable.** Text in the paragraph styles you chose under **Keep readable** isn't scrambled. Put names in **Always scramble these words** so they change there too.
- [ ] **Clean links and document info** (off by default) points every web link at an `example.com` address (`https://example.com/link-1` and so on) and every email link at `hello@example.com`, gives links neutral names, and empties the title, author, description, keywords and copyright notice. Without it, check **File › File Info** yourself.
- [ ] **Notes and Track Changes** keep the original words. Accept or reject every change, and delete notes, first.
- [ ] **Send a PDF if you can.** If you must send the `.indd`, use **File › Save As** to a new file first. A plain Save can leave old edits inside the file.

## Figma

- [ ] **Version history keeps the original text.** Anyone who can edit the file can bring it back. Share a duplicate made after scrambling: Figma doesn't copy version history or comments into a duplicate.
- [ ] **Hidden layers are skipped** unless you turn on **Include hidden layers**. Locked layers are scrambled, because locked text still exports. Text with missing fonts is always skipped, because Figma can't edit it. The plugin says how many it skipped.
- [ ] **Renamed layers** keep the names you gave them, even when those names quote the original copy.

## Raycast

- [ ] It only changes the text you selected or copied.
- [ ] **Clipboard history** apps, including Raycast's own Clipboard History, can keep the original text you copied. Delete those entries if that matters.
