import { COMMON_WORDS as COMMON_WORD_LIST, UNWELCOME_FRAGMENTS } from "./word-lists";

export type RandomSource = () => number;

/** Decides whether one word or number is scrambled. Return false to leave that token exactly as it is. */
export type TokenFilter = (token: string) => boolean;

export interface ScrambleOptions {
  /** Supplies the randomness directly. Takes priority over `seed`. */
  random?: RandomSource;
  /**
   * Makes the result repeatable. Each word and number draws from its own random stream, derived from the
   * seed and the word itself, so with the same seed a word becomes the same invented word in every text,
   * run and app. An empty string counts as no seed.
   */
  seed?: number | string;
  scrambleNumbers?: boolean;
  candidateCount?: number;
}

export interface Scrambler {
  /**
   * Scrambles one text. A word that repeats across calls on the same scrambler becomes the same invented
   * word every time. Tokens the filter rejects are left untouched.
   */
  scramble(input: string, filter?: TokenFilter): string;
}

const TOKEN_PATTERN = /(?:\p{L}\p{M}*)+|\p{N}+/gu;
const LETTER_PATTERN = /^(?:\p{L}\p{M}*)+$/u;
const LETTER_CHARACTER_PATTERN = /^\p{L}$/u;
const MARK_CHARACTER_PATTERN = /^\p{M}$/u;
const DECIMAL_DIGIT_PATTERN = /^\p{Nd}$/u;
const VOWEL_PATTERN = /[aeiou]/;
const TRIPLE_VOWEL_PATTERN = /[aeiou]{3}/;
const TRIPLE_CONSONANT_PATTERN = /[^aeiou]{3}/;
const REPEATED_BIGRAM_PATTERN = /([a-z]{2})\1/;

export function hasScramblableText(input: string, options: Pick<ScrambleOptions, "scrambleNumbers"> = {}): boolean {
  return Array.from(input).some(
    (char) =>
      LETTER_CHARACTER_PATTERN.test(char) || (options.scrambleNumbers !== false && DECIMAL_DIGIT_PATTERN.test(char)),
  );
}

const VOWELS = ["a", "a", "a", "e", "e", "e", "e", "i", "i", "o", "o", "u"];
const CONSONANTS = [
  "b",
  "c",
  "d",
  "f",
  "g",
  "h",
  "l",
  "l",
  "l",
  "m",
  "m",
  "m",
  "n",
  "n",
  "n",
  "n",
  "p",
  "r",
  "r",
  "r",
  "r",
  "s",
  "s",
  "s",
  "t",
  "t",
  "t",
  "v",
  "v",
  "w",
];
const END_CONSONANTS = ["d", "l", "l", "m", "n", "n", "r", "r", "s", "s", "t"];
const CLUSTER_FOLLOWERS: Record<string, readonly string[]> = {
  b: ["l", "r"],
  c: ["h", "l", "r"],
  d: ["r"],
  f: ["l", "r"],
  g: ["l", "r"],
  p: ["l", "r"],
  s: ["c", "h", "l", "p", "t"],
  t: ["h", "r"],
};

const COMMON_WORDS = new Set(COMMON_WORD_LIST);

const WIDTHS: Record<string, number> = {
  i: 0.34,
  j: 0.43,
  l: 0.38,
  f: 0.55,
  r: 0.58,
  t: 0.56,
  c: 0.82,
  s: 0.82,
  v: 0.86,
  x: 0.86,
  y: 0.86,
  z: 0.8,
  a: 0.9,
  b: 0.92,
  d: 0.92,
  e: 0.88,
  g: 0.92,
  h: 0.94,
  k: 0.9,
  n: 0.94,
  o: 0.94,
  p: 0.92,
  q: 0.94,
  u: 0.94,
  m: 1.34,
  w: 1.28,
};

// How much an accent that would fall off the invented word counts against a candidate. High enough that a
// candidate which can carry the source's accents almost always wins.
const STRANDED_MARK_WEIGHT = 2;

// FNV-1a over UTF-16 code units, so any number or string becomes a 32-bit seed.
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

/** A small, repeatable random source (mulberry32), seeded from any number or string. */
export function createSeededRandom(seed: number | string): RandomSource {
  let state = hashSeed(String(seed));
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: RandomSource): T {
  const index = Math.min(items.length - 1, Math.floor(random() * items.length));
  return items[index];
}

function isVowel(char: string): boolean {
  return VOWEL_PATTERN.test(char);
}

function makeCandidate(length: number, random: RandomSource): string {
  if (length === 1) return pick(VOWELS, random);

  const result: string[] = [];

  for (let index = 0; index < length; index++) {
    if (index === 0) {
      result.push(random() < 0.18 ? pick(VOWELS, random) : pick(CONSONANTS, random));
      continue;
    }

    const previous = result[index - 1];
    const beforePrevious = result[index - 2];
    const finalPosition = index === length - 1;

    if (finalPosition) {
      if (isVowel(previous)) {
        result.push(
          random() < 0.07
            ? pick(
                VOWELS.filter((letter) => letter !== previous),
                random,
              )
            : pick(END_CONSONANTS, random),
        );
      } else {
        result.push(pick(VOWELS, random));
      }
      continue;
    }

    if (isVowel(previous)) {
      const mustUseConsonant = beforePrevious !== undefined && isVowel(beforePrevious);
      result.push(mustUseConsonant || random() < 0.95 ? pick(CONSONANTS, random) : pick(VOWELS, random));
      continue;
    }

    const followers = CLUSTER_FOLLOWERS[previous];
    const alreadyInCluster = beforePrevious !== undefined && !isVowel(beforePrevious);
    if (!alreadyInCluster && followers && random() < 0.18) {
      result.push(pick(followers, random));
    } else {
      result.push(pick(VOWELS, random));
    }
  }

  return result.join("");
}

function isUppercaseLetter(char: string): boolean {
  return char !== char.toLowerCase();
}

function lowercaseLetter(char: string): string {
  const lower = char.toLowerCase();
  return Array.from(lower).length === 1 ? lower : char;
}

function applyCasePattern(candidate: string, sourceCharacters: readonly string[]): string {
  return Array.from(candidate)
    .map((char, index) => (isUppercaseLetter(sourceCharacters[index]) ? char.toUpperCase() : char))
    .join("");
}

// One letter of a source word, with every combining mark it carries, whether the text stores the accent
// inside the letter ("é") or as a separate mark after it ("e" + U+0301).
interface LetterCluster {
  letter: string;
  marks: string;
}

// One code point of a source word: a letter (with the marks stored inside it), or a separate combining mark.
type WordPiece = { cluster: number; marks: string } | string;

interface SourceWord {
  clusters: LetterCluster[];
  pieces: WordPiece[];
}

// Splits a precomposed letter such as "é" into its base letter and marks. Letters whose canonical
// decomposition is not one letter plus marks, such as Hangul syllables, stay whole.
function decomposeLetter(char: string): LetterCluster {
  const parts = Array.from(char.normalize("NFD"));
  if (parts.length > 1 && LETTER_CHARACTER_PATTERN.test(parts[0])) {
    const marks = parts.slice(1);
    if (marks.every((part) => MARK_CHARACTER_PATTERN.test(part))) return { letter: parts[0], marks: marks.join("") };
  }
  return { letter: char, marks: "" };
}

function readWord(token: string): SourceWord {
  const clusters: LetterCluster[] = [];
  const pieces: WordPiece[] = [];

  for (const char of token) {
    if (LETTER_CHARACTER_PATTERN.test(char)) {
      const cluster = decomposeLetter(char);
      clusters.push({ letter: cluster.letter, marks: cluster.marks });
      pieces.push({ cluster: clusters.length - 1, marks: cluster.marks });
    } else {
      clusters[clusters.length - 1].marks += char;
      pieces.push(char);
    }
  }

  return { clusters, pieces };
}

// Equivalent spellings share a key: case is ignored, and "é" matches "e" + U+0301.
function wordKey(word: SourceWord): string {
  const key = word.clusters.map((cluster) => lowercaseLetter(cluster.letter) + cluster.marks).join("");
  return `${word.clusters.length}:${key}`;
}

// Accented letters most text fonts draw: Latin-1, Latin Extended-A, Romanian comma-below letters and
// Vietnamese. Rarer precomposed letters (such as "ẗ") often show as missing glyphs, so they are never used.
const COMMON_ACCENTED_LETTER_PATTERN = /^[\u00c0-\u017f\u0218-\u021b\u1ea0-\u1ef9]$/u;

const compositions = new Map<string, string | undefined>();

// The single precomposed character for a letter plus marks ("a" + U+0301 → "á"), or undefined when there is
// no common one. Output keeps exactly one character for each source character, so an accent that cannot be
// composed onto the invented letter is dropped rather than added as an extra character.
function composeLetter(letter: string, marks: string): string | undefined {
  const sequence = letter + marks;
  if (compositions.has(sequence)) return compositions.get(sequence);

  const composed = sequence.normalize("NFC");
  const result =
    COMMON_ACCENTED_LETTER_PATTERN.test(composed) && composed.normalize("NFD") === sequence ? composed : undefined;
  compositions.set(sequence, result);
  return result;
}

function spellWord(word: SourceWord, letters: readonly string[]): string {
  return word.pieces
    .map((piece) => {
      if (typeof piece === "string") return piece;
      const letter = letters[piece.cluster];
      return piece.marks ? (composeLetter(letter, piece.marks) ?? letter) : letter;
    })
    .join("");
}

function glyphWidth(char: string): number {
  if (char === "\t") return 2.08;
  if (/\s/u.test(char)) return 0.52;
  if (/\p{N}/u.test(char)) return 0.92;

  const lower = char.toLowerCase();
  const base = WIDTHS[lower] ?? (/\p{L}/u.test(char) ? 0.94 : 0.5);
  return isUppercaseLetter(char) ? base * 1.06 : base;
}

export function estimateVisualWidth(text: string): number {
  return Array.from(text).reduce((total, char) => total + glyphWidth(char), 0);
}

// Candidates are scored in lowercase, so a word's invented replacement does not depend on how the first
// occurrence happened to be capitalised.
interface SourceProfile {
  characters: string[];
  characterWidths: number[];
  marks: string[];
  lower: string;
  width: number;
}

function candidateScore(candidate: string, source: SourceProfile): number {
  if (candidate === source.lower) return Number.POSITIVE_INFINITY;
  if (COMMON_WORDS.has(candidate)) return Number.POSITIVE_INFINITY;
  if (UNWELCOME_FRAGMENTS.some((fragment) => candidate.includes(fragment))) return Number.POSITIVE_INFINITY;
  if (
    TRIPLE_VOWEL_PATTERN.test(candidate) ||
    TRIPLE_CONSONANT_PATTERN.test(candidate) ||
    REPEATED_BIGRAM_PATTERN.test(candidate)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const candidateCharacters = Array.from(candidate);
  const totalWidthDifference = Math.abs(estimateVisualWidth(candidate) - source.width) / source.width;

  let profileDifference = 0;
  let positionalMatches = 0;
  let strandedMarks = 0;
  for (let index = 0; index < source.characters.length; index++) {
    profileDifference += Math.abs(glyphWidth(candidateCharacters[index]) - source.characterWidths[index]);
    if (candidateCharacters[index] === source.characters[index]) positionalMatches++;
    if (source.marks[index] && composeLetter(candidateCharacters[index], source.marks[index]) === undefined) {
      strandedMarks++;
    }
  }

  const length = Math.max(source.characters.length, 1);
  profileDifference /= length;
  const similarity = positionalMatches / length;
  const unusualLetters = (candidate.match(/[kwyz]/g) ?? []).length / length;
  const vowelPairs = (candidate.match(/[aeiou]{2}/g) ?? []).length / length;
  return (
    totalWidthDifference * 6 +
    profileDifference * 0.34 +
    similarity * 0.42 +
    unusualLetters * 0.18 +
    vowelPairs * 0.08 +
    (strandedMarks / length) * STRANDED_MARK_WEIGHT
  );
}

function createBaseWord(
  clusters: readonly LetterCluster[],
  random: RandomSource,
  requestedCandidateCount?: number,
): string {
  const sourceCharacters = clusters.map((cluster) => lowercaseLetter(cluster.letter));
  const sourceCharacterWidths = sourceCharacters.map(glyphWidth);
  const length = sourceCharacters.length;
  const candidateCount = requestedCandidateCount ?? (length <= 2 ? 32 : length > 40 ? 40 : 96);
  const sourceProfile: SourceProfile = {
    characters: sourceCharacters,
    characterWidths: sourceCharacterWidths,
    marks: clusters.map((cluster) => cluster.marks),
    lower: sourceCharacters.join(""),
    width: Math.max(
      sourceCharacterWidths.reduce((total, width) => total + width, 0),
      0.01,
    ),
  };
  let bestCandidate = "";
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candidateCount; index++) {
    const candidate = makeCandidate(length, random);
    const score = candidateScore(candidate, sourceProfile);
    if (score < bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  if (bestCandidate) return bestCandidate;

  const fallbackLetters = ["v", "e", "l", "o", "r", "a", "n", "i"];
  const fallback = Array.from({ length }, (_, index) => fallbackLetters[index % fallbackLetters.length]).join("");
  return fallback === sourceProfile.lower ? Array.from(fallback).reverse().join("") : fallback;
}

function scrambleDigits(source: string, random: RandomSource): string {
  return Array.from(source)
    .map((char) => {
      if (!DECIMAL_DIGIT_PATTERN.test(char)) return char;

      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) return char;

      let runStart = codePoint;
      while (runStart > 0 && DECIMAL_DIGIT_PATTERN.test(String.fromCodePoint(runStart - 1))) {
        runStart--;
      }

      const original = (codePoint - runStart) % 10;
      const zero = codePoint - original;
      const offset = 1 + Math.floor(random() * 9);
      return String.fromCodePoint(zero + ((original + offset) % 10));
    })
    .join("");
}

/**
 * Creates a scrambler that remembers every word it has invented, so a name becomes the same invented word
 * across all the texts of one run (every frame, layer or story).
 */
export function createScrambler(options: ScrambleOptions = {}): Scrambler {
  const words = new Map<string, string>();
  const seeded = options.seed !== undefined && options.seed !== "";
  const randomFor = (key: string): RandomSource =>
    options.random ?? (seeded ? createSeededRandom(`${options.seed}\u0000${key}`) : Math.random);

  return {
    scramble(input, filter) {
      return input.replace(TOKEN_PATTERN, (token) => {
        if (filter && !filter(token)) return token;

        if (!LETTER_PATTERN.test(token)) {
          return options.scrambleNumbers === false ? token : scrambleDigits(token, randomFor(`#${token}`));
        }

        const word = readWord(token);
        const key = wordKey(word);
        let baseWord = words.get(key);
        if (!baseWord) {
          baseWord = createBaseWord(word.clusters, randomFor(key), options.candidateCount);
          words.set(key, baseWord);
        }

        const letters = word.clusters.map((cluster) => cluster.letter);
        return spellWord(word, Array.from(applyCasePattern(baseWord, letters)));
      });
    },
  };
}

/**
 * Matches the words and numbers of a list, such as names to scramble even inside text that is otherwise
 * kept. Case and accents are ignored, so "Zoë" in the list matches "ZOE" in the text.
 */
export function createWordMatcher(entries: readonly string[]): TokenFilter {
  const wanted = new Set<string>();
  for (const entry of entries) {
    for (const token of entry.match(TOKEN_PATTERN) ?? []) wanted.add(matchKey(token));
  }
  return (token) => wanted.has(matchKey(token));
}

function matchKey(token: string): string {
  if (!LETTER_PATTERN.test(token)) return token;
  return readWord(token)
    .clusters.map((cluster) => lowercaseLetter(cluster.letter))
    .join("");
}

export function scrambleText(input: string, options: ScrambleOptions = {}): string {
  return createScrambler(options).scramble(input);
}

export function scrambleTexts(inputs: readonly string[], options: ScrambleOptions = {}): string[] {
  const scrambler = createScrambler(options);
  return inputs.map((input) => scrambler.scramble(input));
}
