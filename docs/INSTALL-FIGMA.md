# Install in Figma

## Development install

1. Duplicate the page you intend to scramble.
2. Open Figma or Figma Beta.
3. Choose **Plugins → Development → Import plugin from manifest…**
4. Select `plugins/figma/manifest.json` from this project, or the `manifest.json` inside the Figma release ZIP.
5. Select text layers, frames, groups, or components.
6. Run **Plugins → Development → Text Scramble**.
7. Choose **Selection** or **Current page**, then click **Scramble with soul**.

The plugin skips hidden or locked content and text with missing fonts. It closes after a successful run so the whole edit remains one clean **Command–Z**.

## Update the local build

From the project root:

```bash
npm run verify
node scripts/install-figma-beta-dev.mjs
```

This refreshes the registered development copy—or registers the source-tree build on first use—without modifying a Figma file.
