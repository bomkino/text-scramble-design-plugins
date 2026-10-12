// "Keep readable" rules: leave paragraphs in chosen paragraph styles as they are (headlines, for
// example), but still scramble listed words, such as a client name inside a kept headline.

import { codePoints, collectionItems, constructorName } from "./collect";

export interface KeepRules {
  /** Paragraph style names to leave readable. */
  keepStyles?: readonly string[];
  /** Words to scramble everywhere, even inside kept paragraphs. Case and accents are ignored. */
  alwaysScramble?: readonly string[];
}

/** A stretch of a target's source, in code points. Kept stretches only scramble listed words. */
export interface Segment {
  start: number;
  end: number;
  keep: boolean;
}

export interface KeepPlan {
  segments: Segment[];
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

/** Splits a typed list ("Brindlewick, Amélie Hart" or one per line) into clean entries. */
export function parseWordList(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim().replace(/\s+/g, " "))
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);
}

interface ParagraphSpan {
  start: number;
  end: number;
  keep: boolean;
}

/**
 * Splits a target into kept and scrambled stretches. A target can start or end in the middle of a
 * paragraph (a frame in a threaded story, or a text selection), so the paragraphs are lined up
 * against the target's own text first. Returns null when they cannot be lined up; the caller then
 * scrambles the target in full rather than guess.
 */
export function keepPlan(text: any, offset: number, source: string, rules: KeepRules): KeepPlan | null {
  const length = codePoints(source).length;
  const whole: KeepPlan = { segments: [{ start: 0, end: length, keep: false }], keptParagraphs: 0 };
  const keepStyles = new Set(rules.keepStyles ?? []);
  if (!keepStyles.size || !length) return whole;

  const paragraphs = collectionItems(read(() => text.paragraphs, null));
  if (!paragraphs.length) return whole;
  const spans: ParagraphSpan[] = [];
  const joined: string[] = [];
  for (const paragraph of paragraphs) {
    const contents = read(() => paragraph.contents, null);
    if (typeof contents !== "string") return null;
    const characters = codePoints(contents);
    spans.push({ start: joined.length, end: joined.length + characters.length, keep: keepStyles.has(paragraphStyleName(paragraph)) });
    joined.push(...characters);
  }
  if (!spans.some((span) => span.keep)) return whole;

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

  const from = lead + offset;
  const to = from + length;
  const segments: Segment[] = [];
  let keptParagraphs = 0;
  for (const span of spans) {
    const start = Math.max(span.start, from) - from;
    const end = Math.min(span.end, to) - from;
    if (end <= start) continue;
    if (span.keep) keptParagraphs++;
    const last = segments[segments.length - 1];
    if (last && last.keep === span.keep && last.end === start) last.end = end;
    else segments.push({ start, end, keep: span.keep });
  }
  if (!segments.length) return whole;
  // Text past the last paragraph (never expected, but never dropped) is scrambled.
  const tail = segments[segments.length - 1].end;
  if (tail < length) segments.push({ start: tail, end: length, keep: false });
  return { segments, keptParagraphs };
}

/** Scrambles each stretch: kept stretches only change listed words. */
export function scrambleSegments(
  source: string,
  plan: KeepPlan,
  scramble: (text: string, keep: boolean) => string,
): string {
  const characters = codePoints(source);
  return plan.segments.map((segment) => scramble(characters.slice(segment.start, segment.end).join(""), segment.keep)).join("");
}
