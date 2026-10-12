// "Keep readable" rules: leave paragraphs in chosen paragraph styles as they are (headlines, for
// example), but still scramble listed words, such as a client name inside a kept headline.

import { codePoints, collectionItems, constructorName } from "./collect";

export interface KeepRules {
  /** Paragraph style names to leave readable. */
  keepStyles?: readonly string[];
  /** Words or phrases to scramble everywhere, even inside kept paragraphs. */
  alwaysScramble?: readonly string[];
}

export interface KeepPlan {
  /** One flag per code point of the target's source: true keeps the original character. */
  keep: boolean[];
  keptParagraphs: number;
}

function read<T>(read: () => T, fallback: T): T {
  try {
    const value = read();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function paragraphStyleName(paragraph: any): string {
  return read(() => String(paragraph.appliedParagraphStyle.name), "");
}

/** Splits a typed list ("Northwind, Ada Lovelace" or one per line) into clean entries. */
export function parseWordList(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim().replace(/\s+/g, " "))
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);
}

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Marks the code points that belong to a listed word or phrase, matched whole and ignoring case. */
export function forcedMask(source: string, entries: readonly string[]): boolean[] {
  const characters = codePoints(source);
  const mask = characters.map(() => false);
  if (!entries.length) return mask;
  const codePointAt: number[] = [];
  characters.forEach((character, index) => {
    for (let unit = 0; unit < character.length; unit++) codePointAt.push(index);
  });
  codePointAt.push(characters.length);
  for (const entry of entries) {
    const body = entry.split(" ").map(escapeForPattern).join("\\s+");
    const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${body}(?![\\p{L}\\p{M}\\p{N}])`, "giu");
    for (const match of source.matchAll(pattern)) {
      const start = codePointAt[match.index ?? 0];
      const end = codePointAt[(match.index ?? 0) + match[0].length];
      for (let index = start; index < end; index++) mask[index] = true;
    }
  }
  return mask;
}

interface ParagraphSpan {
  start: number;
  end: number;
  keep: boolean;
}

/**
 * Works out which characters of a target sit in kept paragraphs. A target can start or end in the
 * middle of a paragraph (a frame in a threaded story, or a text selection), so the paragraphs are
 * lined up against the target's own text before anything is kept. Returns null when they cannot be
 * lined up; the caller then scrambles the target in full rather than guess.
 */
export function keepPlan(text: any, offset: number, source: string, rules: KeepRules): KeepPlan | null {
  const keepStyles = new Set(rules.keepStyles ?? []);
  const sourceCharacters = codePoints(source);
  const forced = forcedMask(source, rules.alwaysScramble ?? []);
  const none: KeepPlan = { keep: sourceCharacters.map(() => false), keptParagraphs: 0 };
  if (!keepStyles.size) return none;

  const paragraphs = collectionItems(read(() => text.paragraphs, null));
  if (!paragraphs.length) return none;
  const spans: ParagraphSpan[] = [];
  const joined: string[] = [];
  for (const paragraph of paragraphs) {
    const contents = read(() => paragraph.contents, null);
    if (typeof contents !== "string") return null;
    const characters = codePoints(contents);
    spans.push({ start: joined.length, end: joined.length + characters.length, keep: keepStyles.has(paragraphStyleName(paragraph)) });
    joined.push(...characters);
  }

  const flowText = read(() => text.contents, null);
  if (typeof flowText !== "string") return null;
  const flowCharacters = codePoints(flowText);
  const flowJoined = flowCharacters.join("");
  const matchesAt = (start: number) => joined.slice(start, start + flowCharacters.length).join("") === flowJoined;

  // Stories, cells and footnotes start with their first paragraph. Frames and selections may not.
  let lead = constructorName(text) === "Story" ? 0 : read(() => Number(text.index) - Number(paragraphs[0].index), 0);
  if (!Number.isFinite(lead) || lead < 0 || !matchesAt(lead)) {
    lead = -1;
    const firstLength = spans[0].end - spans[0].start;
    for (let start = 0; start < Math.max(firstLength, 1); start++) {
      if (matchesAt(start)) {
        lead = start;
        break;
      }
    }
    if (lead < 0) return null;
  }

  const keep = sourceCharacters.map(() => false);
  let keptParagraphs = 0;
  const from = lead + offset;
  const to = from + sourceCharacters.length;
  for (const span of spans) {
    if (!span.keep || span.end <= from || span.start >= to) continue;
    keptParagraphs++;
    for (let index = Math.max(span.start, from); index < Math.min(span.end, to); index++) {
      keep[index - from] = !forced[index - from];
    }
  }
  return { keep, keptParagraphs };
}

/** Puts kept characters back into the scrambled output. Both strings have the same code points. */
export function applyKeepPlan(source: string, output: string, plan: KeepPlan | null): string {
  if (!plan || !plan.keep.some(Boolean)) return output;
  const sourceCharacters = codePoints(source);
  return codePoints(output)
    .map((character, index) => (plan.keep[index] ? sourceCharacters[index] : character))
    .join("");
}
