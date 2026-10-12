# Real-app tests on a Mac

The automated tests run in the cloud and on GitHub, but they can't open InDesign, Figma or Raycast. This folder holds the checks that need the real apps. They're written for a Claude Code session running on a Mac, working with a person who clicks where the apps need a human.

| File | What it covers |
|---|---|
| [indesign.md](indesign.md) | Classic script (automatic and by hand) and the UXP panel |
| [figma.md](figma.md) | The Figma plugin |
| [raycast.md](raycast.md) | The Raycast extension, from [bomkino/text-scramble](https://github.com/bomkino/text-scramble) |
| `indesign-fixture.jsx`, `indesign-harness.jsx`, `indesign-dump.jsx` | Helper scripts the InDesign checks run |

## Brief for the Mac session

You are a Claude Code session on the user's Mac. Your job is to test the current builds in the real apps and take screenshots. The person helping you is new to coding: talk in plain, everyday words, ask for one action at a time, and say exactly what to click.

### Rules

- **Scratch only.** Create new documents, fill them only with the invented sample text below, and close them without saving. Never open, edit or save an existing InDesign, Figma or other user file.
- **Fresh copies.** Work only in a new folder named `text-scramble-mac-tests` inside your starting folder. Don't touch any existing checkout of these repos.
- **No sign-ins by you.** Never type passwords, codes or tokens. When a sign-in screen appears, stop and ask the person to do it.
- **Nothing public.** Don't push to GitHub, publish anything, or change system settings. The Raycast Store step at the end runs only when the cloud thread says so.
- **Record everything.** Keep `text-scramble-mac-tests/RESULTS.md` up to date: one row per check with pass, fail or blocked, and what you saw. Post the whole file in your thread when you finish or get stuck, along with `indesign-jsx-results.json`.

### Sample text (invented, safe to use)

```text
Brindlewick Studio — Spring Review 2026
Quellmoor Orchard will open its café on 14 March, with 3 new rooms.
Amélie and Jonas wrote the brief; Amélie signs it off.
```

Use it everywhere a check needs text. The second "Amélie" is stored as "e" plus a separate accent mark (U+0301), so both ways of storing `é` get tested. Copying and pasting can merge the two, so put the text into files with Node, as [raycast.md](raycast.md) R1 does, and use `pbcopy` from those files.

### Part 0: Check the Mac

```bash
sw_vers; node -v; npm -v; git --version
mdfind "kMDItemCFBundleIdentifier == 'com.adobe.InDesign'"
ls /Applications | grep -i -E "figma|raycast|indesign|uxp"
```

The Raycast repo needs Node 22.22.2 or newer; this repo needs Node 20 or newer. If anything is missing or too old, tell the person and stop. Don't install anything system-wide without asking.

### Part 1: Get and check the code

```bash
mkdir -p text-scramble-mac-tests && cd text-scramble-mac-tests
git clone https://github.com/bomkino/text-scramble-design-plugins.git
git clone https://github.com/bomkino/text-scramble.git
git -C text-scramble-design-plugins rev-parse --short HEAD
git -C text-scramble rev-parse --short HEAD

cd text-scramble-design-plugins && npm ci && npm run package && cat artifacts/SHA256SUMS.txt && cd ..
cd text-scramble && npm ci && npm test && npm run lint && npm run build && cd ..
cp text-scramble-design-plugins/docs/testing/*.jsx .
```

Use `main` unless the cloud thread names other commits. Write both commit IDs at the top of `RESULTS.md`. If a check fails, stop and report the output.

### Part 2: InDesign classic script, automatic

Run checks I1 and I2 in [indesign.md](indesign.md). The first time a script talks to InDesign, macOS asks whether this app may control InDesign. Ask the person to click **OK**.

### Part 3: InDesign panel (needs the person's clicks)

Run checks P1 to P16 in [indesign.md](indesign.md).

### Part 4: Figma (needs the person's clicks)

Ask the person to open the Figma desktop app and create a new design file in **Drafts**. Then run checks F1 to F15 in [figma.md](figma.md). They can delete the scratch file afterwards.

### Part 5: Raycast

Run checks R1 to R8 in [raycast.md](raycast.md). Afterwards, tell the person that the development copy stays in Raycast; if they also have the Store version, they can remove the development one under **Raycast Settings › Extensions**.

### Part 6: Screenshots

With the scratch documents only, ask the person for these and save them in `text-scramble-mac-tests/screenshots/`:

- Figma: the plugin window next to scrambled text
- InDesign: the panel next to scrambled text, plus its after-run report
- Raycast: the command in the Raycast window
- one before-and-after of the same layout

Check that no real names, client copy or file paths are visible before you keep a screenshot.

### Part 7: Raycast Store update (only when the cloud thread says go)

1. In `text-scramble`, on the commit the cloud thread names, run `npm run publish`.
2. A browser asks the person to sign in to GitHub. They sign in; you wait.
3. If it says other people contributed changes, run `npx @raycast/api@latest pull-contributions`, show the person what changed, and report back before publishing again.
4. Report the pull request link it prints. Don't claim the update is live: Raycast reviews it first, and it goes live when they merge it.
