import { copyFile, cp, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.resolve(process.argv[2] || path.join(projectRoot, "plugins", "figma"));

const settingsPath = path.join(process.env.HOME, "Library", "Application Support", "Figma", "DesktopBeta", "settings.json");
const manifestPath = path.join(pluginRoot, "manifest.json");
const codePath = path.join(pluginRoot, "dist", "code.js");
const uiPath = path.join(pluginRoot, "dist", "ui.html");
const [settingsText, manifestText] = await Promise.all([readFile(settingsPath, "utf8"), readFile(manifestPath, "utf8")]);
const settings = JSON.parse(settingsText);
const manifest = JSON.parse(manifestText);
const files = Array.isArray(settings.localFileExtensions) ? settings.localFileExtensions : [];
const knownManifest = files.find((entry) => entry.fileMetadata?.type === "manifest" && entry.lastKnownPluginId === manifest.id);

if (knownManifest) {
  const knownRoot = path.dirname(knownManifest.manifestPath);
  if (knownRoot !== pluginRoot) {
    await copyFile(manifestPath, path.join(knownRoot, "manifest.json"));
    await cp(path.join(pluginRoot, "dist"), path.join(knownRoot, "dist"), { recursive: true, force: true });
    console.log(`Refreshed the registered Figma Beta build: ${knownRoot}`);
  } else {
    console.log("Figma Beta already points to the current Text Scramble build.");
  }
  process.exit(0);
}

const nextId = files.reduce((maximum, entry) => Math.max(maximum, Number(entry.id) || 0), 0) + 1;
files.push(
  {
    id: nextId,
    manifestPath,
    lastKnownName: manifest.name,
    lastKnownPluginId: manifest.id,
    fileMetadata: { type: "manifest", codeFileId: nextId + 1, uiFileIds: [nextId + 2] },
  },
  { id: nextId + 1, manifestPath: codePath, fileMetadata: { type: "code", manifestFileId: nextId } },
  { id: nextId + 2, manifestPath: uiPath, fileMetadata: { type: "ui", manifestFileId: nextId } },
);
settings.localFileExtensions = files;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${settingsPath}.before-text-scramble-${stamp}`;
const temporaryPath = `${settingsPath}.text-scramble-tmp`;
await copyFile(settingsPath, backupPath);
await writeFile(temporaryPath, JSON.stringify(settings));
await rename(temporaryPath, settingsPath);
console.log(`Registered Text Scramble in Figma Beta. Backup: ${backupPath}`);
