// Text Scramble engine for ExtendScript (ES3): a hand port of packages/core/src/scramble-text.ts that gives the
// same output for the same input, options and random source, character for character. tests/legacy-engine.test.ts
// and scripts/verify-build.mjs hold it to the TypeScript core; change both together.
//
// Runs after these, which scripts/legacy-engine.mjs puts in front of it in the same scope:
//   COMMON_WORDS, UNWELCOME_FRAGMENTS   packages/core/src/word-lists.ts
//   TOP_LEVEL_DOMAINS                   packages/core/src/top-level-domains.ts
//   UNICODE_TABLES                      packages/core/es3/unicode-tables.js (generated)
//   planWebAddresses, fillerText        packages/core/es3/web-addresses.js
//
// ExtendScript rules this file keeps: ES3 syntax only (no let, const, arrow functions, trailing commas or
// reserved words as names or keys); no ES5 library calls (forEach, map, filter, indexOf on arrays, Object.keys,
// JSON, trim, Math.imul); strings read with charAt and charCodeAt, never text[index]; no String#normalize and
// no Unicode regexes, so every Unicode property and case mapping comes from UNICODE_TABLES; no for-in; and
// every word-keyed lookup goes through a "~"-prefixed own property, because ExtendScript gives every object
// watch, unwatch, toSource and reflect.

// ---------------------------------------------------------------------------------------------------------
// Lookups keyed by words. Never obj[word]: "watch" or "constructor" would find an inherited member.

var hasOwnEntry = Object.prototype.hasOwnProperty;

function hasEntry(table, key) {
  return hasOwnEntry.call(table, "~" + key);
}

function getEntry(table, key) {
  return hasOwnEntry.call(table, "~" + key) ? table["~" + key] : null;
}

function setEntry(table, key, value) {
  table["~" + key] = value;
}

function createLookup(values) {
  var lookup = {};
  var index;
  for (index = 0; index < values.length; index += 1) setEntry(lookup, values[index], true);
  return lookup;
}

// ---------------------------------------------------------------------------------------------------------
// Code points. Strings are UTF-16; a surrogate pair is one code point and a lone surrogate counts as one too,
// as Array.from and for...of do in the core.

function codePointAt(text, index) {
  var first = text.charCodeAt(index);
  if (first >= 0xd800 && first <= 0xdbff && index + 1 < text.length) {
    var second = text.charCodeAt(index + 1);
    if (second >= 0xdc00 && second <= 0xdfff) return (first - 0xd800) * 0x400 + (second - 0xdc00) + 0x10000;
  }
  return first;
}

function codePointSize(codePoint) {
  return codePoint > 0xffff ? 2 : 1;
}

function fromCodePoint(codePoint) {
  if (codePoint <= 0xffff) return String.fromCharCode(codePoint);
  var offset = codePoint - 0x10000;
  return String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
}

function codePointCount(text) {
  var count = 0;
  var index = 0;
  while (index < text.length) {
    index += codePointSize(codePointAt(text, index));
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------------------------------------
// Unicode tables. Decoded once; see the header of unicode-tables.js for the encoding.

function decodeNumbers(text) {
  var numbers = [];
  if (text === "") return numbers;
  var parts = text.split(",");
  var index;
  for (index = 0; index < parts.length; index += 1) numbers.push(parseInt(parts[index], 36));
  return numbers;
}

function decodeRanges(text) {
  var numbers = decodeNumbers(text);
  var ranges = { starts: [], ends: [] };
  var end = 0;
  var index;
  for (index = 0; index < numbers.length; index += 2) {
    var start = end + numbers[index];
    end = start + numbers[index + 1];
    ranges.starts.push(start);
    ranges.ends.push(end);
  }
  return ranges;
}

function decodeCaseRuns(text) {
  var numbers = decodeNumbers(text);
  var runs = { starts: [], lasts: [], steps: [], deltas: [] };
  var last = 0;
  var index;
  for (index = 0; index < numbers.length; index += 4) {
    var start = last + numbers[index];
    last = start + numbers[index + 2] * (numbers[index + 1] - 1);
    runs.starts.push(start);
    runs.lasts.push(last);
    runs.steps.push(numbers[index + 2]);
    runs.deltas.push(numbers[index + 3]);
  }
  return runs;
}

function decodeExpansions(text) {
  var numbers = decodeNumbers(text);
  var expansions = { starts: [], texts: [] };
  var codePoint = 0;
  var index = 0;
  while (index < numbers.length) {
    codePoint += numbers[index];
    var length = numbers[index + 1];
    var expansion = "";
    var part;
    for (part = 0; part < length; part += 1) expansion += fromCodePoint(numbers[index + 2 + part]);
    expansions.starts.push(codePoint);
    expansions.texts.push(expansion);
    index += 2 + length;
  }
  return expansions;
}

// Index of the last start at or before codePoint, or -1.
function findStart(starts, codePoint) {
  var low = 0;
  var high = starts.length - 1;
  while (low <= high) {
    var middle = (low + high) >> 1;
    if (starts[middle] <= codePoint) low = middle + 1;
    else high = middle - 1;
  }
  return high;
}

function inRanges(ranges, codePoint) {
  var index = findStart(ranges.starts, codePoint);
  return index >= 0 && codePoint <= ranges.ends[index];
}

var LETTER_RANGES = decodeRanges(UNICODE_TABLES.letters);
var MARK_RANGES = decodeRanges(UNICODE_TABLES.marks);
var NUMBER_RANGES = decodeRanges(UNICODE_TABLES.numbers);
var DECIMAL_RANGES = decodeRanges(UNICODE_TABLES.decimals);
var SPACE_RANGES = decodeRanges(UNICODE_TABLES.spaces);
var LOWERCASE_RUNS = decodeCaseRuns(UNICODE_TABLES.lowercase);
var LOWERCASE_EXPANSIONS = decodeExpansions(UNICODE_TABLES.lowercaseExpansions);
var UPPERCASE_RUNS = decodeCaseRuns(UNICODE_TABLES.uppercase);
var UPPERCASE_EXPANSIONS = decodeExpansions(UNICODE_TABLES.uppercaseExpansions);

// \p{L}, \p{M}, \p{N}, \p{Nd} and \s, one code point at a time. ASCII is answered without a search.
function isLetter(codePoint) {
  if (codePoint < 0x80) return (codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a);
  return inRanges(LETTER_RANGES, codePoint);
}

function isMark(codePoint) {
  return codePoint >= 0x80 && inRanges(MARK_RANGES, codePoint);
}

function isNumber(codePoint) {
  if (codePoint < 0x80) return codePoint >= 0x30 && codePoint <= 0x39;
  return inRanges(NUMBER_RANGES, codePoint);
}

function isDecimalDigit(codePoint) {
  if (codePoint < 0x80) return codePoint >= 0x30 && codePoint <= 0x39;
  return inRanges(DECIMAL_RANGES, codePoint);
}

function isSpace(codePoint) {
  if (codePoint < 0x80) return codePoint === 0x20 || (codePoint >= 0x09 && codePoint <= 0x0d);
  return inRanges(SPACE_RANGES, codePoint);
}

// True when text is exactly one code point and that code point passes test (the core's /^\p{..}$/u).
function isSingle(text, test) {
  if (text.length === 0) return false;
  var codePoint = codePointAt(text, 0);
  return codePointSize(codePoint) === text.length && test(codePoint);
}

// The code point toLowerCase() or toUpperCase() turns one code point into, or -1 when it becomes several.
function mapCase(runs, expansions, codePoint) {
  var expansion = findStart(expansions.starts, codePoint);
  if (expansion >= 0 && expansions.starts[expansion] === codePoint) return -1;
  var index = findStart(runs.starts, codePoint);
  if (index >= 0 && codePoint <= runs.lasts[index] && (codePoint - runs.starts[index]) % runs.steps[index] === 0) {
    return codePoint + runs.deltas[index];
  }
  return codePoint;
}

function lowercaseCodePoint(codePoint) {
  if (codePoint < 0x80) return codePoint >= 0x41 && codePoint <= 0x5a ? codePoint + 0x20 : codePoint;
  return mapCase(LOWERCASE_RUNS, LOWERCASE_EXPANSIONS, codePoint);
}

function uppercaseCodePoint(codePoint) {
  if (codePoint < 0x80) return codePoint >= 0x61 && codePoint <= 0x7a ? codePoint - 0x20 : codePoint;
  return mapCase(UPPERCASE_RUNS, UPPERCASE_EXPANSIONS, codePoint);
}

function changeCase(text, mapCodePoint, expansions) {
  var result = "";
  var index = 0;
  while (index < text.length) {
    var codePoint = codePointAt(text, index);
    var mapped = mapCodePoint(codePoint);
    result += mapped === -1 ? expansions.texts[findStart(expansions.starts, codePoint)] : fromCodePoint(mapped);
    index += codePointSize(codePoint);
  }
  return result;
}

// String#toLowerCase, one code point at a time. It skips only the Final_Sigma rule (a word-final capital
// sigma becomes U+03C2 rather than U+03C3), which cannot matter here: the engine lowercases single letters, and
// whole words only to compare them with ASCII words such as "www" or "com".
function lowercaseText(text) {
  return changeCase(text, lowercaseCodePoint, LOWERCASE_EXPANSIONS);
}

// String#toUpperCase, which has no context rules.
function uppercaseText(text) {
  return changeCase(text, uppercaseCodePoint, UPPERCASE_EXPANSIONS);
}

// ---------------------------------------------------------------------------------------------------------
// Letters and accents.

// Letter (one code point) -> { letter, marks } for every letter whose NFD is one letter plus marks.
var DECOMPOSITIONS = {};
// Letter + marks -> the common precomposed letter whose NFD it is (see composeLetter).
var COMPOSITIONS = {};

(function () {
  var sequences = [];
  var numbers = decodeNumbers(UNICODE_TABLES.markSequences);
  var index = 0;
  while (index < numbers.length) {
    var marks = "";
    var part;
    for (part = 0; part < numbers[index]; part += 1) marks += fromCodePoint(numbers[index + 1 + part]);
    sequences.push(marks);
    index += 1 + numbers[index];
  }

  var composable = decodeRanges(UNICODE_TABLES.composable);
  var entries = decodeNumbers(UNICODE_TABLES.decompositions);
  var codePoint = 0;
  for (index = 0; index < entries.length; index += 3) {
    codePoint += entries[index];
    var letter = fromCodePoint(entries[index + 1]);
    var sequence = sequences[entries[index + 2]];
    setEntry(DECOMPOSITIONS, fromCodePoint(codePoint), { letter: letter, marks: sequence });
    if (inRanges(composable, codePoint)) setEntry(COMPOSITIONS, letter + sequence, fromCodePoint(codePoint));
  }
}());

// character.toLowerCase() !== character, for one code point.
function isUppercaseLetter(character) {
  var codePoint = codePointAt(character, 0);
  return lowercaseCodePoint(codePoint) !== codePoint;
}

function lowercaseLetter(character) {
  var lower = lowercaseCodePoint(codePointAt(character, 0));
  return lower === -1 ? character : fromCodePoint(lower);
}

// Splits a precomposed letter such as U+00E9 (e acute) into its base letter and marks. Letters whose canonical
// decomposition is not one letter plus marks, such as Hangul syllables, stay whole.
function decomposeLetter(character) {
  return getEntry(DECOMPOSITIONS, character) || { letter: character, marks: "" };
}

// The single precomposed character for a letter plus marks ("a" + U+0301 -> U+00E1), or null when there is no
// common one: the core's NFC(letter + marks), when that is one common accented letter whose NFD is exactly
// letter + marks. unicode-tables.js lists those letters, already checked to be stable under NFC.
function composeLetter(letter, marks) {
  return getEntry(COMPOSITIONS, letter + marks);
}

// One letter of a source word, with every combining mark it carries, whether the text stores the accent
// inside the letter (U+00E9) or as a separate mark after it ("e" + U+0301). Pieces are the word's code points in
// order: a letter ({ cluster, marks } with the marks stored inside it) or a separate mark ({ cluster: -1, text }).
function readWord(token) {
  var clusters = [];
  var pieces = [];
  var index = 0;
  while (index < token.length) {
    var codePoint = codePointAt(token, index);
    var size = codePointSize(codePoint);
    var character = token.substring(index, index + size);
    if (isLetter(codePoint)) {
      var cluster = decomposeLetter(character);
      clusters.push({ letter: cluster.letter, marks: cluster.marks });
      pieces.push({ cluster: clusters.length - 1, marks: cluster.marks, text: "" });
    } else {
      clusters[clusters.length - 1].marks += character;
      pieces.push({ cluster: -1, marks: "", text: character });
    }
    index += size;
  }
  return { clusters: clusters, pieces: pieces };
}

// Equivalent spellings share a key: case is ignored, and U+00E9 matches "e" + U+0301.
function wordKey(word) {
  var key = "";
  var index;
  for (index = 0; index < word.clusters.length; index += 1) {
    key += lowercaseLetter(word.clusters[index].letter) + word.clusters[index].marks;
  }
  return word.clusters.length + ":" + key;
}

function spellWord(word, letters) {
  var result = [];
  var index;
  for (index = 0; index < word.pieces.length; index += 1) {
    var piece = word.pieces[index];
    if (piece.cluster === -1) {
      result.push(piece.text);
      continue;
    }
    var letter = letters[piece.cluster];
    var composed = piece.marks ? composeLetter(letter, piece.marks) : null;
    result.push(composed !== null ? composed : letter);
  }
  return result.join("");
}

// candidate is invented, so ASCII: toUpperCase is safe in ExtendScript.
function applyCasePattern(candidate, sourceCharacters) {
  var result = "";
  var index;
  for (index = 0; index < candidate.length; index += 1) {
    var character = candidate.charAt(index);
    result += isUppercaseLetter(sourceCharacters[index]) ? character.toUpperCase() : character;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------
// Random numbers.

// Math.imul, which ExtendScript lacks: the low 32 bits of a * b as a signed integer.
function multiply32(a, b) {
  var aHigh = (a >>> 16) & 0xffff;
  var aLow = a & 0xffff;
  var bHigh = (b >>> 16) & 0xffff;
  var bLow = b & 0xffff;
  return (aLow * bLow + (((aHigh * bLow + aLow * bHigh) << 16) >>> 0)) | 0;
}

// FNV-1a over UTF-16 code units, continued from hash.
function hashText(hash, text) {
  var index;
  for (index = 0; index < text.length; index += 1) hash = multiply32(hash ^ text.charCodeAt(index), 0x01000193);
  return hash;
}

function createMulberry32(seed) {
  var state = seed;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    var value = multiply32(state ^ (state >>> 15), state | 1);
    value ^= value + multiply32(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small, repeatable random source (mulberry32), seeded from any number or string. */
function createSeededRandom(seed) {
  return createMulberry32(hashText(0x811c9dc5, String(seed)) >>> 0);
}

// createSeededRandom(seedText + "\u0000" + key), without putting a NUL character in an ExtendScript string.
function createKeyedRandom(seedText, key) {
  var hash = hashText(0x811c9dc5, seedText);
  hash = multiply32(hash ^ 0, 0x01000193);
  return createMulberry32(hashText(hash, key) >>> 0);
}

function mathRandom() {
  return Math.random();
}

function pick(items, random) {
  var index = Math.min(items.length - 1, Math.floor(random() * items.length));
  return items[index];
}

// ---------------------------------------------------------------------------------------------------------
// Invented words.

var VOWELS = ["a", "a", "a", "e", "e", "e", "e", "i", "i", "o", "o", "u"];
var CONSONANTS = [
  "b", "c", "d", "f", "g", "h", "l", "l", "l", "m", "m", "m", "n", "n", "n", "n",
  "p", "r", "r", "r", "r", "s", "s", "s", "t", "t", "t", "v", "v", "w"
];
var END_CONSONANTS = ["d", "l", "l", "m", "n", "n", "r", "r", "s", "s", "t"];
var CLUSTER_FOLLOWERS = {};
setEntry(CLUSTER_FOLLOWERS, "b", ["l", "r"]);
setEntry(CLUSTER_FOLLOWERS, "c", ["h", "l", "r"]);
setEntry(CLUSTER_FOLLOWERS, "d", ["r"]);
setEntry(CLUSTER_FOLLOWERS, "f", ["l", "r"]);
setEntry(CLUSTER_FOLLOWERS, "g", ["l", "r"]);
setEntry(CLUSTER_FOLLOWERS, "p", ["l", "r"]);
setEntry(CLUSTER_FOLLOWERS, "s", ["c", "h", "l", "p", "t"]);
setEntry(CLUSTER_FOLLOWERS, "t", ["h", "r"]);

// VOWELS.filter((letter) => letter !== vowel) for each vowel, in the same order.
var OTHER_VOWELS = {};
(function () {
  var vowels = ["a", "e", "i", "o", "u"];
  var index;
  for (index = 0; index < vowels.length; index += 1) {
    var others = [];
    var position;
    for (position = 0; position < VOWELS.length; position += 1) {
      if (VOWELS[position] !== vowels[index]) others.push(VOWELS[position]);
    }
    setEntry(OTHER_VOWELS, vowels[index], others);
  }
}());

var COMMON_WORD_LOOKUP = createLookup(COMMON_WORDS);
var INFINITY = Number.POSITIVE_INFINITY;

// WIDTHS in the core: the width of each lowercase ASCII letter, a to z, relative to an average letter.
var LETTER_WIDTHS = [
  0.9, 0.92, 0.82, 0.92, 0.88, 0.55, 0.92, 0.94, 0.34, 0.43, 0.9, 0.38, 1.34,
  0.94, 0.94, 0.92, 0.94, 0.58, 0.82, 0.56, 0.94, 0.86, 1.28, 0.86, 0.86, 0.8
];

// How much an accent that would fall off the invented word counts against a candidate.
var STRANDED_MARK_WEIGHT = 2;
var FALLBACK_LETTERS = ["v", "e", "l", "o", "r", "a", "n", "i"];

function isVowel(character) {
  return character === "a" || character === "e" || character === "i" || character === "o" || character === "u";
}

function makeCandidate(length, random) {
  if (length === 1) return pick(VOWELS, random);

  var result = [];
  var index;
  for (index = 0; index < length; index += 1) {
    if (index === 0) {
      result.push(random() < 0.18 ? pick(VOWELS, random) : pick(CONSONANTS, random));
      continue;
    }

    var previous = result[index - 1];
    var hasBeforePrevious = index >= 2;
    var beforePrevious = hasBeforePrevious ? result[index - 2] : "";

    if (index === length - 1) {
      if (isVowel(previous)) {
        result.push(random() < 0.07 ? pick(getEntry(OTHER_VOWELS, previous), random) : pick(END_CONSONANTS, random));
      } else {
        result.push(pick(VOWELS, random));
      }
      continue;
    }

    if (isVowel(previous)) {
      var mustUseConsonant = hasBeforePrevious && isVowel(beforePrevious);
      result.push(mustUseConsonant || random() < 0.95 ? pick(CONSONANTS, random) : pick(VOWELS, random));
      continue;
    }

    var followers = getEntry(CLUSTER_FOLLOWERS, previous);
    var alreadyInCluster = hasBeforePrevious && !isVowel(beforePrevious);
    if (!alreadyInCluster && followers && random() < 0.18) {
      result.push(pick(followers, random));
    } else {
      result.push(pick(VOWELS, random));
    }
  }

  return result.join("");
}

// glyphWidth in the core, for one code point. Invented letters (a to z) take the first, short path.
function glyphWidth(character) {
  var codePoint = codePointAt(character, 0);
  if (codePoint >= 0x61 && codePoint <= 0x7a) return LETTER_WIDTHS[codePoint - 0x61];
  if (character === "\t") return 2.08;
  if (isSpace(codePoint)) return 0.52;
  if (isNumber(codePoint)) return 0.92;

  var lower = lowercaseCodePoint(codePoint);
  var base;
  if (lower >= 0x61 && lower <= 0x7a) base = LETTER_WIDTHS[lower - 0x61];
  else base = isLetter(codePoint) ? 0.94 : 0.5;
  return lower !== codePoint ? base * 1.06 : base;
}

function hasUnwelcomeFragment(candidate) {
  var index;
  for (index = 0; index < UNWELCOME_FRAGMENTS.length; index += 1) {
    if (candidate.indexOf(UNWELCOME_FRAGMENTS[index]) !== -1) return true;
  }
  return false;
}

// /[aeiou]{3}/, /[^aeiou]{3}/ and /([a-z]{2})\1/ on an invented (lowercase ASCII) candidate.
function hasHarshPattern(candidate) {
  var vowels = 0;
  var consonants = 0;
  var index;
  for (index = 0; index < candidate.length; index += 1) {
    if (isVowel(candidate.charAt(index))) {
      vowels += 1;
      consonants = 0;
    } else {
      consonants += 1;
      vowels = 0;
    }
    if (vowels === 3 || consonants === 3) return true;
    if (
      index >= 3 &&
      candidate.charAt(index - 3) === candidate.charAt(index - 1) &&
      candidate.charAt(index - 2) === candidate.charAt(index)
    ) {
      return true;
    }
  }
  return false;
}

// Candidates are scored in lowercase, so a word's invented replacement does not depend on how the first
// occurrence happened to be capitalised. The arithmetic follows the core step by step, so scores, and with
// them the chosen words, are identical to the last bit.
function candidateScore(candidate, source) {
  if (candidate === source.lower) return INFINITY;
  if (hasEntry(COMMON_WORD_LOOKUP, candidate)) return INFINITY;
  if (hasUnwelcomeFragment(candidate)) return INFINITY;
  if (hasHarshPattern(candidate)) return INFINITY;

  var candidateWidth = 0;
  var index;
  for (index = 0; index < candidate.length; index += 1) candidateWidth = candidateWidth + glyphWidth(candidate.charAt(index));
  var totalWidthDifference = Math.abs(candidateWidth - source.width) / source.width;

  var profileDifference = 0;
  var positionalMatches = 0;
  var strandedMarks = 0;
  for (index = 0; index < source.characters.length; index += 1) {
    var character = candidate.charAt(index);
    profileDifference += Math.abs(glyphWidth(character) - source.characterWidths[index]);
    if (character === source.characters[index]) positionalMatches += 1;
    if (source.marks[index] && composeLetter(character, source.marks[index]) === null) strandedMarks += 1;
  }

  var length = Math.max(source.characters.length, 1);
  profileDifference /= length;
  var similarity = positionalMatches / length;

  var unusual = 0;
  for (index = 0; index < candidate.length; index += 1) {
    var letter = candidate.charAt(index);
    if (letter === "k" || letter === "w" || letter === "y" || letter === "z") unusual += 1;
  }
  // candidate.match(/[aeiou]{2}/g): pairs found left to right, without overlapping.
  var pairs = 0;
  index = 0;
  while (index < candidate.length - 1) {
    if (isVowel(candidate.charAt(index)) && isVowel(candidate.charAt(index + 1))) {
      pairs += 1;
      index += 2;
    } else {
      index += 1;
    }
  }
  var unusualLetters = unusual / length;
  var vowelPairs = pairs / length;
  return (
    totalWidthDifference * 6 +
    profileDifference * 0.34 +
    similarity * 0.42 +
    unusualLetters * 0.18 +
    vowelPairs * 0.08 +
    (strandedMarks / length) * STRANDED_MARK_WEIGHT
  );
}

function createBaseWord(clusters, random, requestedCandidateCount) {
  var characters = [];
  var characterWidths = [];
  var marks = [];
  var width = 0;
  var index;
  for (index = 0; index < clusters.length; index += 1) {
    characters.push(lowercaseLetter(clusters[index].letter));
    characterWidths.push(glyphWidth(characters[index]));
    marks.push(clusters[index].marks);
    width = width + characterWidths[index];
  }
  var length = characters.length;
  var candidateCount =
    requestedCandidateCount != null ? requestedCandidateCount : length <= 2 ? 32 : length > 40 ? 40 : 96;
  var source = {
    characters: characters,
    characterWidths: characterWidths,
    marks: marks,
    lower: characters.join(""),
    width: Math.max(width, 0.01)
  };
  var bestCandidate = "";
  var bestScore = INFINITY;

  for (index = 0; index < candidateCount; index += 1) {
    var candidate = makeCandidate(length, random);
    var score = candidateScore(candidate, source);
    if (score < bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  if (bestCandidate) return bestCandidate;

  var fallback = "";
  for (index = 0; index < length; index += 1) fallback += FALLBACK_LETTERS[index % FALLBACK_LETTERS.length];
  if (fallback !== source.lower) return fallback;
  var reversed = "";
  for (index = fallback.length - 1; index >= 0; index -= 1) reversed += fallback.charAt(index);
  return reversed;
}

// Each decimal digit moves to another digit of its own writing system.
function scrambleDigits(source, random) {
  var result = [];
  var index = 0;
  while (index < source.length) {
    var codePoint = codePointAt(source, index);
    var size = codePointSize(codePoint);
    if (!isDecimalDigit(codePoint)) {
      result.push(source.substring(index, index + size));
    } else {
      // Digits of one script are ten consecutive code points, so the run of digits around this one tells
      // where its zero is.
      var runStart = DECIMAL_RANGES.starts[findStart(DECIMAL_RANGES.starts, codePoint)];
      var original = (codePoint - runStart) % 10;
      var zero = codePoint - original;
      var offset = 1 + Math.floor(random() * 9);
      result.push(fromCodePoint(zero + ((original + offset) % 10)));
    }
    index += size;
  }
  return result.join("");
}

// ---------------------------------------------------------------------------------------------------------
// Tokens.

var WORD_TOKEN = "word";
var NUMBER_TOKEN = "number";
var OTHER_TOKEN = "other";

// The core's tokenize: one pass over the code points. A word is a letter followed by letters and marks
// ((\p{L}\p{M}*)+), a number is a run of \p{N}, and every other code point is a token of its own. Passes
// such as planWebAddresses read the token stream rather than the text.
function tokenize(text) {
  var tokens = [];
  var length = text.length;
  var index = 0;
  while (index < length) {
    var codePoint = codePointAt(text, index);
    var end = index + codePointSize(codePoint);
    var kind = OTHER_TOKEN;
    var next;
    if (isLetter(codePoint)) {
      kind = WORD_TOKEN;
      while (end < length) {
        next = codePointAt(text, end);
        if (!isLetter(next) && !isMark(next)) break;
        end += codePointSize(next);
      }
    } else if (isNumber(codePoint)) {
      kind = NUMBER_TOKEN;
      while (end < length) {
        next = codePointAt(text, end);
        if (!isNumber(next)) break;
        end += codePointSize(next);
      }
    }
    tokens.push({ text: text.substring(index, end), kind: kind });
    index = end;
  }
  return tokens;
}

// /^(?:\p{L}\p{M}*)+$/u: a letter, then only letters and marks.
function isWordText(text) {
  if (text.length === 0 || !isLetter(codePointAt(text, 0))) return false;
  var index = 0;
  while (index < text.length) {
    var codePoint = codePointAt(text, index);
    if (!isLetter(codePoint) && !isMark(codePoint)) return false;
    index += codePointSize(codePoint);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Public API: the same names and behaviour as packages/core/src/scramble-text.ts.

/**
 * True when the text has a letter, or a decimal digit while numbers are scrambled. The second argument is the
 * core's options object ({ scrambleNumbers }) or, for the classic script, the scrambleNumbers flag itself.
 */
function hasScramblableText(input, options) {
  var scrambleNumbers = options !== null && typeof options === "object" ? options.scrambleNumbers : options;
  var text = String(input);
  var index = 0;
  while (index < text.length) {
    var codePoint = codePointAt(text, index);
    if (isLetter(codePoint) || (scrambleNumbers !== false && isDecimalDigit(codePoint))) return true;
    index += codePointSize(codePoint);
  }
  return false;
}

/**
 * Creates a scrambler that remembers every word it has invented, so a name becomes the same invented word
 * across all the texts of one run. Options: random (a function returning [0, 1), wins over seed), seed
 * (number or string; "" counts as none), scrambleNumbers (false keeps numbers), candidateCount.
 * Emails and web addresses keep their shape but always end in a domain that can never be registered.
 */
function createScrambler(options) {
  if (typeof options === "undefined") options = {};
  var words = {};
  var seeded = typeof options.seed !== "undefined" && options.seed !== "";

  function randomFor(key) {
    if (options.random != null) return options.random;
    return seeded ? createKeyedRandom(String(options.seed), key) : mathRandom;
  }

  function scrambleToken(token) {
    if (token.kind === NUMBER_TOKEN) {
      return options.scrambleNumbers === false ? token.text : scrambleDigits(token.text, randomFor("#" + token.text));
    }

    var word = readWord(token.text);
    var key = wordKey(word);
    var baseWord = getEntry(words, key);
    if (!baseWord) {
      baseWord = createBaseWord(word.clusters, randomFor(key), options.candidateCount);
      setEntry(words, key, baseWord);
    }

    var letters = [];
    var index;
    for (index = 0; index < word.clusters.length; index += 1) letters.push(word.clusters[index].letter);
    var cased = applyCasePattern(baseWord, letters);
    var casedLetters = [];
    for (index = 0; index < cased.length; index += 1) casedLetters.push(cased.charAt(index));
    return spellWord(word, casedLetters);
  }

  return {
    // Scrambles one text. Tokens the filter rejects (a function given each word or number) stay as written.
    scramble: function (input, filter) {
      var tokens = tokenize(String(input));
      var accepted = [];
      var index;
      for (index = 0; index < tokens.length; index += 1) {
        accepted.push(tokens[index].kind !== OTHER_TOKEN && (!filter || filter(tokens[index].text)));
      }
      var plans = planWebAddresses(tokens, function (position) {
        return accepted[position];
      });

      var result = [];
      for (index = 0; index < tokens.length; index += 1) {
        var token = tokens[index];
        var plan = plans[index];
        var text;
        if (plan && typeof plan.text !== "undefined") text = plan.text;
        else if ((plan && plan.keep) || !accepted[index]) text = token.text;
        else text = scrambleToken(token);
        result.push(plan && plan.filler ? text + fillerText(plan.filler, plan.upper === true) : text);
      }
      return result.join("");
    }
  };
}

function matchKey(token) {
  if (!isWordText(token)) return token;
  var clusters = readWord(token).clusters;
  var key = "";
  var index;
  for (index = 0; index < clusters.length; index += 1) key += lowercaseLetter(clusters[index].letter);
  return key;
}

/**
 * Matches the words and numbers of a list, such as names to scramble even inside text that is otherwise
 * kept. Case and accents are ignored, so "Zoe" with a diaeresis in the list matches "ZOE" in the text.
 */
function createWordMatcher(entries) {
  var wanted = {};
  var index;
  for (index = 0; index < entries.length; index += 1) {
    var tokens = tokenize(String(entries[index]));
    var position;
    for (position = 0; position < tokens.length; position += 1) {
      if (tokens[position].kind !== OTHER_TOKEN) setEntry(wanted, matchKey(tokens[position].text), true);
    }
  }
  return function (token) {
    return typeof token === "string" && hasEntry(wanted, matchKey(token));
  };
}

function scrambleText(input, options) {
  return createScrambler(options).scramble(input);
}

function scrambleTexts(inputs, options) {
  var scrambler = createScrambler(options);
  var outputs = [];
  var index;
  for (index = 0; index < inputs.length; index += 1) outputs.push(scrambler.scramble(inputs[index]));
  return outputs;
}

// The names the classic InDesign script's main code calls. One scrambler per run lives on the run's cache
// object, so a word becomes the same invented word in every frame.
function scrambleContents(source, scrambleNumbers, cache) {
  if (!cache) return createScrambler({ scrambleNumbers: scrambleNumbers }).scramble(source);
  if (!hasEntry(cache, "scrambler")) setEntry(cache, "scrambler", createScrambler({ scrambleNumbers: scrambleNumbers }));
  return getEntry(cache, "scrambler").scramble(source);
}

function hasScramblableContents(source, scrambleNumbers) {
  return hasScramblableText(source, scrambleNumbers);
}
