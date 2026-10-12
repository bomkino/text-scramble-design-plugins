// The classic ExtendScript JSX, run headlessly in an ExtendScript-like sandbox against the fake
// InDesign DOM. The same fake documents also go through the UXP panel's runScramble, and the two
// reports must agree on everything except the invented words themselves.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { before } from "node:test";
import vm from "node:vm";
import {
  createExtendScriptContext,
  directiveCommentLines,
  es3Problems,
  extractSections,
  runJsx,
  runJsxHeadless,
} from "../scripts/extendscript-sandbox.mjs";
import { createScrambler, createWordMatcher, estimateVisualWidth, hasScramblableText } from "../packages/core/src/scramble-text";
import { TOP_LEVEL_DOMAINS } from "../packages/core/src/top-level-domains";
import { COMMON_WORDS, UNWELCOME_FRAGMENTS } from "../packages/core/src/word-lists";
import { runScramble, type RunOptions, type ScrambleReport } from "../plugins/indesign/src/run";
import {
  Bookmark,
  Collection,
  createInDesign,
  Footnote,
  hostFor,
  Table,
  Text,
  VariableTypes,
  type Document,
  type Flow,
} from "./fakes/indesign";

const SOURCE = readFileSync(new URL("../plugins/indesign/src/Text Scramble.jsx", import.meta.url), "utf8");
const SECTIONS = extractSections(SOURCE, ["engine", "document", "ui"]);

interface Engine {
  name: string;
  source: string;
  globals: Record<string, unknown>;
  /** Same seed, same words, and the same words as the UXP panel. */
  matchesCore: boolean;
}

function withEngine(engine: string): string {
  return SOURCE.replace(SECTIONS.engine, () => engine);
}

// The engine that ships: the ES3 port of the core that scripts/build.mjs puts in the engine block.
const FILE_ENGINE: Engine = { name: "engine in the file", source: "", globals: {}, matchesCore: true };
// The TypeScript core itself, handed in from Node.
const CORE_ENGINE: Engine = {
  name: "core engine API",
  source: withEngine("\n"),
  globals: { createScrambler, createWordMatcher, hasScramblableText },
  matchesCore: true,
};
const ENGINES = [FILE_ENGINE, CORE_ENGINE];

before(async () => {
  const { legacyEngineSource } = await import(new URL("../scripts/legacy-engine.mjs", import.meta.url).href);
  const engine: string = await legacyEngineSource({ commonWords: COMMON_WORDS, unwelcomeFragments: UNWELCOME_FRAGMENTS, topLevelDomains: TOP_LEVEL_DOMAINS });
  FILE_ENGINE.source = withEngine(`\n${engine}`);
});

type JsxReport = Omit<ScrambleReport, "overflow"> & {
  overflow: { overflowing: Array<{ label: string; kind: string }>; alreadyOverflowing: number };
};

type App = ReturnType<typeof createInDesign>["app"];

function jsx(engine: Engine, app: App, settings: RunOptions | Record<string, unknown>): JsxReport {
  return runJsxHeadless(engine.source, { ...hostFor(app), settings, globals: engine.globals });
}

function shape(text: string): string {
  return text.replace(/\p{L}/gu, "L").replace(/\p{N}/gu, "N");
}

function words(text: string): string[] {
  return text.match(/\p{L}+/gu) ?? [];
}

/** Every text flow in a document: stories, then the cells and footnotes inside them. */
function flowTexts(document: Document): string[] {
  const texts: string[] = [];
  const visit = (flow: Flow) => {
    texts.push(flow.text(0, flow.glyphs.length));
    for (const glyph of flow.glyphs) {
      if (glyph.anchor instanceof Table) glyph.anchor.rows.forEach((cell) => visit(cell.flow));
      if (glyph.anchor instanceof Footnote) visit(glyph.anchor.flow);
    }
  };
  document.storyList.forEach((story) => visit(story.flow));
  return texts;
}

function bookmarkNames(bookmarks: readonly Bookmark[]): string[] {
  return bookmarks.flatMap((bookmark) => [bookmark.name, ...bookmarkNames(bookmark.children)]);
}

/** Everything a run can change, as plain strings. */
function documentState(document: Document) {
  return {
    flows: flowTexts(document),
    bookmarks: bookmarkNames(document.bookmarkList),
    anchors: document.textDestinations.map((anchor) => anchor.name),
    variables: document.variables.map((variable) => variable.variableOptions.contents),
    links: document.urlDestinations.map((destination) => `${destination.name} ${destination.destinationURL}`),
    hyperlinks: document.hyperlinkList.map((hyperlink) => hyperlink.name),
    pageLinks: document.pageDestinations.map((destination) => destination.name),
    info: Object.keys(document.metadataPreferences).map((key) => `${key}=${String(document.metadataPreferences[key])}`),
  };
}

/** An invented deck with text in every place InDesign keeps it. */
function deck() {
  const fake = createInDesign();
  const { document: doc } = fake;
  const spread = doc.spread(["1", "2"]);
  const [page1, page2] = spread.pages;
  const parent = doc.masterSpread("A-Parent");
  const headline = doc.paragraphStyle("Headline");
  const body = doc.paragraphStyle("Body");

  const nested = doc.table([["Brindlewick inner cell"]]);
  const table = doc.table([["Brindlewick ledger"], ["Quarter", nested], ["Totals 2026"]]);
  const footnote = doc.footnote("Brindlewick footnote text.");
  const anchoredStory = doc.story("Brindlewick anchored caption");
  const anchored = doc.anchoredFrame(anchoredStory);
  const article = doc.story([
    headline,
    "Brindlewick Annual Review\r",
    body,
    "Brindlewick grew in every region. ",
    table,
    " See the note",
    footnote,
    ". ",
    anchored,
    "\rThe overset tail mentions Brindlewick once more.",
  ]);
  const frame1 = doc.frame(page1, article, { capacity: 40 });
  const frame2 = doc.frame(page2, article, { capacity: 30 });

  const footerStory = doc.story("Brindlewick confidential footer");
  const footer = doc.frame(parent.pages[0], footerStory);

  const pasteboardStory = doc.story("Brindlewick pasteboard note");
  doc.frame(spread, pasteboardStory);

  const hiddenStory = doc.story("Hidden Brindlewick alternate");
  const hidden = doc.frame(page1, hiddenStory);
  hidden.visible = false;

  const lockedLayer = doc.layer("Locked furniture");
  lockedLayer.setLockedForTest(true);
  const slugStory = doc.story("Brindlewick slug line");
  const slug = doc.frame(page2, slugStory, { layer: lockedLayer });

  const lockedFrameStory = doc.story("Brindlewick locked frame");
  const lockedFrame = doc.frame(page1, lockedFrameStory);
  lockedFrame.setLockedForTest(true);

  const circle = doc.shape(page1);
  const pathStory = doc.story("Brindlewick around a circle");
  doc.textPath(circle, pathStory);

  const group = doc.group(page2);
  const groupedStory = doc.story("Brindlewick grouped caption");
  const grouped = doc.frame(group, groupedStory);

  const unlistedStory = doc.story("Brindlewick unlisted story");
  doc.frame(page2, unlistedStory);
  doc.unlistedStories.add(unlistedStory);

  const chapter = doc.bookmark("Brindlewick results");
  const child = doc.bookmark("Regional detail", chapter);
  const web = doc.bookmark("www.brindlewick.invalid");
  const anchor = doc.anchor("Brindlewick results anchor");
  const client = doc.variable("Client", "Brindlewick Traders");
  const fileName = doc.variable("File", "brindlewick-deck.indd", VariableTypes.FILE_NAME_TYPE);
  const webLink = doc.link("https://brindlewick.invalid/annual", "https://brindlewick.invalid/annual");
  const mailLink = doc.link("mailto:press@brindlewick.invalid", "mailto:press@brindlewick.invalid");
  doc.pageLink("Brindlewick page 3");

  fake.app.activeWindow.activePage = page1;
  return {
    ...fake,
    page1,
    page2,
    parent,
    article,
    frame1,
    frame2,
    table,
    nested,
    footnote,
    anchoredStory,
    footerStory,
    footer,
    pasteboardStory,
    hiddenStory,
    hidden,
    lockedLayer,
    slugStory,
    slug,
    lockedFrameStory,
    lockedFrame,
    circle,
    pathStory,
    group,
    groupedStory,
    grouped,
    unlistedStory,
    headline,
    body,
    chapter,
    child,
    web,
    anchor,
    client,
    fileName,
    webLink,
    mailLink,
  };
}

type Deck = ReturnType<typeof deck>;

/** Frame and cell overflow that every engine can be trusted to cause: narrow words in exact frames. */
function overflowDeck() {
  const fake = createInDesign();
  const { document } = fake;
  const spread = document.spread(["1", "2"]);
  const parent = document.masterSpread("B-Parent");
  const tight = "lil fil tilt lit";
  const exact = Array.from(tight).reduce((total, character) => total + estimateVisualWidth(character), 0) + 0.001;
  document.frame(spread.pages[1], document.story(tight), { capacity: exact });
  document.frame(spread.pages[0], document.story("This one already oversets badly"), { capacity: 2 });
  document.frame(parent.pages[0], document.story(tight), { capacity: exact });
  const table = document.table([tight]);
  table.rows[0].capacity = exact;
  document.frame(spread.pages[0], document.story(["Table: ", table]));
  return fake;
}

/** The part of a report both runtimes must agree on: everything but the invented words. */
function comparable(report: ScrambleReport | JsxReport) {
  return {
    scope: report.scope,
    changed: report.changed,
    characters: report.characters,
    kinds: { ...report.kinds },
    parentPages: report.parentPages,
    names: report.names,
    skipped: { ...report.skipped },
    keptParagraphs: report.keptParagraphs,
    overflow: {
      overflowing: report.overflow.overflowing.map(({ label, kind }) => ({ label, kind })),
      alreadyOverflowing: report.overflow.alreadyOverflowing,
    },
    cleanup: report.cleanup ? { ...report.cleanup } : null,
    errors: [...report.errors],
    notes: [...report.notes],
    empty: report.empty,
  };
}

// A small stand-in for ScriptUI: enough to build the dialog, answer it, and read it back.
class FakeControl {
  readonly children: FakeControl[] = [];
  items: Array<{ text: string; selected: boolean; index: number }> = [];
  value = false;
  text = "";
  helpTip = "";
  private chosen: { text: string; selected: boolean; index: number } | null = null;
  [setting: string]: unknown;
  constructor(readonly type: string, text?: unknown, readonly properties?: unknown) {
    if (text && typeof text === "object" && "length" in text) {
      this.items = Array.from(text as ArrayLike<unknown>, (entry, index) => ({ text: String(entry), selected: false, index }));
    } else if (text !== undefined) {
      this.text = String(text);
    }
  }
  add(type: string, _bounds?: unknown, text?: unknown, properties?: unknown): FakeControl {
    const control = new FakeControl(type, text, properties);
    this.children.push(control);
    return control;
  }
  get selection(): { text: string; selected: boolean; index: number } | null {
    return this.chosen;
  }
  set selection(value: unknown) {
    this.chosen = typeof value === "number" ? (this.items[value] ?? null) : (value as FakeControl["chosen"]);
  }
  all(): FakeControl[] {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }
  find(type: string, text?: string): FakeControl {
    const found = this.all().find((control) => control.type === type && (text === undefined || control.text === text));
    if (!found) throw new Error(`No ${type} "${text ?? ""}" in the dialog.`);
    return found;
  }
}

/** Runs the script the way a person does: dialog, run, closing alert. */
function interactive(engine: Engine, app: App, answer: ((dialog: FakeControl) => number) | null) {
  const alerts: string[] = [];
  const dialogs: FakeControl[] = [];
  class Window extends FakeControl {
    constructor(type: string, readonly title: string) {
      super(type);
      dialogs.push(this);
    }
    show(): number {
      if (!answer) throw new Error("No dialog was expected.");
      return answer(this);
    }
  }
  runJsx(engine.source, { ...hostFor(app), ...engine.globals, Window, alert: (message: string) => alerts.push(String(message)) });
  return { alerts, dialogs };
}

function choose(dialog: FakeControl, choices: { scope?: number; keep?: string[]; words?: string; seed?: string; check?: Record<string, boolean> }): number {
  if (choices.scope !== undefined) dialog.find("dropdownlist").selection = choices.scope;
  const list = dialog.find("listbox");
  for (const item of list.items) item.selected = (choices.keep ?? []).includes(item.text);
  const edits = dialog.all().filter((control) => control.type === "edittext");
  if (choices.words !== undefined) edits[0].text = choices.words;
  if (choices.seed !== undefined) edits[1].text = choices.seed;
  for (const [label, value] of Object.entries(choices.check ?? {})) dialog.find("checkbox", label).value = value;
  return 1;
}

test("the sandbox behaves like ExtendScript", () => {
  const context = createExtendScriptContext();
  const probe = vm.runInContext(
    "[typeof [].forEach, typeof [].indexOf, typeof Object.keys, typeof JSON, typeof ''.trim, typeof Function.prototype.bind, typeof Date.now, typeof Math.imul, typeof Map, typeof Array.isArray, typeof ({}).watch, typeof ({}).reflect, $.global === this].join()",
    context,
  );
  assert.equal(probe, "undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,function,object,true");
});

test("no line starts with // @, which ExtendScript reads as an unknown directive and refuses to load", () => {
  assert.deepEqual(directiveCommentLines(SOURCE), []);
  assert.deepEqual(directiveCommentLines(FILE_ENGINE.source), [], "the injected engine neither");
  assert.deepEqual(directiveCommentLines("var a = 1; // @ at the end is fine\n  //@include other.jsx\n// an @ later is fine\n\t// @document:start\n"), [2, 4]);
  // The sandbox refuses such a script the way InDesign does, so every other test would fail too.
  const broken = FILE_ENGINE.source.replace("// [document:start]", "// @document:start");
  assert.throws(() => runJsx(broken), /unknown preprocessor directive/);
});

test("the script is ES3, with no ES5 calls outside the engine and only example.com addresses", () => {
  assert.deepEqual(es3Problems(SOURCE, { skipSections: ["engine"], strictIndexOf: true }), []);
  assert.match(SECTIONS.document, /function runTextScramble\(settings\)/);
  assert.match(SECTIONS.document, /UndoModes\.ENTIRE_SCRIPT/);
  assert.doesNotMatch(SOURCE, /\.save\(|\.close\(/, "the script never saves or closes a document");
  assert.doesNotMatch(SOURCE.slice(SOURCE.indexOf("// [engine:end]")), /[^\x00-\x7F]/, "ASCII only, so the file reads the same in any encoding");
  const addresses = SOURCE.match(/[a-z]+:\/\/[^\s"'/]+|[\w.-]+@[\w-]+\.[\w.-]+/gi) ?? [];
  assert.ok(addresses.length > 0);
  for (const address of addresses) assert.match(address, /example\.com$/, address);
  assert.deepEqual(es3Problems("var a = [].map(function () {}); var b = JSON; var c = /\\p{L}/;").length, 3, "the linter itself works");
});

for (const engine of ENGINES) {
  test(`selection: a frame changes in place, as one undo step (${engine.name})`, () => {
    const d = deck();
    const before = d.article.contents;
    const frame1End = d.frame1.texts.item(0)!.length;
    const formatting = d.document.formattingSnapshot();
    d.app.selection = [d.frame1];

    const report = jsx(engine, d.app, { scope: "selection", seed: 7 });

    assert.equal(report.empty, null);
    assert.equal(report.changed, 1);
    assert.equal(report.kinds.frame, 1);
    assert.equal(report.characters, frame1End);
    assert.notEqual(d.article.contents.slice(0, frame1End), before.slice(0, frame1End));
    assert.equal(d.article.contents.slice(frame1End), before.slice(frame1End), "the next frame in the thread is not selected");
    assert.equal(shape(d.article.contents), shape(before));
    assert.equal(d.footerStory.contents, "Brindlewick confidential footer");
    const after = d.document.formattingSnapshot();
    assert.equal(after.length, formatting.length);
    assert.ok(after.every((style, index) => style === formatting[index]), "every character keeps its formatting objects");
    assert.deepEqual(d.app.doScriptCalls, [{ language: "JAVASCRIPT", undoMode: "ENTIRE_SCRIPT", name: "Text Scramble" }]);
    assert.ok(d.world.writes > 0 && d.world.writes <= frame1End, "only changed characters are written");
  });

  test(`selection: partial text, cells, whole tables, groups and paths (${engine.name})`, () => {
    const { app, document } = createInDesign();
    const page = document.spread(["1"]).pages[0];
    const story = document.story("Keep this. Scramble these words. Keep that.");
    document.frame(page, story);
    const start = "Keep this. ".length;
    const end = start + "Scramble these words.".length;
    app.selection = [new Text(story.flow, start, end)];
    const partial = jsx(engine, app, { scope: "selection" });
    assert.equal(partial.changed, 1);
    assert.equal(partial.kinds.selection, 1);
    assert.ok(story.contents.startsWith("Keep this. ") && story.contents.endsWith(" Keep that."));
    assert.notEqual(story.contents.slice(start, end), "Scramble these words.");

    const d = deck();
    const cellsBefore = d.table.rows.map((cell) => cell.contents);
    d.app.selection = [d.table.rows[0], d.group, d.circle];
    const report = jsx(engine, d.app, { scope: "selection" });
    assert.notEqual(d.table.rows[0].contents, cellsBefore[0]);
    assert.equal(d.table.rows[2].contents, cellsBefore[2], "unselected cells stay");
    assert.notEqual(d.groupedStory.contents, "Brindlewick grouped caption");
    assert.notEqual(d.pathStory.contents, "Brindlewick around a circle");
    assert.deepEqual([report.kinds.cell, report.kinds.frame, report.kinds.path], [1, 1, 1]);

    const whole = deck();
    whole.app.selection = [whole.table];
    const tableReport = jsx(engine, whole.app, { scope: "selection" });
    assert.equal(tableReport.kinds.cell, 4, "every cell, including the nested table's");
    assert.ok(!whole.nested.rows[0].contents.includes("Brindlewick"));
  });

  test(`page: frames on the active page, the overset tail, nothing on other pages (${engine.name})`, () => {
    const d = deck();
    d.app.activeWindow.activePage = d.page2;
    const frame1End = d.frame1.texts.item(0)!.length;
    const storyBefore = d.article.contents;
    const oversetStart = d.frame2.texts.item(0)!.index + d.frame2.texts.item(0)!.length;
    assert.ok(d.frame2.overflows, "fixture: the article oversets");

    const report = jsx(engine, d.app, { scope: "page" });

    assert.equal(d.article.contents.slice(0, frame1End), storyBefore.slice(0, frame1End), "frame on page 1 untouched");
    assert.notEqual(d.article.contents.slice(frame1End, oversetStart), storyBefore.slice(frame1End, oversetStart));
    assert.notEqual(d.article.contents.slice(oversetStart), storyBefore.slice(oversetStart), "overset text changed");
    assert.equal(report.kinds.overset, 1);
    assert.notEqual(d.slugStory.contents, "Brindlewick slug line", "locked layer is included by default");
    assert.notEqual(d.groupedStory.contents, "Brindlewick grouped caption", "grouped frames are included");
    assert.equal(d.footerStory.contents, "Brindlewick confidential footer", "parent pages are not part of a page run");
    assert.equal(d.chapter.name, "Brindlewick results", "names only change in a Whole document run");
    assert.equal(d.lockedLayer.locked, true);

    const first = deck();
    const firstEnd = first.frame1.texts.item(0)!.length;
    const firstBefore = first.article.contents;
    jsx(engine, first.app, { scope: "page" });
    assert.notEqual(first.article.contents.slice(0, firstEnd), firstBefore.slice(0, firstEnd));
    assert.equal(first.article.contents.slice(firstEnd), firstBefore.slice(firstEnd), "the threaded frame on page 2 is left alone");
  });

  test(`document: every story, table, footnote, path, anchored frame and parent page (${engine.name})`, () => {
    const d = deck();
    const report = jsx(engine, d.app, { scope: "document", seed: 5 });

    for (const story of [d.article, d.footerStory, d.pasteboardStory, d.slugStory, d.lockedFrameStory, d.pathStory, d.groupedStory, d.unlistedStory, d.anchoredStory]) {
      assert.ok(!story.contents.includes("Brindlewick"), `still readable: ${story.contents}`);
    }
    for (const cell of [...d.table.rows, ...d.nested.rows]) assert.ok(!cell.contents.includes("Brindlewick"), cell.contents);
    assert.ok(!d.footnote.flow.text(0, 99).includes("Brindlewick"));
    assert.equal(d.hiddenStory.contents, "Hidden Brindlewick alternate", "hidden items are skipped by default");
    assert.deepEqual(report.skipped, { locked: 0, hidden: 1, unreadable: 0 });
    assert.equal(report.parentPages, 1);
    assert.equal(report.kinds.cell, 4);
    assert.equal(report.kinds.footnote, 1);
    assert.equal(report.kinds.path, 1);
    assert.deepEqual(report.errors, []);
    assert.equal(d.app.doScriptCalls.length, 1);
    assert.equal(d.lockedLayer.locked, true, "locked layer is locked again");
    assert.equal(d.lockedFrame.locked, true, "locked frame is locked again");
    assert.notEqual(d.slugStory.contents, "Brindlewick slug line");
    assert.ok(d.world.recomposed > 0);
  });

  test(`document: each story is scrambled and counted once, however InDesign names it (${engine.name})`, () => {
    const { app, document } = createInDesign();
    const [page1, page2] = document.spread(["1", "2"]).pages;
    const article = document.story("Brindlewick grew in every region and kept going past the frame.");
    document.frame(page1, article, { capacity: 20 });
    document.frame(page2, article);
    document.frame(page1, document.story("Quellmoor Orchard opened three rooms."));
    const report = jsx(engine, app, { scope: "document", seed: 22 });
    assert.equal(report.changed, 2);
    assert.equal(report.kinds.story, 2);
    assert.equal(report.characters, Array.from(article.contents).length + "Quellmoor Orchard opened three rooms.".length);
  });

  test(`document: locked and hidden switches (${engine.name})`, () => {
    const locked = deck();
    const lockedGroup = locked.document.group(locked.page2);
    lockedGroup.setLockedForTest(true);
    const inLockedGroup = locked.document.story("Brindlewick in a locked group");
    locked.document.frame(lockedGroup, inLockedGroup);
    const leftAlone = jsx(engine, locked.app, { scope: "document", includeLocked: false });
    assert.equal(locked.slugStory.contents, "Brindlewick slug line");
    assert.equal(locked.lockedFrameStory.contents, "Brindlewick locked frame");
    assert.equal(inLockedGroup.contents, "Brindlewick in a locked group");
    assert.equal(leftAlone.skipped.locked, 3);
    assert.equal(locked.lockedLayer.locked, true);

    const included = deck();
    const lockedGroupToo = included.document.group(included.page2);
    lockedGroupToo.setLockedForTest(true);
    const inGroup = included.document.story("Brindlewick in a locked group");
    included.document.frame(lockedGroupToo, inGroup);
    jsx(engine, included.app, { scope: "document" });
    assert.notEqual(inGroup.contents, "Brindlewick in a locked group");
    assert.equal(lockedGroupToo.locked, true, "the group is locked again");

    const hidden = deck();
    const hiddenLayer = hidden.document.layer("Hidden notes");
    hiddenLayer.visible = false;
    const onHiddenLayer = hidden.document.story("Brindlewick on a hidden layer");
    hidden.document.frame(hidden.page1, onHiddenLayer, { layer: hiddenLayer });
    const skipped = jsx(engine, hidden.app, { scope: "document" });
    assert.equal(skipped.skipped.hidden, 2);
    assert.equal(onHiddenLayer.contents, "Brindlewick on a hidden layer");
    const shown = jsx(engine, hidden.app, { scope: "document", includeHidden: true });
    assert.equal(shown.skipped.hidden, 0);
    assert.notEqual(hidden.hiddenStory.contents, "Hidden Brindlewick alternate");
    assert.notEqual(onHiddenLayer.contents, "Brindlewick on a hidden layer");
    assert.equal(hidden.app.doScriptCalls.length, 2, "one undo step per run");
  });

  test(`keep readable: kept styles stay, listed words still change, one word everywhere (${engine.name})`, () => {
    const d = deck();
    const report = jsx(engine, d.app, { scope: "document", keepStyles: ["Headline"], alwaysScramble: ["brindlewick"], seed: 10 });
    const headline = d.article.contents.split("\r")[0];
    assert.match(headline, /^\p{L}+ Annual Review$/u);
    assert.ok(!headline.startsWith("Brindlewick"));
    assert.equal(words(headline)[0], words(d.footerStory.contents)[0], "same invented word as elsewhere");
    assert.ok(!d.article.contents.includes("grew in every region"));
    assert.equal(report.keptParagraphs, 1);
    // Bookmarks and anchors follow the keep-readable rule; text variables scramble in full.
    assert.match(d.chapter.name, /^\p{L}+ results$/u);
    assert.equal(words(d.chapter.name)[0], words(headline)[0]);
    assert.equal(d.child.name, "Regional detail");
    assert.match(d.anchor.name, /^\p{L}+ results anchor$/u);
    assert.doesNotMatch(d.client.variableOptions.contents, /Traders/);
    assert.equal(report.names, 3, "the unchanged child bookmark is not counted");

    const { app, document } = createInDesign();
    const page = document.spread(["1"]).pages[0];
    document.frame(page, document.story([document.paragraphStyle("Headline"), "Only a headline"]));
    app.activeWindow.activePage = page;
    const allKept = jsx(engine, app, { scope: "page", keepStyles: ["Headline"] });
    assert.equal(allKept.empty, "all-kept");
    assert.equal(app.doScriptCalls.length, 0);
  });

  test(`names and custom text variables follow the scramble (${engine.name})`, () => {
    const d = deck();
    const report = jsx(engine, d.app, { scope: "document", seed: 15 });
    assert.notEqual(d.chapter.name, "Brindlewick results");
    assert.notEqual(d.child.name, "Regional detail");
    assert.equal(d.web.name, "www.brindlewick.invalid", "address-like names are never scrambled into new addresses");
    assert.notEqual(d.anchor.name, "Brindlewick results anchor");
    assert.notEqual(d.client.variableOptions.contents, "Brindlewick Traders");
    assert.equal(shape(d.client.variableOptions.contents), shape("Brindlewick Traders"));
    assert.equal(d.fileName.variableOptions.contents, "brindlewick-deck.indd");
    assert.equal(report.names, 4);
    assert.equal(words(d.chapter.name)[0], words(d.footerStory.contents)[0], "same scrambler as the copy");
  });

  test(`cleanup: example.com links, neutral names, cleared document info (${engine.name})`, () => {
    const d = deck();
    const report = jsx(engine, d.app, { scope: "document", cleanup: true });
    assert.deepEqual(
      d.document.urlDestinations.map((destination) => destination.destinationURL),
      ["https://example.com/link-1", "mailto:hello@example.com"],
    );
    assert.deepEqual(d.document.urlDestinations.map((destination) => destination.name), ["Link 1", "Link 2"]);
    assert.deepEqual(d.document.hyperlinkList.map((link) => link.name), ["Hyperlink 1", "Hyperlink 2"]);
    assert.equal(d.document.pageDestinations[0].name, "Page link 1");
    for (const key of ["author", "description", "copyrightNotice", "copyrightInfoURL", "jobName"]) {
      assert.equal(d.document.metadataPreferences[key], "", key);
    }
    assert.equal(d.document.metadataPreferences.documentTitle, "Untitled", "InDesign ignores an empty title, so it gets a neutral one");
    assert.deepEqual(Array.from(d.document.metadataPreferences.keywords as ArrayLike<unknown>), []);
    assert.deepEqual(report.cleanup, { links: 2, renamed: 5, documentInfo: true });

    const refusing = deck();
    let title = "Brindlewick deck";
    Object.defineProperty(refusing.document.metadataPreferences, "documentTitle", {
      get: () => title,
      set: (value: string) => {
        if (value === "") throw new Error("Invalid value for documentTitle.");
        title = value;
      },
    });
    assert.deepEqual(jsx(engine, refusing.app, { scope: "document", cleanup: true }).errors, []);
    assert.equal(title, "Untitled", "a title that refuses to be emptied gets a neutral one");

    const off = deck();
    jsx(engine, off.app, { scope: "document" });
    assert.equal(off.webLink.destinationURL, "https://brindlewick.invalid/annual", "cleanup is off by default");
    assert.equal(off.document.metadataPreferences.author, "Sample Author");

    const { app, document } = createInDesign();
    const lone = document.link("https://brindlewick.invalid/", "https://brindlewick.invalid/");
    const alone = jsx(engine, app, { scope: "selection", cleanup: true });
    assert.equal(lone.destinationURL, "https://example.com/link-1", "cleanup works on its own");
    assert.equal(alone.empty, null);
    assert.equal(app.doScriptCalls.length, 1);
  });

  test(`failures are reported, the rest still runs, locks come back, odd text is left alone (${engine.name})`, () => {
    const d = deck();
    d.footerStory.flow.assertEditable = () => {
      throw new Error("Story is checked out to InCopy.");
    };
    const report = jsx(engine, d.app, { scope: "document" });
    assert.deepEqual(report.errors, ["Story is checked out to InCopy."]);
    assert.equal(d.footerStory.contents, "Brindlewick confidential footer");
    assert.ok(!d.pathStory.contents.includes("Brindlewick"));
    assert.equal(d.lockedLayer.locked, true);

    const odd = createInDesign();
    const story = odd.document.story("Brindlewick special characters");
    odd.document.frame(odd.document.spread(["1"]).pages[0], story);
    Object.defineProperty(story, "contents", { get: () => "Brindlewick special characters plus" });
    const unreadable = jsx(engine, odd.app, { scope: "document" });
    assert.equal(unreadable.skipped.unreadable, 1);
    assert.equal(odd.world.writes, 0);
    assert.ok(unreadable.notes.some((note) => note.includes("lined up")));

    const overset = createInDesign();
    const long = overset.document.story("Brindlewick text that is far too long for its little frame.");
    const page = overset.document.spread(["1"]).pages[0];
    const frame = overset.document.frame(page, long, { capacity: 10 });
    const real = frame.texts.item(0)!;
    Object.defineProperty(frame, "texts", { get: () => new Collection(() => [Object.create(real, { index: { value: real.index + 1 } })]) });
    overset.app.activeWindow.activePage = page;
    const misaligned = jsx(engine, overset.app, { scope: "page" });
    assert.equal(misaligned.kinds.overset, 0);
    assert.equal(misaligned.skipped.unreadable, 1);
  });

  test(`empty runs explain themselves and change nothing (${engine.name})`, () => {
    const d = deck();
    const before = documentState(d.document);
    assert.equal(jsx(engine, d.app, { scope: "selection" }).empty, "empty-selection");

    const hiddenOnly = createInDesign();
    const page = hiddenOnly.document.spread(["1"]).pages[0];
    hiddenOnly.document.frame(page, hiddenOnly.document.story("Brindlewick")).visible = false;
    hiddenOnly.app.activeWindow.activePage = page;
    assert.equal(jsx(engine, hiddenOnly.app, { scope: "page" }).empty, "all-skipped");

    const blank = createInDesign();
    blank.app.activeWindow.activePage = blank.document.spread(["1"]).pages[0];
    blank.document.frame(blank.app.activeWindow.activePage!, blank.document.story(" . , "));
    assert.equal(jsx(engine, blank.app, { scope: "page" }).empty, "nothing-to-scramble");

    const none = createInDesign();
    none.app.documentList.length = 0;
    const report = jsx(engine, none.app, { scope: "document" });
    assert.equal(report.empty, "no-document");
    assert.equal(report.changed, 0);

    assert.deepEqual(documentState(d.document), before);
    assert.equal(d.app.doScriptCalls.length + hiddenOnly.app.doScriptCalls.length + blank.app.doScriptCalls.length + none.app.doScriptCalls.length, 0);
  });
}

for (const engine of ENGINES) {
  test(`overflow report: names the pages of frames and cells that now overflow (${engine.name})`, () => {
    const { app, document } = overflowDeck();
    const report = jsx(engine, app, { scope: "document", seed: 12 });
    assert.deepEqual(report.overflow.overflowing.map((item) => item.label).sort(), ["page 2", "parent page B-Parent", "table on page 1"]);
    assert.deepEqual(report.overflow.overflowing.map((item) => Object.keys(item).sort()), [["kind", "label"], ["kind", "label"], ["kind", "label"]]);
    assert.equal(report.overflow.alreadyOverflowing, 1);
    assert.ok(document.world.recomposed > 0);
  });
}

test("parity: the JSX and the UXP panel give the same report for the same document", () => {
  const scenarios: Array<{ name: string; options: RunOptions; setup?: (d: Deck) => void }> = [
    {
      name: "selection",
      options: { scope: "selection" },
      setup: (d) => {
        d.app.selection = [d.frame1, d.table.rows[0], d.group, d.circle, new Text(d.article.flow, 2, 9), d.hidden];
      },
    },
    { name: "selection of locked items, left alone", options: { scope: "selection", includeLocked: false }, setup: (d) => (d.app.selection = [d.lockedFrame, d.slug]) },
    { name: "empty selection", options: { scope: "selection" } },
    { name: "page 1", options: { scope: "page" } },
    { name: "page 2", options: { scope: "page" }, setup: (d) => (d.app.activeWindow.activePage = d.page2) },
    { name: "page 2, numbers off", options: { scope: "page", scrambleNumbers: false }, setup: (d) => (d.app.activeWindow.activePage = d.page2) },
    { name: "document", options: { scope: "document" } },
    { name: "document, hidden in, locked out", options: { scope: "document", includeHidden: true, includeLocked: false } },
    { name: "document, keep, words, cleanup", options: { scope: "document", keepStyles: ["Headline"], alwaysScramble: ["Brindlewick"], cleanup: true } },
    { name: "document, everything kept", options: { scope: "document", keepStyles: ["Headline", "Body", "[Basic Paragraph]"] } },
    { name: "page, everything kept", options: { scope: "page", keepStyles: ["Headline", "Body", "[Basic Paragraph]"] } },
    {
      // InDesign can answer "no next frame" with a NothingEnum object instead of null.
      name: "page 2, no next frame given as an object",
      options: { scope: "page" },
      setup: (d) => {
        d.app.activeWindow.activePage = d.page2;
        Object.defineProperty(d.frame2, "nextTextFrame", { get: () => ({ isValid: true }) });
        Object.defineProperty(d.frame2, "overflows", { get: () => true });
      },
    },
    {
      name: "document, a frame fails",
      options: { scope: "document" },
      setup: (d) => {
        d.footerStory.flow.assertEditable = () => {
          throw new Error("Story is checked out to InCopy.");
        };
      },
    },
  ];
  for (const engine of ENGINES) {
    for (const scenario of scenarios) {
      const uxp = deck();
      const classic = deck();
      scenario.setup?.(uxp);
      scenario.setup?.(classic);
      const options = engine.matchesCore ? { ...scenario.options, seed: `parity ${scenario.name}` } : scenario.options;
      const expected = runScramble(hostFor(uxp.app), options);
      const actual = jsx(engine, classic.app, options);
      const label = `${scenario.name} (${engine.name})`;
      assert.deepEqual(comparable(actual), comparable(expected), label);
      assert.equal(classic.app.doScriptCalls.length, uxp.app.doScriptCalls.length, label);
      assert.equal(classic.lockedLayer.locked, true, label);
      if (engine.matchesCore) assert.deepEqual(documentState(classic.document), documentState(uxp.document), `same words: ${label}`);
    }
  }
});

test("parity: overflow, word for word", () => {
  for (const engine of ENGINES) {
    const uxp = overflowDeck();
    const classic = overflowDeck();
    const expected = runScramble(hostFor(uxp.app), { scope: "document", seed: 12 });
    const actual = jsx(engine, classic.app, { scope: "document", seed: 12 });
    assert.deepEqual(comparable(actual), comparable(expected), engine.name);
    assert.deepEqual(documentState(classic.document), documentState(uxp.document), engine.name);
  }
});

test("engine: the shipped engine and the core API give the UXP panel's words exactly", () => {
  const withNames = () => {
    const d = deck();
    const story = d.document.story([d.headline, "Amélie Hart met AMELIE of Quellmoor\r", d.body, "Quellmoor, née Hart, wrote back."]);
    d.document.frame(d.page2, story);
    return { ...d, story };
  };
  for (const engine of ENGINES) {
    const uxp = withNames();
    const classic = withNames();
    const options = { scope: "document" as const, seed: "pitch", keepStyles: ["Headline"], alwaysScramble: ["Amélie", "brindlewick"] };
    runScramble(hostFor(uxp.app), options);
    jsx(engine, classic.app, options);
    assert.deepEqual(documentState(classic.document), documentState(uxp.document), engine.name);
    const kept = classic.story.contents.split("\r")[0];
    assert.match(kept, /^\p{L}+ Hart met \p{L}+ of Quellmoor$/u, "accents and case are ignored when matching listed words");
    assert.ok(!kept.startsWith("Amélie") && !kept.includes("AMELIE"));
  }
});

test("headless entry: $.global.TextScrambleTest runs without dialog or alerts and stores a plain report", () => {
  const d = deck();
  const report = runJsxHeadless(FILE_ENGINE.source, {
    ...hostFor(d.app),
    settings: { scope: "document", seed: 1 },
    globals: {
      Window: function Window() {
        throw new Error("No dialog in a headless run.");
      },
    },
  }) as JsxReport;
  assert.deepEqual(Object.keys(report).sort(), [
    "changed", "characters", "cleanup", "empty", "errors", "keptParagraphs", "kinds", "names", "notes", "overflow", "parentPages", "scope", "skipped",
  ]);
  assert.deepEqual(Object.keys(report.kinds).sort(), ["cell", "footnote", "frame", "overset", "path", "selection", "story"]);
  assert.deepEqual(Object.keys(report.skipped).sort(), ["hidden", "locked", "unreadable"]);
  assert.deepEqual(Object.keys(report.overflow).sort(), ["alreadyOverflowing", "overflowing"]);
  assert.equal(report.scope, "document");
  assert.ok(report.changed > 10);

  const none = createInDesign();
  none.app.documentList.length = 0;
  const empty = runJsxHeadless(FILE_ENGINE.source, { ...hostFor(none.app), settings: { scope: "page" } }) as JsxReport;
  assert.equal(empty.empty, "no-document");
  assert.equal(empty.cleanup, null);
});

test("dialog: the choices reach the run and the closing message sums it up", () => {
  const d = deck();
  const seen: { dialog?: FakeControl } = {};
  const { alerts, dialogs } = interactive(FILE_ENGINE, d.app, (dialog) => {
    seen.dialog = dialog;
    return choose(dialog, {
      scope: 2,
      keep: ["Headline"],
      words: "Brindlewick, Amélie  Hart",
      seed: " 42 ",
      check: { "Include hidden items": true, "Clean links and document info": true },
    });
  });
  assert.equal(dialogs.length, 1);
  const dialog = seen.dialog!;
  assert.equal((dialog as unknown as { title: string }).title, "Text Scramble");
  assert.deepEqual(dialog.find("dropdownlist").items.map((item) => item.text), ["Selection", "Active page", "Whole document"]);
  assert.deepEqual(dialog.find("listbox").items.map((item) => item.text), ["[Basic Paragraph]", "Headline", "Body"]);
  assert.equal(dialog.find("checkbox", "Include locked items").helpTip, "Locked frames still print");
  assert.equal(dialog.find("checkbox", "Include hidden items").helpTip, "Hidden items don’t print, but stay in the file");
  assert.equal(dialog.find("checkbox", "Clean links and document info").helpTip, "Points links at example.com and clears the title and author");
  assert.ok(dialog.find("statictext", "Always scramble these words"));
  assert.ok(dialog.find("statictext", "Seed (optional)"));
  assert.ok(dialog.find("button", "Cancel") && dialog.find("button", "Scramble"));

  assert.notEqual(d.hiddenStory.contents, "Hidden Brindlewick alternate", "hidden items were included");
  assert.equal(d.webLink.destinationURL, "https://example.com/link-1", "cleanup ran");
  assert.match(d.article.contents.split("\r")[0], /^\p{L}+ Annual Review$/u, "the headline was kept, except the listed word");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /^Scrambled [\d,]+ characters in /);
  assert.match(alerts[0], /Kept 1 paragraph readable/);
  assert.match(alerts[0], /1 of these is on a parent page/);
  assert.match(alerts[0], /pointed 2 links at example\.com/);
  assert.match(alerts[0], /Edit > Undo/);
  assert.equal(d.app.doScriptCalls.length, 1);
});

test("dialog: cancel changes nothing, and the scope starts on what makes sense", () => {
  const d = deck();
  const before = documentState(d.document);
  let scope = -1;
  const { alerts } = interactive(FILE_ENGINE, d.app, (dialog) => {
    scope = dialog.find("dropdownlist").selection!.index;
    return 2;
  });
  assert.equal(scope, 1, "nothing is selected, so Active page");
  assert.deepEqual(alerts, []);
  assert.equal(d.app.doScriptCalls.length, 0);
  assert.deepEqual(documentState(d.document), before);

  d.app.selection = [d.frame1];
  interactive(FILE_ENGINE, d.app, (dialog) => {
    scope = dialog.find("dropdownlist").selection!.index;
    return 2;
  });
  assert.equal(scope, 0, "something is selected, so Selection");
});

test("dialog: friendly messages for every empty run", () => {
  const none = createInDesign();
  none.app.documentList.length = 0;
  assert.deepEqual(interactive(FILE_ENGINE, none.app, null).alerts, ["Open an InDesign document first."]);

  const d = deck();
  const messages = [
    interactive(FILE_ENGINE, d.app, (dialog) => choose(dialog, { scope: 0 })).alerts[0],
    interactive(FILE_ENGINE, d.app, (dialog) => choose(dialog, { scope: 1, keep: ["Headline", "Body", "[Basic Paragraph]"] })).alerts[0],
  ];
  const hiddenOnly = createInDesign();
  const page = hiddenOnly.document.spread(["1"]).pages[0];
  hiddenOnly.document.frame(page, hiddenOnly.document.story("Brindlewick")).visible = false;
  hiddenOnly.app.activeWindow.activePage = page;
  messages.push(interactive(FILE_ENGINE, hiddenOnly.app, (dialog) => choose(dialog, { scope: 1 })).alerts[0]);
  const blank = createInDesign();
  blank.app.activeWindow.activePage = blank.document.spread(["1"]).pages[0];
  messages.push(interactive(FILE_ENGINE, blank.app, (dialog) => choose(dialog, { scope: 1 })).alerts[0]);

  assert.match(messages[0], /^Nothing is selected\./);
  assert.match(messages[1], /keep readable, so nothing changed[\s\S]*Left 1 hidden item alone/, "kept on purpose, not \"all skipped\"");
  assert.match(messages[2], /is locked or hidden, so nothing changed[\s\S]*Left 1 hidden item alone/);
  assert.match(messages[3], /no text to scramble on this page/);
  assert.equal(d.app.doScriptCalls.length + hiddenOnly.app.doScriptCalls.length + blank.app.doScriptCalls.length, 0);
});

test("dialog: overflow, skipped items and failures are spelled out", () => {
  const fake = overflowDeck();
  const { alerts } = interactive(FILE_ENGINE, fake.app, (dialog) => choose(dialog, { scope: 2, seed: "12" }));
  assert.match(alerts[0], /now overflows here: (page 2|parent page B-Parent|table on page 1)(, (page 2|parent page B-Parent|table on page 1)){2}\./);
  assert.match(alerts[0], /1 frame or cell was already overflowing/);

  const d = deck();
  d.footerStory.flow.assertEditable = () => {
    throw new Error("Story is checked out to InCopy.");
  };
  const failed = interactive(FILE_ENGINE, d.app, (dialog) => choose(dialog, { scope: 2, check: { "Include locked items": false } })).alerts[0];
  assert.match(failed, /Left 2 locked items alone/);
  assert.match(failed, /Left 1 hidden item alone/);
  assert.match(failed, /1 problem stopped some text from changing: Story is checked out to InCopy\./);
});
