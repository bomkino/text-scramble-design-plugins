# Install in InDesign

Duplicate the document before scrambling it. Text Scramble never saves a document, but it intentionally edits the current selection or active page.

## Fastest local install: Scripts panel

1. In InDesign, choose **Window → Utilities → Scripts**.
2. In the Scripts panel, right-click **User** and choose **Reveal in Finder**.
3. Copy the versioned `Text-Scramble-InDesign-*.jsx` file from the release artifacts into that folder. From the source tree, use `plugins/indesign/dist/Text Scramble.jsx`.
4. Restart InDesign if the script does not appear immediately.
5. Select text or one or more text frames, then double-click **Text Scramble.jsx**.
6. Choose **Selection** or **Active page** and run it.

This companion uses InDesign’s classic ExtendScript runtime for immediate local use. It preserves formatting through in-place character replacement and keeps the full run inside one undo step.

## Full UXP panel

1. Install Adobe UXP Developer Tool 1.7 or newer from Creative Cloud.
2. Add a plugin and choose `plugins/indesign/manifest.json` from the source tree or release ZIP.
3. Click **Load**.
4. In InDesign 18.5 or newer, open **Plugins → Text Scramble**.

Adobe UXP Developer Tool is also used to package the panel as a `.ccx` for distribution. The release ZIP is a loadable developer build, not a Marketplace package; Marketplace packaging must use the plugin ID assigned by Adobe Developer Distribution.
