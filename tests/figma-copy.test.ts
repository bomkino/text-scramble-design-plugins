import assert from "node:assert/strict";
import { mock } from "node:test";
import test from "node:test";
import { readPreferences, resultView, summaryView } from "../plugins/figma/src/copy";
import { debounce } from "../plugins/figma/src/debounce";
import type { RunReport } from "../plugins/figma/src/run";
import type { ScanResult, TextLayer } from "../plugins/figma/src/scope";

function scan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    scope: "selection",
    roots: 1,
    textLayers: 3,
    eligible: [{} as TextLayer, {} as TextLayer, {} as TextLayer],
    characters: 1204,
    skipped: { hidden: 0, locked: 0, missingFont: 0 },
    numbersOnly: 0,
    inMainComponents: 0,
    ...overrides,
  };
}

function report(overrides: Partial<RunReport> = {}): RunReport {
  return { layers: 3, characters: 1204, inherited: 0, renamed: 0, failed: [], wrapped: [], ...overrides };
}

test("asks for a selection when nothing is selected", () => {
  const view = summaryView(scan({ roots: 0, textLayers: 0, eligible: [], characters: 0 }));
  assert.equal(view.headline, "Select layers to scramble");
  assert.equal(view.canScramble, false);
});

test("says where there is no text", () => {
  assert.equal(summaryView(scan({ textLayers: 0, eligible: [] })).headline, "No text in your selection");
  assert.equal(summaryView(scan({ scope: "page", textLayers: 0, eligible: [] })).headline, "No text on this page");
});

test("counts what is ready and lists what is skipped", () => {
  const view = summaryView(scan({ skipped: { hidden: 2, locked: 1, missingFont: 3 } }));
  assert.equal(view.headline, "1,204 characters ready");
  assert.equal(view.count, "3 layers");
  assert.deepEqual(view.details, ["Skipping 2 hidden, 1 locked and 3 with missing fonts."]);
  assert.equal(view.canScramble, true);
});

test("warns that main components carry changes to their instances", () => {
  const view = summaryView(scan({ inMainComponents: 1 }));
  assert.match(view.details.join(" "), /1 layer is in a main component, so its instances change too/);
});

test("explains how to unblock text that was all skipped", () => {
  const view = summaryView(scan({ eligible: [], characters: 0, textLayers: 4, skipped: { hidden: 3, locked: 0, missingFont: 1 } }));
  assert.equal(view.tone, "warning");
  assert.equal(view.headline, "All 4 text layers skipped");
  assert.deepEqual(view.details, [
    "Skipped: 3 hidden and 1 with missing fonts.",
    "Turn on Include hidden and locked to change those too.",
    "Text with missing fonts can’t be edited. Install the fonts, then run it again.",
  ]);
  assert.equal(view.canScramble, false);
});

test("points to the numbers switch when only numbers are left", () => {
  const view = summaryView(scan({ eligible: [], characters: 0, textLayers: 1, numbersOnly: 1 }));
  assert.equal(view.headline, "Nothing here to change");
  assert.deepEqual(view.details, ["1 layer only has numbers. Turn on Scramble numbers to change them."]);
});

test("a clean run reports, offers undo and closes by itself", () => {
  const view = resultView(report(), scan({ skipped: { hidden: 1, locked: 0, missingFont: 0 } }));
  assert.equal(view.tone, "success");
  assert.equal(view.headline, "Scrambled 3 layers · 1,204 characters");
  assert.equal(view.toast, "Scrambled 3 text layers · skipped 1 hidden");
  assert.deepEqual(view.details, ["Skipped 1 hidden.", "Undo brings it all back in one step."]);
  assert.equal(view.closeAutomatically, true);
});

test("stays open to show wrapped text and failures", () => {
  const view = resultView(
    report({
      layers: 2,
      wrapped: [{} as TextLayer],
      failed: Array.from({ length: 6 }, (_, index) => ({ id: `${index}`, name: `Layer ${index + 1}`, reason: "Locked by a library" })),
    }),
    scan(),
  );
  assert.equal(view.tone, "warning");
  assert.equal(view.canSelectWrapped, true);
  assert.equal(view.closeAutomatically, false);
  assert.match(view.details.join(" "), /1 layer now wraps onto more lines/);
  assert.match(view.details.join(" "), /6 layers couldn’t be changed/);
  assert.deepEqual(view.problems, [
    "Layer 1: Locked by a library",
    "Layer 2: Locked by a library",
    "Layer 3: Locked by a library",
    "Layer 4: Locked by a library",
    "and 2 more",
  ]);
});

test("a run that changed nothing says so plainly", () => {
  const view = resultView(report({ layers: 0, characters: 0, failed: [{ id: "1", name: "Title", reason: "Font didn’t load" }] }), scan());
  assert.equal(view.tone, "error");
  assert.equal(view.headline, "That layer couldn’t be changed");
  assert.deepEqual(view.details, ["Nothing was changed."]);
  assert.equal(view.closeAutomatically, false);
});

test("reads stored preferences defensively", () => {
  assert.deepEqual(readPreferences(undefined), { scope: "selection", scrambleNumbers: true, includeHidden: false, seed: "" });
  assert.deepEqual(readPreferences({ scope: "page", scrambleNumbers: false, includeHidden: true, seed: "  spring  " }), {
    scope: "page",
    scrambleNumbers: false,
    includeHidden: true,
    seed: "spring",
  });
  assert.deepEqual(readPreferences({ scope: "document", includeHidden: "yes", seed: 42 }), {
    scope: "selection",
    scrambleNumbers: true,
    includeHidden: false,
    seed: "",
  });
  assert.equal(readPreferences({ seed: "x".repeat(80) }).seed.length, 40);
});

test("debounce runs once after a burst and can be cancelled", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let runs = 0;
    const refresh = debounce(() => runs++, 120);

    refresh();
    mock.timers.tick(100);
    refresh();
    mock.timers.tick(100);
    refresh();
    assert.equal(runs, 0);
    mock.timers.tick(120);
    assert.equal(runs, 1);

    refresh();
    refresh.cancel();
    mock.timers.tick(500);
    assert.equal(runs, 1);
  } finally {
    mock.timers.reset();
  }
});
