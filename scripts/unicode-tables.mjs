// Builds the Unicode data that the ES3 engine (packages/core/es3/scramble-engine.js) needs, from Node's own
// Unicode support, so the classic InDesign script classifies, decomposes and changes the case of text exactly
// as the TypeScript core does on the same Unicode version. ExtendScript has no \p{...} regexes, no
// String#normalize and unknown case tables, so the engine reads all of that from these tables instead.
//
// `npm run unicode-tables` rewrites packages/core/es3/unicode-tables.js. Run it, then `npm run build`, when
// process.versions.unicode changes; tests/legacy-engine.test.ts says so when the committed tables are stale.
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const UNICODE_TABLES_PATH = path.join(root, "packages", "core", "es3", "unicode-tables.js");

const LAST_CODE_POINT = 0x10ffff;
const LETTER = /^\p{L}$/u;
const MARK = /^\p{M}$/u;
const NUMBER = /^\p{N}$/u;
const DECIMAL = /^\p{Nd}$/u;
const SPACE = /^\s$/u;

// The core keeps an accent only where a common precomposed letter exists. Read that rule from the core
// itself, so the tables cannot drift from it.
export function commonAccentedLetterPattern() {
  const source = readFileSync(path.join(root, "packages", "core", "src", "scramble-text.ts"), "utf8");
  const match = source.match(/const COMMON_ACCENTED_LETTER_PATTERN = \/(.+)\/u;/);
  if (!match) throw new Error("packages/core/src/scramble-text.ts no longer defines COMMON_ACCENTED_LETTER_PATTERN.");
  return new RegExp(match[1], "u");
}

function addToRanges(ranges, codePoint) {
  const last = ranges[ranges.length - 1];
  if (last && last[1] === codePoint - 1) last[1] = codePoint;
  else ranges.push([codePoint, codePoint]);
}

// Code points that map to one other code point, grouped into runs that share a step and an offset:
// A-Z is one run (step 1, +32) and the alternating capitals of Latin Extended-A are another (step 2, +1).
function toCaseRuns(mappings) {
  const runs = [];
  for (const [codePoint, mapped] of mappings) {
    const delta = mapped - codePoint;
    const run = runs[runs.length - 1];
    if (run && run.delta === delta) {
      const step = run.count === 1 ? codePoint - run.start : run.step;
      if ((step === 1 || step === 2) && codePoint === run.start + step * run.count) {
        run.step = step;
        run.count++;
        continue;
      }
    }
    runs.push({ start: codePoint, count: 1, step: 1, delta });
  }
  return runs;
}

/**
 * Reads every code point through Node's regexes, String#normalize and case mapping, and returns the tables
 * the ES3 engine needs, as plain data.
 */
export function buildUnicodeTables() {
  const common = commonAccentedLetterPattern();
  const letters = [];
  const marks = [];
  const numbers = [];
  const decimals = [];
  const spaces = [];
  const lowercase = [];
  const lowercaseExpansions = [];
  const uppercase = [];
  const uppercaseExpansions = [];
  const decompositions = [];
  const composable = [];

  for (let codePoint = 0; codePoint <= LAST_CODE_POINT; codePoint++) {
    const character = String.fromCodePoint(codePoint);
    if (LETTER.test(character)) addToRanges(letters, codePoint);
    if (MARK.test(character)) addToRanges(marks, codePoint);
    if (NUMBER.test(character)) addToRanges(numbers, codePoint);
    if (DECIMAL.test(character)) addToRanges(decimals, codePoint);
    if (SPACE.test(character)) addToRanges(spaces, codePoint);

    for (const [change, mappings, expansions] of [
      [character.toLowerCase(), lowercase, lowercaseExpansions],
      [character.toUpperCase(), uppercase, uppercaseExpansions],
    ]) {
      if (change === character) continue;
      const parts = Array.from(change, (part) => part.codePointAt(0));
      if (parts.length === 1) mappings.push([codePoint, parts[0]]);
      else expansions.push([codePoint, parts]);
    }

    // decomposeLetter in the core: a letter whose NFD is one letter followed by one or more marks.
    if (LETTER.test(character)) {
      const parts = Array.from(character.normalize("NFD"));
      if (parts.length > 1 && LETTER.test(parts[0]) && parts.slice(1).every((part) => MARK.test(part))) {
        decompositions.push([codePoint, parts[0].codePointAt(0), parts.slice(1).map((part) => part.codePointAt(0))]);
      }
    }

    // composeLetter in the core returns c for letter + marks exactly when c is common, NFC(c) is c and NFD(c)
    // is letter + marks. The engine looks those up through the decomposition table.
    if (common.test(character) && character.normalize("NFC") === character && character.normalize("NFD") !== character) {
      composable.push(codePoint);
    }
  }

  const decomposed = new Set(decompositions.map(([codePoint]) => codePoint));
  for (const codePoint of composable) {
    if (!decomposed.has(codePoint)) {
      throw new Error(`U+${codePoint.toString(16)} is a common accented letter that is not one letter plus marks.`);
    }
  }
  const composableRanges = [];
  for (const codePoint of composable) addToRanges(composableRanges, codePoint);

  return {
    unicodeVersion: process.versions.unicode,
    letters,
    marks,
    numbers,
    decimals,
    spaces,
    lowercase: toCaseRuns(lowercase),
    lowercaseExpansions,
    uppercase: toCaseRuns(uppercase),
    uppercaseExpansions,
    decompositions,
    composable: composableRanges,
  };
}

const base36 = (value) => value.toString(36);

function encodeRanges(ranges) {
  const numbers = [];
  let previousEnd = 0;
  for (const [start, end] of ranges) {
    numbers.push(start - previousEnd, end - start);
    previousEnd = end;
  }
  return numbers.map(base36);
}

function encodeCaseRuns(runs) {
  const numbers = [];
  let previous = 0;
  for (const { start, count, step, delta } of runs) {
    numbers.push(start - previous, count, step, delta);
    previous = start + step * (count - 1);
  }
  return numbers.map(base36);
}

function encodeExpansions(expansions) {
  const numbers = [];
  let previous = 0;
  for (const [codePoint, parts] of expansions) {
    numbers.push(codePoint - previous, parts.length, ...parts);
    previous = codePoint;
  }
  return numbers.map(base36);
}

// Mark sequences are stored once, most frequent first, and each decomposition points at one by index.
function encodeDecompositions(decompositions) {
  const counts = new Map();
  for (const [, , marks] of decompositions) counts.set(marks.join(","), (counts.get(marks.join(",")) ?? 0) + 1);
  const sequences = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || (a < b ? -1 : a > b ? 1 : 0));
  const indexes = new Map(sequences.map((sequence, index) => [sequence, index]));

  const markSequences = [];
  for (const sequence of sequences) {
    const marks = sequence.split(",").map(Number);
    markSequences.push(marks.length, ...marks);
  }
  const entries = [];
  let previous = 0;
  for (const [codePoint, letter, marks] of decompositions) {
    entries.push(codePoint - previous, letter, indexes.get(marks.join(",")));
    previous = codePoint;
  }
  return { markSequences: markSequences.map(base36), decompositions: entries.map(base36) };
}

// Splits a long comma list over several string literals, so the file stays readable and diffs stay small.
function stringLiteral(numbers, indent) {
  const lines = [];
  let line = "";
  for (const number of numbers) {
    const next = line ? `${line},${number}` : number;
    if (next.length > 100 && line) {
      lines.push(`${line},`);
      line = number;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines.map((text) => JSON.stringify(text)).join(` +\n${indent}`);
}

/** Renders the tables as packages/core/es3/unicode-tables.js: ES3, ASCII only, deterministic. */
export function renderUnicodeTables(tables) {
  const { markSequences, decompositions } = encodeDecompositions(tables.decompositions);
  const fields = [
    ["letters", "\\p{L}: ranges", encodeRanges(tables.letters)],
    ["marks", "\\p{M}: ranges", encodeRanges(tables.marks)],
    ["numbers", "\\p{N}: ranges", encodeRanges(tables.numbers)],
    ["decimals", "\\p{Nd}: ranges", encodeRanges(tables.decimals)],
    ["spaces", "\\s: ranges", encodeRanges(tables.spaces)],
    ["lowercase", "toLowerCase() of one code point, when it is one other code point: case runs", encodeCaseRuns(tables.lowercase)],
    ["lowercaseExpansions", "toLowerCase() of one code point, when it is several: expansions", encodeExpansions(tables.lowercaseExpansions)],
    ["uppercase", "toUpperCase() of one code point, when it is one other code point: case runs", encodeCaseRuns(tables.uppercase)],
    ["uppercaseExpansions", "toUpperCase() of one code point, when it is several: expansions", encodeExpansions(tables.uppercaseExpansions)],
    ["markSequences", "the mark sequences decompositions refer to, by index: length, marks...", markSequences],
    ["decompositions", "letters whose NFD is one letter plus marks: code point gap, letter, mark sequence index", decompositions],
    ["composable", "common accented letters the engine may write (see composeLetter): ranges", encodeRanges(tables.composable)],
  ];

  const body = fields
    .map(([name, description, numbers]) => `  // ${description}\n  ${name}:\n    ${stringLiteral(numbers, "    ")}`)
    .join(",\n");
  return `// Generated by scripts/unicode-tables.mjs from the Unicode ${tables.unicodeVersion} data built into Node.js. Do not edit.
// Run \`npm run unicode-tables\` to regenerate it, then \`npm run build\`.
//
// Every table is a comma-separated list of base-36 integers. Ranges are pairs (gap, size): each range starts
// gap code points after the previous range's end (the first after 0) and ends size code points later. Case
// runs are (gap, count, step, delta): count code points, step apart, starting gap after the previous run's
// last code point, each mapping to itself plus delta. Expansions are (gap, length, code points...).
var UNICODE_TABLES = {
  version: ${JSON.stringify(tables.unicodeVersion)},
${body}
};
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = renderUnicodeTables(buildUnicodeTables());
  await writeFile(UNICODE_TABLES_PATH, source);
  console.log(`Wrote ${path.relative(root, UNICODE_TABLES_PATH)} (Unicode ${process.versions.unicode}, ${Buffer.byteLength(source)} bytes).`);
}
