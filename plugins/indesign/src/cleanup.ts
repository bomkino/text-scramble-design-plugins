// Document details that live outside the text flows.
//
// Whole-document runs also scramble the names that show up in an exported PDF (bookmarks and text
// anchors) and custom text variables, using the same word cache as the copy. The optional cleanup
// goes further: it points every web link at example.com, gives links neutral names and clears the
// document info. It never invents a real-looking address: example.com is reserved for examples.

import { collectionItems } from "./collect";

export interface NamedText {
  /** Sets the scrambled value back on the document. */
  apply: (value: string) => void;
  source: string;
  kind: "bookmark" | "anchor" | "variable";
}

export interface CleanupReport {
  links: number;
  renamed: number;
  documentInfo: boolean;
}

export const EXAMPLE_LINK = "https://example.com/";
export const EXAMPLE_EMAIL = "mailto:hello@example.com";
/** What the document title becomes when InDesign won't take an empty one. */
export const NEUTRAL_TITLE = "Untitled";

function read<T>(read: () => T, fallback: T): T {
  try {
    const value = read();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/** URLs and email addresses must never be scrambled into new, real-looking ones. */
export function looksLikeAddress(value: string): boolean {
  return /@|:\/\/|^www\.|\.(?:com|net|org|io|co|uk|de|fr|app|dev)\b/i.test(value.trim());
}

function bookmarksOf(owner: any): any[] {
  return collectionItems(read(() => owner.bookmarks, null)).flatMap((bookmark) => [bookmark, ...bookmarksOf(bookmark)]);
}

/** Names that appear in an exported PDF, plus custom text variables. Scrambled in Whole document runs. */
export function documentNames(document: any, customTextType: unknown): NamedText[] {
  const names: NamedText[] = [];
  const addName = (item: any, kind: NamedText["kind"]) => {
    const name = read(() => item.name, null);
    if (typeof name !== "string" || !name.trim() || looksLikeAddress(name)) return;
    names.push({ source: name, kind, apply: (value) => (item.name = value) });
  };
  bookmarksOf(document).forEach((bookmark) => addName(bookmark, "bookmark"));
  collectionItems(read(() => document.hyperlinkTextDestinations, null)).forEach((anchor) => addName(anchor, "anchor"));
  if (customTextType !== undefined) {
    collectionItems(read(() => document.textVariables, null)).forEach((variable) => {
      if (read(() => variable.variableType, null) !== customTextType) return;
      const options = read(() => variable.variableOptions, null);
      const contents = read(() => options.contents, null);
      if (typeof contents !== "string" || !contents.trim() || looksLikeAddress(contents)) return;
      names.push({ source: contents, kind: "variable", apply: (value) => (options.contents = value) });
    });
  }
  return names;
}

function rename(item: any, base: string, used: Set<string>): boolean {
  for (let attempt = 1; attempt < 50; attempt++) {
    const name = attempt === 1 ? base : `${base} (${attempt})`;
    if (used.has(name)) continue;
    try {
      item.name = name;
      used.add(name);
      return true;
    } catch {
      // Another object already uses this name. Try the next one.
    }
  }
  return false;
}

/** Points links at example.com, gives links neutral names and clears the document info. */
export function cleanDocument(document: any): CleanupReport {
  const report: CleanupReport = { links: 0, renamed: 0, documentInfo: false };
  const used = new Set<string>();

  collectionItems(read(() => document.hyperlinkURLDestinations, null)).forEach((destination, index) => {
    const url = String(read(() => destination.destinationURL, ""));
    try {
      destination.destinationURL = /^mailto:/i.test(url) ? EXAMPLE_EMAIL : `${EXAMPLE_LINK}link-${index + 1}`;
      report.links++;
    } catch {
      // A shared destination from another document can be read-only. Leave it.
    }
    if (rename(destination, `Link ${index + 1}`, used)) report.renamed++;
  });
  collectionItems(read(() => document.hyperlinks, null)).forEach((hyperlink, index) => {
    if (rename(hyperlink, `Hyperlink ${index + 1}`, used)) report.renamed++;
  });
  collectionItems(read(() => document.hyperlinkPageDestinations, null)).forEach((destination, index) => {
    if (rename(destination, `Page link ${index + 1}`, used)) report.renamed++;
  });

  // InDesign quietly ignores an empty value for some fields (the document title, for one), so a field
  // that still holds text afterwards gets a neutral placeholder instead.
  const metadata = read(() => document.metadataPreferences, null);
  if (metadata) {
    const fields: Array<[string, unknown, string | null]> = [
      ["documentTitle", "", NEUTRAL_TITLE],
      ["author", "", "Unknown"],
      ["description", "", "None"],
      ["keywords", [], null],
      ["copyrightNotice", "", "None"],
      ["copyrightInfoURL", "", EXAMPLE_LINK],
      ["jobName", "", NEUTRAL_TITLE],
    ];
    for (const [field, empty, neutral] of fields) {
      try {
        try {
          metadata[field] = empty;
        } catch (error) {
          if (neutral === null) throw error;
        }
        const left = read(() => metadata[field], "");
        if (neutral !== null && typeof left === "string" && left !== "") metadata[field] = neutral;
        report.documentInfo = true;
      } catch {
        // Not every InDesign version exposes every field.
      }
    }
  }
  return report;
}
