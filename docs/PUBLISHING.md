# Publishing

## Figma Community

Before submission:

1. Run `npm run verify` and test the production manifest in current stable Figma.
2. Capture Community listing artwork and a short privacy description.
3. Publish from Figma’s **Plugins → Development** menu using the registered plugin ID in `plugins/figma/manifest.json`.
4. State clearly that processing is local and that users should duplicate their page first.

## Adobe Marketplace

Before submission:

1. Load and test the UXP panel in current stable InDesign with Adobe UXP Developer Tool.
2. Create the Marketplace listing in Adobe Developer Distribution and copy its unique plugin ID into `plugins/indesign/manifest.json`.
3. Rebuild, retest, and package the registered build as a `.ccx` with Adobe UXP Developer Tool.
4. Prepare Marketplace icons, screenshots, description, support URL, privacy statement, and test notes.
5. Upload the version and submit the listing for review through Adobe Developer Distribution.

The standalone JSX companion can be distributed directly under the MIT license. A Marketplace submission should use the UXP panel as the primary product and retain the JSX file as a documented local fallback.
