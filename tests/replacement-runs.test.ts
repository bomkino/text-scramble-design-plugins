import assert from "node:assert/strict";
import test from "node:test";
import { buildReplacementRuns } from "../packages/core/src/replacement-runs";

test("tracks Figma UTF-16 ranges without splitting surrogate pairs", () => {
  assert.deepEqual(buildReplacementRuns("A𝕒 e\u0301", "Ba e\u0301"), [
    { characterIndex: 0, start: 0, end: 1, replacement: "B" },
    { characterIndex: 1, start: 1, end: 3, replacement: "a" },
  ]);
});

test("rejects replacement text that changes structural character count", () => {
  assert.throws(() => buildReplacementRuns("é", "e\u0301"), /preserve the source character structure/);
});
