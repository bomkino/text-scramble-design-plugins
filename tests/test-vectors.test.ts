import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { scrambleTexts, type ScrambleOptions } from "../packages/core/src/scramble-text";

interface TestVector {
  inputs: string[];
  options: ScrambleOptions;
  outputs: string[];
}

// The same file ships with every copy of the engine. Same seed, same input: same output, everywhere.
const vectors: TestVector[] = JSON.parse(readFileSync(new URL("../packages/core/test-vectors.json", import.meta.url), "utf8"));

test("reproduces every shared test vector exactly", () => {
  assert.ok(vectors.length >= 10);
  for (const { inputs, options, outputs } of vectors) {
    assert.deepEqual(scrambleTexts(inputs, options), outputs, `Vector with seed ${JSON.stringify(options.seed)} changed.`);
  }
});
