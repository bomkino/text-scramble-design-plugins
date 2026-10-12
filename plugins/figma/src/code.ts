import { DEFAULT_PREFERENCES, errorView, readPreferences, resultView, summaryView, type Preferences } from "./copy";
import { debounce } from "./debounce";
import { scrambleLayers, type RunOptions } from "./run";
import { scanScope, type ScanResult, type TextLayer } from "./scope";

const STORAGE_KEY = "text-scramble-preferences-v1";
const WIDTH = 372;
const MIN_HEIGHT = 420;
const MAX_HEIGHT = 760;

let preferences: Preferences = DEFAULT_PREFERENCES;
let isScrambling = false;
let isClosing = false;
let scanRequest = 0;
let wrappedLayers: TextLayer[] = [];

figma.showUI(__html__, { width: WIDTH, height: 600, title: "Text Scramble", themeColors: true });

async function scanCurrentScope(): Promise<ScanResult> {
  await figma.currentPage.loadAsync();
  // Figma reads hidden layers inside instances slowly. Skip them unless they are wanted.
  figma.skipInvisibleInstanceChildren = !preferences.includeHidden;
  const roots = preferences.scope === "page" ? [figma.currentPage] : figma.currentPage.selection;
  return scanScope(preferences.scope, roots, preferences);
}

function postPage(): void {
  figma.ui.postMessage({ type: "page", name: figma.currentPage.name });
}

async function sendSummary(): Promise<void> {
  const request = ++scanRequest;
  try {
    const view = summaryView(await scanCurrentScope());
    if (request === scanRequest) figma.ui.postMessage({ type: "summary", view });
  } catch (error) {
    if (request === scanRequest) figma.ui.postMessage({ type: "summary-error", view: errorView(describeError(error)) });
  }
}

const refreshSoon = debounce(() => void sendSummary(), 120);

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runOptions(): RunOptions {
  return {
    scrambleNumbers: preferences.scrambleNumbers,
    loadFont: (font) => figma.loadFontAsync(font),
  };
}

async function scramble(): Promise<void> {
  if (isScrambling || isClosing) return;
  isScrambling = true;
  refreshSoon.cancel();
  wrappedLayers = [];
  figma.ui.postMessage({ type: "working" });

  try {
    const scan = await scanCurrentScope();
    if (scan.eligible.length === 0) {
      const view = summaryView(scan);
      figma.notify(view.headline, { error: true });
      figma.ui.postMessage({ type: "summary", view });
      figma.ui.postMessage({ type: "idle" });
      return;
    }

    const selectionBefore = [...figma.currentPage.selection];
    const report = await scrambleLayers(scan.eligible, runOptions());
    const view = resultView(report, scan);

    if (report.layers > 0) {
      // Clearing and restoring the selection makes Figma refresh its properties panel.
      figma.currentPage.selection = [];
      figma.currentPage.selection = selectionBefore;
      figma.commitUndo();
    }

    wrappedLayers = report.wrapped;
    figma.notify(view.toast, { error: report.layers === 0 });
    figma.ui.postMessage({ type: "result", view });
    if (view.closeAutomatically) {
      isClosing = true;
      setTimeout(() => figma.closePlugin(), 1100);
    }
  } catch (error) {
    const view = errorView(describeError(error));
    figma.notify(view.headline, { error: true });
    figma.ui.postMessage({ type: "result", view: { ...view, problems: [], canSelectWrapped: false, closeAutomatically: false } });
  } finally {
    isScrambling = false;
  }
}

function selectWrapped(): void {
  const layers = wrappedLayers.filter((layer) => !("removed" in layer && layer.removed));
  if (layers.length === 0) return;
  figma.currentPage.selection = layers as unknown as SceneNode[];
  figma.viewport.scrollAndZoomIntoView(layers as unknown as SceneNode[]);
}

type UiMessage =
  | { type: "ready" }
  | { type: "preferences"; preferences: unknown }
  | { type: "scramble" }
  | { type: "select-wrapped" }
  | { type: "resize"; height: number }
  | { type: "close" };

figma.ui.onmessage = async (message: UiMessage) => {
  switch (message.type) {
    case "ready": {
      preferences = readPreferences(await figma.clientStorage.getAsync(STORAGE_KEY));
      figma.ui.postMessage({ type: "preferences", preferences });
      postPage();
      await sendSummary();
      return;
    }
    case "preferences": {
      const next = readPreferences(message.preferences);
      const rescan =
        next.scope !== preferences.scope ||
        next.scrambleNumbers !== preferences.scrambleNumbers ||
        next.includeHidden !== preferences.includeHidden;
      preferences = next;
      await figma.clientStorage.setAsync(STORAGE_KEY, preferences);
      if (rescan && !isScrambling) await sendSummary();
      return;
    }
    case "scramble":
      await scramble();
      return;
    case "select-wrapped":
      selectWrapped();
      return;
    case "resize": {
      const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Number(message.height) || 0)));
      figma.ui.resize(WIDTH, height);
      return;
    }
    case "close":
      figma.closePlugin();
      return;
  }
};

figma.on("selectionchange", () => {
  if (!isScrambling && preferences.scope === "selection") refreshSoon();
});

figma.on("currentpagechange", () => {
  postPage();
  if (!isScrambling) refreshSoon();
});
