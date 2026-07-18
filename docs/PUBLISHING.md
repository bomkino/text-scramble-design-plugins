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
2. Package and sign a `.ccx` through Adobe’s developer tooling.
3. Prepare Marketplace icons, screenshots, description, support URL, privacy statement, and test notes.
4. Submit through Adobe Developer Distribution.

The standalone JSX companion can be distributed directly under the MIT license. A Marketplace submission should use the UXP panel as the primary product and retain the JSX file as a documented local fallback.
