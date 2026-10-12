import type { RunReport } from "./run";
import type { ScanResult, Scope, SkipCounts } from "./scope";

// Everything the panel and Figma's toasts say lives here, so the wording can be tested without Figma.

export interface Preferences {
  scope: Scope;
  scrambleNumbers: boolean;
  includeHidden: boolean;
  seed: string;
}

export const DEFAULT_PREFERENCES: Preferences = { scope: "selection", scrambleNumbers: true, includeHidden: false, seed: "" };
export const SEED_MAX_LENGTH = 40;

// Stored preferences come back from Figma's client storage, so check every field.
export function readPreferences(stored: unknown): Preferences {
  const value = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  return {
    scope: value.scope === "page" ? "page" : "selection",
    scrambleNumbers: value.scrambleNumbers !== false,
    includeHidden: value.includeHidden === true,
    seed: typeof value.seed === "string" ? value.seed.trim().slice(0, SEED_MAX_LENGTH) : "",
  };
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function skippedParts(skipped: SkipCounts): string[] {
  const parts: string[] = [];
  if (skipped.hidden) parts.push(`${skipped.hidden.toLocaleString("en-US")} hidden`);
  if (skipped.missingFont) parts.push(`${skipped.missingFont.toLocaleString("en-US")} with missing fonts`);
  return parts;
}

export type Tone = "neutral" | "ready" | "warning" | "error" | "success";

export interface SummaryView {
  tone: Tone;
  headline: string;
  count: string;
  details: string[];
  canScramble: boolean;
}

function skippedTotal(skipped: SkipCounts): number {
  return skipped.hidden + skipped.missingFont;
}

function skipHints(scan: ScanResult): string[] {
  const hints: string[] = [];
  if (scan.skipped.hidden) hints.push("Turn on Include hidden layers to change those too.");
  if (scan.skipped.missingFont) hints.push("Text with missing fonts can’t be edited. Install the fonts, then run it again.");
  if (scan.numbersOnly) {
    hints.push(`${plural(scan.numbersOnly, "layer")} only ${scan.numbersOnly === 1 ? "has" : "have"} numbers. Turn on Scramble numbers to change them.`);
  }
  return hints;
}

export function summaryView(scan: ScanResult): SummaryView {
  const place = scan.scope === "page" ? "on this page" : "in your selection";

  if (scan.scope === "selection" && scan.roots === 0) {
    return {
      tone: "neutral",
      headline: "Select layers to scramble",
      count: "—",
      details: ["Pick text, frames, groups or instances. Or switch to This page."],
      canScramble: false,
    };
  }

  if (scan.textLayers === 0) {
    // While hidden layers are skipped, Figma doesn't even list hidden text inside instances.
    const hiddenHint = scan.includeHidden ? [] : ["Hidden text isn’t counted. Turn on Include hidden layers to look for it."];
    return {
      tone: "neutral",
      headline: scan.includeHidden ? `No text ${place}` : `No visible text ${place}`,
      count: "0 layers",
      details: [...(scan.scope === "selection" ? ["Select layers that contain text."] : []), ...hiddenHint],
      canScramble: false,
    };
  }

  if (scan.eligible.length === 0) {
    const skipped = skippedTotal(scan.skipped);
    return {
      tone: "warning",
      headline: skipped === scan.textLayers ? `All ${plural(scan.textLayers, "text layer")} skipped` : "Nothing here to change",
      count: "0 layers",
      details: [
        ...(skipped ? [`Skipped: ${joinList(skippedParts(scan.skipped))}.`] : []),
        ...(skipped || scan.numbersOnly ? skipHints(scan) : ["Only symbols and spaces here."]),
      ],
      canScramble: false,
    };
  }

  const details: string[] = [];
  const parts = skippedParts(scan.skipped);
  if (parts.length) details.push(`Skipping ${joinList(parts)}.`);
  if (scan.locked) {
    details.push(`Includes ${plural(scan.locked, "locked layer")}. Locked text still shows in exports.`);
  }
  if (scan.inMainComponents) {
    details.push(
      scan.inMainComponents === 1
        ? "1 layer is in a main component, so its instances change too, even on other pages."
        : `${plural(scan.inMainComponents, "layer")} are in main components, so their instances change too, even on other pages.`,
    );
  }

  return {
    tone: "ready",
    headline: `${plural(scan.characters, "character")} ready`,
    count: plural(scan.eligible.length, "layer"),
    details,
    canScramble: true,
  };
}

export interface ResultView {
  tone: Tone;
  headline: string;
  details: string[];
  problems: string[];
  toast: string;
  canSelectWrapped: boolean;
  // Close on our own only when there is nothing left to read or act on.
  closeAutomatically: boolean;
}

const MAX_LISTED = 4;

function listNames(names: readonly string[]): string[] {
  const listed = names.slice(0, MAX_LISTED);
  return names.length > MAX_LISTED ? [...listed, `and ${(names.length - MAX_LISTED).toLocaleString("en-US")} more`] : listed;
}

export function resultView(report: RunReport, scan: ScanResult): ResultView {
  const parts = skippedParts(scan.skipped);
  const skippedNote = parts.length ? ` · skipped ${joinList(parts)}` : "";

  if (report.layers === 0) {
    return {
      tone: "error",
      headline: report.failed.length === 1 ? "That layer couldn’t be changed" : "None of these layers could be changed",
      details: ["Nothing was changed."],
      problems: listNames(report.failed.map((problem) => `${problem.name}: ${problem.reason}`)),
      toast: "Text Scramble couldn’t change any layers.",
      canSelectWrapped: false,
      closeAutomatically: false,
    };
  }

  const details = ["Undo brings it all back in one step."];
  if (parts.length) details.unshift(`Skipped ${joinList(parts)}.`);
  if (report.wrapped.length) {
    details.push(
      `${plural(report.wrapped.length, "layer")} now ${report.wrapped.length === 1 ? "wraps" : "wrap"} onto more lines. Check ${report.wrapped.length === 1 ? "it" : "them"} before you share.`,
    );
  }

  const problems = listNames(report.failed.map((problem) => `${problem.name}: ${problem.reason}`));
  if (problems.length) details.push(`${plural(report.failed.length, "layer")} couldn’t be changed:`);

  return {
    tone: report.failed.length || report.wrapped.length ? "warning" : "success",
    headline: `Scrambled ${plural(report.layers, "layer")} · ${plural(report.characters, "character")}`,
    details,
    problems,
    toast: `Scrambled ${plural(report.layers, "text layer")}${skippedNote}`,
    canSelectWrapped: report.wrapped.length > 0,
    closeAutomatically: report.failed.length === 0 && report.wrapped.length === 0,
  };
}

export function errorView(detail: string): { tone: Tone; headline: string; details: string[] } {
  return { tone: "error", headline: "Something went wrong", details: [detail, "If anything changed, Undo puts it back."] };
}

export function scanErrorView(detail: string): SummaryView {
  return { tone: "error", headline: "Couldn’t read the layers", count: "—", details: [detail], canScramble: false };
}
