// A small fake of the InDesign scripting DOM, shared by the UXP panel tests and the classic JSX
// sandbox tests. It models only what Text Scramble touches: stories threaded through frames with a
// simple width-based composition (so overset text and overflow are real), paragraphs and their
// styles, tables, footnotes, anchored frames, text on paths, groups, layers, parent pages,
// hyperlinks, bookmarks, text variables and document info.
//
// Class names match InDesign's, because both runtimes identify objects by constructor name.
// Every change to the document must happen inside app.doScript, or the fake throws: that is how the
// tests prove a run is one undo step.

import { estimateVisualWidth } from "../../packages/core/src/scramble-text";

export const ANCHOR = { table: "\u0016", footnote: "\u0004", object: "￼" } as const;

export class World {
  inScript = false;
  writes = 0;
  recomposed = 0;
  nextId = 1;
  assertInScript(what: string): void {
    if (!this.inScript) throw new Error(`${what} changed outside the undo step.`);
  }
}

/** The same object, reached by index: everything reads and writes through, but toSpecifier() differs. */
function byIndex<T extends object>(item: T, spec: string): T {
  return new Proxy(item, { get: (target, key) => (key === "toSpecifier" ? () => spec : Reflect.get(target, key)) });
}

export class Collection<T> {
  constructor(private readonly items: () => T[]) {}
  get length(): number {
    return this.items().length;
  }
  item(index: number): T | undefined {
    const items = this.items();
    return items[index < 0 ? items.length + index : index];
  }
  everyItem(): never {
    throw new Error("everyItem is not modelled by the fake DOM.");
  }
}

export class ParagraphStyle {
  readonly isValid = true;
  constructor(readonly name: string, readonly id: number) {}
  toSpecifier(): string {
    return `/document/paragraphStyle[@id=${this.id}]`;
  }
}

export class Layer {
  readonly isValid = true;
  private lockedValue = false;
  visible = true;
  constructor(private readonly world: World, readonly name: string, readonly id: number) {}
  get locked(): boolean {
    return this.lockedValue;
  }
  set locked(value: boolean) {
    this.world.assertInScript(`Layer "${this.name}" lock`);
    this.lockedValue = value;
  }
  setLockedForTest(value: boolean): void {
    this.lockedValue = value;
  }
  toSpecifier(): string {
    return `/document/layer[@id=${this.id}]`;
  }
}

export interface Glyph {
  ch: string;
  /** Character formatting. The object must survive a run untouched. */
  style: Record<string, unknown>;
  paragraphStyle: ParagraphStyle;
  anchor?: Table | Footnote | PageItem;
}

export type Part = string | ParagraphStyle | Table | Footnote | PageItem;

/** A run of glyphs that owns its own character indices: a story, a cell or a footnote. */
export class Flow {
  glyphs: Glyph[] = [];
  constructor(readonly world: World, readonly spec: string, readonly owner: Story | Cell | Footnote) {}

  fill(parts: readonly Part[], style: ParagraphStyle): void {
    let paragraphStyle = style;
    for (const part of parts) {
      if (part instanceof ParagraphStyle) {
        paragraphStyle = part;
      } else if (typeof part === "string") {
        for (const ch of Array.from(part)) {
          this.glyphs.push({ ch, paragraphStyle, style: { font: "Fake Sans", tracking: this.glyphs.length % 3 } });
        }
      } else {
        const ch = part instanceof Table ? ANCHOR.table : part instanceof Footnote ? ANCHOR.footnote : ANCHOR.object;
        this.glyphs.push({ ch, paragraphStyle, style: { font: "Fake Sans" }, anchor: part });
        part.anchorTo(this, this.glyphs.length - 1);
      }
    }
  }

  text(start: number, end: number): string {
    return this.glyphs.slice(start, end).map((glyph) => glyph.ch).join("");
  }

  story(): Story {
    const owner = this.owner;
    if (owner instanceof Story) return owner;
    if (owner instanceof Cell) return owner.parent.hostFlow!.story();
    return owner.hostFlow!.story();
  }

  /** Character edits fail on locked text, like InDesign does for locked layers. */
  assertEditable(): void {
    if (this.story().containers.some((container) => isLocked(container))) {
      throw new Error("Cannot edit text in a locked frame or on a locked layer.");
    }
  }

  anchors<T>(start: number, end: number, type: new (...args: any[]) => T): T[] {
    return this.glyphs
      .slice(start, end)
      .map((glyph) => glyph.anchor)
      .filter((anchor): anchor is any => anchor instanceof type);
  }

  paragraphRanges(): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let start = 0;
    this.glyphs.forEach((glyph, index) => {
      if (glyph.ch === "\r") {
        ranges.push([start, index + 1]);
        start = index + 1;
      }
    });
    if (start < this.glyphs.length || !ranges.length) ranges.push([start, this.glyphs.length]);
    return ranges;
  }
}

function isLocked(container: PageItem | TextPath): boolean {
  let item: PageItem | null = container instanceof TextPath ? container.parent : container;
  if (item?.itemLayer?.locked) return true;
  while (item) {
    if (item.locked) return true;
    item = item.parent instanceof PageItem ? item.parent : null;
  }
  return false;
}

export class Character {
  readonly isValid = true;
  constructor(readonly flow: Flow, readonly index: number) {}
  get contents(): string {
    return this.flow.glyphs[this.index].ch;
  }
  set contents(value: string) {
    this.flow.world.assertInScript("Text");
    this.flow.assertEditable();
    if (Array.from(value).length !== 1) throw new Error("A character can only hold one character.");
    this.flow.glyphs[this.index].ch = value;
    this.flow.world.writes++;
  }
  get appliedParagraphStyle(): ParagraphStyle {
    return this.flow.glyphs[this.index].paragraphStyle;
  }
  toSpecifier(): string {
    return `${this.flow.spec}/character[${this.index}]`;
  }
}

export class Paragraph {
  readonly isValid = true;
  constructor(readonly flow: Flow, readonly index: number, private readonly end: number) {}
  get contents(): string {
    return this.flow.text(this.index, this.end);
  }
  get length(): number {
    return this.end - this.index;
  }
  get appliedParagraphStyle(): ParagraphStyle | undefined {
    return this.flow.glyphs[this.index]?.paragraphStyle;
  }
  toSpecifier(): string {
    return `${this.flow.spec}/paragraph[${this.index}]`;
  }
}

/** A range of a flow, like the Text InDesign returns from frame.texts.item(0) or a selection. */
export class Text {
  readonly isValid = true;
  constructor(readonly flow: Flow, readonly start: number, readonly end: number) {}
  get contents(): string {
    return this.flow.text(this.start, this.end);
  }
  get index(): number {
    return this.start;
  }
  get length(): number {
    return this.end - this.start;
  }
  get characters(): Collection<Character> {
    return new Collection(() => range(this.start, this.end).map((index) => new Character(this.flow, index)));
  }
  get paragraphs(): Collection<Paragraph> {
    return new Collection(() =>
      this.flow
        .paragraphRanges()
        .filter(([start, end]) => end > this.start && start < Math.max(this.end, this.start + 1))
        .map(([start, end]) => new Paragraph(this.flow, start, end)),
    );
  }
  get tables(): Collection<Table> {
    return new Collection(() => this.flow.anchors(this.start, this.end, Table));
  }
  get footnotes(): Collection<Footnote> {
    return new Collection(() => this.flow.anchors(this.start, this.end, Footnote));
  }
  get allPageItems(): PageItem[] {
    return this.flow.anchors(this.start, this.end, PageItem).flatMap((item) => [item, ...item.allPageItems]);
  }
  get parentStory(): Story {
    return this.flow.story();
  }
  get parentTextFrames(): Array<PageItem | TextPath> {
    const story = this.flow.story();
    if (this.flow.owner !== story) return story.framesHolding(anchorIndexInStory(this.flow));
    return story.containers.filter((container) => {
      const [start, end] = story.rangeOf(container);
      return end > this.start && start < Math.max(this.end, this.start + 1);
    });
  }
  toSpecifier(): string {
    return `${this.flow.spec}/text[${this.start}:${this.end}]`;
  }
}

/** Where a flow (or an index inside it) sits in its story, following table and footnote anchors. */
function anchorIndexInStory(flow: Flow, index = 0): number {
  let owner = flow.owner;
  let position = index;
  while (!(owner instanceof Story)) {
    const host: Flow = owner instanceof Cell ? owner.parent.hostFlow! : owner.hostFlow!;
    position = owner instanceof Cell ? owner.parent.anchorIndex : owner.anchorIndex;
    owner = host.owner;
  }
  return position;
}

function pageOf(container: PageItem | TextPath): Page | null {
  return container instanceof TextPath ? container.parent.parentPage : container.parentPage;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(end - start, 0) }, (_, offset) => start + offset);
}

function glyphWidth(ch: string): number {
  return ch === "\r" ? 0 : estimateVisualWidth(ch);
}

export class Story {
  readonly isValid = true;
  readonly flow: Flow;
  readonly id: number;
  containers: Array<PageItem | TextPath> = [];
  lockState = "NONE";
  constructor(readonly document: Document, parts: readonly Part[], style: ParagraphStyle) {
    this.id = document.world.nextId++;
    this.flow = new Flow(document.world, `/document/story[@id=${this.id}]`, this);
    this.flow.fill(parts, style);
  }
  get contents(): string {
    return this.flow.text(0, this.flow.glyphs.length);
  }
  get length(): number {
    return this.flow.glyphs.length;
  }
  private whole(): Text {
    return new Text(this.flow, 0, this.flow.glyphs.length);
  }
  get characters(): Collection<Character> {
    return this.whole().characters;
  }
  get paragraphs(): Collection<Paragraph> {
    return this.whole().paragraphs;
  }
  get tables(): Collection<Table> {
    return this.whole().tables;
  }
  get footnotes(): Collection<Footnote> {
    return this.whole().footnotes;
  }
  get allPageItems(): PageItem[] {
    return this.whole().allPageItems;
  }
  get texts(): Collection<Text> {
    return new Collection(() => [this.whole()]);
  }
  get textContainers(): Array<PageItem | TextPath> {
    return [...this.containers];
  }
  get overflows(): boolean {
    const last = this.containers[this.containers.length - 1];
    return last ? this.rangeOf(last)[1] < this.flow.glyphs.length : false;
  }
  recompose(): void {
    this.document.world.recomposed++;
  }
  /** Composition: each container takes glyphs until its capacity is full. */
  rangeOf(container: PageItem | TextPath): [number, number] {
    let start = 0;
    for (const current of this.containers) {
      let end = start;
      let width = 0;
      const capacity = (current as TextFrame).capacity ?? Number.POSITIVE_INFINITY;
      while (end < this.flow.glyphs.length) {
        const next = width + glyphWidth(this.flow.glyphs[end].ch);
        if (next > capacity) break;
        width = next;
        end++;
      }
      if (current === container) return [start, end];
      start = end;
    }
    return [0, 0];
  }
  framesHolding(index: number): Array<PageItem | TextPath> {
    return this.containers.filter((container) => {
      const [start, end] = this.rangeOf(container);
      return index >= start && index < end;
    });
  }
  toSpecifier(): string {
    return this.flow.spec;
  }
}

export class PageItem {
  readonly isValid = true;
  readonly id: number;
  private lockedValue = false;
  visible = true;
  parent: Spread | MasterSpread | Group | Character | null = null;
  page: Page | null = null;
  readonly paths: TextPath[] = [];
  hostFlow?: Flow;
  anchorIndex = -1;
  constructor(readonly document: Document, public itemLayer: Layer | null) {
    this.id = document.world.nextId++;
  }
  get locked(): boolean {
    return this.lockedValue;
  }
  set locked(value: boolean) {
    this.document.world.assertInScript(`${this.constructor.name} lock`);
    this.lockedValue = value;
  }
  setLockedForTest(value: boolean): void {
    this.lockedValue = value;
  }
  get parentPage(): Page | null {
    if (this.page) return this.page;
    if (this.parent instanceof Group) return this.parent.parentPage;
    if (this.hostFlow) {
      const host = this.hostFlow.story().framesHolding(anchorIndexInStory(this.hostFlow, this.anchorIndex))[0];
      return host ? pageOf(host) : null;
    }
    return null;
  }
  get textPaths(): Collection<TextPath> {
    return new Collection(() => this.paths);
  }
  get allPageItems(): PageItem[] {
    return [];
  }
  anchorTo(flow: Flow, index: number): void {
    this.hostFlow = flow;
    this.anchorIndex = index;
    this.parent = new Character(flow, index);
  }
  toSpecifier(): string {
    return `/document//pageItem[@id=${this.id}]`;
  }
}

export class Rectangle extends PageItem {}
export class Oval extends PageItem {}
export class GraphicLine extends PageItem {}

export class Group extends PageItem {
  readonly children: PageItem[] = [];
  get allPageItems(): PageItem[] {
    return this.children.flatMap((child) => [child, ...child.allPageItems]);
  }
  get pageItems(): Collection<PageItem> {
    return new Collection(() => this.children);
  }
}

export class TextFrame extends PageItem {
  constructor(document: Document, itemLayer: Layer | null, readonly story: Story, public capacity = Number.POSITIVE_INFINITY) {
    super(document, itemLayer);
    story.containers.push(this);
  }
  get parentStory(): Story {
    return this.story;
  }
  get texts(): Collection<Text> {
    return new Collection(() => {
      const [start, end] = this.story.rangeOf(this);
      return [new Text(this.story.flow, start, end)];
    });
  }
  get nextTextFrame(): PageItem | TextPath | null {
    const index = this.story.containers.indexOf(this);
    return this.story.containers[index + 1] ?? null;
  }
  get previousTextFrame(): PageItem | TextPath | null {
    const index = this.story.containers.indexOf(this);
    return index > 0 ? this.story.containers[index - 1] : null;
  }
  get overflows(): boolean {
    return this.nextTextFrame === null && this.story.rangeOf(this)[1] < this.story.length;
  }
}

export class EndnoteTextFrame extends TextFrame {}

export class TextPath {
  readonly isValid = true;
  readonly id: number;
  constructor(readonly parent: PageItem, readonly story: Story, public capacity = Number.POSITIVE_INFINITY) {
    this.id = parent.document.world.nextId++;
    parent.paths.push(this);
    story.containers.push(this);
  }
  get parentStory(): Story {
    return this.story;
  }
  get texts(): Collection<Text> {
    return new Collection(() => {
      const [start, end] = this.story.rangeOf(this);
      return [new Text(this.story.flow, start, end)];
    });
  }
  get nextTextFrame(): PageItem | TextPath | null {
    const index = this.story.containers.indexOf(this);
    return this.story.containers[index + 1] ?? null;
  }
  get overflows(): boolean {
    return this.nextTextFrame === null && this.story.rangeOf(this)[1] < this.story.length;
  }
  toSpecifier(): string {
    return `/document//textPath[@id=${this.id}]`;
  }
}

export class InsertionPoint {
  readonly isValid = true;
  constructor(readonly flow: Flow, readonly index: number) {}
  /** Like InDesign: the story, cell or footnote the insertion point sits in. */
  get parent(): unknown {
    return this.flow.owner;
  }
  get parentTextFrames(): Array<PageItem | TextPath> {
    return this.flow.owner instanceof Story ? this.flow.owner.framesHolding(this.index) : [];
  }
  toSpecifier(): string {
    return `${this.flow.spec}/insertionPoint[${this.index}]`;
  }
}

export class Cell {
  readonly isValid = true;
  readonly flow: Flow;
  readonly id: number;
  capacity = Number.POSITIVE_INFINITY;
  constructor(readonly parent: Table, parts: readonly Part[], style: ParagraphStyle) {
    this.id = parent.document.world.nextId++;
    this.flow = new Flow(parent.document.world, `/document//cell[@id=${this.id}]`, this);
    this.flow.fill(parts, style);
  }
  get texts(): Collection<Text> {
    return new Collection(() => [new Text(this.flow, 0, this.flow.glyphs.length)]);
  }
  get contents(): string {
    return this.flow.text(0, this.flow.glyphs.length);
  }
  get characters(): Collection<Character> {
    return this.texts.item(0)!.characters;
  }
  get overflows(): boolean {
    return estimateVisualWidth(this.contents) > this.capacity;
  }
  toSpecifier(): string {
    return this.flow.spec;
  }
}

export class Table {
  readonly isValid = true;
  readonly id: number;
  readonly rows: Cell[];
  hostFlow?: Flow;
  anchorIndex = -1;
  constructor(readonly document: Document, rows: readonly (readonly Part[])[], style: ParagraphStyle) {
    this.id = document.world.nextId++;
    this.rows = rows.map((parts) => new Cell(this, parts, style));
  }
  get cells(): Collection<Cell> {
    return new Collection(() => this.rows);
  }
  get storyOffset(): InsertionPoint {
    return new InsertionPoint(this.hostFlow!, this.anchorIndex);
  }
  anchorTo(flow: Flow, index: number): void {
    this.hostFlow = flow;
    this.anchorIndex = index;
  }
  toSpecifier(): string {
    return `/document//table[@id=${this.id}]`;
  }
}

export class Footnote {
  readonly isValid = true;
  readonly id: number;
  readonly flow: Flow;
  hostFlow?: Flow;
  anchorIndex = -1;
  constructor(document: Document, parts: readonly Part[], style: ParagraphStyle) {
    this.id = document.world.nextId++;
    this.flow = new Flow(document.world, `/document//footnote[@id=${this.id}]`, this);
    this.flow.fill(parts, style);
  }
  get texts(): Collection<Text> {
    return new Collection(() => [new Text(this.flow, 0, this.flow.glyphs.length)]);
  }
  get storyOffset(): InsertionPoint {
    return new InsertionPoint(this.hostFlow!, this.anchorIndex);
  }
  anchorTo(flow: Flow, index: number): void {
    this.hostFlow = flow;
    this.anchorIndex = index;
  }
  toSpecifier(): string {
    return this.flow.spec;
  }
}

export class Page {
  readonly isValid = true;
  constructor(readonly parent: Spread | MasterSpread, readonly name: string) {}
  get allPageItems(): PageItem[] {
    return this.parent.items.filter((item) => item.page === this).flatMap((item) => [item, ...item.allPageItems]);
  }
  toSpecifier(): string {
    return `${this.parent.toSpecifier()}/page[@name="${this.name}"]`;
  }
}

export class Spread {
  readonly isValid = true;
  readonly pages: Page[];
  readonly items: PageItem[] = [];
  constructor(readonly name: string, pageNames: readonly string[]) {
    this.pages = pageNames.map((pageName) => new Page(this, pageName));
  }
  get allPageItems(): PageItem[] {
    return this.items.flatMap((item) => [item, ...item.allPageItems]);
  }
  toSpecifier(): string {
    return `/document/${this.constructor.name}[@name="${this.name}"]`;
  }
}

export class MasterSpread extends Spread {}

export class Named {
  readonly isValid = true;
  private nameValue: string;
  constructor(private readonly world: World, private readonly siblings: () => Named[], name: string) {
    this.nameValue = name;
  }
  get name(): string {
    return this.nameValue;
  }
  set name(value: string) {
    this.world.assertInScript("A name");
    if (this.siblings().some((sibling) => sibling !== this && sibling.name === value)) {
      throw new Error(`The name "${value}" is already in use.`);
    }
    this.nameValue = value;
  }
}

export class HyperlinkURLDestination extends Named {
  private url: string;
  constructor(world: World, siblings: () => Named[], name: string, url: string) {
    super(world, siblings, name);
    this.url = url;
  }
  get destinationURL(): string {
    return this.url;
  }
  set destinationURL(value: string) {
    (this as any).world.assertInScript("A link");
    this.url = value;
  }
}

export class Bookmark extends Named {
  readonly children: Bookmark[] = [];
  get bookmarks(): Collection<Bookmark> {
    return new Collection(() => this.children);
  }
}

/**
 * Like UXP, every read of an enum value is a new object: === and == are false between two reads, and
 * Number() is NaN. Only String() gives the name. (ExtendScript uses plain numbers instead.)
 */
export class EnumValue {
  constructor(readonly enumName: string) {}
  toString(): string {
    return this.enumName;
  }
}

export class TextVariable {
  readonly isValid = true;
  readonly variableOptions: { contents: string };
  private readonly typeName: string;
  constructor(world: World, readonly name: string, variableType: unknown, contents: string) {
    this.typeName = String(variableType);
    let value = contents;
    this.variableOptions = {
      get contents() {
        return value;
      },
      set contents(next: string) {
        world.assertInScript("A text variable");
        value = next;
      },
    };
  }
  get variableType(): EnumValue {
    return new EnumValue(this.typeName);
  }
}

export const VariableTypes = {
  get CUSTOM_TEXT_TYPE() {
    return new EnumValue("CUSTOM_TEXT_TYPE");
  },
  get FILE_NAME_TYPE() {
    return new EnumValue("FILE_NAME_TYPE");
  },
};

export class Document {
  readonly isValid = true;
  readonly world: World;
  readonly storyList: Story[] = [];
  readonly spreads: Spread[] = [];
  readonly masterSpreads: MasterSpread[] = [];
  readonly layerList: Layer[] = [];
  readonly styles: ParagraphStyle[] = [];
  readonly urlDestinations: HyperlinkURLDestination[] = [];
  readonly hyperlinkList: Named[] = [];
  readonly textDestinations: Named[] = [];
  readonly pageDestinations: Named[] = [];
  readonly bookmarkList: Bookmark[] = [];
  readonly variables: TextVariable[] = [];
  /** Stories left out of document.stories, to prove the walker also finds them through page items. */
  readonly unlistedStories = new Set<Story>();
  readonly metadataPreferences: Record<string, unknown>;
  readonly basicParagraph: ParagraphStyle;
  readonly defaultLayer: Layer;

  constructor(world = new World()) {
    this.world = world;
    const fields: Record<string, unknown> = {
      documentTitle: "Sample title",
      author: "Sample Author",
      description: "Sample description",
      keywords: ["sample"],
      copyrightNotice: "Sample notice",
      copyrightInfoURL: "https://sample.invalid/rights",
      jobName: "Sample job",
    };
    this.metadataPreferences = {};
    for (const key of Object.keys(fields)) {
      Object.defineProperty(this.metadataPreferences, key, {
        enumerable: true,
        configurable: true,
        get: () => fields[key],
        set: (value) => {
          world.assertInScript("Document info");
          // Like InDesign 2026, an empty title is quietly ignored.
          if (key === "documentTitle" && value === "") return;
          fields[key] = value;
        },
      });
    }
    // The XMP route does clear the title: setProperty(Dublin Core, "title[1]", "").
    const xmpFields: Record<string, string> = { "title[1]": "documentTitle", "description[1]": "description", "rights[1]": "copyrightNotice" };
    Object.defineProperty(this.metadataPreferences, "setProperty", {
      enumerable: false,
      value: (namespace: string, path: string, value: string) => {
        world.assertInScript("Document info");
        if (namespace !== "http://purl.org/dc/elements/1.1/" || !(path in xmpFields)) throw new Error(`Unknown XMP property ${path}.`);
        fields[xmpFields[path]] = value;
      },
    });
    this.basicParagraph = this.paragraphStyle("[Basic Paragraph]");
    this.defaultLayer = this.layer("Layer 1");
  }

  // Builders used by the tests.
  paragraphStyle(name: string): ParagraphStyle {
    const style = new ParagraphStyle(name, this.world.nextId++);
    this.styles.push(style);
    return style;
  }
  layer(name: string): Layer {
    const layer = new Layer(this.world, name, this.world.nextId++);
    this.layerList.push(layer);
    return layer;
  }
  spread(pageNames: readonly string[]): Spread {
    const spread = new Spread(`Spread ${this.spreads.length + 1}`, pageNames);
    this.spreads.push(spread);
    return spread;
  }
  masterSpread(name: string, pageNames: readonly string[] = ["A"]): MasterSpread {
    const spread = new MasterSpread(name, pageNames);
    this.masterSpreads.push(spread);
    return spread;
  }
  story(parts: Part | readonly Part[], style = this.basicParagraph): Story {
    const story = new Story(this, Array.isArray(parts) ? parts : [parts as Part], style);
    this.storyList.push(story);
    return story;
  }
  table(rows: readonly (Part | readonly Part[])[], style = this.basicParagraph): Table {
    return new Table(this, rows.map((row) => (Array.isArray(row) ? row : [row as Part])), style);
  }
  footnote(parts: Part | readonly Part[], style = this.basicParagraph): Footnote {
    return new Footnote(this, Array.isArray(parts) ? parts : [parts as Part], style);
  }
  /** A text frame placed on a page (or on the pasteboard of a spread when `page` is a Spread). */
  frame(
    place: Page | Spread | Group,
    story: Story,
    options: { capacity?: number; layer?: Layer; type?: typeof TextFrame } = {},
  ): TextFrame {
    const FrameType = options.type ?? TextFrame;
    const frame = new FrameType(this, options.layer ?? this.defaultLayer, story, options.capacity);
    this.place(frame, place);
    return frame;
  }
  shape(place: Page | Spread | Group, layer = this.defaultLayer): Rectangle {
    const shape = new Rectangle(this, layer);
    this.place(shape, place);
    return shape;
  }
  group(place: Page | Spread, layer = this.defaultLayer): Group {
    const group = new Group(this, layer);
    this.place(group, place);
    return group;
  }
  /** A frame anchored inside text. Put it in a story's parts to anchor it. */
  anchoredFrame(story: Story, layer = this.defaultLayer): TextFrame {
    return new TextFrame(this, layer, story);
  }
  textPath(on: PageItem, story: Story, capacity?: number): TextPath {
    return new TextPath(on, story, capacity);
  }
  link(name: string, url: string): HyperlinkURLDestination {
    const destination = new HyperlinkURLDestination(this.world, () => this.urlDestinations, name, url);
    this.urlDestinations.push(destination);
    this.hyperlinkList.push(new Named(this.world, () => this.hyperlinkList, name));
    return destination;
  }
  anchor(name: string): Named {
    const anchor = new Named(this.world, () => this.textDestinations, name);
    this.textDestinations.push(anchor);
    return anchor;
  }
  pageLink(name: string): Named {
    const destination = new Named(this.world, () => this.pageDestinations, name);
    this.pageDestinations.push(destination);
    return destination;
  }
  bookmark(name: string, parent?: Bookmark): Bookmark {
    const siblings = parent ? parent.children : this.bookmarkList;
    const bookmark = new Bookmark(this.world, () => siblings, name);
    siblings.push(bookmark);
    return bookmark;
  }
  variable(name: string, contents: string, type: unknown = VariableTypes.CUSTOM_TEXT_TYPE): TextVariable {
    const variable = new TextVariable(this.world, name, type, contents);
    this.variables.push(variable);
    return variable;
  }

  private place(item: PageItem, place: Page | Spread | Group): void {
    if (place instanceof Group) {
      item.parent = place;
      place.children.push(item);
    } else if (place instanceof Page) {
      item.parent = place.parent;
      item.page = place;
      place.parent.items.push(item);
    } else {
      item.parent = place;
      place.items.push(item);
    }
  }

  // The DOM surface Text Scramble reads.
  /**
   * Like InDesign, document.stories.item(i) names the story by its index ("/document/story[0]"), while
   * frame.parentStory names the same story by its id. Code that dedupes by specifier sees two stories.
   */
  get stories(): Collection<Story> {
    return new Collection(() =>
      this.storyList
        .filter((story) => !this.unlistedStories.has(story))
        .map((story, index) => byIndex(story, `/document/story[${index}]`)),
    );
  }
  get pages(): Collection<Page> {
    return new Collection(() => this.spreads.flatMap((spread) => spread.pages));
  }
  get layers(): Collection<Layer> {
    return new Collection(() => this.layerList);
  }
  get allPageItems(): PageItem[] {
    return [...this.spreads, ...this.masterSpreads].flatMap((spread) => spread.allPageItems);
  }
  get allParagraphStyles(): ParagraphStyle[] {
    return [...this.styles];
  }
  get hyperlinkURLDestinations(): Collection<HyperlinkURLDestination> {
    return new Collection(() => this.urlDestinations);
  }
  get hyperlinks(): Collection<Named> {
    return new Collection(() => this.hyperlinkList);
  }
  get hyperlinkTextDestinations(): Collection<Named> {
    return new Collection(() => this.textDestinations);
  }
  get hyperlinkPageDestinations(): Collection<Named> {
    return new Collection(() => this.pageDestinations);
  }
  get bookmarks(): Collection<Bookmark> {
    return new Collection(() => this.bookmarkList);
  }
  get textVariables(): Collection<TextVariable> {
    return new Collection(() => this.variables);
  }
  save(): never {
    throw new Error("Text Scramble must never save a document.");
  }
  close(): never {
    throw new Error("Text Scramble must never close a document.");
  }
  toSpecifier(): string {
    return "/document[@id=1]";
  }

  /** Every glyph's formatting object, to prove a run never replaces or restyles characters. */
  formattingSnapshot(): unknown[] {
    const flows: Flow[] = [];
    const visit = (flow: Flow) => {
      flows.push(flow);
      flow.glyphs.forEach((glyph) => {
        if (glyph.anchor instanceof Table) glyph.anchor.rows.forEach((cell) => visit(cell.flow));
        if (glyph.anchor instanceof Footnote) visit(glyph.anchor.flow);
      });
    };
    this.storyList.forEach((story) => visit(story.flow));
    return flows.flatMap((flow) => flow.glyphs.flatMap((glyph) => [glyph.style, glyph.paragraphStyle]));
  }
}

export interface DoScriptCall {
  language: unknown;
  undoMode: unknown;
  name: unknown;
}

export class Application {
  readonly isValid = true;
  readonly documentList: Document[] = [];
  selection: unknown[] = [];
  readonly activeWindow: { activePage: Page | null } = { activePage: null };
  readonly doScriptCalls: DoScriptCall[] = [];
  constructor(readonly world: World) {}
  get documents(): Collection<Document> {
    return new Collection(() => this.documentList);
  }
  get activeDocument(): Document {
    if (!this.documentList.length) throw new Error("No documents are open.");
    return this.documentList[0];
  }
  doScript(script: () => void, language: unknown, _args: unknown, undoMode: unknown, name: unknown): void {
    this.doScriptCalls.push({ language, undoMode, name });
    this.world.inScript = true;
    try {
      script();
    } finally {
      this.world.inScript = false;
    }
  }
  select(item: unknown): void {
    this.selection = [item];
  }
  toSpecifier(): string {
    return "/application";
  }
}

export const ScriptLanguage = { UXPSCRIPT: "UXPSCRIPT", JAVASCRIPT: "JAVASCRIPT" } as const;
export const UndoModes = { ENTIRE_SCRIPT: "ENTIRE_SCRIPT" } as const;

export function createInDesign(): { app: Application; document: Document; world: World } {
  const world = new World();
  const app = new Application(world);
  const document = new Document(world);
  app.documentList.push(document);
  return { app, document, world };
}

export function hostFor(app: Application) {
  return { app, ScriptLanguage, UndoModes, VariableTypes };
}
