import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { parse } from "acorn";
import {
  createScrambler,
  createSeededRandom,
  createWordMatcher,
  hasScramblableText,
  type ScrambleOptions,
  type TokenFilter,
} from "../packages/core/src/scramble-text";
import { TOP_LEVEL_DOMAINS } from "../packages/core/src/top-level-domains";
import { planWebAddresses, type Token } from "../packages/core/src/web-addresses";
import { COMMON_WORDS, UNWELCOME_FRAGMENTS } from "../packages/core/src/word-lists";

// The classic InDesign script runs an ES3 port of the core (packages/core/es3) in ExtendScript. These tests
// load the exact engine block scripts/build.mjs injects into the JSX, in a sandbox that adds the members
// ExtendScript puts on every object, and hold it to the TypeScript core: same input, same output.

interface TestVector {
  inputs: string[];
  options: ScrambleOptions;
  outputs: string[];
}

const vectors: TestVector[] = JSON.parse(readFileSync(new URL("../packages/core/test-vectors.json", import.meta.url), "utf8"));
const tablesSource = readFileSync(new URL("../packages/core/es3/unicode-tables.js", import.meta.url), "utf8");
const recordedUnicode = tablesSource.match(/^var UNICODE_TABLES = \{\n {2}version: "([^"]+)"/m)?.[1];
const sameUnicode = recordedUnicode === process.versions.unicode;
const unicodeSkip = sameUnicode
  ? false
  : `packages/core/es3/unicode-tables.js is for Unicode ${recordedUnicode}, this Node has Unicode ${process.versions.unicode}. ` +
    "Run `npm run unicode-tables` and `npm run build` when the project moves to this Node.";

// The sandbox's globals: every function and variable the engine declares.
type Engine = any;
let engineSource: Promise<string> | undefined;
let engine: Promise<Engine> | undefined;

function loadEngineSource(): Promise<string> {
  engineSource ??= import(new URL("../scripts/legacy-engine.mjs", import.meta.url).href).then((module) =>
    module.legacyEngineSource({
      commonWords: COMMON_WORDS,
      unwelcomeFragments: UNWELCOME_FRAGMENTS,
      topLevelDomains: TOP_LEVEL_DOMAINS,
    }),
  );
  return engineSource;
}

function loadEngine(): Promise<Engine> {
  engine ??= loadEngineSource().then((source) => {
    // An ordinary global object (not a contextified one) keeps the engine as fast as plain code; older Node
    // versions without DONT_CONTEXTIFY fall back to a contextified one.
    const sandbox = vm.createContext(vm.constants?.DONT_CONTEXTIFY ?? {});
    vm.runInContext(
      "Object.prototype.watch = function () {}; Object.prototype.unwatch = function () {};" +
        "Object.prototype.toSource = function () { return ''; }; Object.prototype.reflect = {};",
      sandbox,
    );
    vm.runInContext(source, sandbox, { filename: "legacy-engine.js" });
    return sandbox;
  });
  return engine;
}

// Runs fn with Math.random replaced, in Node and in the sandbox, by two copies of the same seeded sequence,
// so the unseeded path (no seed, or seed "") can be compared too.
async function withMathRandom<T>(seed: string, fn: () => T): Promise<T> {
  const es3 = await loadEngine();
  const sandboxMath = vm.runInContext("Math", es3);
  const original = Math.random;
  const originalSandbox = sandboxMath.random;
  Math.random = createSeededRandom(seed);
  sandboxMath.random = createSeededRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
    sandboxMath.random = originalSandbox;
  }
}

// ---------------------------------------------------------------------------------------------------------
// The random text pool.

const NAMES = ["Sloane", "Ruby", "Lisbon", "Quellmoor", "Brindle", "Ada", "Quell", "Zoë", "Hart", "ACME"];
const ASCII_WORDS = [
  ...NAMES,
  "the", "ten", "roses", "and", "a", "I", "x", "A", "of", "SHAPE", "Shape", "shape", "sHaPe", "quiet", "QUIET",
  "Stories", "deserve", "template", "magic", "rhythm", "strengths", "Mississippi", "aaaa", "zzz", "qu", "Kw",
  "Supercalifragilisticexpialidocious", "Pneumonoultramicroscopicsilicovolcanoconiosis", "ab", "OK",
];
const EXTENDSCRIPT_WORDS = [
  "watch", "unwatch", "toSource", "reflect", "constructor", "valueOf", "__proto__", "hasOwnProperty", "prototype",
  "Watch", "REFLECT", "toString",
];
const ACCENTED_WORDS = [
  "Café", "résumé", "naïve", "crème", "brûlée", "façade", "Ångström", "Łódź", "Ñandú", "São", "Paulo", "Đặng", "Việt",
  "Nguyễn", "Trường", "Phạm", "Hồ", "ở", "ÉLAN", "Élan", "élan", "Øre", "Œuvre", "Æsir", "æ", "Straße", "ß", "Łukasz",
  "Ŀ", "ŉ", "Ș", "ț", "ẗ", "ǖ", "ḱ", "Ā", "ĳ", "ﬁne", "ﬂow", "ﬀ", "ǅuro", "ǈub", "ǋ", "ǲ", "İstanbul", "ıi", "Iİıi",
  "\u212a", "\u212b", "\u2126", "ſ", "ẛ", "ΐ", "Ὀδυσσεύς", "ᾳ", "ῼ", "Ελληνικά", "ΑΣ", "σοφία", "ΟΔΟΣ", "Русский", "й",
  "Йод", "ЁЖ", "ёж", "עברית", "שָׁלוֹם", "العربية", "مَرْحَبًا", "東京", "漢字", "한국어", "서울", "ไทย", "हिन्दी", "क़", "ড়",
  "𝒜𝒷𝒸", "𐐀𐐨", "𐐷", "𝔄𝔟", "ᏣᎳᎩ", "ꭰ", "Ǆ", "ǆ",
];
const COMBINED_WORDS = [
  ...ACCENTED_WORDS.map((word) => word.normalize("NFD")),
  "ẹ́", "ê\u0323", "e\u0323\u0302", "e\u0302\u0323", "É\u0301", "a\u0301\u0301", "o\u031b\u0301", "ơ\u0301",
  "u\u0308\u0304", "A\u030a", "n\u0303", "i\u0307", "I\u0307", "Cafe\u0301", "Vie\u0323\u0302t", "й\u0308", "a\u20dd",
];
const NUMBERS = [
  "2026", "03", "14", "0", "9", "２０２６", "٢٠٢٦", "۲۰۲۶", "२०२६", "২০২৬", "𝟚𝟘𝟚𝟞", "𝟎𝟗", "๑๒๓", "߁߂", "᠐᠑", "𑁦𑁧",
  "3.14", "1,000", "v2", "2nd", "Ⅷ", "½", "²", "³", "Ⅻ", "①", "⑳", "〇", "ↂ", "𐌢", "12½", "2\u0301", "12\u0308x",
];
const OTHER = [
  "✦", "🙂", "👩‍💻", "🇵🇹", "©", "™", "€", "№", "°", "\u200d", "—", "…", "!", "?", "«»", "“”", "'", "\"", "#", "&",
  "\u0301", "\u0301abc", "\u20dd", "\ud83d", "\udc00x", "\u00a0", "\u3000",
];
const ADDRESSES = [
  "hello@quellmoor.co", "https://www.quellmoor.co/work/autumn-menu?ref=deck", "north-star.studio", "NORTH-STAR.STUDIO",
  "mail.north-star.co.uk", "Ada.Quell@orchard.photography", "mailto:team@example.com", "MAILTO:Team@Example.COM",
  "demo.example.org", "shop.local", "lab.test", "Zoë@café.fr", "e.g.", "i.e.", "U.S.A.", "a.m.", "Next.js", "Vue.js",
  "Mr.Smith", "Section 2.Introduction", "v2.0", "first.last@", "first.last@quellmoor.com", "x@t.co", "Quellmoor.Studio",
  "quellmoor.photography", "www.brindle.design", "WWW.BRINDLE.DESIGN", "www.studio", "www.example.com",
  "ftp://files.quellmoor.com:21/a", "https://пример.рф/путь", "orchard.io/menu", "a@b@c.com", "user+tag@mail.example.net",
  "user_name%x@host.museum", "über.de", "straße.de", "x@y.ǅz", "x@y.𐐀𐐨", "x@y.𐐀𐐀", "x@y.ΑΣ", "x@y.Ωmega", "x@y.e\u0301e",
  "x@y.Café", "quellmoor.unknownending", "quellmoor.Com", "SITE.De", "web2.app", "co-op.coop", "a--b.com", "-x.com",
  "x-.com", "1.2.3.4", "2026.design", "https://quellmoor.com/autumn-menu?page=2", "http://localhost:3000",
  "https://example.com", "hello@quellmoor.software", "hello@quellmoor.marketing", "hello@quellmoor.info",
  "hello@quellmoor.space", "hello@quellmoor.digital", "info@sub.domain.co.uk", "first.last.name@x.io", "@handle", "name@",
  "@.com", ".com", "quellmoor..com", "quellmoor.c", "quellmoor.c0m", "www.x", "WWW.Quellmoor.COM", "Www.Quellmoor.Com",
  "watch@reflect.toSource", "constructor.valueOf", "__proto__@prototype.com", "mailto:", "https://", "://x.com", "x://y.z",
  "mailto:x@y.z", "é.com", "e\u0301.com", "\u0301.com", "x.\u0301com", "x.ab\u0301", "ǅ.Studio", "x@ﬁ.com", "x@y.İo",
  "x@y.\u212aiwi", "sloane@Lisbon.co", "RUBY@LISBON.PHOTOGRAPHY",
];
const ATOMS = [...ASCII_WORDS, ...EXTENDSCRIPT_WORDS, ...ACCENTED_WORDS, ...COMBINED_WORDS, ...NUMBERS, ...OTHER, ...ADDRESSES];
const SEPARATORS = [" ", " ", " ", " ", ", ", ". ", "\n", "\t", " — ", "", "", "-", "/", "@", ".", ":", "'", "\u00a0", "…", "(", "  ", "\r\n"];

function pickFrom<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

function randomText(random: () => number): string {
  const count = 1 + Math.floor(random() * 10);
  let text = random() < 0.1 ? pickFrom(OTHER, random) : "";
  for (let index = 0; index < count; index++) {
    const pool = random() < 0.25 ? ADDRESSES : ATOMS;
    text += pickFrom(pool, random);
    if (index < count - 1) text += pickFrom(SEPARATORS, random);
  }
  return text;
}

const OPTION_VARIANTS: Array<Partial<ScrambleOptions>> = [
  {},
  { scrambleNumbers: true },
  { scrambleNumbers: false },
  { candidateCount: 0 },
  { candidateCount: 1 },
  { candidateCount: 5, scrambleNumbers: false },
];
const SEEDS: Array<number | string | undefined> = [
  undefined, "", 0, 1, 7, 42, -3, 3.5, 1e21, 2026, "deck", "studio", "web", "Zoë", "🙂", "a\u0000b", "watch", "__proto__",
];

// Filters as the hosts build them: scramble only listed words, or keep listed words as they are.
function filtersFor(entries: string[], matcher: (entries: readonly string[]) => TokenFilter) {
  const matches = matcher(entries);
  return [undefined, matches, (token: string) => !matches(token)];
}

// ---------------------------------------------------------------------------------------------------------

test("parses as ES3, stays ASCII and declares each name once", async () => {
  const source = await loadEngineSource();
  const program = parse(source, { ecmaVersion: 3, allowReserved: "never" });
  assert.ok(/^[\t\n\r\x20-\x7e]*$/.test(source), "The ES3 engine must be ASCII.");

  const names = new Set<string>();
  for (const statement of program.body) {
    const declared =
      statement.type === "FunctionDeclaration"
        ? [statement.id.name]
        : statement.type === "VariableDeclaration"
          ? statement.declarations.map((declaration) => (declaration.id.type === "Identifier" ? declaration.id.name : ""))
          : [];
    for (const name of declared) {
      assert.ok(!names.has(name), `The ES3 engine declares ${name} twice.`);
      names.add(name);
    }
  }
  for (const name of ["createScrambler", "createSeededRandom", "createWordMatcher", "hasScramblableText", "scrambleText", "scrambleTexts", "scrambleContents", "hasScramblableContents"]) {
    assert.ok(names.has(name), `The ES3 engine must define ${name}.`);
  }
});

test("avoids ES5 library calls and string indexing that ExtendScript lacks", async () => {
  const source = (await loadEngineSource())
    .replace(/\/\/.*$/gm, "")
    // String#indexOf is ES1; only Array#indexOf is missing, and the engine calls it on strings only.
    .replace(/candidate\.indexOf\(/g, "");
  const forbidden = [
    /\.(?:forEach|map|filter|some|every|reduce|reduceRight|indexOf|lastIndexOf)\s*\(/g,
    /\b(?:Object\.(?:keys|create|defineProperty|freeze|getPrototypeOf)|Array\.isArray|JSON\.|Date\.now|Math\.imul|String\.fromCodePoint)\b/g,
    /\.(?:trim|normalize|codePointAt|includes|startsWith|endsWith|repeat|padStart|padEnd)\s*\(/g,
    /,\s*[\]}]/g,
    /\b(?:text|token|candidate|source|input|character|word|ending)\[/g,
  ];
  for (const pattern of forbidden) {
    const match = source.match(pattern);
    assert.equal(match, null, `The ES3 engine uses ${JSON.stringify(match?.[0])}, which ExtendScript lacks.`);
  }
});

test("reproduces every shared test vector exactly", async () => {
  const es3 = await loadEngine();
  assert.ok(vectors.length >= 17);
  for (const { inputs, options, outputs } of vectors) {
    const scrambler = es3.createScrambler(options);
    assert.deepEqual(
      inputs.map((input) => scrambler.scramble(input)),
      outputs,
      `Vector with seed ${JSON.stringify(options.seed)} differs.`,
    );
    assert.deepEqual(Array.from(es3.scrambleTexts(inputs, options)), outputs);
  }
});

function referenceTokens(input: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of input.matchAll(/(?:\p{L}\p{M}*)+|\p{N}+/gu)) {
    for (const char of input.slice(last, match.index)) tokens.push({ text: char, kind: "other" });
    tokens.push({ text: match[0], kind: /^(?:\p{L}\p{M}*)+$/u.test(match[0]) ? "word" : "number" });
    last = match.index + match[0].length;
  }
  for (const char of input.slice(last)) tokens.push({ text: char, kind: "other" });
  return tokens;
}

test("tokenizes and plans web addresses exactly like the core", async () => {
  const es3 = await loadEngine();
  const random = createSeededRandom("tokens");
  const texts = [...ATOMS, ...Array.from({ length: 600 }, () => randomText(random))];

  for (const text of texts) {
    const tokens = referenceTokens(text);
    const es3Tokens = es3.tokenize(text);
    assert.deepEqual(
      Array.from(es3Tokens, (token: Token) => ({ text: token.text, kind: token.kind })),
      tokens,
      `Tokens differ for ${JSON.stringify(text)}.`,
    );

    for (const share of [1, 0.6]) {
      const accepted = tokens.map((token) => token.kind !== "other" && random() < share);
      const expected = [...planWebAddresses(tokens, (index) => accepted[index])].sort((a, b) => a[0] - b[0]);
      const es3Plans = es3.planWebAddresses(es3Tokens, (index: number) => accepted[index]);
      const actual: Array<[number, object]> = [];
      for (let index = 0; index < es3Plans.length; index++) {
        if (es3Plans[index] !== undefined) actual.push([index, { ...es3Plans[index] }]);
      }
      assert.deepEqual(actual, expected, `Address plans differ for ${JSON.stringify(text)}.`);
    }
  }
});

test("matches the core on random text with an injected random source and a shared scrambler", async () => {
  const es3 = await loadEngine();
  const random = createSeededRandom("injected");
  let compared = 0;

  for (let trial = 0; trial < 600; trial++) {
    const variant = OPTION_VARIANTS[trial % OPTION_VARIANTS.length];
    const core = createScrambler({ ...variant, random: createSeededRandom(trial) });
    const legacy = es3.createScrambler({ ...variant, random: es3.createSeededRandom(trial) });
    for (let text = 0; text < 3; text++) {
      const input = randomText(random);
      assert.equal(legacy.scramble(input), core.scramble(input), `Trial ${trial} differs for ${JSON.stringify(input)}.`);
      compared++;
    }
  }
  assert.ok(compared >= 1500);
});

test("matches the core on random text with seeds, including no seed and an empty seed", async () => {
  const es3 = await loadEngine();
  const random = createSeededRandom("seeded");
  let compared = 0;

  for (let trial = 0; trial < 450; trial++) {
    const seed = SEEDS[trial % SEEDS.length];
    const options = { ...OPTION_VARIANTS[trial % OPTION_VARIANTS.length], seed };
    const inputs = [randomText(random), randomText(random), randomText(random)];
    await withMathRandom(`trial ${trial}`, () => {
      const core = createScrambler(options);
      const legacy = es3.createScrambler(options);
      for (const input of inputs) {
        assert.equal(legacy.scramble(input), core.scramble(input), `Seed ${JSON.stringify(seed)} differs for ${JSON.stringify(input)}.`);
        compared++;
      }
    });
  }
  assert.ok(compared >= 1350);

  // An injected random source wins over a seed.
  const input = "Sloane met Ruby at hello@quellmoor.co in 2026.";
  assert.equal(
    es3.createScrambler({ seed: 1, random: es3.createSeededRandom(5) }).scramble(input),
    createScrambler({ seed: 1, random: createSeededRandom(5) }).scramble(input),
  );
});

test("matches the core with word filters, including parts of emails", async () => {
  const es3 = await loadEngine();
  const random = createSeededRandom("filters");
  const listPool = [...NAMES, ...ASCII_WORDS.slice(0, 20), "hello", "quellmoor", "Quellmoor.co", "Zoe Hart", "ZOË", "2026", "co", "studio", "www", "orchard", "first.last", "x", "é", "e\u0301"];
  let compared = 0;

  for (let trial = 0; trial < 300; trial++) {
    const entries = Array.from({ length: 1 + Math.floor(random() * 4) }, () => pickFrom(listPool, random));
    const coreFilters = filtersFor(entries, createWordMatcher);
    const es3Filters = filtersFor(entries, es3.createWordMatcher);
    const seed = trial % 2 === 0 ? trial : undefined;
    const variant = OPTION_VARIANTS[trial % OPTION_VARIANTS.length];
    const core = createScrambler(seed === undefined ? { ...variant, random: createSeededRandom(trial) } : { ...variant, seed });
    const legacy = es3.createScrambler(seed === undefined ? { ...variant, random: es3.createSeededRandom(trial) } : { ...variant, seed });
    for (let text = 0; text < 3; text++) {
      const input = random() < 0.5 ? `${pickFrom(ADDRESSES, random)} ${randomText(random)}` : randomText(random);
      const which = Math.floor(random() * 3);
      assert.equal(
        legacy.scramble(input, es3Filters[which]),
        core.scramble(input, coreFilters[which]),
        `Filter ${which} of ${JSON.stringify(entries)} differs for ${JSON.stringify(input)}.`,
      );
      compared++;
    }
  }
  assert.ok(compared >= 900);
});

test("builds word matchers that agree with the core", async () => {
  const es3 = await loadEngine();
  const core = createWordMatcher(["Zoë Hart", "ACME", "2026", "quellmoor.co", "İstanbul", "ǅuro", "𐐀", "watch", "__proto__"]);
  const legacy = es3.createWordMatcher(["Zoë Hart", "ACME", "2026", "quellmoor.co", "İstanbul", "ǅuro", "𐐀", "watch", "__proto__"]);
  for (const token of [...ATOMS, ...ATOMS.flatMap((atom) => referenceTokens(atom).map((token) => token.text)), "", "zoe", "ZOE", "Zoe\u0308", "hart", "acme", "proto", "𐐨", "dzuro", "ǆuro", "ǄURO", "istanbul", "constructor", "anything", "Zo", "2025"]) {
    assert.equal(legacy(token), core(token), `Matcher differs for ${JSON.stringify(token)}.`);
  }
  assert.equal(es3.createWordMatcher([])("anything"), false);
});

test("draws the same seeded random numbers as the core", async () => {
  const es3 = await loadEngine();
  for (const seed of ["text-scramble", "", 0, 7, "7", -1, 3.5, "Zoë", "🙂", "a\u0000b", 4294967295, "watch"]) {
    const core = createSeededRandom(seed);
    const legacy = es3.createSeededRandom(seed);
    for (let draw = 0; draw < 10_000; draw++) {
      const expected = core();
      const actual = legacy();
      if (actual !== expected) assert.fail(`Draw ${draw} for seed ${JSON.stringify(seed)}: ${actual} instead of ${expected}.`);
    }
  }
  const pinned = es3.createSeededRandom("text-scramble");
  assert.deepEqual([pinned(), pinned(), pinned()], [0.2002851574216038, 0.2523116529919207, 0.9054286654572934]);
});

test("detects scramblable text exactly like the core", async () => {
  const es3 = await loadEngine();
  const random = createSeededRandom("detect");
  const texts = [...ATOMS, " — ✦\n", "Ⅷ · ½ · ²", "٢٠٢٦", "", ...Array.from({ length: 300 }, () => randomText(random))];
  for (const text of texts) {
    for (const scrambleNumbers of [undefined, true, false]) {
      const expected = hasScramblableText(text, { scrambleNumbers });
      assert.equal(es3.hasScramblableText(text, { scrambleNumbers }), expected, `Differs for ${JSON.stringify(text)}.`);
      if (scrambleNumbers !== undefined) assert.equal(es3.hasScramblableContents(text, scrambleNumbers), expected);
    }
    assert.equal(es3.hasScramblableText(text), hasScramblableText(text));
  }
});

test("keeps scrambleContents working for the classic script's main code", async () => {
  const es3 = await loadEngine();
  const texts = ["Sloane met Ruby in Lisbon.", "RUBY and SLOANE, 2026 · hello@quellmoor.co", "watch reflect toSource unwatch"];
  for (const scrambleNumbers of [true, false]) {
    await withMathRandom(`contents ${scrambleNumbers}`, () => {
      const core = createScrambler({ scrambleNumbers });
      const cache = vm.runInContext("({})", es3);
      for (const text of texts) assert.equal(es3.scrambleContents(text, scrambleNumbers, cache), core.scramble(text));
      assert.ok(Object.prototype.hasOwnProperty.call(cache, "~scrambler"));
    });
  }
});

test("reads Unicode exactly as this Node does, code point by code point", { skip: unicodeSkip }, async () => {
  const es3 = await loadEngine();
  // One line per code point that is a letter, mark, number or space, changes case, or decomposes.
  const describe = vm.runInContext(
    `(function (from, to) {
      var lines = [];
      var codePoint;
      for (codePoint = from; codePoint < to; codePoint += 1) {
        var character = fromCodePoint(codePoint);
        var category = (isLetter(codePoint) ? "L" : "") + (isMark(codePoint) ? "M" : "") + (isNumber(codePoint) ? "N" : "") +
          (isDecimalDigit(codePoint) ? "d" : "") + (isSpace(codePoint) ? "s" : "");
        var lower = lowercaseText(character);
        var upper = uppercaseText(character);
        var parts = category.charAt(0) === "L" ? decomposeLetter(character) : { letter: character, marks: "" };
        if (category || lower !== character || upper !== character || parts.marks) {
          lines.push(codePoint + " " + category + " " + escape(lower) + " " + escape(upper) + " " + escape(parts.letter + parts.marks) +
            " " + (lowercaseLetter(character) === lower ? 1 : 0) + (isUppercaseLetter(character) ? 1 : 0));
        }
      }
      return lines.join("\\n");
    })`,
    es3,
  );
  const step = 0x10000;
  for (let from = 0; from <= 0x10ffff; from += step) {
    const lines: string[] = [];
    for (let codePoint = from; codePoint < from + step; codePoint++) {
      const character = String.fromCodePoint(codePoint);
      const category =
        (/^\p{L}$/u.test(character) ? "L" : "") +
        (/^\p{M}$/u.test(character) ? "M" : "") +
        (/^\p{N}$/u.test(character) ? "N" : "") +
        (/^\p{Nd}$/u.test(character) ? "d" : "") +
        (/^\s$/u.test(character) ? "s" : "");
      const lower = character.toLowerCase();
      const upper = character.toUpperCase();
      let decomposed = character;
      if (category.startsWith("L")) {
        const parts = Array.from(character.normalize("NFD"));
        if (parts.length > 1 && /^\p{L}$/u.test(parts[0]) && parts.slice(1).every((part) => /^\p{M}$/u.test(part))) {
          decomposed = parts.join("");
        }
      }
      if (category || lower !== character || upper !== character || decomposed !== character) {
        const lowercaseLetter = Array.from(lower).length === 1 ? lower : character;
        lines.push(
          `${codePoint} ${category} ${escape(lower)} ${escape(upper)} ${escape(decomposed)} ` +
            `${lowercaseLetter === lower ? 1 : 0}${character !== lower ? 1 : 0}`,
        );
      }
    }
    const actual = describe(from, from + step).split("\n");
    const expected = lines.join("\n").split("\n");
    if (actual.join("\n") !== expected.join("\n")) {
      const index = expected.findIndex((line, position) => line !== actual[position]);
      assert.fail(`Plane ${from / step} differs: expected "${expected[index]}", got "${actual[index]}".`);
    }
  }
});

test("composes accents exactly as the core does", { skip: unicodeSkip }, async () => {
  const es3 = await loadEngine();
  const { commonAccentedLetterPattern } = await import(new URL("../scripts/unicode-tables.mjs", import.meta.url).href);
  const common: RegExp = commonAccentedLetterPattern();
  // The core's composeLetter.
  const compose = (letter: string, marks: string) => {
    const composed = (letter + marks).normalize("NFC");
    return common.test(composed) && composed.normalize("NFD") === letter + marks ? composed : null;
  };
  const markSequences = new Set<string>(["\u0301", "\u0301\u0301", "\u0302\u0323", "\u0323\u0302", "\u0308\u0304", "\u031b", "\u20dd"]);
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint++) {
    const parts = Array.from(String.fromCodePoint(codePoint).normalize("NFD"));
    if (parts.length > 1 && parts.slice(1).every((part) => /^\p{M}$/u.test(part))) markSequences.add(parts.slice(1).join(""));
  }
  const letters = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", "ı", "ſ", "α", "Ω", "и", "ơ"];
  for (const marks of markSequences) {
    for (const letter of letters) {
      assert.equal(es3.composeLetter(letter, marks), compose(letter, marks), `Differs for ${escape(letter + marks)}.`);
    }
  }
});

test("ships tables generated from the recorded Unicode version", { skip: unicodeSkip }, async () => {
  const { buildUnicodeTables, renderUnicodeTables } = await import(new URL("../scripts/unicode-tables.mjs", import.meta.url).href);
  assert.equal(tablesSource, renderUnicodeTables(buildUnicodeTables()), "packages/core/es3/unicode-tables.js is stale. Run `npm run unicode-tables`.");
  assert.ok(Buffer.byteLength(tablesSource) < 60_000);
});
