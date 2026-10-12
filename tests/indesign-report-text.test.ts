import assert from "node:assert/strict";
import test from "node:test";
import type { OverflowItem } from "../plugins/indesign/src/overflow";
import {
  describeCleanup,
  describeKinds,
  describeOverflow,
  describeRun,
  describeScope,
  describeScopeSkips,
  emptyMessage,
  errorMessage,
  formatNumber,
  inspectErrorMessage,
  joinList,
  overflowItemLabel,
  runSummaryLines,
  SCOPES,
  UNDO_HINT,
  unknownStylesNote,
  wrapText,
} from "../plugins/indesign/src/report-text";
import { inspectScope, runScramble, type KindCounts, type ScopeSummary, type ScrambleReport } from "../plugins/indesign/src/run";
import { createInDesign, hostFor } from "./fakes/indesign";

function kinds(values: Partial<KindCounts> = {}): KindCounts {
  return { selection: 0, frame: 0, story: 0, overset: 0, cell: 0, footnote: 0, path: 0, ...values };
}

function summary(values: Partial<ScopeSummary> = {}): ScopeSummary {
  return {
    scope: "page",
    targets: 0,
    characters: 0,
    kinds: kinds(),
    skipped: { locked: 0, hidden: 0, unreadable: 0 },
    empty: null,
    ...values,
  };
}

function report(values: Partial<ScrambleReport> = {}): ScrambleReport {
  return {
    scope: "page",
    changed: 0,
    characters: 0,
    kinds: kinds(),
    parentPages: 0,
    names: 0,
    skipped: { locked: 0, hidden: 0, unreadable: 0 },
    keptParagraphs: 0,
    overflow: { overflowing: [], alreadyOverflowing: 0 },
    cleanup: null,
    errors: [],
    notes: [],
    empty: null,
    ...values,
  };
}

function overflowing(label: string, kind: OverflowItem["kind"] = "frame"): OverflowItem {
  return { label, kind, item: { label } };
}

test("groups digits the same way in every runtime", () => {
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(999), "999");
  assert.equal(formatNumber(1240), "1,240");
  assert.equal(formatNumber(1234567), "1,234,567");
  assert.equal(formatNumber(Number.NaN), "0");
});

test("joins lists the way the panel copy reads", () => {
  assert.equal(joinList([]), "");
  assert.equal(joinList(["frames"]), "frames");
  assert.equal(joinList(["frames", "cells"]), "frames and cells");
  assert.equal(joinList(["a", "b", "c"]), "a, b and c");
});

test("names each kind of text in designer terms, singular and plural", () => {
  assert.equal(describeKinds(kinds({ frame: 6, cell: 12 })), "6 frames and 12 table cells");
  assert.equal(describeKinds(kinds({ frame: 1 })), "1 frame");
  assert.equal(describeKinds(kinds({ story: 34, cell: 120, footnote: 6 })), "34 stories, 120 table cells and 6 footnotes");
  assert.equal(describeKinds(kinds({ selection: 1, overset: 2, path: 1 })), "1 text selection, 1 text path and 2 overset passages");
  assert.equal(describeKinds(kinds()), "no text");
});

test("summarizes a scope in one line, with what it will skip", () => {
  const ready = summary({ targets: 18, characters: 1240, kinds: kinds({ frame: 6, cell: 12 }), skipped: { locked: 0, hidden: 2, unreadable: 0 } });
  assert.equal(describeScope(ready), "1,240 characters in 6 frames and 12 table cells");
  assert.deepEqual(describeScopeSkips(ready), ["2 hidden frames will be skipped"]);

  const one = summary({ targets: 1, characters: 1, kinds: kinds({ selection: 1 }), skipped: { locked: 1, hidden: 1, unreadable: 1 } });
  assert.equal(describeScope(one), "1 character in 1 text selection");
  assert.deepEqual(describeScopeSkips(one), [
    "1 hidden frame will be skipped",
    "1 locked frame will be skipped",
    "1 passage will be left alone (couldn't be lined up safely)",
  ]);
});

test("an empty scope shows the friendly message instead of a count", () => {
  assert.equal(describeScope(summary({ empty: "no-document" })), "Open a document to begin.");
  assert.equal(
    describeScope(summary({ scope: "selection", empty: "empty-selection" })),
    "Select text, frames or table cells — or switch to Page or Document.",
  );
  assert.equal(describeScope(summary({ scope: "page", empty: "nothing-to-scramble" })), "There's no text to scramble on this page.");
  assert.match(
    describeScope(summary({ scope: "page", empty: "nothing-to-scramble" }), { scrambleNumbers: false }),
    /Numbers stay as they are while Scramble numbers is off\./,
  );
});

test("has a friendly message for every empty reason", () => {
  assert.equal(emptyMessage("no-document"), "Open a document to begin.");
  assert.equal(emptyMessage("empty-selection"), "Select text, frames or table cells — or switch to Page or Document.");
  assert.equal(emptyMessage("nothing-to-scramble", { scope: "document" }), "This document has no text to scramble yet.");
  assert.equal(emptyMessage("nothing-to-scramble", { scope: "selection" }), "There's no text to scramble in the selection.");
  assert.equal(emptyMessage("nothing-to-scramble"), "There's no text to scramble here.");
  assert.match(emptyMessage("nothing-to-scramble", { skipped: { unreadable: 2 } }), /couldn't be lined up safely/);
  assert.match(emptyMessage("all-skipped", { skipped: { hidden: 3 } }), /hidden\. Turn on Include hidden items/);
  assert.match(emptyMessage("all-skipped", { skipped: { locked: 3 } }), /locked\. Turn on Include locked items/);
  assert.match(emptyMessage("all-skipped", { skipped: { hidden: 1, locked: 1 } }), /Include hidden items or Include locked items/);
  assert.match(emptyMessage("all-skipped"), /Include hidden items or Include locked items/);
  assert.match(emptyMessage("all-kept"), /keep readable.*Untick a style under Keep readable/);
});

test("reports what a run changed, by kind, with parent pages, names and kept paragraphs", () => {
  const result = describeRun(
    report({
      scope: "document",
      changed: 52,
      characters: 18400,
      kinds: kinds({ story: 40, cell: 10, footnote: 2 }),
      parentPages: 3,
      names: 4,
      keptParagraphs: 12,
    }),
  );
  assert.equal(result.tone, "success");
  assert.equal(result.headline, "Done — 18,400 characters in 40 stories, 10 table cells and 2 footnotes.");
  assert.deepEqual(result.details, [
    "Including 3 on parent pages.",
    "4 bookmarks, anchors and text variables follow the new words.",
    "12 paragraphs kept readable.",
  ]);
  assert.equal(result.undo, UNDO_HINT);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.overflow, null);
});

test("says why things were skipped, in a few words", () => {
  const skipped = { locked: 2, hidden: 1, unreadable: 1 };
  const withLockedOff = describeRun(report({ changed: 1, characters: 10, kinds: kinds({ frame: 1 }), skipped }), { includeLocked: false });
  assert.deepEqual(withLockedOff.skipped, [
    "Skipped 2 locked frames. Turn on Include locked items to scramble them.",
    "Skipped 1 hidden frame: hidden items don't print, but stay in the file.",
    "Left 1 passage as it was: it couldn't be lined up safely.",
  ]);
  // Locked items only come up when Include locked items was off.
  const withLockedOn = describeRun(report({ changed: 1, characters: 10, kinds: kinds({ frame: 1 }), skipped }), { includeLocked: true });
  assert.ok(withLockedOn.skipped.every((line) => !/locked/.test(line)));
});

test("lists new overflow by place, with advice", () => {
  const items = [overflowing("page 4"), overflowing("page 7"), overflowing("page 7")];
  const overflow = describeOverflow({ overflowing: items, alreadyOverflowing: 0 });
  assert.ok(overflow);
  assert.equal(overflow.headline, "3 frames now overflow: page 4, page 7 (2)");
  assert.equal(overflow.advice, "Tighten tracking or edit them before exporting.");
  assert.equal(overflow.earlier, null);
  assert.equal(overflow.items.length, 3);

  const single = describeOverflow({ overflowing: [overflowing("table on page 9", "cell")], alreadyOverflowing: 2 });
  assert.ok(single);
  assert.equal(single.headline, "1 table cell now overflows: table on page 9");
  assert.equal(single.advice, "Tighten tracking or edit it before exporting.");
  assert.equal(single.earlier, "2 more already overflowed before this run.");

  const mixed = describeOverflow({ overflowing: [overflowing("page 2"), overflowing("table on page 2", "cell")], alreadyOverflowing: 0 });
  assert.equal(mixed?.headline, "1 frame and 1 table cell now overflow: page 2, table on page 2");
  assert.equal(describeOverflow({ overflowing: [], alreadyOverflowing: 3 }), null);
});

test("labels each overflowing item for its Show button", () => {
  assert.equal(overflowItemLabel(overflowing("page 4")), "Frame on page 4");
  assert.equal(overflowItemLabel(overflowing("parent page A-Parent")), "Frame on parent page A-Parent");
  assert.equal(overflowItemLabel(overflowing("pasteboard")), "Frame on the pasteboard");
  assert.equal(overflowItemLabel(overflowing("table on page 9", "cell")), "Cell in table on page 9");
  assert.equal(overflowItemLabel(overflowing("table", "cell")), "Cell in a table");
});

test("reports cleanup in plain words", () => {
  assert.equal(describeCleanup({ links: 5, renamed: 9, documentInfo: true }), "5 links now point at example.com; title and author cleared.");
  assert.equal(describeCleanup({ links: 1, renamed: 1, documentInfo: false }), "1 link now points at example.com.");
  assert.equal(describeCleanup({ links: 0, renamed: 0, documentInfo: true }), "Title and author cleared.");
  assert.equal(describeCleanup({ links: 0, renamed: 0, documentInfo: false }), "No links or document info needed cleaning.");
  const cleaned = describeRun(report({ cleanup: { links: 2, renamed: 2, documentInfo: true } }));
  assert.equal(cleaned.tone, "success");
  assert.equal(cleaned.headline, "Done — links and document info cleaned.");
  assert.ok(cleaned.details.includes("2 links now point at example.com; title and author cleared."));
});

test("a names-only run still reads as done", () => {
  const result = describeRun(report({ scope: "document", names: 3 }));
  assert.equal(result.headline, "Done — 3 bookmarks, anchors and text variables scrambled.");
});

test("errors turn a run into a warning, or an error when nothing changed", () => {
  const partial = describeRun(report({ changed: 2, characters: 40, kinds: kinds({ frame: 2 }), errors: ["Cannot edit character 5"] }));
  assert.equal(partial.tone, "warning");
  assert.deepEqual(partial.errors, ["Couldn't change some text: Cannot edit character 5."]);

  const failed = describeRun(report({ errors: Array.from({ length: 8 }, (_, index) => `Problem ${index + 1}.`) }));
  assert.equal(failed.tone, "error");
  assert.equal(failed.headline, "Nothing changed: the text couldn't be edited.");
  assert.equal(failed.undo, null);
  assert.equal(failed.errors.length, 6);
  assert.equal(failed.errors[5], "…and 3 more problems.");
});

test("empty runs use the empty message and keep the skipped counts", () => {
  const result = describeRun(report({ scope: "page", empty: "all-skipped", skipped: { locked: 0, hidden: 4, unreadable: 0 } }));
  assert.equal(result.tone, "empty");
  assert.equal(result.undo, null);
  assert.match(result.headline, /Turn on Include hidden items/);
  assert.deepEqual(result.skipped, ["Skipped 4 hidden frames: hidden items don't print, but stay in the file."]);
  assert.equal(describeRun(report({ scope: "selection", empty: "empty-selection" })).headline, emptyMessage("empty-selection"));
  // The menu command has no scope to switch to.
  assert.equal(
    describeRun(report({ scope: "selection", empty: "empty-selection" }), { fromMenu: true }).headline,
    "Select text, frames or table cells first.",
  );
});

test("notes come through once, without repeating the skipped line", () => {
  const result = describeRun(
    report({
      changed: 1,
      characters: 5,
      kinds: kinds({ frame: 1 }),
      skipped: { locked: 0, hidden: 0, unreadable: 1 },
      notes: [
        "Some text with special characters could not be lined up safely, so it was left as it is.",
        "Some paragraphs could not be matched to their styles, so they were scrambled in full.",
        "Some paragraphs could not be matched to their styles, so they were scrambled in full.",
      ],
    }),
  );
  assert.deepEqual(result.notes, ["Some paragraphs could not be matched to their styles, so they were scrambled in full."]);
});

test("flattens a run into dialog lines in reading order", () => {
  const lines = runSummaryLines(
    report({
      changed: 3,
      characters: 120,
      kinds: kinds({ frame: 3 }),
      keptParagraphs: 1,
      skipped: { locked: 0, hidden: 1, unreadable: 0 },
      overflow: { overflowing: [overflowing("page 4")], alreadyOverflowing: 0 },
      errors: ["Cannot edit character 2."],
      notes: ["A note."],
    }),
  );
  assert.deepEqual(lines, [
    "Done — 120 characters in 3 frames.",
    "1 paragraph kept readable.",
    "Skipped 1 hidden frame: hidden items don't print, but stay in the file.",
    "1 frame now overflows: page 4. Tighten tracking or edit it before exporting.",
    "Couldn't change some text: Cannot edit character 2.",
    "A note.",
    UNDO_HINT,
  ]);
  assert.deepEqual(runSummaryLines(report({ empty: "no-document" })), ["Open a document to begin."]);
});

test("explains exceptions with a way back", () => {
  assert.equal(
    errorMessage(new Error("Object is invalid")),
    "Something went wrong: Object is invalid. If anything changed, Edit > Undo Text Scramble puts it back.",
  );
  assert.equal(errorMessage("Boom!"), "Something went wrong: Boom! If anything changed, Edit > Undo Text Scramble puts it back.");
  assert.match(errorMessage(undefined), /Unknown error\./);
  assert.equal(inspectErrorMessage(new Error("Busy")), "Couldn't read the text just now: Busy.");
});

test("names unknown styles and wraps long dialog lines", () => {
  assert.equal(unknownStylesNote([]), null);
  assert.equal(unknownStylesNote(["Headlin"]), "There's no paragraph style called “Headlin”, so nothing was kept readable for it.");
  assert.match(unknownStylesNote(["A", "B"]) ?? "", /no paragraph styles called “A” and “B”/);
  assert.deepEqual(wrapText("one two three four", 9), ["one two", "three", "four"]);
  assert.deepEqual(wrapText("", 10), [""]);
  assert.ok(wrapText(errorMessage(new Error("x")), 40).every((line) => line.length <= 40));
});

test("keeps the three scopes in panel order with their approved copy", () => {
  assert.deepEqual(
    SCOPES.map(({ scope, title, copy }) => [scope, title, copy]),
    [
      ["selection", "Selection", "Text, frames or table cells"],
      ["page", "Page", "Every frame on this page, overset text included"],
      ["document", "Document", "Every story, table, footnote, parent page and bookmark"],
    ],
  );
});

test("describes real summaries and reports from the run", () => {
  const { app, document } = createInDesign();
  const host = hostFor(app);
  const spread = document.spread(["1", "2"]);
  const [page] = spread.pages;
  app.activeWindow.activePage = page;
  document.frame(page, document.story("Brindlewick Traders ships fresh produce daily."));
  document.frame(page, document.story(["Quarterly report", document.table(["North", "South", "East", "West"])]));
  const hidden = document.frame(page, document.story("A note nobody should print."));
  hidden.visible = false;

  const inspected = inspectScope(host, { scope: "page" });
  assert.match(describeScope(inspected), /^[\d,]+ characters in 2 frames and 4 table cells$/);
  assert.deepEqual(describeScopeSkips(inspected), ["1 hidden frame will be skipped"]);

  const ran = runScramble(host, { scope: "page" });
  const described = describeRun(ran, { includeLocked: true });
  assert.equal(described.tone, "success");
  assert.match(described.headline, /^Done — [\d,]+ characters in 2 frames and 4 table cells\.$/);
  assert.deepEqual(described.skipped, ["Skipped 1 hidden frame: hidden items don't print, but stay in the file."]);
  assert.equal(described.undo, UNDO_HINT);

  app.selection = [];
  assert.equal(describeScope(inspectScope(host, { scope: "selection" })), emptyMessage("empty-selection"));
  app.documentList.length = 0;
  assert.equal(describeRun(runScramble(host, { scope: "document" })).headline, "Open a document to begin.");
});
