// Finds every piece of text a run should change, without changing anything.
//
// InDesign keeps text in more places than the frames on a page: overset text past the last frame,
// table cells, footnotes, text on paths, anchored frames and parent (master) pages. Each one is a
// separate text flow, so the walker visits them all and records what it had to skip and why.

export type Scope = "selection" | "page" | "document";

export interface CollectOptions {
  scope: Scope;
  /** Locked frames and layers still print, so they are scrambled unless this is false. */
  includeLocked?: boolean;
  /** Hidden items do not print but stay in the file. Skipped unless this is true. */
  includeHidden?: boolean;
}

export type TargetKind = "selection" | "frame" | "story" | "overset" | "cell" | "footnote" | "path";

export interface TextTarget {
  /** An InDesign text object with `characters` (a Story, Text, cell text or footnote text). */
  text: any;
  /** Index of the first character to change inside `text.characters`. Non-zero only for overset text. */
  offset: number;
  /** The exact text from `offset` to the end of `text`. */
  source: string;
  kind: TargetKind;
  key: string;
  onParentPage: boolean;
  /** Locked page items, groups and layers that must be unlocked while this text changes. */
  unlock: any[];
}

export interface SkipCounts {
  locked: number;
  hidden: number;
  unreadable: number;
}

export interface Collection {
  targets: TextTarget[];
  skipped: SkipCounts;
  /** Text frames and paths whose overflow state the run reports on. */
  containers: any[];
  /** Table cells whose overflow state the run reports on. */
  cells: any[];
  stories: any[];
  notes: string[];
}

const TEXT_TYPES = new Set([
  "Text",
  "Character",
  "Word",
  "Line",
  "Paragraph",
  "TextColumn",
  "TextStyleRange",
  "Story",
]);
const CELL_TYPES = new Set(["Cell", "Table", "Row", "Column"]);
const FRAME_TYPES = new Set(["TextFrame", "EndnoteTextFrame"]);
const LAYOUT_ROOTS = new Set(["Spread", "MasterSpread", "Page", "Document", "Application"]);

export function constructorName(item: any): string {
  try {
    return item?.constructorName || item?.constructor?.name || "Unknown";
  } catch {
    return "Unknown";
  }
}

export function collectionItems(collection: any): any[] {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection.filter((item) => item && item.isValid !== false);
  const items: any[] = [];
  let length = 0;
  try {
    length = Number(collection.length || 0);
  } catch {
    return items;
  }
  for (let index = 0; index < length; index++) {
    try {
      const item = typeof collection.item === "function" ? collection.item(index) : collection[index];
      if (item && item.isValid !== false) items.push(item);
    } catch {
      // InDesign collections can contain unresolved objects. Ignore only that object.
    }
  }
  return items;
}

function read<T>(read: () => T, fallback: T): T {
  try {
    const value = read();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function isValid(item: any): boolean {
  return Boolean(item) && read(() => item.isValid !== false, false);
}

function specifier(item: any, fallback: string): string {
  return read(() => (typeof item.toSpecifier === "function" ? String(item.toSpecifier()) : ""), "") || fallback;
}

const ID_KEYED = new Set([...FRAME_TYPES, "TextPath", "Story"]);

/**
 * A key that names the same object however it was reached. InDesign's specifier depends on the path:
 * document.stories.item(0) is "story[0]" but a frame's parentStory is "story[@id=233]". Stories, frames
 * and text paths have an id that is unique in the document, so they are keyed by it.
 */
function identity(item: any, fallback: string): string {
  const type = constructorName(item);
  const id = read(() => item.id, null);
  return ID_KEYED.has(type) && typeof id === "number" ? `${type}#${id}` : specifier(item, fallback);
}

export function codePoints(text: string): string[] {
  return Array.from(text);
}

function textContents(text: any): string | null {
  const contents = read(() => text.contents, null);
  return typeof contents === "string" ? contents : null;
}

export function activeDocument(app: any): any | null {
  if (!read(() => Number(app.documents.length) > 0, false)) return null;
  return read(() => app.activeDocument, null);
}

export function activePage(app: any): any | null {
  return read(() => app.activeWindow?.activePage || app.layoutWindows?.item(0)?.activePage || null, null);
}

/** The page item that decides whether a text container is locked or hidden. */
export function pageItemOf(container: any): any {
  return constructorName(container) === "TextPath" ? read(() => container.parent, container) : container;
}

export function isOnParentPage(item: any): boolean {
  const pageItem = pageItemOf(item);
  const page = read(() => pageItem.parentPage, null);
  if (page) return constructorName(read(() => page.parent, null)) === "MasterSpread";
  let parent = read(() => pageItem.parent, null);
  for (let depth = 0; parent && depth < 12; depth++) {
    const type = constructorName(parent);
    if (type === "MasterSpread") return true;
    if (type === "Spread" || type === "Document") return false;
    parent = read(() => parent.parent, null);
  }
  return false;
}

interface Eligibility {
  skip?: "locked" | "hidden";
  unlock: any[];
}

class Walker {
  readonly targets: TextTarget[] = [];
  readonly skipped: SkipCounts = { locked: 0, hidden: 0, unreadable: 0 };
  readonly containers: any[] = [];
  readonly cells: any[] = [];
  readonly stories: any[] = [];
  readonly notes: string[] = [];
  private readonly seenTargets = new Set<string>();
  private readonly seenContainers = new Set<string>();
  private readonly seenCells = new Set<string>();
  private readonly seenStories = new Set<string>();
  private readonly includeLocked: boolean;
  private readonly includeHidden: boolean;
  private readonly followAnchored: boolean;

  constructor(options: CollectOptions) {
    this.includeLocked = options.includeLocked !== false;
    this.includeHidden = options.includeHidden === true;
    // A whole-document run reaches anchored frames through document.stories already.
    this.followAnchored = options.scope !== "document";
  }

  result(): Collection {
    return {
      targets: this.targets,
      skipped: this.skipped,
      containers: this.containers,
      cells: this.cells,
      stories: this.stories,
      notes: this.notes,
    };
  }

  eligibility(container: any): Eligibility {
    const unlock: any[] = [];
    let hidden = false;
    let item = pageItemOf(container);
    const layer = read(() => item.itemLayer, null);
    for (let depth = 0; item && depth < 24; depth++) {
      const type = constructorName(item);
      if (LAYOUT_ROOTS.has(type) || TEXT_TYPES.has(type) || type === "Cell") break;
      if (read(() => item.visible === false, false)) hidden = true;
      if (read(() => item.locked === true, false)) unlock.push(item);
      item = read(() => item.parent, null);
    }
    if (layer) {
      if (read(() => layer.visible === false, false)) hidden = true;
      if (read(() => layer.locked === true, false)) unlock.unshift(layer);
    }
    if (hidden && !this.includeHidden) return { skip: "hidden", unlock };
    if (unlock.length && !this.includeLocked) return { skip: "locked", unlock };
    return { unlock };
  }

  private countSkip(container: any, reason: "locked" | "hidden"): void {
    const key = identity(container, `container-${this.seenContainers.size}`);
    if (this.seenContainers.has(key)) return;
    this.seenContainers.add(key);
    this.skipped[reason]++;
  }

  private rememberStory(story: any): void {
    if (!isValid(story)) return;
    const key = identity(story, `story-${this.seenStories.size}`);
    if (this.seenStories.has(key)) return;
    this.seenStories.add(key);
    this.stories.push(story);
  }

  private addTarget(text: any, offset: number, source: string, kind: TargetKind, unlock: any[], onParentPage: boolean): void {
    const key = `${identity(text, `text-${this.seenTargets.size}`)}@${offset}`;
    if (this.seenTargets.has(key)) return;
    this.seenTargets.add(key);
    this.targets.push({ text, offset, source, kind, key, onParentPage, unlock });
  }

  /** Adds a text flow, then the tables, footnotes and anchored frames inside it. */
  addFlow(text: any, kind: TargetKind, unlock: any[], onParentPage: boolean): void {
    if (!isValid(text)) return;
    const contents = textContents(text);
    if (contents === null) return;
    if (contents.length) this.addTarget(text, 0, contents, kind, unlock, onParentPage);
    collectionItems(read(() => text.tables, null)).forEach((table) => this.addTable(table, unlock, onParentPage));
    collectionItems(read(() => text.footnotes, null)).forEach((footnote) =>
      this.addFlow(read(() => footnote.texts.item(0), null), "footnote", unlock, onParentPage),
    );
    if (this.followAnchored) {
      collectionItems(read(() => text.allPageItems, null)).forEach((item) => this.addPageItem(item));
    }
  }

  addTable(table: any, unlock: any[], onParentPage: boolean): void {
    collectionItems(read(() => table.cells, null)).forEach((cell) => this.addCell(cell, unlock, onParentPage));
  }

  addCell(cell: any, unlock: any[], onParentPage: boolean): void {
    if (!isValid(cell)) return;
    const key = specifier(cell, `cell-${this.seenCells.size}`);
    if (!this.seenCells.has(key)) {
      this.seenCells.add(key);
      this.cells.push(cell);
    }
    const text = read(() => cell.texts.item(0), null) ?? cell;
    this.addFlow(text, "cell", unlock, onParentPage);
  }

  /** A text frame or text path: its visible text, plus the overset text if it ends the story. */
  addContainer(container: any, kind: TargetKind): void {
    if (!isValid(container)) return;
    const key = identity(container, `container-${this.seenContainers.size}`);
    if (this.seenContainers.has(key)) return;
    const eligibility = this.eligibility(container);
    if (eligibility.skip) {
      this.countSkip(container, eligibility.skip);
      return;
    }
    this.seenContainers.add(key);
    this.containers.push(container);
    const onParentPage = isOnParentPage(container);
    const text = read(() => container.texts.item(0), null);
    this.rememberStory(read(() => container.parentStory, null));
    this.addFlow(text, kind, eligibility.unlock, onParentPage);
    if (isLastContainer(container) && read(() => container.overflows === true, false)) {
      this.addOverset(container, text, eligibility.unlock, onParentPage);
    }
  }

  /** Text past the end of a story's last frame. It never prints, but it is still in the file. */
  private addOverset(container: any, frameText: any, unlock: any[], onParentPage: boolean): void {
    const story = read(() => container.parentStory, null);
    const storyContents = story ? textContents(story) : null;
    const frameContents = frameText ? textContents(frameText) : null;
    const start = read(() => Number(frameText.index), Number.NaN);
    if (storyContents === null || frameContents === null || !Number.isFinite(start)) {
      this.skipped.unreadable++;
      this.notes.push("Some overset text could not be read. Try the Whole document scope.");
      return;
    }
    const storyCharacters = codePoints(storyContents);
    const frameLength = codePoints(frameContents).length;
    const end = start + frameLength;
    if (storyCharacters.slice(start, end).join("") !== frameContents) {
      this.skipped.unreadable++;
      this.notes.push("Some overset text could not be lined up safely. Try the Whole document scope.");
      return;
    }
    if (end >= storyCharacters.length) return;
    this.addTarget(story, end, storyCharacters.slice(end).join(""), "overset", unlock, onParentPage);
    const inOverset = (item: any) => read(() => Number(item.storyOffset.index) >= end, false);
    collectionItems(read(() => story.tables, null))
      .filter(inOverset)
      .forEach((table) => this.addTable(table, unlock, onParentPage));
    collectionItems(read(() => story.footnotes, null))
      .filter(inOverset)
      .forEach((footnote) => this.addFlow(read(() => footnote.texts.item(0), null), "footnote", unlock, onParentPage));
  }

  /** Any page item: text frames, plus text on the item's paths. Groups are flattened by the caller. */
  addPageItem(item: any): void {
    const type = constructorName(item);
    if (FRAME_TYPES.has(type)) this.addContainer(item, "frame");
    collectionItems(read(() => item.textPaths, null)).forEach((path) => this.addContainer(path, "path"));
  }

  addSelected(item: any): void {
    const type = constructorName(item);
    if (type === "InsertionPoint") return;
    if (TEXT_TYPES.has(type)) {
      if (type === "Story") {
        this.addStory(item);
        return;
      }
      const frames = collectionItems(read(() => item.parentTextFrames, null));
      const decisions = frames.map((frame) => this.eligibility(frame));
      const blocked = decisions.find((decision) => decision.skip);
      if (blocked?.skip) {
        this.skipped[blocked.skip]++;
        return;
      }
      const unlock = decisions.flatMap((decision) => decision.unlock);
      this.rememberStory(read(() => item.parentStory, null));
      this.addFlow(item, "selection", unlock, frames.some(isOnParentPage));
      return;
    }
    if (CELL_TYPES.has(type)) {
      const table = type === "Table" ? item : read(() => item.parent, null);
      const frames = collectionItems(read(() => table.storyOffset.parentTextFrames, null));
      const decisions = frames.map((frame) => this.eligibility(frame));
      const blocked = decisions.find((decision) => decision.skip);
      if (blocked?.skip) {
        this.skipped[blocked.skip]++;
        return;
      }
      const unlock = decisions.flatMap((decision) => decision.unlock);
      const cells = collectionItems(read(() => item.cells, null));
      (cells.length ? cells : type === "Cell" ? [item] : []).forEach((cell) => this.addCell(cell, unlock, frames.some(isOnParentPage)));
      return;
    }
    if (FRAME_TYPES.has(type) || type === "TextPath") {
      this.addContainer(item, type === "TextPath" ? "path" : "frame");
      collectionItems(read(() => item.textPaths, null)).forEach((path) => this.addContainer(path, "path"));
      return;
    }
    this.addPageItem(item);
    collectionItems(read(() => item.allPageItems, null)).forEach((child) => this.addPageItem(child));
  }

  /**
   * A whole story: every frame, the overset text, tables and footnotes. When some of its frames are
   * skipped (hidden or locked), fall back to the eligible frames one by one.
   */
  addStory(story: any): void {
    if (!isValid(story)) return;
    const key = identity(story, `story-${this.seenStories.size}`);
    if (this.seenStories.has(key)) return;
    const containers = collectionItems(read(() => story.textContainers, null));
    if (!containers.length) {
      this.rememberStory(story);
      this.addFlow(story, "story", [], false);
      return;
    }
    const decisions = containers.map((container) => ({ container, eligibility: this.eligibility(container) }));
    const eligible = decisions.filter((decision) => !decision.eligibility.skip);
    decisions
      .filter((decision) => decision.eligibility.skip)
      .forEach((decision) => this.countSkip(decision.container, decision.eligibility.skip!));
    if (!eligible.length) return;
    if (eligible.length < decisions.length) {
      eligible.forEach(({ container }) => this.addContainer(container, constructorName(container) === "TextPath" ? "path" : "frame"));
      return;
    }
    this.rememberStory(story);
    eligible.forEach(({ container }) => {
      const containerKey = identity(container, `container-${this.seenContainers.size}`);
      if (this.seenContainers.has(containerKey)) return;
      this.seenContainers.add(containerKey);
      this.containers.push(container);
    });
    const unlock = eligible.flatMap(({ eligibility }) => eligibility.unlock);
    const kind = containers.every((container) => constructorName(container) === "TextPath") ? "path" : "story";
    this.addFlow(story, kind, unlock, containers.some(isOnParentPage));
  }

  addDocument(document: any): void {
    collectionItems(read(() => document.stories, null)).forEach((story) => this.addStory(story));
    // Belt and braces: reach any story that document.stories did not list, such as text on parent
    // pages or the pasteboard in older documents.
    collectionItems(read(() => document.allPageItems, null)).forEach((item) => {
      const stories = [
        FRAME_TYPES.has(constructorName(item)) ? read(() => item.parentStory, null) : null,
        ...collectionItems(read(() => item.textPaths, null)).map((path) => read(() => path.parentStory, null)),
      ];
      stories.forEach((story) => story && this.addStory(story));
    });
  }
}

/** True for a story's last frame or path. InDesign answers "nothing" with null or a NothingEnum. */
export function isLastContainer(container: any): boolean {
  const next = read(() => container.nextTextFrame, null);
  if (!next || !isValid(next)) return true;
  const type = constructorName(next);
  return !(FRAME_TYPES.has(type) || type === "TextPath");
}

export function collectTargets(app: any, options: CollectOptions): Collection {
  const walker = new Walker(options);
  const document = activeDocument(app);
  if (!document) return walker.result();
  if (options.scope === "selection") {
    collectionItems(read(() => app.selection, [])).forEach((item) => walker.addSelected(item));
  } else if (options.scope === "page") {
    const page = activePage(app);
    collectionItems(read(() => page?.allPageItems, null)).forEach((item) => walker.addPageItem(item));
  } else {
    walker.addDocument(document);
  }
  return walker.result();
}
