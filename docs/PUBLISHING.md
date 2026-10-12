# Publishing

Text Scramble ships in three places: GitHub releases (downloads anyone can install by hand), Figma Community and the Adobe Marketplace.

As of October 2026 it's on GitHub releases only. Figma Community status is unconfirmed, and there is no Adobe Marketplace listing yet.

## GitHub release

1. Set the new version and rebuild, so the built files carry it:

   ```bash
   npm version 1.2.0 --no-git-tag-version
   ```

   Then set the same `"version"` in `plugins/indesign/manifest.json` and run `npm run verify`. It fails if the two numbers differ.
2. Add an entry to the top of `CHANGELOG.md` headed `## 1.2.0 — <date>`. It becomes the release notes.
3. Merge to `main`.
4. On GitHub, open **Actions › Release › Run workflow**. Leave **Dry run** ticked and run it. When it's green, its summary lists the files, their checksums and the release notes.
5. Run it again on `main` with **Dry run** unticked. It tags the version (for example `v1.2.0`) and publishes the release with:
   - `Text-Scramble-Figma-<version>.zip`
   - `Text-Scramble-InDesign-<version>.zip`
   - `Text-Scramble-InDesign-<version>.jsx`
   - `SHA256SUMS.txt`, the checksums people can use to confirm a download is intact

The workflow refuses to publish a version that already has a release.

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
