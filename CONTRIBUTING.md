# Contributing

Small, focused pull requests are welcome. Explain the visual or workflow reason for a change in the pull request.

## Set up

You need Node.js 20 or newer (CI uses Node 22). Building and testing work on macOS and Linux.

```bash
npm ci
npm run verify
```

`npm run verify` type-checks the code, runs the tests, builds both plugins into `plugins/*/dist`, and checks the builds: manifests, the no-network rule, formatting paths, ExtendScript compatibility for the classic InDesign script, that its engine gives the same results as the shared one, the UI copy and bundle sizes.

To make the release files in `artifacts/`:

```bash
npm run package
```

## Rules

- **Commit the built files.** `plugins/figma/dist` and `plugins/indesign/dist` are committed, and CI fails if they don't match a fresh `npm run build`.
- **Keep the core contract:** no network access, never create or save documents, one undo step per run, and no avoidable formatting loss.
- **Engine changes need a test.** Add or update one in `tests/`.
- **Invented text only.** Tests, fixtures and docs use made-up names and copy, never real client text.

## The shared engine

`packages/core` is the master copy of the scrambling engine. Everything else uses it:

- The Figma plugin, the InDesign panel and the UXP script build it in directly.
- The classic InDesign script runs a hand-written ES3 copy in `packages/core/es3`, because ExtendScript only understands old JavaScript. `npm run verify` checks that both copies give the same results.
- The [Raycast extension](https://github.com/bomkino/text-scramble) keeps a copy pinned to a commit of this repo. After an engine change merges here, run `npm run sync-core -- <commit>` in that repo. Its CI fails if its copy stops matching the pinned commit.

If a change means the same seed should give different words, regenerate the shared test results and commit them:

```bash
npm run test-vectors
```

Web-address endings come from IANA's list of top-level domains. To refresh it:

```bash
npm run update-tlds
```

## Mac-only helpers

- `npm run icons` re-renders the InDesign PNG icons after you change `assets/icon.svg`. It uses macOS's `sips`, and `npm run verify` fails if the SVG changes without a re-render.
- `node scripts/install-figma-beta-dev.mjs` points Figma Beta's development copy of the plugin at this checkout, or refreshes the copy it already knows. Run `npm run verify` first.

Real-app checks for InDesign, Figma and Raycast are in [docs/testing](docs/testing/README.md).

## Project map

```text
packages/core/       Shared scrambling engine (source of truth), plus its ES3 copy in es3/
plugins/figma/       Figma plugin
plugins/indesign/    InDesign panel, menu command, UXP script and classic script
tests/               Automated tests
scripts/             Build, checks, packaging and local install helpers
docs/                Install guides, formatting, publishing and real-app tests
```
