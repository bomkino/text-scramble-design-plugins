# Text Scramble for Figma

## Install

You need the Figma desktop app. The browser version can't add a plugin from a file.

1. Download `Text-Scramble-Figma-<version>.zip` from [Releases](https://github.com/bomkino/text-scramble-design-plugins/releases/latest) and double-click it to unzip. Keep the `Text Scramble - Figma` folder somewhere it can stay, such as your Documents folder.
2. In the Figma desktop app, open any design file.
3. Choose **Plugins › Development › Import plugin from manifest…** and pick `manifest.json` inside the `Text Scramble - Figma` folder.

Text Scramble now appears under **Plugins › Development**.

To update, unzip the new version and replace the old `Text Scramble - Figma` folder with it, in the same place. Figma uses the new files the next time you run the plugin.

## Use

1. Duplicate the page first, so the original stays safe.
2. Select text layers, frames, groups, components or instances. To scramble the whole page, you don't need to select anything.
3. Choose **Plugins › Development › Text Scramble**.
4. Pick **Selection**, or **This page** for every text layer on the page.
5. Set the options if you need them:
   - **Scramble numbers** (on): numbers change too, keeping their digit count.
   - **Include hidden layers** (off): hidden text still lives in the file, so turn this on before sharing the file itself.
   - **Seed** (empty): type any word to get the same invented words every time you scramble the same text.
6. Click **Scramble with soul**.

One **Undo** (⌘Z) puts the whole run back.

## Good to know

- **Locked layers are scrambled**, because locked text still exports. The plugin counts them.
- **Text with missing fonts is skipped**, because Figma can't edit it. Install the font, or swap it, and run again.
- **Instances follow their main component.** If a main component is part of the run, its instances change with it. Scrambling a main component also changes its instances on other pages, and the plugin warns you before that happens.
- **Layer names** that repeat a layer's text get the new text. Names you typed yourself stay as they are.
- **Links keep their real addresses.** The linked words change, but not the web address behind them.
- Everything happens on your computer. The plugin has no network access.

Before you share the file, read [Before you share](https://github.com/bomkino/text-scramble-design-plugins/blob/main/PRIVACY.md). Figma's version history keeps the original text.
