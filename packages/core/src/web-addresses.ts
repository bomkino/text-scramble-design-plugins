import { TOP_LEVEL_DOMAINS } from "./top-level-domains";

// Scrambled emails and web addresses must never point at a real site or mailbox. An invented name with a
// real ending (".com", ".studio") could belong to a stranger, so every recognised address gets an ending
// that can never be registered, at the same length, so the layout and character count stay put.

export type TokenKind = "word" | "number" | "other";

export interface Token {
  text: string;
  kind: TokenKind;
}

export interface TokenPlan {
  /** Leave the token exactly as written. */
  keep?: boolean;
  /** Write this text instead of the token. */
  text?: string;
  /** Add this many filler letters after the token's output, to keep the address its original length. */
  filler?: number;
  /** Write the filler in capitals. */
  upper?: boolean;
}

const KNOWN_ENDINGS = new Set(TOP_LEVEL_DOMAINS);

// Endings that can never reach the public internet: reserved for tests and documentation (RFC 2606 and
// 6761), local networks (RFC 6762, 8375 and ICANN's .internal), special-use names (RFC 7686 and 9476),
// infrastructure (.arpa), and "xx", an ISO user-assigned code that is never given to a country.
const SAFE_ENDINGS = new Set([
  "alt",
  "arpa",
  "example",
  "internal",
  "invalid",
  "local",
  "localhost",
  "onion",
  "test",
  "xx",
]);
const SAFE_ENDINGS_BY_LENGTH: Record<number, string> = {
  2: "xx",
  3: "alt",
  4: "test",
  5: "local",
  7: "example",
  8: "internal",
  9: "localhost",
};
const SAFE_DOMAIN_PATTERN = /^example\.(?:com|net|org)$/;
const EMAIL_NAME_PUNCTUATION = new Set([".", "_", "%", "+", "-"]);
const LETTER_CHARACTER_PATTERN = /^\p{L}$/u;
const MARK_CHARACTER_PATTERN = /^\p{M}$/u;

/** Letters added after the name when the safe ending is shorter than the real one ("pitch.studio" → "velaran.test"). */
export const FILLER_LETTERS = "anelo";

function isLabelPart(token: Token | undefined): boolean {
  return token !== undefined && token.kind !== "other";
}

function startsLabel(tokens: readonly Token[], index: number): boolean {
  if (!isLabelPart(tokens[index])) return false;
  const previous = tokens[index - 1];
  return (
    previous === undefined ||
    (previous.kind === "other" &&
      previous.text !== "." &&
      previous.text !== "-" &&
      !MARK_CHARACTER_PATTERN.test(previous.text))
  );
}

// A label is a run of words and numbers joined by hyphens: "studio", "web2", "north-star".
function readLabel(tokens: readonly Token[], start: number): number {
  let end = start + 1;
  for (let index = start + 1; index < tokens.length; index++) {
    if (isLabelPart(tokens[index])) end = index + 1;
    else if (tokens[index].text !== "-") break;
  }
  return end;
}

// Labels joined by single dots, ending in a word of two or more letters: "pitch.dog", "mail.north-star.co.uk".
function readDomain(tokens: readonly Token[], start: number): Array<[number, number]> | undefined {
  const labels: Array<[number, number]> = [];
  let position = start;
  for (;;) {
    const end = readLabel(tokens, position);
    labels.push([position, end]);
    if (tokens[end]?.text !== "." || !isLabelPart(tokens[end + 1])) break;
    position = end + 1;
  }

  if (labels.length < 2) return undefined;
  const [endingStart, endingEnd] = labels[labels.length - 1];
  const ending = tokens[endingStart];
  if (endingEnd - endingStart !== 1 || ending.kind !== "word") return undefined;
  if (Array.from(ending.text).filter((char) => LETTER_CHARACTER_PATTERN.test(char)).length < 2) return undefined;
  return labels;
}

function labelText(tokens: readonly Token[], [start, end]: [number, number]): string {
  return tokens
    .slice(start, end)
    .map((token) => token.text)
    .join("")
    .toLowerCase();
}

function safeEnding(length: number): { ending: string; filler: number } {
  const exact = SAFE_ENDINGS_BY_LENGTH[length];
  if (exact) return { ending: exact, filler: 0 };
  const ending = length < 9 ? "test" : "localhost";
  return { ending, filler: length - ending.length };
}

/**
 * Finds emails, web addresses and bare domains such as "studio.design", and plans how each token in them is
 * written: schemes ("https") and "www" stay, a domain that is already safe ("example.com", ".test") stays
 * whole, and any other domain gets a safe ending. `scrambles` says whether a token would be scrambled; a
 * domain none of whose tokens would change is left alone.
 */
export function planWebAddresses(
  tokens: readonly Token[],
  scrambles: (index: number) => boolean,
): Map<number, TokenPlan> {
  const plans = new Map<number, TokenPlan>();

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const next = (offset: number) => tokens[index + offset]?.text;
    if (token.kind === "word") {
      const scheme = token.text.toLowerCase();
      if ((next(1) === ":" && next(2) === "/" && next(3) === "/") || (scheme === "mailto" && next(1) === ":")) {
        plans.set(index, { keep: true });
        continue;
      }
    }

    if (!startsLabel(tokens, index)) continue;
    const labels = readDomain(tokens, index);
    if (!labels) continue;

    const domainEnd = labels[labels.length - 1][1];
    const before = (offset: number) => tokens[index - offset]?.text;
    const afterAt = before(1) === "@";
    const afterScheme = before(1) === "/" && before(2) === "/" && before(3) === ":";
    const startsWithWww = labelText(tokens, labels[0]) === "www";
    const endingIndex = labels[labels.length - 1][0];
    const ending = tokens[endingIndex].text.toLowerCase();
    // "first.last@" is the name part of an email, not a domain.
    if (tokens[domainEnd]?.text === "@") continue;
    const known = KNOWN_ENDINGS.has(ending) || SAFE_ENDINGS.has(ending);
    if (!afterAt && !afterScheme && !startsWithWww && !known) continue;

    index = domainEnd - 1;
    const lastTwo = `${labelText(tokens, labels[labels.length - 2])}.${ending}`;
    if (SAFE_ENDINGS.has(ending) || SAFE_DOMAIN_PATTERN.test(lastTwo)) {
      for (let position = labels[0][0]; position < domainEnd; position++) plans.set(position, { keep: true });
      continue;
    }

    // An invented name at a real domain could still reach a real mailbox, so the name part of an email
    // counts too.
    let firstScrambled = startsWithWww ? labels[1][0] : labels[0][0];
    if (afterAt) {
      while (firstScrambled > 0) {
        const previous = tokens[firstScrambled - 1];
        if (previous.text !== "@" && previous.kind === "other" && !EMAIL_NAME_PUNCTUATION.has(previous.text)) break;
        firstScrambled--;
      }
    }
    let changes = false;
    for (let position = firstScrambled; position < domainEnd; position++) {
      if (isLabelPart(tokens[position]) && scrambles(position)) changes = true;
    }
    if (!changes) continue;

    if (startsWithWww) {
      for (let position = labels[0][0]; position < labels[0][1]; position++) plans.set(position, { keep: true });
    }
    const source = tokens[endingIndex].text;
    const upper = source === source.toUpperCase() && source !== source.toLowerCase();
    const { ending: replacement, filler } = safeEnding(Array.from(source).length);
    const capitalised = source.charAt(0) !== source.charAt(0).toLowerCase();
    const text = upper
      ? replacement.toUpperCase()
      : capitalised
        ? replacement[0].toUpperCase() + replacement.slice(1)
        : replacement;
    plans.set(endingIndex, { text });
    if (filler > 0) {
      const nameEnd = labels[labels.length - 2][1] - 1;
      plans.set(nameEnd, { ...plans.get(nameEnd), filler, upper });
    }
  }

  return plans;
}

export function fillerText(count: number, upper: boolean): string {
  let filler = "";
  for (let index = 0; index < count; index++) filler += FILLER_LETTERS[index % FILLER_LETTERS.length];
  return upper ? filler.toUpperCase() : filler;
}
