import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parse } from "acorn";
import { build } from "esbuild";

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
assert.match(indesignLegacy, /function hasScramblableContents/);
// The classic JSX runs in ExtendScript, an ES3 engine: reserved words cannot be property names
// (`{ for: 1 }` stops the whole script from loading) and Object.prototype carries watch, unwatch,
// toSource and reflect. Parse it as ES3 and run its engine with those members present.
const legacySource = indesignLegacy.replace(/^#target .*$/m, "");
parse(legacySource, { ecmaVersion: 3, allowReserved: "never" });
const engineMatch = legacySource.match(/\/\/ @engine:start\n([\s\S]*?)\/\/ @engine:end/);
assert.ok(engineMatch, "Text Scramble.jsx must keep its @engine:start and @engine:end markers.");
const sandbox = vm.createContext({});
vm.runInContext(
  "Object.prototype.watch = function () {}; Object.prototype.unwatch = function () {};" +
    "Object.prototype.toSource = function () { return ''; }; Object.prototype.reflect = {};",
  sandbox,
);
const legacy = vm.runInContext(
  `(function () {\n${engineMatch[1]}\nreturn { scrambleContents: scrambleContents, COMMON_WORDS: COMMON_WORDS, UNWELCOME_FRAGMENTS: UNWELCOME_FRAGMENTS };\n})()`,
  sandbox,
);
const bundledLists = await build({
  entryPoints: [path.join(root, "packages", "core", "src", "word-lists.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
});
const lists = await import(`data:text/javascript;base64,${Buffer.from(bundledLists.outputFiles[0].text).toString("base64")}`);
assert.deepEqual(Array.from(legacy.COMMON_WORDS), [...lists.COMMON_WORDS]);
assert.deepEqual(Array.from(legacy.UNWELCOME_FRAGMENTS), [...lists.UNWELCOME_FRAGMENTS]);
const legacyProbe = "Watch the reflect toSource unwatch constructor valueOf: Sloane, Ruby and the ten roses, 2026.";
const common = new Set(lists.COMMON_WORDS);
for (let run = 0; run < 40; run++) {
  const cache = vm.runInContext("({})", sandbox);
  const output = legacy.scrambleContents(legacyProbe, true, cache);
  assert.equal(output.replace(/[A-Za-z]/g, "L").replace(/[0-9]/g, "N"), legacyProbe.replace(/[A-Za-z]/g, "L").replace(/[0-9]/g, "N"));
  for (const word of output.toLowerCase().match(/[a-z]+/g) ?? []) {
    assert.ok(!common.has(word), `Legacy JSX produced the real word "${word}".`);
    assert.ok(lists.UNWELCOME_FRAGMENTS.every((fragment) => !word.includes(fragment)), `Legacy JSX produced "${word}".`);
  }
}

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

console.log("Build verified: manifests, privacy boundary, formatting paths, ExtendScript compatibility, UI, and bundle sizes.");
