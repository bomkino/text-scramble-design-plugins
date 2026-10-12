import assert from "node:assert/strict";
import test from "node:test";
import { buildReplacementRuns } from "../packages/core/src/replacement-runs";
import { createSeededRandom, scrambleText } from "../packages/core/src/scramble-text";

function hasMarks(text: string): boolean {
  return /\p{M}/u.test(text.normalize("NFD"));
}

function withoutMarks(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

const ACCENTED = [
  "Café résumé naïve, crème brûlée and a façade.",
  "Đặng Việt · Ångström · Łódź · Ñandú · São Paulo",
  "ÉLAN Élan élan · ǅuro · İstanbul ıi",
  "한국어 東京 Ελληνικά Русский",
];

test("keeps one character for every source character, in composed or decomposed text", () => {
  const sources = ACCENTED.flatMap((text) => [text, text.normalize("NFD"), text.normalize("NFC")]);
  sources.push("ẹ́ ệ ệ É́"); // partly composed, and an extra mark on a composed letter

  for (let seed = 1; seed <= 60; seed++) {
    for (const source of sources) {
      const result = scrambleText(source, { random: createSeededRandom(seed) });

      assert.equal(Array.from(result).length, Array.from(source).length, `Character count changed for "${source}".`);
      assert.doesNotThrow(() => buildReplacementRuns(source, result));
      Array.from(source).forEach((char, index) => {
        if (!/[\p{L}\p{M}\p{N}]/u.test(char)) assert.equal(Array.from(result)[index], char);
      });
    }
  }
});

test("renders a composed and a decomposed accent as the same invented word", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const [composed, decomposed] = scrambleText("Café Café", { random: createSeededRandom(seed) }).split(" ");

    assert.equal(withoutMarks(composed), withoutMarks(decomposed));
    // The composed form can only drop its accent when no single character can carry it.
    if (hasMarks(composed)) assert.equal(composed.normalize("NFC"), decomposed.normalize("NFC"));
  }
});

test("keeps accents on the invented words wherever Unicode can", () => {
  const source = "Café résumé naïve, crème brûlée and a façade. Đặng Việt, São Paulo, Ångström, Ñandú.";
  const accented = Array.from(source).filter((char) => char.normalize("NFD").length > 1).length;
  let kept = 0;

  for (let seed = 1; seed <= 100; seed++) {
    const result = Array.from(scrambleText(source, { seed }));
    Array.from(source).forEach((char, index) => {
      if (char.normalize("NFD").length > 1 && hasMarks(result[index])) kept++;
    });
  }

  assert.ok(kept / (accented * 100) > 0.9, `Kept only ${kept} of ${accented * 100} accents.`);
});

test("keeps stacked marks together on one invented letter", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const result = scrambleText("Việt", { seed });
    const letter = Array.from(result)[2];

    if (hasMarks(letter)) assert.deepEqual(Array.from(letter.normalize("NFD")).slice(1), ["̣", "̂"]);
  }
});

test("treats each Hangul syllable as one letter", () => {
  const result = scrambleText("한국어", { seed: 4 });

  assert.equal(Array.from(result).length, 3);
  assert.match(result, /^[a-z]{3}$/);
});
