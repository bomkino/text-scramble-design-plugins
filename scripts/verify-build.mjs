import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parse } from "acorn";
import { build } from "esbuild";
import { createExtendScriptContext, directiveCommentLines, es3Problems, runJsxHeadless } from "./extendscript-sandbox.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const figma = path.join(root, "plugins", "figma");
const indesign = path.join(root, "plugins", "indesign");
const projectPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const required = [
  path.join(figma, "manifest.json"),
  path.join(figma, "dist", "code.js"),
  path.join(figma, "dist", "ui.html"),
  path.join(indesign, "manifest.json"),
  path.join(indesign, "dist", "index.js"),
  path.join(indesign, "dist", "index.html"),
  path.join(indesign, "dist", "Text Scramble.idjs"),
  path.join(indesign, "dist", "Text Scramble.jsx"),
  path.join(indesign, "dist", "icons", "icon.png"),
  path.join(indesign, "dist", "icons", "icon@2x.png"),
];

await Promise.all(required.map((file) => access(file)));
const [figmaManifest, indesignManifest, figmaCode, figmaUi, indesignCode, indesignUi, indesignLegacy] = await Promise.all([
  readFile(path.join(figma, "manifest.json"), "utf8").then(JSON.parse),
  readFile(path.join(indesign, "manifest.json"), "utf8").then(JSON.parse),
  readFile(path.join(figma, "dist", "code.js"), "utf8"),
  readFile(path.join(figma, "dist", "ui.html"), "utf8"),
  readFile(path.join(indesign, "dist", "index.js"), "utf8"),
  readFile(path.join(indesign, "dist", "index.html"), "utf8"),
  readFile(path.join(indesign, "dist", "Text Scramble.jsx"), "utf8"),
]);

assert.equal(figmaManifest.documentAccess, "dynamic-page");
assert.deepEqual(figmaManifest.networkAccess.allowedDomains, ["none"]);
assert.equal(indesignManifest.manifestVersion, 5);
assert.equal(indesignManifest.host.app, "ID");
assert.equal(indesignManifest.version, projectPackage.version);
assert.ok(indesignManifest.entrypoints.some((entrypoint) => entrypoint.type === "panel"));
assert.ok(indesignManifest.entrypoints.some((entrypoint) => entrypoint.type === "command"));
assert.equal(indesignManifest.icons[0].path, "dist/icons/icon.png");
assert.deepEqual(indesignManifest.icons[0].scale, [1, 2]);
assert.ok(indesignManifest.entrypoints.every((entrypoint) => !("icons" in entrypoint)));
assert.match(figmaCode, /insertCharacters/);
assert.match(figmaCode, /deleteCharacters/);
assert.match(indesignCode, /Text Scramble/);
assert.match(indesignCode, /UXPSCRIPT/);
assert.match(indesignLegacy, /function toCharacters/);
assert.match(indesignLegacy, /sourceCharacters\.length !== outputCharacters\.length/);
assert.match(indesignLegacy, /allPageItems/);
assert.match(indesignLegacy, /function hasScramblableText/);
// The classic JSX runs in ExtendScript, an ES3 engine: reserved words cannot be property names
// (`{ for: 1 }` stops the whole script from loading), ES5 builtins such as Array.prototype.forEach
// and JSON are missing, and Object.prototype carries watch, unwatch, toSource and reflect. Parse it
// as ES3 and run its engine in a sandbox that behaves the same way (scripts/extendscript-sandbox.mjs).
const legacySource = indesignLegacy.replace(/^#target .*$/m, "");
const legacyProgram = parse(legacySource, { ecmaVersion: 3, allowReserved: "never" });
// ExtendScript reads a line comment that starts with @ as a preprocessor directive and stops the whole
// script with "Syntax error" on one it doesn't know, so no line of the built script may start that way.
assert.deepEqual(directiveCommentLines(indesignLegacy), [], 'Text Scramble.jsx has lines starting with "// @", which ExtendScript reads as unknown directives.');
const engineMatch = legacySource.match(/\/\/ \[engine:start\]\n([\s\S]*?)\/\/ \[engine:end\]/);
assert.ok(engineMatch, "Text Scramble.jsx must keep its [engine:start] and [engine:end] markers.");
assert.match(legacySource, /\/\/ \[engine:end\]\n[\s\S]*\/\/ \[document:start\]\n[\s\S]*?\/\/ \[document:end\]/, "Text Scramble.jsx must keep its document-walking code between [document:start] and [document:end], after the engine.");
assert.ok(/^[\t\n\r\x20-\x7e]*$/.test(engineMatch[1]), "The JSX engine block must be ASCII.");

// The engine shares the script's function scope with the document code and the dialog, so no name may be
// declared twice there: a second declaration would silently replace the first.
const scriptBody = legacyProgram.body[0].expression.callee.body.body;
const engineStart = engineMatch.index;
const engineEnd = engineMatch.index + engineMatch[0].length;
const declaredNames = new Map();
for (const statement of scriptBody) {
  const names =
    statement.type === "FunctionDeclaration"
      ? [statement.id.name]
      : statement.type === "VariableDeclaration"
        ? statement.declarations.map((declaration) => declaration.id.name)
        : [];
  const inEngine = statement.start >= engineStart && statement.end <= engineEnd;
  for (const name of names) {
    const other = declaredNames.get(name);
    assert.ok(other === undefined || (!other && !inEngine), `Text Scramble.jsx declares ${name} more than once${inEngine || other ? " (in the engine block)" : ""}.`);
    declaredNames.set(name, inEngine);
  }
}

const sandbox = createExtendScriptContext();
const legacy = vm.runInContext(
  `(function () {\n${engineMatch[1]}\nreturn { createScrambler: createScrambler, createSeededRandom: createSeededRandom, createWordMatcher: createWordMatcher, hasScramblableText: hasScramblableText, COMMON_WORDS: COMMON_WORDS, UNWELCOME_FRAGMENTS: UNWELCOME_FRAGMENTS, TOP_LEVEL_DOMAINS: TOP_LEVEL_DOMAINS };\n})()`,
  sandbox,
);
async function importBundled(entry) {
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "neutral" });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
}
const lists = await importBundled(path.join(root, "packages", "core", "src", "word-lists.ts"));
const { TOP_LEVEL_DOMAINS } = await importBundled(path.join(root, "packages", "core", "src", "top-level-domains.ts"));
const core = await importBundled(path.join(root, "packages", "core", "src", "scramble-text.ts"));
assert.deepEqual(Array.from(legacy.COMMON_WORDS), [...lists.COMMON_WORDS]);
assert.deepEqual(Array.from(legacy.UNWELCOME_FRAGMENTS), [...lists.UNWELCOME_FRAGMENTS]);
assert.deepEqual(Array.from(legacy.TOP_LEVEL_DOMAINS), [...TOP_LEVEL_DOMAINS]);

// The JSX engine must reproduce every shared test vector, and match the core on random text.
const vectors = JSON.parse(await readFile(path.join(root, "packages", "core", "test-vectors.json"), "utf8"));
for (const { inputs, options, outputs } of vectors) {
  const scrambler = legacy.createScrambler(options);
  assert.deepEqual(inputs.map((input) => scrambler.scramble(input)), outputs, `The JSX engine differs on the test vector with seed ${JSON.stringify(options.seed)}.`);
}
const parityPool = [
  "Sloane", "ruby", "LISBON", "the", "ten", "a", "Stories", "rhythm", "Café", "re\u0301sume\u0301", "Đặng", "Việt", "Ångström",
  "Łódź", "ǅuro", "İstanbul", "ıi", "Straße", "Æsir", "ﬁne", "Ελληνικά", "Русский", "й", "עברית", "東京", "한국어", "𝒜𝒷", "𐐀𐐨",
  "watch", "unwatch", "toSource", "reflect", "constructor", "valueOf", "__proto__", "hasOwnProperty", "prototype",
  "2026", "٢٠٢٦", "𝟚𝟘", "Ⅷ", "½", "²", "\u0301x", "2\u0301", "✦", "🙂", " — ", "…",
  "hello@quellmoor.co", "https://www.quellmoor.co/work/autumn-menu?ref=deck", "north-star.studio", "NORTH-STAR.STUDIO",
  "Ada.Quell@orchard.photography", "mailto:team@example.com", "demo.example.org", "shop.local", "Zoë@café.fr", "e.g.",
  "Next.js", "first.last@quellmoor.com", "Quellmoor.Studio", "www.studio", "x@y.𐐀𐐨", "quellmoor.unknownending",
];
const separators = [" ", " ", ", ", ". ", "\n", "\t", "", "-", "@", ".", "/", ":"];
const parityRandom = core.createSeededRandom("verify-build");
const pickFrom = (items) => items[Math.floor(parityRandom() * items.length)];
const randomText = () => Array.from({ length: 1 + Math.floor(parityRandom() * 8) }, () => pickFrom(parityPool) + pickFrom(separators)).join("");
for (let trial = 0; trial < 150; trial++) {
  // A seed, a seed with numbers kept, or an injected random source; and no filter, a list to scramble, or a
  // list to keep.
  const seeded = [{ seed: trial }, { seed: `deck ${trial}`, scrambleNumbers: false }, undefined][trial % 3];
  const coreScrambler = core.createScrambler(seeded ?? { random: core.createSeededRandom(trial) });
  const legacyScrambler = legacy.createScrambler(seeded ?? { random: legacy.createSeededRandom(trial) });
  const entries = [pickFrom(parityPool), pickFrom(parityPool)];
  const coreMatches = core.createWordMatcher(entries);
  const legacyMatches = legacy.createWordMatcher(entries);
  const [coreFilter, legacyFilter] = [
    [undefined, undefined],
    [coreMatches, legacyMatches],
    [(token) => !coreMatches(token), (token) => !legacyMatches(token)],
  ][Math.floor(trial / 3) % 3];
  for (let text = 0; text < 3; text++) {
    const input = randomText();
    assert.equal(legacyScrambler.scramble(input, legacyFilter), coreScrambler.scramble(input, coreFilter), `The JSX engine differs from the core on ${JSON.stringify(input)}.`);
    assert.equal(legacy.hasScramblableText(input, { scrambleNumbers: trial % 2 === 0 }), core.hasScramblableText(input, { scrambleNumbers: trial % 2 === 0 }));
  }
}

// The document code outside the engine must not call ES5 methods either, even on arrays that come
// from InDesign (which the sandbox cannot strip), and must stay ASCII so any encoding reads it.
assert.deepEqual(es3Problems(indesignLegacy, { skipSections: ["engine"], strictIndexOf: true }), [], "Text Scramble.jsx uses ES5 outside its engine.");
assert.doesNotMatch(legacySource.slice(legacySource.indexOf("// [engine:end]")), /[^\x00-\x7F]/, "Text Scramble.jsx must stay ASCII outside its engine.");

// Smoke-run the built JSX headlessly against a small fake document: the text changes, in one undo
// step, and the report has the panel's shape.
const bundledFakes = await build({
  entryPoints: [path.join(root, "tests", "fakes", "indesign.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
});
const fakes = await import(`data:text/javascript;base64,${Buffer.from(bundledFakes.outputFiles[0].text).toString("base64")}`);
const smoke = fakes.createInDesign();
const smokePage = smoke.document.spread(["1"]).pages[0];
const smokeSource = "Brindlewick met Quellmoor in 2026.";
const smokeStory = smoke.document.story(smokeSource);
smoke.document.frame(smokePage, smokeStory);
smoke.document.frame(smokePage, smoke.document.story([smoke.document.table([["Quarter"], ["Totals 7"]])]));
smoke.app.activeWindow.activePage = smokePage;
const smokeReport = runJsxHeadless(indesignLegacy, { ...fakes.hostFor(smoke.app), settings: { scope: "page", seed: "verify" } });
const letterShape = (text) => text.replace(/[A-Za-z]/g, "L").replace(/[0-9]/g, "N");
assert.notEqual(smokeStory.contents, smokeSource, "The built JSX did not change any text.");
assert.equal(letterShape(smokeStory.contents), letterShape(smokeSource));
assert.deepEqual(smoke.app.doScriptCalls, [{ language: "JAVASCRIPT", undoMode: "ENTIRE_SCRIPT", name: "Text Scramble" }]);
assert.deepEqual(Object.keys(smokeReport).sort(), [
  "changed", "characters", "cleanup", "empty", "errors", "keptParagraphs", "kinds", "names", "notes", "overflow", "parentPages", "scope", "skipped",
]);
assert.deepEqual(Object.keys(smokeReport.kinds).sort(), ["cell", "footnote", "frame", "overset", "path", "selection", "story"]);
assert.deepEqual(Object.keys(smokeReport.skipped).sort(), ["hidden", "locked", "unreadable"]);
assert.deepEqual(Object.keys(smokeReport.overflow).sort(), ["alreadyOverflowing", "overflowing"]);
assert.deepEqual([smokeReport.scope, smokeReport.changed, smokeReport.kinds.frame, smokeReport.kinds.cell, smokeReport.empty], ["page", 3, 1, 2, null]);
assert.deepEqual(smokeReport.errors, []);

// The PNG icons are committed renders of icon.svg (see scripts/render-icons.mjs). Fail when the SVG
// changed without a re-render, or when a PNG is not the size the manifest promises.
const iconSvgHash = createHash("sha256").update(await readFile(path.join(root, "assets", "icon.svg"))).digest("hex");
const renderedFrom = (await readFile(path.join(root, "assets", "icon.svg.sha256"), "utf8")).split(/\s+/)[0];
assert.equal(iconSvgHash, renderedFrom, "assets/icon.svg changed but its PNG icons were not re-rendered. Run `npm run icons` on a Mac.");
for (const [name, size] of [["icon.png", 24], ["icon@2x.png", 48]]) {
  const png = await readFile(path.join(indesign, "dist", "icons", name));
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG", `${name} is not a PNG.`);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [size, size], `${name} must be ${size}×${size}.`);
}

assert.match(figmaUi, /Formatting stays put/);
assert.match(indesignUi, /Formatting stays put/);
assert.ok((await stat(path.join(figma, "dist", "code.js"))).size < 100_000);
assert.ok((await stat(path.join(indesign, "dist", "index.js"))).size < 100_000);
assert.ok((await stat(path.join(indesign, "dist", "Text Scramble.jsx"))).size < 150_000);

console.log("Build verified: manifests, privacy boundary, formatting paths, ExtendScript compatibility and engine parity, a headless JSX run, UI, and bundle sizes.");
