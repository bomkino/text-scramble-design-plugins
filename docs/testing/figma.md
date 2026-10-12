# Figma checks (real Figma, scratch file only)

Run these in Part 4 of the [Mac brief](README.md), on `main` unless the cloud thread names another commit.

## Ground rules

- Use a **new design file in Drafts**. Never open a real file.
- Use only the sample text from the brief:
  - Line A: `Brindlewick Studio — Spring Review 2026`
  - Line B: `Quellmoor Orchard will open its café on 14 March, with 3 new rooms.`
  - Line C: `Amélie and Jonas wrote the brief; Amélie signs it off.` The second "Amélie" uses a separate accent mark (U+0301). To keep it, write the line to a file with Node and paste it with `pbcopy < file`, rather than typing it.
- Fonts: use **Inter** only (Regular, Bold, Italic). Figma always has it.
- After every run that changes text, press **⌘Z once** and check everything comes back. Write "undo ok" or what stayed changed.
- Record each check in `RESULTS.md` as pass, fail or blocked, with what you saw. Take a screenshot of anything that fails.
- "The panel" means the Text Scramble plugin window. "The summary" is the grey box under the two scope cards.

## Setup

1. Figma desktop app, **Plugins › Development › Import plugin from manifest…**, choose `text-scramble-design-plugins/plugins/figma/manifest.json`.
2. Start the plugin with **Plugins › Development › Text Scramble**. Close it between checks unless a check says otherwise.

## F1. Nothing selected

- **Build:** empty canvas, nothing selected, scope set to **Selection**.
- **Do:** open the plugin.
- **Expect:** summary says **Select layers to scramble**, count shows **—**, and the **Scramble with soul** button is greyed out and does nothing when clicked.

## F2. One text layer with mixed styles

- **Build:** one text layer with lines A, B and C (three lines, press Return between them). Make "Brindlewick Studio" **Bold**, "Spring Review" *Italic*, and colour "Quellmoor Orchard" red. Leave the layer name as Figma made it.
- **Do:** select it, open the plugin, scope **Selection**, click **Scramble with soul**.
- **Expect:**
  - Summary before the run: **1 layer**, about 160 characters ready.
  - Every word changes. Bold, italic and red stay on the same words. Line breaks, "—", ";", ",", "." and "é" positions stay put.
  - "2026", "14" and "3" become other numbers with the same number of digits.
  - Both "Amélie" become the same invented word.
  - The panel shows a green **Scrambled 1 layer** card, then closes by itself after about a second. Figma shows a toast like **Scrambled 1 text layer**.
  - The layer name in the Layers panel now shows the new text, not the old.
  - ⌘Z once brings back the original text **and** the original layer name.

## F3. One name, same invented word everywhere

- **Build:** three separate text layers: line C, `Amélie`, and `AMÉLIE`. Put them in one frame.
- **Do:** select the frame, run.
- **Expect:** all three show the same invented word for Amélie (third one in capitals). ⌘Z once restores all three.

## F4. Hidden and locked layers

- **Build:** a frame named "Hidden test" with three text layers: line A (visible), line B (click the eye to hide it), line C (click the lock to lock it).
- **Do 1:** select the frame, open the plugin. Make sure **Include hidden layers** is off.
- **Expect 1:** summary says **2 layers** ready, **Skipping 1 hidden.** and **Includes 1 locked layer. Locked text still shows in exports.** Run: lines A and C change, line B (hidden) does not. The toast ends with **skipped 1 hidden**. ⌘Z.
- **Do 2:** open the plugin again, turn **Include hidden layers** on.
- **Expect 2:** summary updates straight away to **3 layers**, with no skipping line. Run: all three change (unhide line B to check it). ⌘Z once restores all three. The switch stays on next time you open the plugin; turn it off again before F5.

## F5. Everything skipped, and a locked frame

- **Build:** hide the whole "Hidden test" frame (eye icon on the frame). **Include hidden layers** off.
- **Do 1:** select the frame in the Layers panel, open the plugin.
- **Expect 1:** summary is tinted, says **All 3 text layers skipped** and **Skipped: 3 hidden.**, and suggests turning on **Include hidden layers**. The button is greyed out.
- **Do 2:** unhide the frame, then lock the whole frame (lock icon on the frame). Select it in the Layers panel, open the plugin.
- **Expect 2:** summary says **3 layers** and **Includes 3 locked layers.** Run: all three change. ⌘Z. Unlock the frame afterwards.

## F6. Numbers switch

- **Build:** a text layer containing only `2026`.
- **Do:** select it, open the plugin, turn **Scramble numbers** off.
- **Expect:** summary says **Nothing here to change** and **1 layer only has numbers. Turn on Scramble numbers to change them.** Button greyed out. Turn the switch on: summary shows **1 layer**, run changes it to a different 4-digit number.

## F7. Main component and instances

- **Build:**
  1. Text layer `Book a call`. Select it and press **⌥⌘K** to make it a component (rename the component "Button").
  2. Alt-drag the component twice to make two instances.
  3. In the second instance only, change the text to `Book a tour` (this is an override).
- **Do:** click on empty canvas, open the plugin, choose **This page**.
- **Expect before running:** summary counts **3 layers** and says **1 layer is in a main component, so its instances change too, even on other pages.**
- **Run, then expect:**
  - The main component and the **first** instance show the same new words.
  - The first instance has **no override**: right-click it, and **Reset all changes** (or "Reset all overrides") is greyed out or missing. Write down which you saw.
  - The second instance shows its own scrambled `Book a tour`, with "Book" scrambled to the same invented word as in the main.
  - ⌘Z once restores all three.

## F8. Text bound to a component property

This checks something the cloud tests can't: whether Figma lets a plugin edit text that a component property controls.

- **Build:** make a new component with a text layer `Spring Review`. With the text layer selected, in the right panel click the **Create component property** icon next to the text content, name it "Label". Make one instance.
- **Do:** select only the instance, open the plugin, run.
- **Expect one of:**
  - **Works:** the instance text changes and the "Label" property in the right panel shows the new words. Record "works".
  - **Refused:** the panel stays open with a warning card listing the layer and Figma's reason. Nothing else breaks. Record the exact reason shown.

## F9. Hidden layer inside an instance

- **Build:** a component with two text layers: `Spring Review` (visible) and `Helper text` (hidden). Make one instance. Both on this page.
- **Do 1:** **This page**, **Include hidden layers** off, open the plugin.
- **Expect 1:** summary counts the 2 visible layers (main and instance) and **Skipping 1 hidden** (the main's hidden layer; the hidden layer inside the instance is not counted, on purpose, for speed).
- **Do 2:** turn **Include hidden layers** on.
- **Expect 2:** 4 layers. Run, unhide the helper layers to check they changed. ⌘Z once.

## F10. Selection versus This page, and page switching

- **Build:** two frames side by side, each with line B. Add a second page ("Page 2") with one text layer, line A.
- **Do 1:** select only the left frame, **Selection**, run.
- **Expect 1:** only the left frame changes. ⌘Z.
- **Do 2:** open the plugin, choose **This page**.
- **Expect 2:** the This page card names the current page, e.g. **All text on "Page 1".** Summary counts both frames.
- **Do 3:** with the plugin still open, switch to Page 2 in the Pages list.
- **Expect 3:** the card now says **"Page 2"** and the summary recounts to **1 layer** within about a second.

## F11. Layer names

- **Build:** two text layers with line A. Leave the first one's name as Figma made it. Double-click the second one's name in the Layers panel and rename it `Headline`.
- **Do:** select both, run.
- **Expect:** the first layer's name now shows the new text. The second is still called `Headline`. Afterwards, edit the first layer's text by hand: its name should keep following the text.

## F12. Text that wraps onto more lines

- **Build:** a text layer with line B. In the right panel set it to **Auto height** (fixed width). Drag its width until the line only just fits on one line.
- **Do:** select it, run. If the result still fits on one line, ⌘Z, type a seed like `1`, `2`, `3`… and run again until it wraps (each seed gives a different result).
- **Expect when it wraps:** the panel **stays open** with an amber card that says **1 layer now wraps onto more lines**, plus **Select wrapped** and **Close** buttons. **Select wrapped** selects and zooms to the layer. **Close** closes the plugin, then ⌘Z once restores the text.

## F13. Seed

- **Build:** a text layer with line A.
- **Do:** open the plugin, type `spring` in **Seed**, run, and note the result. ⌘Z. Run again with the same seed.
- **Expect:** exactly the same result both times. Change the seed to `autumn`: a different result. Clear the seed: a different result each run. Closing and reopening the plugin keeps the seed you typed.

## F14. A big page stays quick

- **Build:** a frame with lines A, B and C as three layers. Select it and press **⌘D** about 60 times (or duplicate in a grid), so the page has around 180 text layers.
- **Do:** open the plugin on **Selection** and drag a selection box across many frames, then shift-click a few more.
- **Expect:** the summary keeps up without freezing Figma and settles on the right count about a tenth of a second after you stop. Switch to **This page**: the count appears within about a second. Run: it finishes, and ⌘Z once restores every layer.

## F15. Look and fit

- **Do:** open the plugin in Figma's light theme and again in dark theme (**Figma menu › Preferences › Theme**).
- **Expect:** text is readable in both. The window fits the panel without a scroll bar in the normal state. When a result card appears (F12), it is visible without scrolling, or the panel scrolls to it.

## Screenshot for the README

Take one screenshot of the plugin window next to scrambled text from F2 or F7, in light theme. Check no real names or file paths are visible.
