import assert from "node:assert/strict";
import test from "node:test";
import { buildReplacementRuns } from "../packages/core/src/replacement-runs";
import { createScrambler, createWordMatcher, scrambleText } from "../packages/core/src/scramble-text";
import { TOP_LEVEL_DOMAINS } from "../packages/core/src/top-level-domains";

const SAFE_ENDING = /\.(?:xx|alt|test|local|example|internal|localhost)$/i;

// Every "name.ending" run in the text that is not the name part of an email.
function domainsIn(text: string): string[] {
  return text.match(/(?<![\p{L}\p{N}.-])(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{M}]{2,}(?![\p{L}\p{M}\p{N}@-])/gu) ?? [];
}

const SAMPLES = [
  "Write to hello@brindlewick.co or visit https://www.brindlewick.co/work/case-study?ref=deck.",
  "Studio: north-star.studio · NORTH-STAR.STUDIO · mail.north-star.co.uk",
  "Ada.Quell@quellmoor.photography and ops@quellmoor.consulting, x@t.co",
  "Bare: quellmoor.com, brindle.design, orchard.io/menu.",
  "mailto:hello@quellmoor.com · ftp://files.quellmoor.com:21/a · first.last@quellmoor.com",
  "Contact: Zoë@café.fr and https://пример.рф/путь",
];

test("gives every email and web address an ending that can never be registered", () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const source of SAMPLES) {
      const result = scrambleText(source, { seed });
      const domains = domainsIn(result);

      assert.equal(domains.length, domainsIn(source).length);
      for (const domain of domains) assert.match(domain, SAFE_ENDING, `"${domain}" from "${source}" could be real.`);
    }
  }
});

test("keeps the character count of text with addresses", () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const source of SAMPLES) {
      const result = scrambleText(source, { seed });

      assert.equal(Array.from(result).length, Array.from(source).length);
      assert.doesNotThrow(() => buildReplacementRuns(source, result));
    }
  }
});

test("swaps the ending for a safe one of the same length where one exists", () => {
  const cases: Array<[string, RegExp]> = [
    ["hello@quellmoor.io", /^[a-z]{5}@[a-z]{9}\.xx$/],
    ["hello@quellmoor.com", /^[a-z]{5}@[a-z]{9}\.alt$/],
    ["hello@quellmoor.info", /^[a-z]{5}@[a-z]{9}\.test$/],
    ["hello@quellmoor.space", /^[a-z]{5}@[a-z]{9}\.local$/],
    ["hello@quellmoor.digital", /^[a-z]{5}@[a-z]{9}\.example$/],
    ["hello@quellmoor.software", /^[a-z]{5}@[a-z]{9}\.internal$/],
    ["hello@quellmoor.marketing", /^[a-z]{5}@[a-z]{9}\.localhost$/],
    ["HELLO@QUELLMOOR.COM", /^[A-Z]{5}@[A-Z]{9}\.ALT$/],
  ];

  for (const [source, expected] of cases) assert.match(scrambleText(source, { seed: 3 }), expected);
});

test("lengthens the name when the safe ending is shorter", () => {
  assert.match(scrambleText("quellmoor.studio", { seed: 3 }), /^[a-z]{9}an\.test$/);
  assert.match(scrambleText("quellmoor.photography", { seed: 3 }), /^[a-z]{9}an\.localhost$/);
  assert.match(scrambleText("QUELLMOOR.STUDIO", { seed: 3 }), /^[A-Z]{9}AN\.TEST$/);
  assert.match(scrambleText("Quellmoor.Studio", { seed: 3 }), /^[A-Z][a-z]{8}an\.Test$/);
});

test("keeps schemes, www and already safe domains as written", () => {
  const result = scrambleText(
    "https://www.quellmoor.com · mailto:team@example.com · demo.example.org · shop.local · lab.test",
    { seed: 4 },
  );

  assert.match(result, /^https:\/\/www\.[a-z]{9}\.alt · mailto:[a-z]{4}@example\.com · demo\.example\.org · shop\.local · lab\.test$/);
});

test("scrambles everything after the domain as ordinary words", () => {
  const result = scrambleText("https://quellmoor.com/autumn-menu?page=2", { seed: 6 });

  assert.match(result, /^https:\/\/[a-z]{9}\.alt\/[a-z]{6}-[a-z]{4}\?[a-z]{4}=\d$/);
  assert.ok(!result.includes("autumn"));
});

test("leaves ordinary text with dots alone", () => {
  for (const source of ["e.g. i.e. U.S.A. a.m.", "Pi is 3.14 in v2.0.", "Next.js and Vue.js", "Section 2.Introduction", "Mr.Smith"]) {
    const result = scrambleText(source, { seed: 2 });

    assert.ok(!SAFE_ENDING.test(result.replace(/[.\s]+$/, "")), `"${source}" became "${result}".`);
  }
});

test("matches a name in an address with the same name elsewhere", () => {
  const scrambler = createScrambler({ seed: 8 });
  const prose = scrambler.scramble("Quellmoor");
  const address = scrambler.scramble("hello@quellmoor.com");

  assert.equal(address.split("@")[1].split(".")[0], prose.toLowerCase());
});

test("never leaves an invented email name at a real domain", () => {
  const scrambler = createScrambler({ seed: 1 });

  assert.match(scrambler.scramble("Keep hello@quellmoor.com here", createWordMatcher(["hello"])), /^Keep [a-z]{5}@quellmoor\.alt here$/);
  assert.equal(scrambler.scramble("Keep hello@quellmoor.com here", createWordMatcher(["nothing"])), "Keep hello@quellmoor.com here");
});

test("ships a lowercase, sorted list of real endings", () => {
  assert.ok(TOP_LEVEL_DOMAINS.length > 1000);
  assert.deepEqual([...TOP_LEVEL_DOMAINS], [...new Set(TOP_LEVEL_DOMAINS)].sort());
  assert.ok(TOP_LEVEL_DOMAINS.every((ending) => /^[a-z]+$/.test(ending)));
  for (const ending of ["com", "studio", "design", "dog", "io"]) assert.ok(TOP_LEVEL_DOMAINS.includes(ending));
  for (const ending of ["test", "example", "invalid", "localhost", "local", "alt", "internal", "xx"]) {
    assert.ok(!TOP_LEVEL_DOMAINS.includes(ending), `.${ending} must never be a real ending.`);
  }
});
