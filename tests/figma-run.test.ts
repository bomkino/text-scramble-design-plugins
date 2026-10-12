import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { scrambleLayers } from "../plugins/figma/src/run";
import { scanScope } from "../plugins/figma/src/scope";
import { component, createWorld, frame, instanceOf, MockText, page, REGULAR, seededRandom, text } from "./helpers/figma-mock";

const SCAN = { includeHidden: false, scrambleNumbers: true };

function structure(value: string): string {
  return value.replace(/\p{L}/gu, "L").replace(/\p{N}/gu, "N");
}

function words(value: string): string[] {
  return value.match(/\p{L}+/gu) ?? [];
}

async function run(layers: MockText[], world = layers[0].world, seed = 1) {
  return scrambleLayers(layers, { scrambleNumbers: true, random: seededRandom(seed), loadFont: world.loadFont });
}

test("keeps every character's style and the text's shape", async () => {
  const world = createWorld();
  const source = "Bold start, then plain 2026.";
  const styles = Array.from(source, (_, index) => (index < 10 ? "bold" : index > 22 ? "link" : "regular"));
  const layer = text(world, source, { styles });

  const report = await run([layer]);

  assert.equal(report.layers, 1);
  assert.equal(report.characters, source.length);
  assert.notEqual(layer.characters, source);
  assert.equal(structure(layer.characters), structure(source));
  assert.deepEqual(layer.styles, styles);
});

test("gives a word the same invented word in every layer of one run", async () => {
  const world = createWorld();
  const main = component(world, { name: "Author" }, text(world, "Mara Quell"));
  const overridden = instanceOf(main);
  const root = page(
    world,
    frame(world, { name: "Intro" }, text(world, "Mara Quell wrote this."), text(world, "MARA QUELL")),
    main,
    overridden,
  );
  // An override: this instance shows its own copy, so it is scrambled on its own.
  const overrideText = overridden.children[0] as MockText;
  world.loadedFonts.add("Inter Regular");
  overrideText.insertCharacters(overrideText.characters.length, " says hi");

  const scan = scanScope("page", [root], SCAN);
  await run(scan.eligible as MockText[]);

  const [intro, shouting, mainText, instanceText] = scan.eligible as MockText[];
  const name = words(mainText.characters);
  assert.notDeepEqual(name, ["Mara", "Quell"]);
  assert.deepEqual(words(intro.characters).slice(0, 2), name);
  assert.deepEqual(
    words(shouting.characters),
    name.map((word) => word.toUpperCase()),
  );
  assert.deepEqual(words(instanceText.characters).slice(0, 2), name);
});

test("lets instance text follow its main component instead of adding an override", async () => {
  const world = createWorld();
  const main = component(world, { name: "Button" }, text(world, "Book a call"));
  const instance = instanceOf(main);
  const root = page(world, instance, main);

  const scan = scanScope("page", [root], SCAN);
  const report = await run(scan.eligible as MockText[]);

  const mainText = main.children[0] as MockText;
  const instanceText = instance.children[0] as MockText;
  assert.equal(report.layers, 2);
  assert.equal(report.inherited, 1);
  assert.equal(instanceText.characters, mainText.characters);
  assert.equal(instanceText.overridden, false);
  assert.equal(instanceText.edits, 0);
});

test("scrambles overridden instance text in place and keeps the instance", async () => {
  const world = createWorld();
  const main = component(world, { name: "Quote" }, text(world, "Placeholder quote"));
  const instance = instanceOf(main);
  page(world, instance);
  const instanceText = instance.children[0] as MockText;

  const report = await run([instanceText]);

  assert.equal(report.layers, 1);
  assert.equal(report.inherited, 0);
  assert.equal(instanceText.overridden, true);
  assert.equal((main.children[0] as MockText).characters, "Placeholder quote");
  assert.equal(instance.type, "INSTANCE");
});

test("renames layers whose names repeat their text, and leaves chosen names alone", async () => {
  const world = createWorld();
  const automatic = text(world, "Northwind annual report");
  const copied = text(world, "Harbour lights", { name: "Harbour lights", autoRename: false });
  const chosen = text(world, "Harbour lights", { name: "Headline" });

  const report = await run([automatic, copied, chosen]);

  assert.equal(report.renamed, 2);
  assert.equal(automatic.name, automatic.characters);
  assert.equal(automatic.autoRename, true);
  assert.equal(copied.name, copied.characters);
  assert.equal(copied.autoRename, false);
  assert.equal(chosen.name, "Headline");
});

test("does not rename a layer Figma already renamed", async () => {
  const world = createWorld();
  const layer = text(world, "Field notes", { renamesOnEdit: true });

  const report = await run([layer]);

  assert.equal(report.renamed, 0);
  assert.equal(layer.name, layer.characters);
});

test("reports layers whose fonts would not load and still scrambles the rest", async () => {
  const world = createWorld();
  world.missingFonts.add("Brand Serif Italic");
  const fine = text(world, "Plain words");
  const stuck = text(world, "Fancy words", { name: "Pull quote", fonts: [REGULAR, { family: "Brand Serif", style: "Italic" }] });

  const report = await run([fine, stuck]);

  assert.equal(report.layers, 1);
  assert.equal(stuck.characters, "Fancy words");
  assert.deepEqual(report.failed, [{ id: stuck.id, name: "Pull quote", reason: "The font “Brand Serif Italic” didn’t load." }]);
});

test("loads each font once for the whole run", async () => {
  const world = createWorld();
  const loads: string[] = [];
  const layers = [text(world, "One"), text(world, "Two"), text(world, "Three")];

  await scrambleLayers(layers, {
    scrambleNumbers: true,
    random: seededRandom(4),
    loadFont: async (font) => {
      loads.push(`${font.family} ${font.style}`);
      await world.loadFont(font);
    },
  });

  assert.deepEqual(loads, ["Inter Regular"]);
});

test("instance text that follows its main is not failed over its own font", async () => {
  const world = createWorld();
  world.missingFonts.add("Brand Serif Italic");
  const main = component(world, { name: "Tag" }, text(world, "Limited offer"));
  const instance = instanceOf(main);
  page(world, main, instance);
  const instanceText = instance.children[0] as MockText;
  // A style override in the instance uses a font that won't load; its characters still follow the main.
  instanceText.fonts = [{ family: "Brand Serif", style: "Italic" }];

  const report = await run([main.children[0] as MockText, instanceText]);

  assert.deepEqual(report.failed, []);
  assert.equal(report.inherited, 1);
  assert.equal(instanceText.characters, (main.children[0] as MockText).characters);
});

test("a name Figma refuses doesn't fail a layer whose text changed", async () => {
  const world = createWorld();
  const layer = text(world, "Spring launch");
  let name = layer.name;
  Object.defineProperty(layer, "name", {
    get: () => name,
    set: () => {
      throw new Error("Cannot rename this layer");
    },
  });

  const report = await run([layer]);

  assert.equal(report.layers, 1);
  assert.deepEqual(report.failed, []);
  assert.equal(report.renamed, 0);
  assert.notEqual(layer.characters, "Spring launch");
  assert.equal(name, "Spring launch");
});

test("a name that copies its text gets exactly the new text, numbers included", async () => {
  const world = createWorld();
  const layer = text(world, "Q3 report 2026", { name: "Q3 report 2026", autoRename: false });

  await scrambleLayers([layer], { scrambleNumbers: true, loadFont: world.loadFont });

  assert.notEqual(layer.characters, "Q3 report 2026");
  assert.equal(layer.name, layer.characters);
});

test("reports a layer that throws while writing without stopping the run", async () => {
  const world = createWorld();
  const fine = text(world, "Calm words");
  const broken = text(world, "Broken words", { name: "Broken" });
  broken.insertCharacters = () => {
    throw new Error("Cannot write to internal and read-only node");
  };

  const report = await run([fine, broken]);

  assert.equal(report.layers, 1);
  assert.equal(report.failed[0].name, "Broken");
  assert.match(report.failed[0].reason, /read-only/);
});

test("spots fixed-width text that now wraps onto more lines", async () => {
  const world = createWorld();
  const source = "A line that only just fits";
  const oneLineUntilChanged = (characters: string) => (characters === source ? 12 : 24);
  const wrapping = text(world, source, { textAutoResize: "HEIGHT", measure: oneLineUntilChanged });
  const steady = text(world, source, { textAutoResize: "HEIGHT", measure: () => 12 });
  const autoWidth = text(world, source, { textAutoResize: "WIDTH_AND_HEIGHT", measure: oneLineUntilChanged });
  const fixedBox = text(world, source, { textAutoResize: "NONE", measure: oneLineUntilChanged });

  const report = await run([wrapping, steady, autoWidth, fixedBox]);

  assert.equal(report.layers, 4);
  assert.deepEqual(report.wrapped, [wrapping]);
});

test("a seed repeats the result in any layer order, and a new seed changes it", async () => {
  const sources = ["Studio Halden builds calm tools for 12 teams.", "Halden, since 2019"];
  const runWith = async (seed: string, order: (layers: MockText[]) => MockText[] = (layers) => layers) => {
    const world = createWorld();
    const layers = sources.map((source) => text(world, source));
    await scrambleLayers(order(layers), { scrambleNumbers: true, seed, loadFont: world.loadFont });
    return layers.map((layer) => layer.characters);
  };

  const first = await runWith("spring");
  assert.deepEqual(await runWith("spring"), first);
  assert.deepEqual(await runWith("spring", (layers) => [...layers].reverse()), first);
  assert.notDeepEqual(await runWith("autumn"), first);
  assert.equal(words(first[0])[1], words(first[1])[0]);
});

test("matches the shared engine's test vectors, so a seed gives the same words as the other apps", async () => {
  const vectors: { inputs: string[]; options: { seed?: number | string; scrambleNumbers?: boolean }; outputs: string[] }[] =
    JSON.parse(readFileSync(new URL("../packages/core/test-vectors.json", import.meta.url), "utf8"));
  assert.ok(vectors.length > 0);

  for (const vector of vectors) {
    const world = createWorld();
    const layers = vector.inputs.map((input) => text(world, input, { name: "Sample" }));
    await scrambleLayers(layers, {
      scrambleNumbers: vector.options.scrambleNumbers !== false,
      seed: vector.options.seed === undefined ? undefined : String(vector.options.seed),
      loadFont: world.loadFont,
    });
    assert.deepEqual(
      layers.map((layer) => layer.characters),
      vector.outputs,
      `Seed ${JSON.stringify(vector.options.seed)} gave different words in Figma.`,
    );
  }
});
