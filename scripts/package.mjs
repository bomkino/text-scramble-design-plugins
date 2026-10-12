import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";

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

// Every entry carries the last commit's time, so one commit always packs into the same bytes, on
// macOS, Linux or Windows. Zip stores wall-clock time, so shift it to read as UTC in any time zone.
function commitTime() {
  if (process.env.SOURCE_DATE_EPOCH) return Number(process.env.SOURCE_DATE_EPOCH) * 1000;
  const git = spawnSync("git", ["log", "-1", "--format=%ct"], { cwd: root, encoding: "utf8" });
  return git.status === 0 && git.stdout.trim() ? Number(git.stdout.trim()) * 1000 : Date.now();
}
const committed = commitTime();
const mtime = new Date(committed + new Date(committed).getTimezoneOffset() * 60_000);

// Same layout as macOS `ditto -c -k --keepParent`: one top folder, folder entries, Unix permissions.
async function archive(source, output) {
  const entries = {};
  const files = {};
  async function add(directory, prefix) {
    entries[`${prefix}/`] = [new Uint8Array(0), { level: 0, os: 3, attrs: 0o40755 * 0x10000, mtime }];
    const children = (await readdir(directory, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const child of children) {
      if (child.name === ".DS_Store") continue;
      const name = `${prefix}/${child.name}`;
      if (child.isDirectory()) {
        await add(path.join(directory, child.name), name);
      } else {
        files[name] = await readFile(path.join(directory, child.name));
        entries[name] = [files[name], { level: 9, os: 3, attrs: 0o100644 * 0x10000, mtime }];
      }
    }
  }
  await add(source, path.basename(source));
  const zip = zipSync(entries);
  const unpacked = unzipSync(zip);
  assert.deepEqual(Object.keys(unpacked).sort(), Object.keys(entries).sort());
  for (const [name, data] of Object.entries(files)) assert.ok(Buffer.from(unpacked[name]).equals(data), `${name} did not survive zipping.`);
  await writeFile(output, zip);
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
