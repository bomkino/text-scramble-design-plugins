import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const figma = path.join(root, "plugins", "figma");
const indesign = path.join(root, "plugins", "indesign");

async function clean(directory) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

async function renderIcon(output, size) {
  const source = path.join(root, "assets", "icon.svg");
  const rendered = path.join(path.dirname(output), "icon-source.png");
  await mkdir(path.dirname(output), { recursive: true });
  const convert = spawnSync("sips", ["-s", "format", "png", source, "--out", rendered], { encoding: "utf8" });
  if (convert.status !== 0) throw new Error(convert.stderr || "Could not render plugin icon.");
  const resize = spawnSync("sips", ["-z", String(size), String(size), rendered, "--out", output], { encoding: "utf8" });
  if (resize.status !== 0) throw new Error(resize.stderr || "Could not resize plugin icon.");
  await rm(rendered, { force: true });
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
await cp(path.join(indesign, "src", "Text Scramble.jsx"), path.join(indesign, "dist", "Text Scramble.jsx"));
await cp(path.join(indesign, "src", "index.html"), path.join(indesign, "dist", "index.html"));
await mkdir(path.join(indesign, "dist", "icons"), { recursive: true });
await cp(path.join(root, "assets", "icon.svg"), path.join(indesign, "dist", "icons", "icon.svg"));
await renderIcon(path.join(indesign, "dist", "icons", "icon-24.png"), 24);
await renderIcon(path.join(indesign, "dist", "icons", "icon-48.png"), 48);

const figmaManifest = JSON.parse(await readFile(path.join(figma, "manifest.json"), "utf8"));
const indesignManifest = JSON.parse(await readFile(path.join(indesign, "manifest.json"), "utf8"));
await writeFile(path.join(figma, "dist", "build.json"), JSON.stringify({ name: figmaManifest.name, version: "1.0.0" }, null, 2) + "\n");
await writeFile(path.join(indesign, "dist", "build.json"), JSON.stringify({ name: indesignManifest.name, version: indesignManifest.version }, null, 2) + "\n");

console.log("Built Figma and InDesign plugins.");
