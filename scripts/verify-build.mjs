import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const figma = path.join(root, "plugins", "figma");
const indesign = path.join(root, "plugins", "indesign");
const required = [
  path.join(figma, "manifest.json"),
  path.join(figma, "dist", "code.js"),
  path.join(figma, "dist", "ui.html"),
  path.join(indesign, "manifest.json"),
  path.join(indesign, "dist", "index.js"),
  path.join(indesign, "dist", "index.html"),
  path.join(indesign, "dist", "Text Scramble.idjs"),
  path.join(indesign, "dist", "Text Scramble.jsx"),
  path.join(indesign, "dist", "icons", "icon-24.png"),
  path.join(indesign, "dist", "icons", "icon-48.png"),
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
assert.ok(indesignManifest.entrypoints.some((entrypoint) => entrypoint.type === "panel"));
assert.ok(indesignManifest.entrypoints.some((entrypoint) => entrypoint.type === "command"));
assert.match(figmaCode, /insertCharacters/);
assert.match(figmaCode, /deleteCharacters/);
assert.match(indesignCode, /Text Scramble/);
assert.match(indesignLegacy, /function toCharacters/);
assert.match(indesignLegacy, /sourceCharacters\.length !== outputCharacters\.length/);
assert.match(figmaUi, /Formatting stays put/);
assert.match(indesignUi, /Formatting stays put/);
assert.ok((await stat(path.join(figma, "dist", "code.js"))).size < 100_000);
assert.ok((await stat(path.join(indesign, "dist", "index.js"))).size < 100_000);

console.log("Build verified: manifests, privacy boundary, formatting paths, UI, and bundle sizes.");
