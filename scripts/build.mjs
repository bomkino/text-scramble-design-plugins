import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const figma = path.join(root, "plugins", "figma");
const indesign = path.join(root, "plugins", "indesign");
const projectPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

async function clean(directory) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

// The classic JSX runs in ExtendScript (ES3), so it cannot import the core. Inject the shared word
// lists instead, so the JSX blocks exactly the words the Figma and UXP builds block.
async function buildLegacyScript() {
  const bundled = await build({
    entryPoints: [path.join(root, "packages", "core", "src", "word-lists.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
  });
  const lists = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  let script = await readFile(path.join(indesign, "src", "Text Scramble.jsx"), "utf8");
  const inject = (marker, name, words) => {
    const pattern = new RegExp(`^(\\s*)var ${name} = \\[\\]; // @build:${marker}$`, "m");
    if (!pattern.test(script)) throw new Error(`Text Scramble.jsx is missing the @build:${marker} line.`);
    script = script.replace(pattern, (_, indent) => `${indent}var ${name} = ${JSON.stringify(words)};`);
  };
  inject("common-words", "COMMON_WORDS", lists.COMMON_WORDS);
  inject("unwelcome-fragments", "UNWELCOME_FRAGMENTS", lists.UNWELCOME_FRAGMENTS);
  return script;
}

await clean(path.join(figma, "dist"));
await clean(path.join(indesign, "dist"));

await build({
  entryPoints: [path.join(figma, "src", "code.ts")],
  outfile: path.join(figma, "dist", "code.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  banner: { js: "/* Text Scramble for Figma · MIT · pitch.dog */" },
});
await cp(path.join(figma, "src", "ui.html"), path.join(figma, "dist", "ui.html"));
await cp(path.join(root, "assets", "icon.svg"), path.join(figma, "dist", "icon.svg"));

await build({
  entryPoints: [path.join(indesign, "src", "index.ts")],
  outfile: path.join(indesign, "dist", "index.js"),
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2020",
  external: ["indesign", "uxp"],
  minify: true,
  legalComments: "none",
  banner: { js: "/* Text Scramble for InDesign · MIT · pitch.dog */" },
});
await build({
  entryPoints: [path.join(indesign, "src", "script.ts")],
  outfile: path.join(indesign, "dist", "Text Scramble.idjs"),
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2020",
  external: ["indesign", "uxp"],
  minify: true,
  legalComments: "none",
  banner: { js: "/* Text Scramble for InDesign Scripts panel · MIT · pitch.dog */" },
});
await writeFile(path.join(indesign, "dist", "Text Scramble.jsx"), await buildLegacyScript());
await cp(path.join(indesign, "src", "index.html"), path.join(indesign, "dist", "index.html"));
await mkdir(path.join(indesign, "dist", "icons"), { recursive: true });
await cp(path.join(root, "assets", "icon.svg"), path.join(indesign, "dist", "icons", "icon.svg"));
// The PNG icons are rendered once from icon.svg on a Mac (`npm run icons`) and committed, so the
// build runs the same on any OS. verify-build.mjs fails if icon.svg changes without a re-render.
await cp(path.join(root, "assets", "icon.png"), path.join(indesign, "dist", "icons", "icon.png"));
await cp(path.join(root, "assets", "icon@2x.png"), path.join(indesign, "dist", "icons", "icon@2x.png"));

const figmaManifest = JSON.parse(await readFile(path.join(figma, "manifest.json"), "utf8"));
const indesignManifest = JSON.parse(await readFile(path.join(indesign, "manifest.json"), "utf8"));
await writeFile(path.join(figma, "dist", "build.json"), JSON.stringify({ name: figmaManifest.name, version: projectPackage.version }, null, 2) + "\n");
await writeFile(path.join(indesign, "dist", "build.json"), JSON.stringify({ name: indesignManifest.name, version: indesignManifest.version }, null, 2) + "\n");

console.log("Built Figma and InDesign plugins.");
