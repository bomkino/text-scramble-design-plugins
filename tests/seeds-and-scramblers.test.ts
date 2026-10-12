import assert from "node:assert/strict";
import test from "node:test";
import {
  createScrambler,
  createSeededRandom,
  createWordMatcher,
  scrambleText,
  scrambleTexts,
} from "../packages/core/src/scramble-text";

const SAMPLE = "Sloane and Ruby moved the 2026 launch to Lisbon. Ruby kept the notes.";

test("pins the seeded random sequence so every engine can match it", () => {
  const random = createSeededRandom("text-scramble");
  const values = [random(), random(), random()];

  assert.deepEqual(values, [0.2002851574216038, 0.2523116529919207, 0.9054286654572934]);
  assert.deepEqual(
    [createSeededRandom(7)(), createSeededRandom("7")()],
    [createSeededRandom("7")(), createSeededRandom(7)()],
  );
});

test("keeps seeded values inside the 0 to 1 range", () => {
  const random = createSeededRandom("range");
  for (let index = 0; index < 10_000; index++) {
    const value = random();
    assert.ok(value >= 0 && value < 1);
  }
});

test("repeats exactly with the same seed", () => {
  assert.equal(scrambleText(SAMPLE, { seed: 42 }), scrambleText(SAMPLE, { seed: 42 }));
  assert.equal(scrambleText(SAMPLE, { seed: "deck" }), scrambleText(SAMPLE, { seed: "deck" }));
  assert.deepEqual(scrambleTexts([SAMPLE, "Ruby"], { seed: 9 }), scrambleTexts([SAMPLE, "Ruby"], { seed: 9 }));
  assert.equal(scrambleText(SAMPLE, { seed: 42 }), scrambleText(SAMPLE, { seed: "42" }));
});

test("changes with a different seed", () => {
  const outputs = new Set(Array.from({ length: 12 }, (_, seed) => scrambleText(SAMPLE, { seed })));

  assert.equal(outputs.size, 12);
});

test("treats an empty seed as no seed", () => {
  const outputs = new Set(Array.from({ length: 8 }, () => scrambleText(SAMPLE, { seed: "" })));

  assert.ok(outputs.size > 1);
});

test("gives a word the same invented word in any text with the same seed", () => {
  const first = scrambleText("Sloane met Ruby in 2026.", { seed: "studio" }).split(/\W+/);
  const second = scrambleText("ruby called SLOANE about 2026", { seed: "studio" }).split(/\W+/);

  assert.equal(first[0].toLowerCase(), second[2].toLowerCase());
  assert.equal(first[2].toLowerCase(), second[0]);
  assert.equal(first[4], second[4]);
  assert.equal(second[2], second[2].toUpperCase());
});

test("lets a passed random source win over a seed", () => {
  const withRandom = scrambleText(SAMPLE, { seed: 1, random: createSeededRandom(5) });

  assert.equal(withRandom, scrambleText(SAMPLE, { random: createSeededRandom(5) }));
});

test("shares invented words across every text one scrambler handles", () => {
  const scrambler = createScrambler({ random: createSeededRandom(3) });
  const first = scrambler.scramble("Lisbon in spring");
  const second = scrambler.scramble("LISBON in autumn");

  assert.equal(first.split(" ")[0].toLowerCase(), second.split(" ")[0].toLowerCase());
  assert.equal(first.split(" ")[1], second.split(" ")[1]);
});

test("matches scrambleTexts when one scrambler handles the texts in turn", () => {
  const texts = ["Shape the story", "SHAPE another story", "", "Edition 2026"];
  const scrambler = createScrambler({ random: createSeededRandom(11) });

  assert.deepEqual(
    texts.map((text) => scrambler.scramble(text)),
    scrambleTexts(texts, { random: createSeededRandom(11) }),
  );
});

test("leaves filtered tokens untouched without using up randomness", () => {
  const keepHeadline = (token: string) => token !== "Quarterly";
  const filtered = createScrambler({ random: createSeededRandom(8) }).scramble("Quarterly review 2026", keepHeadline);
  const plain = createScrambler({ random: createSeededRandom(8) }).scramble("review 2026");

  assert.equal(filtered, `Quarterly ${plain}`);
});

test("matches listed words and names regardless of case and accents", () => {
  const matches = createWordMatcher(["Zoë Hart", "ACME", "2026"]);

  assert.ok(matches("zoe"));
  assert.ok(matches("ZOË"));
  assert.ok(matches("Zoë"));
  assert.ok(matches("hart"));
  assert.ok(matches("Acme"));
  assert.ok(matches("2026"));
  assert.ok(!matches("Zo"));
  assert.ok(!matches("2025"));
  assert.ok(!createWordMatcher([])("anything"));
});

test("scrambles only listed words inside otherwise kept text", () => {
  const scrambler = createScrambler({ seed: 2 });
  const result = scrambler.scramble("Our work with Zoë Hart", createWordMatcher(["Zoe Hart"]));

  assert.ok(result.startsWith("Our work with "));
  assert.notEqual(result, "Our work with Zoë Hart");
  assert.equal(scrambler.scramble("Zoë"), result.split(" ")[3]);
});
