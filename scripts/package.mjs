import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
const staging = path.join(artifacts, ".staging");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
await rm(artifacts, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

async function stage(name, plugin, installGuide) {
  const target = path.join(staging, name);
  await mkdir(target, { recursive: true });
  await cp(path.join(plugin, "manifest.json"), path.join(target, "manifest.json"));
  await cp(path.join(plugin, "dist"), path.join(target, "dist"), { recursive: true });
  await cp(path.join(root, "LICENSE"), path.join(target, "LICENSE"));
  await cp(path.join(root, "ACKNOWLEDGEMENTS.md"), path.join(target, "ACKNOWLEDGEMENTS.md"));
  await cp(path.join(root, "docs", installGuide), path.join(target, "INSTALL.md"));
  return target;
}

async function archive(source, output) {
  const child = spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", source, output], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(child.stderr || "Could not create archive.");
}

const figmaStage = await stage("Text Scramble - Figma", path.join(root, "plugins", "figma"), "INSTALL-FIGMA.md");
const indesignStage = await stage("Text Scramble - InDesign", path.join(root, "plugins", "indesign"), "INSTALL-INDESIGN.md");
const figmaZip = path.join(artifacts, `Text-Scramble-Figma-${version}.zip`);
const indesignZip = path.join(artifacts, `Text-Scramble-InDesign-${version}.zip`);
const indesignScript = path.join(artifacts, `Text-Scramble-InDesign-${version}.jsx`);
await archive(figmaStage, figmaZip);
await archive(indesignStage, indesignZip);
await cp(path.join(root, "plugins", "indesign", "dist", "Text Scramble.jsx"), indesignScript);
await rm(staging, { recursive: true, force: true });

const files = [figmaZip, indesignZip, indesignScript];
const checksums = [];
for (const file of files) {
  const hash = createHash("sha256").update(await readFile(file)).digest("hex");
  checksums.push(`${hash}  ${path.basename(file)}`);
}
await writeFile(path.join(artifacts, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
console.log("Packaged developer builds with SHA-256 checksums.");
