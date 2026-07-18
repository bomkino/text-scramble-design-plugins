import { buildReplacementRuns } from "../../../packages/core/src/replacement-runs";
import { scrambleTexts } from "../../../packages/core/src/scramble-text";

type Scope = "selection" | "page";

interface Preferences {
  scope: Scope;
  scrambleNumbers: boolean;
}

interface ScopeSummary {
  layers: number;
  characters: number;
  skippedLocked: number;
  skippedMissingFonts: number;
}

const DEFAULT_PREFERENCES: Preferences = { scope: "selection", scrambleNumbers: true };
const STORAGE_KEY = "text-scramble-preferences-v1";
let preferences = DEFAULT_PREFERENCES;

figma.showUI(__html__, {
  width: 372,
  height: 590,
  title: "Text Scramble",
  themeColors: true,
});

function isEditable(node: TextNode): boolean {
  let current: BaseNode | null = node;
  while (current && current.type !== "DOCUMENT") {
    if ("visible" in current && current.visible === false) return false;
    if ("locked" in current && current.locked === true) return false;
    current = current.parent;
  }
  return true;
}

function textDescendants(node: SceneNode): TextNode[] {
  if (node.type === "TEXT") return [node];
  if ("findAllWithCriteria" in node) {
    return node.findAllWithCriteria({ types: ["TEXT"] });
  }
  return [];
}

async function collectTextNodes(scope: Scope): Promise<TextNode[]> {
  await figma.currentPage.loadAsync();
  const candidates =
    scope === "page"
      ? figma.currentPage.findAllWithCriteria({ types: ["TEXT"] })
      : figma.currentPage.selection.flatMap(textDescendants);
  const unique = new Map<string, TextNode>();
  candidates.forEach((node) => unique.set(node.id, node));
  return Array.from(unique.values());
}

async function inspectScope(scope: Scope): Promise<ScopeSummary> {
  const nodes = await collectTextNodes(scope);
  const editable = nodes.filter(isEditable);
  return {
    layers: editable.filter((node) => !node.hasMissingFont && node.characters.length > 0).length,
    characters: editable.reduce(
      (total, node) => total + (!node.hasMissingFont ? Array.from(node.characters).length : 0),
      0,
    ),
    skippedLocked: nodes.length - editable.length,
    skippedMissingFonts: editable.filter((node) => node.hasMissingFont).length,
  };
}

async function sendScopeSummary(): Promise<void> {
  try {
    figma.ui.postMessage({ type: "scope-summary", summary: await inspectScope(preferences.scope) });
  } catch (error) {
    figma.ui.postMessage({ type: "scope-error", message: error instanceof Error ? error.message : String(error) });
  }
}

async function loadFonts(node: TextNode): Promise<void> {
  const fonts = node.getRangeAllFontNames(0, node.characters.length);
  const unique = new Map(fonts.map((font) => [`${font.family}\u0000${font.style}`, font]));
  await Promise.all(Array.from(unique.values(), (font) => figma.loadFontAsync(font)));
}

function replaceCharactersPreservingStyles(node: TextNode, output: string): number {
  const runs = buildReplacementRuns(node.characters, output);
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index];
    node.insertCharacters(run.start, run.replacement, "AFTER");
    node.deleteCharacters(run.start + run.replacement.length, run.end + run.replacement.length);
  }
  return runs.length;
}

async function scramble(): Promise<void> {
  figma.ui.postMessage({ type: "working" });
  const selectionBefore = [...figma.currentPage.selection];
  const candidates = await collectTextNodes(preferences.scope);
  const nodes = candidates.filter((node) => isEditable(node) && !node.hasMissingFont && node.characters.length > 0);

  if (nodes.length === 0) {
    const message = preferences.scope === "selection" ? "Select text or a frame containing text." : "No editable text on this page.";
    figma.notify(message, { error: true });
    figma.ui.postMessage({ type: "empty", message });
    return;
  }

  const outputs = scrambleTexts(
    nodes.map((node) => node.characters),
    { scrambleNumbers: preferences.scrambleNumbers },
  );
  let layers = 0;
  let characters = 0;
  const failed: string[] = [];

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    try {
      await loadFonts(node);
      replaceCharactersPreservingStyles(node, outputs[index]);
      layers++;
      characters += Array.from(node.characters).length;
    } catch (error) {
      failed.push(`${node.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (layers === 0) {
    const message = failed[0] ?? "Nothing could be scrambled.";
    figma.notify(message, { error: true });
    figma.ui.postMessage({ type: "failed", message, failed });
    return;
  }

  figma.currentPage.selection = [];
  figma.currentPage.selection = selectionBefore;
  figma.commitUndo();
  const skipped = candidates.length - layers;
  figma.notify(`Scrambled ${layers} text ${layers === 1 ? "layer" : "layers"}${skipped ? ` · ${skipped} skipped` : ""}`);
  figma.ui.postMessage({ type: "complete", layers, characters, skipped, failed });
  await sendScopeSummary();
  setTimeout(() => figma.closePlugin(), 900);
}

figma.ui.onmessage = async (message: { type: string; scope?: Scope; scrambleNumbers?: boolean }) => {
  if (message.type === "ready") {
    preferences = { ...DEFAULT_PREFERENCES, ...(await figma.clientStorage.getAsync(STORAGE_KEY)) };
    figma.ui.postMessage({ type: "preferences", preferences });
    await sendScopeSummary();
    return;
  }

  if (message.type === "preferences") {
    preferences = {
      scope: message.scope === "page" ? "page" : "selection",
      scrambleNumbers: message.scrambleNumbers !== false,
    };
    await figma.clientStorage.setAsync(STORAGE_KEY, preferences);
    await sendScopeSummary();
    return;
  }

  if (message.type === "scramble") {
    await scramble();
  }
};

figma.on("selectionchange", () => {
  if (preferences.scope === "selection") void sendScopeSummary();
});
