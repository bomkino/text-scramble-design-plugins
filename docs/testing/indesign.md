# InDesign checks (real InDesign 2026, scratch documents only)

Run these in Parts 2 and 3 of the [Mac brief](README.md), on `main` unless the cloud thread names another commit.

## Ground rules

- **Scratch documents only.** Every check starts from a NEW document made by `indesign-fixture.jsx` (or by the harness). Never open a real document. Close scratch documents with **Don't Save**.
- Invented text only. The fixture uses the brief's names: Brindlewick, Quellmoor.
- After every run that changes text, press **⌘Z once** (Edit › Undo Text Scramble) and check that everything comes back. Write "undo ok" or what stayed changed.
- Record each check in `RESULTS.md` as pass, fail or blocked, with what you saw. Screenshot anything that fails.
- Files in this folder:
  - `indesign-fixture.jsx`: builds the scratch document and leaves it open (for the panel checks).
  - `indesign-harness.jsx`: the automatic checks for the classic script. Builds, runs, checks and closes its own scratch documents.
  - `indesign-dump.jsx`: read-only. Writes the active scratch document's text, overflow, layers, bookmarks, links and document info to `indesign-dump.json`.
- Copy all three `.jsx` files into `text-scramble-mac-tests/`. Each must start with a UTF-8 byte-order mark when run through `osascript`:

  ```bash
  for f in indesign-fixture indesign-harness indesign-dump; do
    { printf '\xEF\xBB\xBF'; cat "$f.jsx"; } > "$f.bom.jsx"
  done
  ```

  The harness looks for the built script at `../text-scramble-design-plugins/plugins/indesign/dist/Text Scramble.jsx`, relative to itself. If your layout differs, set `$.global.TextScrambleHarness = { script: "/full/path/Text Scramble.jsx" }` first.

### What the fixture contains

Two pages and a parent page. It holds:

- a threaded article (page 1 → page 2) whose text runs on as overset text, with a headline in the paragraph style **TS Headline**
- a table with a nested table, a footnote, and an anchored frame
- a frame on the parent page, a frame on the pasteboard, and a hidden frame
- a frame on the locked layer **TS Locked furniture**, and a locked frame
- text on a circle's path, and a group with a caption
- a tight frame fitted to "lil fil tilt lit", which should overflow after a run
- a frame with an emoji and an automatic page number
- a custom text variable **TS Client**, a bookmark, a text anchor, a web link and an email link (on `.invalid` addresses), and a document title and author

## Part 2: classic script, automatic

### I1. Harness

- **Do:** with InDesign open and no dialog showing, run

  ```bash
  osascript -e 'tell application id "com.adobe.InDesign" to do script (POSIX file "'"$PWD"'/indesign-harness.bom.jsx") language javascript'
  ```

- **Expect:** it prints "N of N checks passed" and writes `indesign-jsx-results.json`. No scratch document is left open, and no other document changed. Send the whole JSON back to the cloud thread, including the `reports` section, even when everything passes.
- **What it checks**, in seven fresh documents:
  1. **Document scope, defaults (seed 1):** every part changes and no "Brindlewick" is left, except the hidden frame (skipped and counted). The locked layer and the locked frame are locked again afterwards. Links and document info are unchanged. Text length is unchanged, the headline keeps its style, and the underline on character 3 stays. There are no errors. The overflow report names page 2. The emoji line is either scrambled or reported as "couldn't be lined up". One Undo restores the story, the parent page, the bookmark and the variable.
  2. **Page scope (page 2):** the page 1 frame is untouched. The page 2 frame and the overset text change, and so do the locked-layer slug and the grouped caption. The parent page and the circle on page 1 are untouched.
  3. **Selection (page 1 article frame):** only that frame changes, not the next frame in the thread or any other frame.
  4. **Include hidden on, include locked off:** the hidden frame changes. Both locked texts stay, and the report counts 2 locked.
  5. **Keep TS Headline readable, always scramble "Brindlewick":** the headline reads "<invented word> Annual Review", the body is scrambled, and the report counts 1 kept paragraph.
  6. **Cleanup:** the web link becomes `https://example.com/link-1`, the email link becomes `mailto:hello@example.com`, and the author and title are empty.
  7. **Seed "pitch" twice:** the story text is identical both times.
- If the harness itself stops with an error (a line number in the JSON), report it: it may be a harness bug rather than a Text Scramble bug.

### I2. Classic script by hand

- **Build:** run `indesign-fixture.bom.jsx` (same `osascript` line) to get a scratch document.
- **Do:** ask the person to open **Window › Utilities › Scripts**, put `plugins/indesign/dist/Text Scramble.jsx` in the User folder (right-click **User** › **Reveal in Finder**), and double-click it.
- **Expect:**
  - A dialog titled **Text Scramble**, top to bottom:
    - **Scramble:** a dropdown with Selection / Active page / Whole document. With nothing selected it starts on **Active page**; select a frame first and it starts on **Selection**.
    - Checkboxes: **Scramble numbers** (on), **Include locked items** (on), **Include hidden items** (off), **Clean links and document info** (off). Hovering each of the last three shows a tip.
    - A panel **Keep these paragraph styles readable** listing the document's paragraph styles, including **TS Headline**. ⌘-click selects more than one.
    - **Always scramble these words** (a text box) and **Seed (optional)** (a text box).
    - **Cancel** and **Scramble** buttons.
  - **Cancel** changes nothing.
  - Choose **Whole document** and click Scramble. One summary message appears. It says how many characters changed and where, that it also scrambled bookmarks, text anchors and text variables, that it left 1 hidden item alone, and that text now overflows on page 2. It ends with **Edit > Undo Text Scramble puts it all back in one step.** Check the message isn't cut off.
  - ⌘Z once puts everything back.
  - Run it again with **TS Headline** selected in the list and `Brindlewick` in Always scramble: the headline reads "<invented word> Annual Review", and the message says 1 paragraph was kept readable.
  - With no document open, double-clicking the script shows **Open an InDesign document first.**
- Then close the scratch document without saving.

## Part 3: UXP panel (needs the person's clicks)

Setup: build a scratch document with `indesign-fixture.bom.jsx`. Ask the person to open **Adobe UXP Developer Tool**, click **Add Plugin**, choose `text-scramble-design-plugins/plugins/indesign/manifest.json`, then **Load**, and open **Window › Plugins › Text Scramble** (or **Plugins › Text Scramble**). After each run, run `indesign-dump.bom.jsx` and compare `indesign-dump.json` with the expectations. Then ⌘Z once and check the dump again.

### P1. Layout

- **Do:** drag the panel to its narrowest (280 px) and scroll to the bottom.
- **Expect:** the three scope rows (Selection, Page, Document) are readable. The **Scramble with soul** button and the "Formatting stays put." note can be reached. Switch InDesign to a light interface (Preferences › Interface) and back: the text stays readable in both.

### P2. No document

- **Do:** close every document (Don't Save), then look at the panel. Build the fixture again.
- **Expect:** with no document, the summary reads **Open a document to begin.** and the button is greyed out. Within about a second of the fixture opening, the summary shows a count and the button works.

### P3. Selection summary follows the selection

- **Do:** scope **Selection**. Select nothing, then the page 1 article frame, then a few words inside it, then two table cells. Then click quickly across several frames.
- **Expect:** with nothing selected, it reads **Select text, frames or table cells — or switch to Page or Document.** The count updates for each selection. Fast clicking doesn't make InDesign lag.

### P4. Scope rows and switches

- **Do:** click each scope row, and each row's title. Then click each checkbox, and then each checkbox's label text.
- **Expect:** exactly one row is highlighted at a time. Each click toggles a switch exactly once. Choosing Page on page 1 shows a count plus "1 hidden frame will be skipped". Toggling **Include hidden items** or **Include locked items** changes the summary.

### P5. Page summary after turning the page

- **Do:** scope **Page**, go to page 2 in the document, then move the pointer back over the panel.
- **Expect:** the count changes to page 2's text.

### P6. Keep readable list

- **Do:** click **Keep readable**, tick **TS Headline**, type `Brindlewick` in "Always scramble these words", and type `pitch` in Seed.
- **Expect:** the section opens with its arrow turned, lists the document's paragraph styles, and its subtitle reads **Keeping 1 style readable.** Scrolling the list and then selecting something on the page doesn't jump the list back to the top.

### P7. Options are remembered

- **Do:** close and reopen the panel, then quit and restart InDesign and open the panel again.
- **Expect:** every option is as you left it (scope, switches, ticked style, words, seed, and whether Keep readable was open).

### P8. Run on Page

- **Do:** build a fresh fixture. On page 2, scope **Page**, with the P6 options, click **Scramble with soul**.
- **Expect:**
  - The button reads **Shaping fresh language…** while it works.
  - The report starts **Done — … characters in …** and mentions the overset text.
  - It ends with **Edit › Undo Text Scramble puts it all back in one step.**
  - In the dump: page 2's frame text and the overset tail are scrambled. Page 1's frame, the parent page and the pasteboard note are unchanged.
  - ⌘Z once restores everything.

### P9. Run on Document, with overflow

- **Do:** fresh fixture, scope **Document**, default options (Keep readable unticked, Seed empty), then click Scramble.
- **Expect:**
  - The report mentions the parent page and the bookmark, anchor and text variable, and says 1 hidden frame was skipped.
  - It says a frame now overflows on page 2 (the tight frame). Its **Show** button turns to page 2 and selects that frame.
  - In the dump, no story, cell, footnote, bookmark, anchor or variable still contains "Brindlewick", except the hidden frame. **TS Locked furniture** is still locked, and the locked frame is still locked.
  - The emoji line is either scrambled, or the report says a passage "couldn't be lined up safely". Note which, and whether the emoji itself survived.
  - ⌘Z once restores everything, including the bookmark name.

### P10. Keep readable on Document

- **Do:** fresh fixture, scope **Document**, tick **TS Headline**, always scramble `Brindlewick`, then run.
- **Expect:** the headline reads "<invented word> Annual Review". The bookmark and the anchor read the same as the headline. The body text is scrambled. The report says 1 paragraph was kept readable.

### P11. Same seed, same words

- **Do:** fresh fixture, Document, Seed `pitch`, then run and dump. Close it without saving, build a fresh fixture, and run and dump again.
- **Expect:** both dumps have identical story text.

### P12. Clean links and document info

- **Do:** fresh fixture, Document, turn on **Clean links and document info**, then run.
- **Expect:**
  - The dump shows links `https://example.com/link-1` and `mailto:hello@example.com`, named "Link 1" and "Link 2", with an empty title and author.
  - **File › File Info** shows no title or author.
  - **Window › Interactive › Hyperlinks** shows the hyperlinks named "Hyperlink 1" and "Hyperlink 2".
  - ⌘Z once restores everything.

### P13. Hidden and locked switches

- **Do:** fresh fixture, Document, turn on **Include hidden items** and turn off **Include locked items**, then run.
- **Expect:** the hidden frame is scrambled (check it in the dump). The locked-layer slug and the locked frame are unchanged. The report says 2 locked frames were skipped.

### P14. Menu command

- **Do:** in **Edit › Keyboard Shortcuts**, give the plugin's **Scramble Selection** command a shortcut. Press it with nothing selected, then with the page 1 article frame selected.
- **Expect:** with nothing selected, a dialog says **Select text, frames or table cells first.** With the frame selected, the frame is scrambled using the panel's options, and ⌘Z once restores it.

### P15. Two documents

- **Do:** build two fixtures. Switch between them, then close one without saving.
- **Expect:** the style list and summary follow the active document.

### P16. UXP script dialog

- **Do:** from the Scripts panel, run `plugins/indesign/dist/Text Scramble.idjs` (copy it into the User scripts folder like the JSX).
- **Expect:**
  - A dialog with the three scopes, four checkboxes and three text boxes (keep styles, always-scramble words, seed).
  - Type `ts headline, Missing Style` in keep styles and run on Document. The headline stays readable (the name matches without caring about capitals), and the message names "Missing Style" as not found.
  - **Cancel** changes nothing.

## Things to note even when everything passes

- Did any message mention text that "couldn't be lined up safely"? If so, on which fixture part? This tells us how InDesign counts emoji and special characters.
- Is a hidden frame's text editable when **Include hidden items** is on, or does the report show an error?
- Do the classic script and the panel give the same words for the same seed? Compare the story text from harness case 7 (seed `pitch`, in `indesign-jsx-results.json`) with the P11 dump. They should match exactly. A mismatch means ExtendScript's arithmetic differs from the panel's, so tell the cloud thread.
- Roughly how long did the Document run take on the fixture? If you can, also time it on a scratch document with about 30 pages of the sample text (duplicate the article frame across pages).
