// Plain-language copy for the panel and the Scripts panel dialog: what a scope holds, what a run
// changed, what it skipped and why, and what to do when there was nothing to change.
//
// Pure functions with no DOM and no InDesign calls, so both UIs say exactly the same thing and the
// wording is covered by tests.

import type { CleanupReport } from "./cleanup";
import type { SkipCounts, TargetKind } from "./collect";
import { summarizePlaces, type OverflowItem } from "./overflow";
import type { EmptyReason, KindCounts, RunOptions, Scope, ScopeSummary, ScrambleReport } from "./run";

/** The three scopes, in the order both UIs show them. */
export const SCOPES: ReadonlyArray<{ scope: Scope; title: string; copy: string }> = [
  { scope: "selection", title: "Selection", copy: "Text, frames or table cells" },
  { scope: "page", title: "Page", copy: "Every frame on this page, overset text included" },
  { scope: "document", title: "Document", copy: "Every story, table, footnote and parent page" },
];

export const UNDO_HINT = "Edit > Undo Text Scramble puts it all back in one step.";

const KIND_NAMES: ReadonlyArray<[TargetKind, string, string]> = [
  ["selection", "text selection", "text selections"],
  ["frame", "frame", "frames"],
  ["story", "story", "stories"],
  ["path", "text path", "text paths"],
  ["overset", "overset passage", "overset passages"],
  ["cell", "table cell", "table cells"],
  ["footnote", "footnote", "footnotes"],
];

const MAX_ERRORS = 5;

/** 1240 → "1,240". Written out so every runtime groups digits the same way. */
export function formatNumber(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rounded < 0 ? `-${digits}` : digits;
}

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

/** ["a", "b", "c"] → "a, b and c". */
export function joinList(parts: readonly string[]): string {
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return text.trim() || "Unknown error";
}

/** "6 frames and 12 table cells" */
export function describeKinds(kinds: Partial<KindCounts>): string {
  const parts = KIND_NAMES.filter(([kind]) => (kinds[kind] ?? 0) > 0).map(([kind, singular, plural]) =>
    count(kinds[kind] ?? 0, singular, plural),
  );
  return parts.length ? joinList(parts) : "no text";
}

export interface EmptyContext {
  scope?: Scope;
  skipped?: Partial<SkipCounts>;
  scrambleNumbers?: boolean;
  /** The Scramble Selection menu command has no scope to switch to. */
  fromMenu?: boolean;
}

/** What the report text needs to know about the run's options. */
export type ReportOptions = Pick<RunOptions, "includeLocked" | "scrambleNumbers"> & { fromMenu?: boolean };

/** A friendly message for each reason a scope or a run had nothing to change. */
export function emptyMessage(reason: EmptyReason, context: EmptyContext = {}): string {
  const skipped = context.skipped ?? {};
  switch (reason) {
    case "no-document":
      return "Open a document to begin.";
    case "empty-selection":
      return context.fromMenu ? "Select text, frames or table cells first." : "Select text, frames or table cells — or switch to Page or Document.";
    case "all-skipped": {
      const hidden = (skipped.hidden ?? 0) > 0;
      const locked = (skipped.locked ?? 0) > 0;
      if (hidden && locked) return "Everything here is hidden or locked. Turn on Include hidden items or Include locked items to scramble it.";
      if (hidden) return "Everything here is hidden. Turn on Include hidden items to scramble it.";
      if (locked) return "Everything here is locked. Turn on Include locked items to scramble it.";
      return "Everything here was skipped. Try Include hidden items or Include locked items.";
    }
    case "all-kept":
      return "Every paragraph here is in a style you keep readable, so nothing changed. Untick a style under Keep readable to scramble it.";
    case "nothing-to-scramble":
    default: {
      if ((skipped.unreadable ?? 0) > 0) return "The text here couldn't be lined up safely, so it was left as it is.";
      const where =
        context.scope === "page"
          ? "There's no text to scramble on this page."
          : context.scope === "document"
            ? "This document has no text to scramble yet."
            : context.scope === "selection"
              ? "There's no text to scramble in the selection."
              : "There's no text to scramble here.";
      return context.scrambleNumbers === false ? `${where} Numbers stay as they are while Scramble numbers is off.` : where;
    }
  }
}

/** One line for the live summary: "1,240 characters in 6 frames and 12 table cells". */
export function describeScope(summary: ScopeSummary, options: Pick<RunOptions, "scrambleNumbers"> = {}): string {
  if (summary.empty) {
    return emptyMessage(summary.empty, { scope: summary.scope, skipped: summary.skipped, scrambleNumbers: options.scrambleNumbers });
  }
  return `${count(summary.characters, "character")} in ${describeKinds(summary.kinds)}`;
}

/** What the live summary will leave alone: "2 hidden frames will be skipped". */
export function describeScopeSkips(summary: ScopeSummary): string[] {
  const lines: string[] = [];
  const { hidden, locked, unreadable } = summary.skipped;
  if (hidden > 0) lines.push(`${count(hidden, "hidden frame")} will be skipped`);
  if (locked > 0) lines.push(`${count(locked, "locked frame")} will be skipped`);
  if (unreadable > 0) lines.push(`${count(unreadable, "passage")} will be left alone (couldn't be lined up safely)`);
  return lines;
}

/** "5 links now point at example.com; title and author cleared." */
export function describeCleanup(cleanup: CleanupReport): string {
  const parts: string[] = [];
  if (cleanup.links > 0) parts.push(`${count(cleanup.links, "link")} now ${cleanup.links === 1 ? "points" : "point"} at example.com`);
  if (cleanup.documentInfo) parts.push("title and author cleared");
  if (!parts.length) return "No links or document info needed cleaning.";
  return sentence(capitalize(parts.join("; ")));
}

/** "Frame on page 4", "Cell in table on page 9", "Frame on the pasteboard". */
export function overflowItemLabel(item: Pick<OverflowItem, "kind" | "label">): string {
  const label = item.label || (item.kind === "cell" ? "table" : "pasteboard");
  if (item.kind === "cell") return label === "table" ? "Cell in a table" : `Cell in ${label}`;
  return label === "pasteboard" ? "Frame on the pasteboard" : `Frame on ${label}`;
}

export interface OverflowSummary {
  /** "3 frames now overflow: page 4, page 7 (2)" */
  headline: string;
  /** "Tighten tracking or edit them before exporting." */
  advice: string;
  /** "2 more already overflowed before this run." or null. */
  earlier: string | null;
  items: OverflowItem[];
}

export function describeOverflow(overflow: ScrambleReport["overflow"]): OverflowSummary | null {
  const items = overflow.overflowing;
  if (!items.length) return null;
  const frames = items.filter((item) => item.kind !== "cell").length;
  const cells = items.length - frames;
  const what = !cells
    ? count(frames, "frame")
    : !frames
      ? count(cells, "table cell")
      : `${count(frames, "frame")} and ${count(cells, "table cell")}`;
  const verb = items.length === 1 ? "now overflows" : "now overflow";
  return {
    headline: `${what} ${verb}: ${summarizePlaces(items)}`,
    advice: `Tighten tracking or edit ${items.length === 1 ? "it" : "them"} before exporting.`,
    earlier: overflow.alreadyOverflowing > 0 ? `${formatNumber(overflow.alreadyOverflowing)} more already overflowed before this run.` : null,
    items: [...items],
  };
}

export type ReportTone = "success" | "warning" | "error" | "empty";

export interface RunSummary {
  tone: ReportTone;
  headline: string;
  /** Parent pages, names, kept paragraphs and cleanup. */
  details: string[];
  /** What was left alone, with the reason in a few words. */
  skipped: string[];
  overflow: OverflowSummary | null;
  errors: string[];
  notes: string[];
  /** How to undo the run, when it changed something. Shown last. */
  undo: string | null;
}

function skippedLines(skipped: SkipCounts, options: Pick<RunOptions, "includeLocked">): string[] {
  const lines: string[] = [];
  // Locked items are only skipped when Include locked items is off.
  if (skipped.locked > 0 && options.includeLocked !== true) {
    lines.push(`Skipped ${count(skipped.locked, "locked frame")}. Turn on Include locked items to scramble ${skipped.locked === 1 ? "it" : "them"}.`);
  }
  if (skipped.hidden > 0) lines.push(`Skipped ${count(skipped.hidden, "hidden frame")}: hidden items don't print, but stay in the file.`);
  if (skipped.unreadable > 0) {
    lines.push(`Left ${count(skipped.unreadable, "passage")} as ${skipped.unreadable === 1 ? "it was: it" : "they were: they"} couldn't be lined up safely.`);
  }
  return lines;
}

function errorLines(errors: readonly string[]): string[] {
  const unique = Array.from(new Set(errors.map((error) => sentence(error)).filter(Boolean)));
  const lines = unique.slice(0, MAX_ERRORS).map((error) => `Couldn't change some text: ${error}`);
  if (unique.length > MAX_ERRORS) lines.push(`…and ${count(unique.length - MAX_ERRORS, "more problem")}.`);
  return lines;
}

/** Everything a finished run has to say, grouped so the panel can lay it out. */
export function describeRun(report: ScrambleReport, options: ReportOptions = {}): RunSummary {
  const summary: RunSummary = {
    tone: "success",
    headline: "",
    details: [],
    skipped: skippedLines(report.skipped, options),
    overflow: describeOverflow(report.overflow),
    errors: errorLines(report.errors),
    notes: Array.from(new Set(report.notes.map((note) => sentence(note)).filter(Boolean))).filter(
      // The skipped line already says this, with a count.
      (note) => !(report.skipped.unreadable > 0 && /lined up safely, so it was left as it is/.test(note)),
    ),
    undo: null,
  };

  if (report.empty) {
    summary.tone = "empty";
    summary.headline = emptyMessage(report.empty, {
      scope: report.scope,
      skipped: report.skipped,
      scrambleNumbers: options.scrambleNumbers,
      fromMenu: options.fromMenu,
    });
    return summary;
  }

  const changedSomething = report.changed > 0 || report.names > 0 || report.cleanup !== null;
  if (!changedSomething) {
    summary.tone = "error";
    summary.headline = "Nothing changed: the text couldn't be edited.";
    return summary;
  }

  if (report.changed > 0) {
    summary.headline = `Done — ${count(report.characters, "character")} in ${describeKinds(report.kinds)}.`;
  } else if (report.names > 0) {
    summary.headline = `Done — ${count(report.names, "bookmark, anchor or text variable", "bookmarks, anchors and text variables")} scrambled.`;
  } else {
    summary.headline = "Done — links and document info cleaned.";
  }

  if (report.parentPages > 0) {
    summary.details.push(report.parentPages === 1 ? "Including 1 on a parent page." : `Including ${formatNumber(report.parentPages)} on parent pages.`);
  }
  if (report.names > 0 && report.changed > 0) {
    summary.details.push(
      report.names === 1
        ? "1 bookmark, anchor or text variable follows the new words."
        : `${formatNumber(report.names)} bookmarks, anchors and text variables follow the new words.`,
    );
  }
  if (report.keptParagraphs > 0) summary.details.push(`${count(report.keptParagraphs, "paragraph")} kept readable.`);
  if (report.cleanup) summary.details.push(describeCleanup(report.cleanup));
  if (!summary.overflow && report.overflow.alreadyOverflowing > 0) {
    const already = report.overflow.alreadyOverflowing;
    summary.details.push(`${count(already, "frame or cell", "frames or cells")} already overflowed before this run.`);
  }
  summary.undo = UNDO_HINT;

  if (summary.errors.length) summary.tone = "warning";
  return summary;
}

/** The run summary as plain lines, in reading order, for a message dialog. */
export function runSummaryLines(report: ScrambleReport, options: ReportOptions = {}): string[] {
  const summary = describeRun(report, options);
  const lines = [summary.headline, ...summary.details, ...summary.skipped];
  if (summary.overflow) {
    lines.push(`${summary.overflow.headline}. ${summary.overflow.advice}`);
    if (summary.overflow.earlier) lines.push(summary.overflow.earlier);
  }
  lines.push(...summary.errors, ...summary.notes);
  if (summary.undo) lines.push(summary.undo);
  return lines;
}

/** Something threw: say what, and how to get back. */
export function errorMessage(error: unknown): string {
  return `Something went wrong: ${sentence(messageOf(error))} If anything changed, Edit > Undo Text Scramble puts it back.`;
}

/** The live summary could not be read. The run itself may still work. */
export function inspectErrorMessage(error: unknown): string {
  return `Couldn't read the text just now: ${sentence(messageOf(error))}`;
}

/** Style names the person typed that the document does not have. */
export function unknownStylesNote(names: readonly string[]): string | null {
  if (!names.length) return null;
  const quoted = joinList(names.map((name) => `“${name}”`));
  return names.length === 1
    ? `There's no paragraph style called ${quoted}, so nothing was kept readable for it.`
    : `There are no paragraph styles called ${quoted}, so nothing was kept readable for them.`;
}

/** Splits a long line at spaces so a dialog's static text stays a readable width. */
export function wrapText(text: string, width = 72): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
