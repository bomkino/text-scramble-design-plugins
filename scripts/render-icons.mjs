// Re-renders the InDesign panel's PNG icons from assets/icon.svg. Run it on a Mac (`npm run icons`)
// whenever icon.svg changes, then commit the PNGs and icon.svg.sha256 together. The build only
// copies these files, so it runs on any OS.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assets = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "assets");
const source = path.join(assets, "icon.svg");
const rendered = path.join(assets, "icon-source.png");

if (process.platform !== "darwin") throw new Error("Rendering icons uses macOS sips. Run `npm run icons` on a Mac.");

function sips(args, failure) {
  const child = spawnSync("sips", args, { encoding: "utf8" });
  if (child.status !== 0) throw new Error(child.stderr || failure);
}

sips(["-s", "format", "png", source, "--out", rendered], "Could not render plugin icon.");
for (const [name, size] of [["icon.png", 24], ["icon@2x.png", 48]]) {
  sips(["-z", String(size), String(size), rendered, "--out", path.join(assets, name)], "Could not resize plugin icon.");
}
await rm(rendered, { force: true });

const hash = createHash("sha256").update(await readFile(source)).digest("hex");
await writeFile(path.join(assets, "icon.svg.sha256"), `${hash}  icon.svg\n`);
console.log("Rendered icon.png and icon@2x.png from icon.svg.");
