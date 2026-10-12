import assert from "node:assert/strict";
import test from "node:test";
import { scanScope, sortByLayerOrder, type TreeNode } from "../plugins/figma/src/scope";
import { component, createWorld, frame, instanceOf, page, text } from "./helpers/figma-mock";

const DEFAULTS = { includeHidden: false, scrambleNumbers: true };

test("page scope finds text in frames, main components and instances", () => {
  const world = createWorld();
  const main = component(world, { name: "Card" }, text(world, "Ada Lovelace"));
  const loose = text(world, "Quarterly results");
  const root = page(world, frame(world, { name: "Hero" }, loose), main, frame(world, {}, instanceOf(main)));

  const scan = scanScope("page", [root], DEFAULTS);

  assert.equal(scan.textLayers, 3);
  assert.equal(scan.eligible.length, 3);
  assert.equal(scan.inMainComponents, 1);
  assert.equal(scan.characters, "Ada Lovelace".length * 2 + "Quarterly results".length);
});

test("skips hidden text unless asked, and scrambles locked text because it still exports", () => {
  const world = createWorld();
  const root = page(
    world,
    text(world, "Visible copy"),
    text(world, "Hidden copy", { visible: false }),
    frame(world, { visible: false }, text(world, "Inside a hidden frame")),
    frame(world, { locked: true }, text(world, "Inside a locked frame")),
    text(world, "Locked copy", { locked: true }),
  );

  const skipping = scanScope("page", [root], DEFAULTS);
  assert.deepEqual(skipping.skipped, { hidden: 2, missingFont: 0 });
  assert.equal(skipping.locked, 2);
  assert.deepEqual(
    skipping.eligible.map((layer) => layer.characters),
    ["Visible copy", "Inside a locked frame", "Locked copy"],
  );

  const including = scanScope("page", [root], { ...DEFAULTS, includeHidden: true });
  assert.deepEqual(including.skipped, { hidden: 0, missingFont: 0 });
  assert.equal(including.eligible.length, 5);
});

test("counts a layer that is both hidden and locked as hidden", () => {
  const world = createWorld();
  const root = page(world, frame(world, { locked: true }, text(world, "Both", { visible: false })));

  const scan = scanScope("page", [root], DEFAULTS);
  assert.deepEqual(scan.skipped, { hidden: 1, missingFont: 0 });
  assert.equal(scan.locked, 0);
});

test("hidden layers inside instances vanish from the scan when Figma is told to skip them", () => {
  const world = createWorld();
  const main = component(world, { name: "Button" }, text(world, "Buy now"), text(world, "Helper", { visible: false }));
  const root = page(world, main, instanceOf(main));

  world.skipInvisibleInstanceChildren = true;
  const fast = scanScope("page", [root], DEFAULTS);
  assert.equal(fast.textLayers, 3);
  assert.deepEqual(fast.skipped, { hidden: 1, missingFont: 0 });
  assert.deepEqual(
    fast.eligible.map((layer) => layer.characters),
    ["Buy now", "Buy now"],
  );

  world.skipInvisibleInstanceChildren = false;
  const full = scanScope("page", [root], { ...DEFAULTS, includeHidden: true });
  assert.equal(full.eligible.length, 4);
});

test("skips text with missing fonts even when hidden layers are included", () => {
  const world = createWorld();
  const root = page(world, text(world, "Readable"), text(world, "Missing font", { hasMissingFont: true }));

  const scan = scanScope("page", [root], { ...DEFAULTS, includeHidden: true });
  assert.equal(scan.skipped.missingFont, 1);
  assert.equal(scan.eligible.length, 1);
});

test("leaves symbol-only text alone and spots number-only text when numbers are off", () => {
  const world = createWorld();
  const root = page(world, text(world, "— ✦ —"), text(world, "2026"), text(world, "Total 42"));

  const numbersOn = scanScope("page", [root], DEFAULTS);
  assert.equal(numbersOn.eligible.length, 2);
  assert.equal(numbersOn.numbersOnly, 0);

  const numbersOff = scanScope("page", [root], { ...DEFAULTS, scrambleNumbers: false });
  assert.deepEqual(
    numbersOff.eligible.map((layer) => layer.characters),
    ["Total 42"],
  );
  assert.equal(numbersOff.numbersOnly, 1);
});

test("selection scope reads selected text, nested text, and drops duplicates", () => {
  const world = createWorld();
  const inner = text(world, "Nested headline");
  const group = frame(world, { name: "Group" }, inner, text(world, "Nested body"));
  const loose = text(world, "Loose caption");
  page(world, group, loose);

  const scan = scanScope("selection", [inner, group, loose], DEFAULTS);
  assert.equal(scan.roots, 3);
  assert.equal(scan.textLayers, 3);
  assert.deepEqual(
    scan.eligible.map((layer) => layer.characters),
    ["Nested headline", "Nested body", "Loose caption"],
  );
});

test("selection order does not change the scan order", () => {
  const world = createWorld();
  const first = text(world, "First");
  const second = frame(world, {}, text(world, "Second"));
  const third = text(world, "Third");
  page(world, first, second, third);

  assert.deepEqual(
    sortByLayerOrder([third, first, second]).map((node) => node.id),
    [first.id, second.id, third.id],
  );
  const shuffled = scanScope("selection", [third, second, first], DEFAULTS);
  assert.deepEqual(
    shuffled.eligible.map((layer) => layer.characters),
    ["First", "Second", "Third"],
  );
});

test("orders main components before instances so instance text can follow its main", () => {
  const world = createWorld();
  const main = component(world, { name: "Badge" }, text(world, "New"));
  const outer = component(world, { name: "Card" }, instanceOf(main), text(world, "Card title"));
  const root = page(world, instanceOf(outer), outer, main);

  const scan = scanScope("page", [root], DEFAULTS);
  const depths = scan.eligible.map((layer) => {
    let depth = 0;
    for (let node = layer.parent; node; node = node.parent) if (node.type === "INSTANCE") depth++;
    return depth;
  });
  assert.deepEqual(depths, [...depths].sort((a, b) => a - b));
  assert.equal(depths[0], 0);
});

test("an empty selection scans nothing", () => {
  const scan = scanScope("selection", [], DEFAULTS);
  assert.equal(scan.roots, 0);
  assert.equal(scan.textLayers, 0);
  assert.equal(scan.eligible.length, 0);
});

test("a root Figma refuses to read counts as hidden instead of failing the scan", () => {
  const world = createWorld();
  const readable = text(world, "Readable");
  const refused = {
    id: "I9:1;2:3",
    type: "FRAME",
    name: "Hidden variant",
    parent: null,
    findAllWithCriteria() {
      throw new Error("The node with id I9:1;2:3 does not exist");
    },
  };
  page(world, readable);

  const scan = scanScope("selection", [readable, refused], DEFAULTS);
  assert.equal(scan.eligible.length, 1);
  assert.equal(scan.skipped.hidden, 1);
});

test("a selected layer whose every property Figma refuses still only counts as hidden", () => {
  const world = createWorld();
  const readable = text(world, "Readable");
  page(world, readable);
  const refuse = () => {
    throw new Error("The node with id I9:1;2:3 does not exist");
  };
  const refused = Object.defineProperties({}, {
    id: { get: refuse },
    type: { get: refuse },
    name: { get: refuse },
    parent: { get: refuse },
  }) as unknown as TreeNode;

  const scan = scanScope("selection", [readable, refused], DEFAULTS);
  assert.deepEqual(scan.eligible, [readable]);
  assert.equal(scan.skipped.hidden, 1);
});
