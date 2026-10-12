// One Text Scramble run: collect, scramble with one shared word cache, write back character by
// character inside one undo step, then report what changed, what was skipped and what now overflows.
//
// The InDesign objects come in through `host`, so the whole run can be tested with fake documents.

import { buildReplacementRuns } from "../../../packages/core/src/replacement-runs";
import { createScrambler, createWordMatcher, hasScramblableText } from "../../../packages/core/src/scramble-text";
import { cleanDocument, documentNames, type CleanupReport } from "./cleanup";
import {
  activeDocument,
  codePoints,
  collectTargets,
  collectionItems,
  constructorName,
  type Scope,
  type SkipCounts,
  type TargetKind,
  type TextTarget,
} from "./collect";
import { keepPlan, scrambleSegments, type KeepRules } from "./keep-readable";
import { overflowReport, snapshotOverflow, type OverflowReport } from "./overflow";

export type { Scope } from "./collect";

export interface InDesignHost {
  app: any;
  ScriptLanguage: any;
  UndoModes: any;
  VariableTypes?: any;
}

export interface RunOptions extends KeepRules {
  scope: Scope;
  scrambleNumbers?: boolean;
  includeLocked?: boolean;
  includeHidden?: boolean;
  /** Point links at example.com, give links neutral names and clear the document info. */
  cleanup?: boolean;
  /** The same seed gives the same invented words every time, in every app. Empty means random. */
  seed?: number | string;
}

export type EmptyReason = "no-document" | "empty-selection" | "nothing-to-scramble" | "all-skipped" | "all-kept";

export type KindCounts = Record<TargetKind, number>;

export interface ScrambleReport {
  scope: Scope;
  /** Text flows that changed: frames, stories, overset passages, cells, footnotes, paths. */
  changed: number;
  characters: number;
  kinds: KindCounts;
  parentPages: number;
  /** Bookmarks, text anchors and custom text variables scrambled in a Whole document run. */
  names: number;
  skipped: SkipCounts;
  keptParagraphs: number;
  overflow: OverflowReport;
  cleanup: CleanupReport | null;
  errors: string[];
  notes: string[];
  empty: EmptyReason | null;
}

export interface ScopeSummary {
  scope: Scope;
  targets: number;
  characters: number;
  kinds: KindCounts;
  skipped: SkipCounts;
  empty: EmptyReason | null;
}

export const UNDO_NAME = "Text Scramble";

function read<T>(read: () => T, fallback: T): T {
  try {
    const value = read();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function emptyKinds(): KindCounts {
  return { selection: 0, frame: 0, story: 0, overset: 0, cell: 0, footnote: 0, path: 0 };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyReason(app: any, options: RunOptions, targets: number, skipped: SkipCounts): EmptyReason | null {
  if (targets) return null;
  if (!activeDocument(app)) return "no-document";
  if (options.scope === "selection" && !read(() => Number(app.selection.length), 0)) return "empty-selection";
  if (skipped.locked + skipped.hidden > 0) return "all-skipped";
  return "nothing-to-scramble";
}

/** InDesign counts characters by code point. Text that does not line up is left alone. */
function linesUp(target: TextTarget): boolean {
  const total = read(() => Number(target.text.characters.length), Number.NaN);
  return total === target.offset + codePoints(target.source).length;
}

function prepare(app: any, options: RunOptions) {
  const collection = collectTargets(app, options);
  const scrambleNumbers = options.scrambleNumbers !== false;
  const targets = collection.targets.filter((target) => hasScramblableText(target.source, { scrambleNumbers }));
  return { collection, targets, scrambleNumbers };
}

export function inspectScope(host: InDesignHost, options: RunOptions): ScopeSummary {
  const { collection, targets } = prepare(host.app, options);
  const kinds = emptyKinds();
  targets.forEach((target) => kinds[target.kind]++);
  return {
    scope: options.scope,
    targets: targets.length,
    characters: targets.reduce((total, target) => total + codePoints(target.source).length, 0),
    kinds,
    skipped: { ...collection.skipped },
    empty: emptyReason(host.app, options, targets.length, collection.skipped),
  };
}

function unlockKey(item: any, index: number): string {
  return read(() => String(item.toSpecifier()), "") || `${constructorName(item)}-${read(() => item.id, index)}`;
}

/** Unlocks layers first, then groups and frames. Returns a function that locks them again. */
function unlockAll(items: readonly any[]): () => void {
  const unique = new Map<string, any>();
  items.forEach((item, index) => unique.set(unlockKey(item, index), item));
  const ordered = Array.from(unique.values()).sort(
    (a, b) => Number(constructorName(b) === "Layer") - Number(constructorName(a) === "Layer"),
  );
  const unlocked: any[] = [];
  for (const item of ordered) {
    try {
      if (item.locked === true) {
        item.locked = false;
        unlocked.push(item);
      }
    } catch {
      // If it cannot be unlocked, the edit below reports the problem for that text.
    }
  }
  return () => {
    for (let index = unlocked.length - 1; index >= 0; index--) {
      try {
        unlocked[index].locked = true;
      } catch {
        // Keep going: every other item should still be locked again.
      }
    }
  };
}

function replaceTarget(target: TextTarget, output: string): void {
  const runs = buildReplacementRuns(target.source, output);
  const characters = target.text.characters;
  const edits = runs.map((run) => {
    const index = target.offset + run.characterIndex;
    const character = typeof characters.item === "function" ? characters.item(index) : characters[index];
    if (!character || character.isValid === false) throw new Error(`Cannot edit character ${index + 1}.`);
    return { character, replacement: run.replacement };
  });
  for (let index = edits.length - 1; index >= 0; index--) {
    edits[index].character.contents = edits[index].replacement;
  }
}

export function runScramble(host: InDesignHost, options: RunOptions): ScrambleReport {
  const { app } = host;
  const document = activeDocument(app);
  const { collection, targets: candidates, scrambleNumbers } = prepare(app, options);
  const report: ScrambleReport = {
    scope: options.scope,
    changed: 0,
    characters: 0,
    kinds: emptyKinds(),
    parentPages: 0,
    names: 0,
    skipped: { ...collection.skipped },
    keptParagraphs: 0,
    overflow: { overflowing: [], alreadyOverflowing: 0 },
    cleanup: null,
    errors: [],
    notes: [...collection.notes],
    empty: null,
  };

  const targets = candidates.filter((target) => {
    if (linesUp(target)) return true;
    report.skipped.unreadable++;
    report.notes.push("Some text with special characters could not be lined up safely, so it was left as it is.");
    return false;
  });

  const names = options.scope === "document" && document
    ? documentNames(document, host.VariableTypes?.CUSTOM_TEXT_TYPE).filter((name) => hasScramblableText(name.source, { scrambleNumbers }))
    : [];
  // One scrambler per run: a word becomes the same invented word in every frame, cell and note.
  const scrambler = createScrambler({ scrambleNumbers, seed: options.seed });
  const listed = createWordMatcher(options.alwaysScramble ?? []);
  const scramble = (text: string, keep: boolean) => (keep ? scrambler.scramble(text, listed) : scrambler.scramble(text));

  const writes: Array<{ target: TextTarget; output: string }> = [];
  targets.forEach((target) => {
    let plan = keepPlan(target.text, target.offset, target.source, options);
    if (plan === null) {
      report.notes.push("Some paragraphs could not be matched to their styles, so they were scrambled in full.");
      plan = { segments: [{ start: 0, end: codePoints(target.source).length, keep: false }], keptParagraphs: 0 };
    }
    report.keptParagraphs += plan.keptParagraphs;
    const output = scrambleSegments(target.source, plan, scramble);
    if (output !== target.source) writes.push({ target, output });
  });
  // Bookmarks and anchors usually repeat headings, so they follow the "keep readable" rule: with kept
  // styles, only listed words change in them. Text variables always scramble in full.
  const keepNames = (options.keepStyles ?? []).length > 0;
  const nameOutputs = names.map((name) => scramble(name.source, keepNames && name.kind !== "variable"));

  report.empty = emptyReason(app, options, writes.length + names.length, report.skipped);
  if (report.empty === "nothing-to-scramble" && targets.length && report.keptParagraphs) report.empty = "all-kept";
  if (!document || (!writes.length && !names.length && !options.cleanup)) {
    report.notes = Array.from(new Set(report.notes));
    return report;
  }

  const containersBefore = snapshotOverflow(collection.containers);
  const cellsBefore = snapshotOverflow(collection.cells);

  const apply = () => {
    const relock = unlockAll(writes.flatMap(({ target }) => target.unlock));
    try {
      for (const { target, output } of writes) {
        try {
          replaceTarget(target, output);
          report.changed++;
          report.characters += codePoints(target.source).length;
          report.kinds[target.kind]++;
          if (target.onParentPage) report.parentPages++;
        } catch (error) {
          report.errors.push(message(error));
        }
      }
      names.forEach((name, index) => {
        try {
          name.apply(nameOutputs[index]);
          report.names++;
        } catch (error) {
          report.errors.push(message(error));
        }
      });
      if (options.cleanup) report.cleanup = cleanDocument(document);
      collection.stories.forEach((story) => {
        try {
          story.recompose();
        } catch {
          // Recomposing only makes the overflow report exact; InDesign recomposes on its own anyway.
        }
      });
    } finally {
      relock();
    }
  };

  app.doScript(apply, host.ScriptLanguage.UXPSCRIPT, [], host.UndoModes.ENTIRE_SCRIPT, UNDO_NAME);

  report.overflow = overflowReport(collection.containers, containersBefore, collection.cells, cellsBefore);
  report.errors = Array.from(new Set(report.errors));
  report.notes = Array.from(new Set(report.notes));
  report.empty = report.changed || report.names || report.cleanup ? null : report.empty;
  return report;
}

/** Unique paragraph style names in the active document, for the "keep readable" list. */
export function paragraphStyleNames(host: InDesignHost): string[] {
  const document = activeDocument(host.app);
  if (!document) return [];
  const names = collectionItems(read(() => document.allParagraphStyles, null))
    .map((style) => read(() => String(style.name), ""))
    .filter((name) => name.length > 0);
  return Array.from(new Set(names));
}

/** Brings a frame or cell from the last report into view and selects it. Changes nothing in the file. */
export function revealItem(host: InDesignHost, item: any): boolean {
  try {
    const frame = constructorName(item) === "Cell" ? item.parent.storyOffset.parentTextFrames[0] : item;
    const page = read(() => (constructorName(frame) === "TextPath" ? frame.parent.parentPage : frame.parentPage), null);
    if (page) host.app.activeWindow.activePage = page;
    host.app.select(constructorName(item) === "Cell" ? item : frame);
    return true;
  } catch {
    return false;
  }
}
