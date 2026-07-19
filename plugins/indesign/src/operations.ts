import { buildReplacementRuns } from "../../../packages/core/src/replacement-runs";
import { hasScramblableText, scrambleTexts } from "../../../packages/core/src/scramble-text";

declare const require: (module: string) => any;

const { app, ScriptLanguage, UndoModes } = require("indesign");

export type Scope = "selection" | "page";

export interface ScrambleResult {
  targets: number;
  characters: number;
  skipped: number;
  errors: string[];
}

const TEXT_TYPES = new Set([
  "Text",
  "Character",
  "Word",
  "Line",
  "Paragraph",
  "TextColumn",
  "TextStyleRange",
  "Cell",
  "Story",
]);

function constructorName(item: any): string {
  return item?.constructorName || item?.constructor?.name || "Unknown";
}

function collectionItems(collection: any): any[] {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  const items: any[] = [];
  for (let index = 0; index < Number(collection.length || 0); index++) {
    try {
      const item = typeof collection.item === "function" ? collection.item(index) : collection[index];
      if (item && item.isValid !== false) items.push(item);
    } catch {
      // InDesign collections can contain unresolved objects. Ignore only that object.
    }
  }
  return items;
}

function isEditablePageItem(item: any): boolean {
  try {
    if (item.locked === true || item.visible === false) return false;
    if (item.itemLayer && (item.itemLayer.locked === true || item.itemLayer.visible === false)) return false;
  } catch {
    return false;
  }
  return true;
}

function frameText(frame: any): any | null {
  if (!isEditablePageItem(frame)) return null;
  try {
    const text = frame.texts?.item(0);
    return text?.isValid === false ? null : text;
  } catch {
    return null;
  }
}

function collectFromItem(item: any): any[] {
  const type = constructorName(item);
  if (type === "InsertionPoint") return [];
  if (type === "TextFrame" || type === "EndnoteTextFrame") {
    const text = frameText(item);
    return text ? [text] : [];
  }
  if (TEXT_TYPES.has(type) && item?.characters) return [item];

  const pageItems = collectionItems(item?.allPageItems || item?.pageItems);
  return pageItems.flatMap((pageItem) => {
    const pageItemType = constructorName(pageItem);
    if (pageItemType !== "TextFrame" && pageItemType !== "EndnoteTextFrame") return [];
    const text = frameText(pageItem);
    return text ? [text] : [];
  });
}

function activePage(): any | null {
  try {
    return app.activeWindow?.activePage || app.layoutWindows?.item(0)?.activePage || null;
  } catch {
    return null;
  }
}

function collectTargets(scope: Scope, scrambleNumbers: boolean): any[] {
  if (!app.documents || app.documents.length === 0) return [];
  const candidates = scope === "selection"
    ? Array.from(app.selection || []).flatMap(collectFromItem)
    : collectFromItem(activePage());
  const unique = new Map<string, any>();

  candidates.forEach((target) => {
    try {
      const key = typeof target.toSpecifier === "function" ? target.toSpecifier() : String(target.id ?? unique.size);
      unique.set(key, target);
    } catch {
      unique.set(`target-${unique.size}`, target);
    }
  });

  return Array.from(unique.values()).filter((target) => {
    try {
      return target.isValid !== false && typeof target.contents === "string" && hasScramblableText(target.contents, { scrambleNumbers });
    } catch {
      return false;
    }
  });
}

function replaceTargetPreservingStyles(target: any, source: string, output: string): void {
  const runs = buildReplacementRuns(source, output);
  const characters = target.characters;
  const edits = runs.map((run) => {
    const character = typeof characters.item === "function" ? characters.item(run.characterIndex) : characters[run.characterIndex];
    if (!character || character.isValid === false) throw new Error(`Cannot edit character ${run.characterIndex + 1}.`);
    return { character, replacement: run.replacement };
  });

  for (let index = edits.length - 1; index >= 0; index--) {
    edits[index].character.contents = edits[index].replacement;
  }
}

export function scrambleDocument(scope: Scope, scrambleNumbers: boolean): ScrambleResult {
  const targets = collectTargets(scope, scrambleNumbers);
  const sources = targets.map((target) => String(target.contents));
  const outputs = scrambleTexts(sources, { scrambleNumbers });
  const result: ScrambleResult = { targets: 0, characters: 0, skipped: 0, errors: [] };

  const apply = () => {
    targets.forEach((target, index) => {
      try {
        replaceTargetPreservingStyles(target, sources[index], outputs[index]);
        result.targets++;
        result.characters += Array.from(sources[index]).length;
      } catch (error) {
        result.skipped++;
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    });
  };

  if (targets.length) {
    app.doScript(apply, ScriptLanguage.UXPSCRIPT, [], UndoModes.ENTIRE_SCRIPT, "Text Scramble");
  }
  return result;
}

export function inspectScope(scope: Scope, scrambleNumbers = true): { targets: number; characters: number } {
  const targets = collectTargets(scope, scrambleNumbers);
  return {
    targets: targets.length,
    characters: targets.reduce((total, target) => total + Array.from(String(target.contents)).length, 0),
  };
}

export { app };
