import { buildReplacementRuns } from "../../../packages/core/src/replacement-runs";
import { hasScramblableText, scrambleTexts, type RandomSource } from "../../../packages/core/src/scramble-text";
import type { FontNameLike, TextLayer } from "./scope";

export interface RunOptions {
  scrambleNumbers: boolean;
  random?: RandomSource;
  loadFont(font: FontNameLike): Promise<void>;
}

export interface LayerProblem {
  id: string;
  name: string;
  reason: string;
}

export interface RunReport {
  layers: number;
  characters: number;
  // Instance text that changed on its own because its main component was scrambled first.
  inherited: number;
  renamed: number;
  failed: LayerProblem[];
  // Fixed-width text that now wraps onto more lines.
  wrapped: TextLayer[];
}

function fontKey(font: FontNameLike): string {
  return `${font.family}\u0000${font.style}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function replaceCharactersPreservingStyles(layer: TextLayer, output: string): number {
  const runs = buildReplacementRuns(layer.characters, output);
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index];
    layer.insertCharacters(run.start, run.replacement, "AFTER");
    layer.deleteCharacters(run.start + run.replacement.length, run.end + run.replacement.length);
  }
  return runs.length;
}

// A layer name that mirrors its text would keep the original copy in the Layers panel.
function nameFollowsText(layer: TextLayer, text: string): boolean {
  return (layer.autoRename || layer.name === text) && hasScramblableText(layer.name);
}

export async function scrambleLayers(layers: readonly TextLayer[], options: RunOptions): Promise<RunReport> {
  const originals = layers.map((layer) => layer.characters);
  const heights = layers.map((layer) => layer.height);
  const names = layers.map((layer) => layer.name);
  const autoRenames = layers.map((layer) => layer.autoRename);
  const renameIndexes = layers.flatMap((layer, index) => (nameFollowsText(layer, originals[index]) ? [index] : []));

  // One call for every layer and every mirrored name shares one word cache, so a word becomes the
  // same invented word everywhere in this run. Names go last so they never change the text output.
  const outputs = scrambleTexts([...originals, ...renameIndexes.map((index) => names[index])], {
    scrambleNumbers: options.scrambleNumbers,
    random: options.random,
  });
  const renamedTo = new Map(renameIndexes.map((layerIndex, position) => [layerIndex, outputs[layers.length + position]]));

  const fontsByLayer = layers.map((layer, index) => {
    try {
      return layer.getRangeAllFontNames(0, originals[index].length);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  });
  const uniqueFonts = new Map<string, FontNameLike>();
  for (const fonts of fontsByLayer) {
    if (Array.isArray(fonts)) fonts.forEach((font) => uniqueFonts.set(fontKey(font), font));
  }
  const unavailableFonts = new Set<string>();
  await Promise.all(
    Array.from(uniqueFonts, async ([key, font]) => {
      try {
        await options.loadFont(font);
      } catch {
        unavailableFonts.add(key);
      }
    }),
  );

  const report: RunReport = { layers: 0, characters: 0, inherited: 0, renamed: 0, failed: [], wrapped: [] };
  const changed: number[] = [];

  layers.forEach((layer, index) => {
    try {
      const fonts = fontsByLayer[index];
      if (fonts instanceof Error) throw fonts;
      const unavailable = fonts.find((font) => unavailableFonts.has(fontKey(font)));
      if (unavailable) throw new Error(`The font “${unavailable.family} ${unavailable.style}” didn’t load.`);

      if (layer.characters === originals[index]) {
        replaceCharactersPreservingStyles(layer, outputs[index]);
      } else {
        report.inherited++;
      }

      const newName = renamedTo.get(index);
      if (newName !== undefined && layer.name === names[index]) {
        layer.name = newName;
        if (autoRenames[index]) layer.autoRename = true;
        report.renamed++;
      }

      report.layers++;
      report.characters += Array.from(originals[index]).length;
      changed.push(index);
    } catch (error) {
      report.failed.push({ id: layer.id, name: layer.name, reason: describeError(error) });
    }
  });

  // Measured after every write, because scrambling a main component also reflows its instances.
  for (const index of changed) {
    const layer = layers[index];
    if (layer.textAutoResize === "HEIGHT" && layer.height > heights[index] + 0.5) report.wrapped.push(layer);
  }

  return report;
}
