# Raycast checks (real Raycast, scratch text only)

Run these in Part 5 of the [Mac brief](README.md), on [bomkino/text-scramble](https://github.com/bomkino/text-scramble) `main` unless the cloud thread names another commit. The exact results in R7 need its shared core pinned to plugins commit `31d5df1` or later (see `core-sync.json` there).

## Ground rules

- Use only the sample text from the brief, in a scratch TextEdit file. Close it without saving at the end.
- Don't change system settings. Never turn Accessibility off to test errors; R8 triggers the same message safely.
- "Preferences" means **Raycast Settings › Extensions › Text Scramble** (click the extension name; its settings show on the right).
- Record each check in `RESULTS.md` as pass, fail or blocked, with what you saw. Screenshot anything that fails.
- Before you start, set the preferences to their defaults: Preferred Source **Selected Text**, Output Action **Replace Selection**, **Scramble Numbers** on, **Seed** empty.

## Setup

In `text-scramble-mac-tests`, write the sample with Node so the second "Amélie" keeps its separate accent mark, then check it:

```bash
node -e 'require("fs").writeFileSync("raycast-sample.txt", "Brindlewick Studio — Spring Review 2026\nQuellmoor Orchard will open its café on 14 March, with 3 new rooms.\nAmélie and Jonas wrote the brief; Amélie signs it off.\n")'
node -e 'const t=require("fs").readFileSync("raycast-sample.txt","utf8"); console.log(t.includes("é") ? "separate accent: yes" : "separate accent: MISSING")'
```

To restore the sample between checks, press **⌘Z** in TextEdit, or close without saving and run `open -a TextEdit raycast-sample.txt` again.

Two helpers you'll reuse (run them in `text-scramble-mac-tests` after copying the result with **⌘A**, **⌘C**):

```bash
# Shape check: same lines, spaces, punctuation and word lengths, and the words changed
pbpaste > raycast-result.txt && node -e 'const fs=require("fs"); const shape=t=>t.trimEnd().normalize("NFD").replace(/\p{M}/gu,"").replace(/\p{L}/gu,"L").replace(/\p{N}/gu,"N"); const a=fs.readFileSync("raycast-sample.txt","utf8"), b=fs.readFileSync("raycast-result.txt","utf8"); console.log(shape(a)===shape(b) ? "shape: same" : "shape: DIFFERENT"); console.log(a.trimEnd()===b.trimEnd() ? "words: UNCHANGED" : "words: changed")'

# Name check: the two invented words that replaced "Amélie"
pbpaste | node -e 'const w=require("fs").readFileSync(0,"utf8").split("\n")[2].split(/[ ;.]+/); console.log(w[0], w[6], w[0].normalize("NFC")===w[6].normalize("NFC") ? "same" : "DIFFERENT", /[̀-ͯ]/.test(w[0].normalize("NFD")) ? "accent kept" : "NO ACCENT")'
```

## R1. The development copy loads

- **Setup:** in `text-scramble`, start `npm run dev` in the background.
- **Do:** ask the person to open Raycast and type `Scramble Selected Text`.
- **Expect:** the command shows up under Text Scramble. `npm run dev` shows no errors. Note the version Raycast lists if the person can see it.

## R2. Replace the selection, structure kept

- **Setup:** `open -a TextEdit raycast-sample.txt`.
- **Do:** person selects all (**⌘A**) and runs **Scramble Selected Text**. Then **⌘A**, **⌘C**, and run the shape check.
- **Expect:** a "Text scrambled" message. TextEdit shows three lines of invented words in place of the sample. Shape check prints `shape: same` and `words: changed`: same lines, "—", ";", ",", "." and spaces in the same places, every word the same length, capitals in the same places, and "2026", "14", "3" are now other numbers with the same number of digits.

## R3. Accents: both spellings of "Amélie"

- **Setup:** fresh sample in TextEdit (Setup check said `separate accent: yes`).
- **Do:** select all, run the command, **⌘A**, **⌘C**, run the name check. Repeat 3 times (restore the sample each time).
- **Expect:** every time, the name check prints the same invented word twice, then `same` and `accent kept` (for example `Utíram Utíram same accent kept`). Each word has exactly six letters. If TextEdit merged the separate accent when it opened the file, write that down; the check still has to say `same`.

## R4. Scramble Numbers on and off

- **Do 1:** in Preferences, turn **Scramble Numbers** off. Select all in a fresh sample, run.
- **Expect 1:** "2026", "14" and "3" stay exactly as they were. Every word still changes.
- **Do 2:** turn it back on, run on a fresh sample.
- **Expect 2:** the three numbers change, each to a number with the same number of digits.

## R5. Copy to Clipboard

- **Setup:** Preferences, Output Action **Copy to Clipboard**. Fresh sample.
- **Do:** select all, run. Then run `pbpaste`.
- **Expect:** a "Scrambled text copied" message. TextEdit still shows the original sample, unchanged and still selected. `pbpaste` prints the three scrambled lines. Set Output Action back to **Replace Selection** afterwards.

## R6. Clipboard comes back after Replace Selection

- **Setup:** Output Action **Replace Selection**. Run `printf 'clipboard canary 42' | pbcopy`. Fresh sample.
- **Do:** select all, run the command (don't copy anything yourself). Then run `pbpaste`.
- **Expect:** the selection in TextEdit is replaced with scrambled text, and `pbpaste` prints exactly `clipboard canary 42`.

## R7. Seed

- **Do 1:** in Preferences, type `spring` in **Seed**. Select all in a fresh sample, run, **⌘A**, **⌘C**, `pbpaste`. Restore the sample and run again.
- **Expect 1:** both runs give exactly this (Scramble Numbers on):

  ```text
  Tishauroser Lenefe — Inered Noreto 9170
  Thalanuva Reradeu ruti boga cri está na 48 Pevon, nelo 1 emu udana.
  Utíram fem Lebua tenuo rad fleta; Utíram olece ci esi.
  ```

  The first line should also match what Figma gives for line A with seed `spring` in its F13 check, when both builds use the same core.
- **Do 2:** change the seed to `autumn`, run on a fresh sample.
- **Expect 2:** a different result. Its first line is `Liferaneram Renele — Nitasu Lusabe 4245`.
- **Do 3:** clear the seed (leave the field empty), run twice on a fresh sample.
- **Expect 3:** the two runs give different words. Leave the seed empty afterwards.

## R8. Clear messages when there's no text or no access

- **Do 1:** Preferred Source **Clipboard**. Run `pbcopy < /dev/null` to empty the clipboard. Click on an empty part of the desktop so nothing is selected, then run the command.
- **Expect 1:** the message **No text — select or copy something first**. Nothing else changes.
- **Do 2:** Preferred Source back to **Selected Text**. Click on an empty part of the desktop again, run the command.
- **Expect 2:** the message **Can’t read selected text — select text or choose Clipboard**. This is the same message a missing Accessibility permission gives, so you don't need to change any setting to see it. (If Raycast reports an empty selection instead of an error, you'll see **No text — select or copy something first**; record which one appeared. Both are fine; a generic "Couldn’t scramble text" is a fail.) If macOS ever asks to give Raycast Accessibility access, stop and ask the person.
- **Do 3:** in TextEdit, type `— ✦ …` on a new line, select only that, run.
- **Expect 3:** the message **Nothing to scramble**, and the text stays as it was.

## Afterwards

Stop `npm run dev`, close TextEdit without saving, and put the preferences back to their defaults (Seed empty).
