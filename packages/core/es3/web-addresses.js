// Emails and web addresses for ExtendScript (ES3): a hand port of packages/core/src/web-addresses.ts with the
// same behaviour. Scrambled emails and web addresses must never point at a real site or mailbox, so every
// recognised address gets an ending that can never be registered, at the same length, so the layout and the
// character count stay put.
//
// Shares a scope with scramble-engine.js (tokens, Unicode helpers and "~"-prefixed lookups come from there)
// and reads TOP_LEVEL_DOMAINS, which scripts/legacy-engine.mjs injects from packages/core/src/top-level-domains.ts.
// The same ExtendScript rules apply: ES3 only, no ES5 library calls, no reserved words as names or keys.

var KNOWN_ENDINGS = createLookup(TOP_LEVEL_DOMAINS);

// Endings that can never reach the public internet: reserved for tests and documentation (RFC 2606 and 6761),
// local networks (RFC 6762, 8375 and ICANN's .internal), special-use names (RFC 7686 and 9476), infrastructure
// (.arpa), and "xx", an ISO user-assigned code that is never given to a country.
var SAFE_ENDINGS = createLookup(["alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion", "test", "xx"]);
// The safe ending for each ending length that has one, by length.
var SAFE_ENDINGS_BY_LENGTH = [null, null, "xx", "alt", "test", "local", null, "example", "internal", "localhost"];
var EMAIL_NAME_PUNCTUATION = createLookup([".", "_", "%", "+", "-"]);

// Letters added after the name when the safe ending is shorter than the real one ("pitch.studio" -> "velaran.test").
var FILLER_LETTERS = "anelo";

// tokens[index].text, or null past either end (the core's tokens[index]?.text).
function tokenTextAt(tokens, index) {
  return index >= 0 && index < tokens.length ? tokens[index].text : null;
}

function isLabelPart(token) {
  return typeof token !== "undefined" && token.kind !== OTHER_TOKEN;
}

function isMarkText(text) {
  return isSingle(text, isMark);
}

function startsLabel(tokens, index) {
  if (!isLabelPart(tokens[index])) return false;
  if (index === 0) return true;
  var previous = tokens[index - 1];
  return previous.kind === OTHER_TOKEN && previous.text !== "." && previous.text !== "-" && !isMarkText(previous.text);
}

// A label is a run of words and numbers joined by hyphens: "studio", "web2", "north-star". Returns its end.
function readLabel(tokens, start) {
  var end = start + 1;
  var index;
  for (index = start + 1; index < tokens.length; index += 1) {
    if (isLabelPart(tokens[index])) end = index + 1;
    else if (tokens[index].text !== "-") break;
  }
  return end;
}

function countLetters(text) {
  var count = 0;
  var index = 0;
  while (index < text.length) {
    var codePoint = codePointAt(text, index);
    if (isLetter(codePoint)) count += 1;
    index += codePointSize(codePoint);
  }
  return count;
}

// Labels joined by single dots, ending in a word of two or more letters: "pitch.dog", "mail.north-star.co.uk".
// Returns [start, end] token ranges, one per label, or null.
function readDomain(tokens, start) {
  var labels = [];
  var position = start;
  while (true) {
    var end = readLabel(tokens, position);
    labels.push([position, end]);
    if (tokenTextAt(tokens, end) !== "." || !isLabelPart(tokens[end + 1])) break;
    position = end + 1;
  }

  if (labels.length < 2) return null;
  var last = labels[labels.length - 1];
  var ending = tokens[last[0]];
  if (last[1] - last[0] !== 1 || ending.kind !== WORD_TOKEN) return null;
  if (countLetters(ending.text) < 2) return null;
  return labels;
}

function labelText(tokens, label) {
  var text = "";
  var index;
  for (index = label[0]; index < label[1]; index += 1) text += tokens[index].text;
  return lowercaseText(text);
}

// /^example\.(?:com|net|org)$/
function isSafeDomain(lastTwo) {
  return lastTwo === "example.com" || lastTwo === "example.net" || lastTwo === "example.org";
}

// Without "@", "://" or "www.", a domain also needs its ending in lower case or the whole domain in capitals
// ("studio.design", "NORTH-STAR.STUDIO"). A capitalised ending is a missing space after a full stop far more
// often than an address: "the end.Next week", "the file.App runs".
function writtenLikeADomain(tokens, start, end, ending) {
  if (ending === lowercaseText(ending)) return true;
  var text = "";
  var index;
  for (index = start; index < end; index += 1) text += tokens[index].text;
  return text === uppercaseText(text);
}

function safeEnding(length) {
  var exact = length < SAFE_ENDINGS_BY_LENGTH.length ? SAFE_ENDINGS_BY_LENGTH[length] : null;
  if (exact) return { ending: exact, filler: 0 };
  var ending = length < 9 ? "test" : "localhost";
  return { ending: ending, filler: length - ending.length };
}

// source.charAt(0) !== source.charAt(0).toLowerCase(): one UTF-16 unit, so a word that starts with an astral
// letter never counts as capitalised, exactly as in the core.
function startsWithCapital(source) {
  var first = source.charCodeAt(0);
  if (first >= 0xd800 && first <= 0xdfff) return false;
  return lowercaseCodePoint(first) !== first;
}

// { ...plan, filler, upper }
function withFiller(plan, filler, upper) {
  var merged = { filler: filler, upper: upper };
  if (plan) {
    if (typeof plan.keep !== "undefined") merged.keep = plan.keep;
    if (typeof plan.text !== "undefined") merged.text = plan.text;
  }
  return merged;
}

/**
 * Finds emails, web addresses and bare domains such as "studio.design", and plans how each token in them is
 * written: schemes ("https") and "www" stay, a domain that is already safe ("example.com", ".test") stays
 * whole, and any other domain gets a safe ending. scrambles(index) says whether a token would be scrambled; a
 * domain none of whose tokens would change is left alone. Returns plans by token index: { keep } to leave the
 * token as written, { text } to write that instead, and { filler, upper } to add filler letters after it.
 */
function planWebAddresses(tokens, scrambles) {
  var plans = [];
  var index;
  var position;

  for (index = 0; index < tokens.length; index += 1) {
    var token = tokens[index];
    if (
      token.kind === WORD_TOKEN &&
      tokenTextAt(tokens, index + 1) === ":" &&
      ((tokenTextAt(tokens, index + 2) === "/" && tokenTextAt(tokens, index + 3) === "/") ||
        lowercaseText(token.text) === "mailto")
    ) {
      plans[index] = { keep: true };
      continue;
    }

    if (!startsLabel(tokens, index)) continue;
    var labels = readDomain(tokens, index);
    if (!labels) continue;

    var domainEnd = labels[labels.length - 1][1];
    var afterAt = tokenTextAt(tokens, index - 1) === "@";
    var afterScheme =
      tokenTextAt(tokens, index - 1) === "/" && tokenTextAt(tokens, index - 2) === "/" && tokenTextAt(tokens, index - 3) === ":";
    var startsWithWww = labelText(tokens, labels[0]) === "www";
    var endingIndex = labels[labels.length - 1][0];
    var source = tokens[endingIndex].text;
    var ending = lowercaseText(source);
    // "first.last@" is the name part of an email, not a domain.
    if (tokenTextAt(tokens, domainEnd) === "@") continue;
    var known = hasEntry(KNOWN_ENDINGS, ending) || hasEntry(SAFE_ENDINGS, ending);
    var bare = known && writtenLikeADomain(tokens, labels[0][0], domainEnd, source);
    if (!afterAt && !afterScheme && !startsWithWww && !bare) continue;

    index = domainEnd - 1;
    var lastTwo = labelText(tokens, labels[labels.length - 2]) + "." + ending;
    if (hasEntry(SAFE_ENDINGS, ending) || isSafeDomain(lastTwo)) {
      for (position = labels[0][0]; position < domainEnd; position += 1) plans[position] = { keep: true };
      continue;
    }

    // An invented name at a real domain could still reach a real mailbox, so the name part of an email
    // counts too.
    var firstScrambled = startsWithWww ? labels[1][0] : labels[0][0];
    if (afterAt) {
      while (firstScrambled > 0) {
        var previous = tokens[firstScrambled - 1];
        if (previous.text !== "@" && previous.kind === OTHER_TOKEN && !hasEntry(EMAIL_NAME_PUNCTUATION, previous.text)) break;
        firstScrambled -= 1;
      }
    }
    var changes = false;
    for (position = firstScrambled; position < domainEnd; position += 1) {
      if (isLabelPart(tokens[position]) && scrambles(position)) changes = true;
    }
    if (!changes) continue;

    if (startsWithWww) {
      for (position = labels[0][0]; position < labels[0][1]; position += 1) plans[position] = { keep: true };
    }
    var upper = source === uppercaseText(source) && source !== lowercaseText(source);
    var safe = safeEnding(codePointCount(source));
    var text = upper
      ? safe.ending.toUpperCase()
      : startsWithCapital(source)
        ? safe.ending.charAt(0).toUpperCase() + safe.ending.slice(1)
        : safe.ending;
    plans[endingIndex] = { text: text };
    if (safe.filler > 0) {
      var nameEnd = labels[labels.length - 2][1] - 1;
      plans[nameEnd] = withFiller(plans[nameEnd], safe.filler, upper);
    }
  }

  return plans;
}

function fillerText(count, upper) {
  var filler = "";
  var index;
  for (index = 0; index < count; index += 1) filler += FILLER_LETTERS.charAt(index % FILLER_LETTERS.length);
  return upper ? filler.toUpperCase() : filler;
}
