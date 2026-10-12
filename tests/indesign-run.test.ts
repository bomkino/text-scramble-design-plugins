import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeAddress } from "../plugins/indesign/src/cleanup";
import { keepPlan, parseWordList } from "../plugins/indesign/src/keep-readable";
import { inspectScope, paragraphStyleNames, revealItem, runScramble, type RunOptions } from "../plugins/indesign/src/run";
import { estimateVisualWidth } from "../packages/core/src/scramble-text";
import { Collection, createInDesign, hostFor, Text, VariableTypes, type Document, type Story } from "./fakes/indesign";

const LETTERS = /\p{L}/gu;
const DIGITS = /\p{N}/gu;

function shape(text: string): string {
  return text.replace(LETTERS, "L").replace(DIGITS, "N");
}

function words(text: string): string[] {
  return text.match(/\p{L}+/gu) ?? [];
}

function run(app: ReturnType<typeof createInDesign>["app"], options: RunOptions) {
  return runScramble(hostFor(app), options);
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

  fake.app.activeWindow.activePage = page1;
  return {
    ...fake,
    page1,
    page2,
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
    pathStory,
    group,
    groupedStory,
    grouped,
    unlistedStory,
    headline,
    body,
  };
}

function allText(doc: Document): string {
  return doc.storyList.map((story) => flowText(story)).join("\n");
}

function flowText(story: Story): string {
  return story.contents;
}

test("selection: changes only the selected frame, in place, as one undo step", () => {
  const { app, document, article, frame1, frame2, footerStory, world } = deck();
  const before = article.contents;
  const frame2Before = frame2.texts.item(0)!.contents;
  const footerBefore = footerStory.contents;
  const formatting = document.formattingSnapshot();
  app.selection = [frame1];

  const report = run(app, { scope: "selection", seed: 7 });

  const frame1After = frame1.texts.item(0)!.contents;
  assert.equal(report.empty, null);
  assert.ok(report.kinds.frame >= 1);
  assert.notEqual(frame1After, before.slice(0, frame1After.length));
  assert.equal(shape(article.contents), shape(before));
  assert.equal(frame2.texts.item(0)!.contents, frame2Before, "the next frame in the thread is not selected");
  assert.equal(footerStory.contents, footerBefore);
  assert.deepEqual(document.formattingSnapshot(), formatting);
  assert.equal(app.doScriptCalls.length, 1);
  assert.deepEqual(app.doScriptCalls[0], { language: "UXPSCRIPT", undoMode: "ENTIRE_SCRIPT", name: "Text Scramble" });
  assert.ok(world.writes > 0);
  assert.ok(world.writes <= Array.from(before).length, "only changed characters are written");
});

test("selection: a text range changes only that range", () => {
  const { app, document } = createInDesign();
  const page = document.spread(["1"]).pages[0];
  const story = document.story("Keep this. Scramble these words. Keep that.");
  document.frame(page, story);
  const start = "Keep this. ".length;
  const end = start + "Scramble these words.".length;
  app.selection = [new Text(story.flow, start, end)];

  const report = run(app, { scope: "selection", seed: 1 });

  assert.equal(report.changed, 1);
  assert.equal(report.kinds.selection, 1);
  assert.ok(story.contents.startsWith("Keep this. "));
  assert.ok(story.contents.endsWith(" Keep that."));
  assert.notEqual(story.contents.slice(start, end), "Scramble these words.");
});

test("selection: table cells, groups and text on paths", () => {
  const { app, table, group, groupedStory, page1, pathStory, document } = deck();
  const circle = document.shape(page1);
  const extraPath = document.story("Second circle text");
  document.textPath(circle, extraPath);
  const cellsBefore = table.rows.map((cell) => cell.contents);
  const groupedBefore = groupedStory.contents;
  const pathBefore = pathStory.contents;

  app.selection = [table.rows[0], group, circle];
  const report = run(app, { scope: "selection", seed: 2 });

  assert.notEqual(table.rows[0].contents, cellsBefore[0]);
  assert.equal(table.rows[2].contents, cellsBefore[2], "unselected cells stay");
  assert.notEqual(groupedStory.contents, groupedBefore);
  assert.notEqual(extraPath.contents, "Second circle text");
  assert.equal(pathStory.contents, pathBefore, "the other circle was not selected");
  assert.equal(report.kinds.path, 1);
});

test("selection: an empty selection explains itself and changes nothing", () => {
  const { app, document, world } = deck();
  const before = allText(document);
  const report = run(app, { scope: "selection" });
  assert.equal(report.empty, "empty-selection");
  assert.equal(app.doScriptCalls.length, 0);
  assert.equal(world.writes, 0);
  assert.equal(allText(document), before);
});

test("selection: the same text selected twice is scrambled once", () => {
  const { app, frame1 } = deck();
  app.selection = [frame1, frame1];
  const report = run(app, { scope: "selection", seed: 3 });
  assert.equal(report.kinds.frame, 1);
});

test("page: every frame on the active page, plus overset text, and nothing else", () => {
  const { app, article, frame1, frame2, page2, slugStory, groupedStory, footerStory } = deck();
  app.activeWindow.activePage = page2;
  const frame1Before = frame1.texts.item(0)!.contents;
  const frame2Before = frame2.texts.item(0)!.contents;
  const storyBefore = article.contents;
  assert.ok(frame2.overflows, "fixture: the article oversets");
  const oversetStart = frame2.texts.item(0)!.index + frame2.texts.item(0)!.length;

  const report = run(app, { scope: "page", seed: 4 });

  assert.equal(frame1.texts.item(0)!.contents, frame1Before, "frame on page 1 untouched");
  assert.notEqual(frame2.texts.item(0)!.contents, frame2Before);
  assert.notEqual(article.contents.slice(oversetStart), storyBefore.slice(oversetStart), "overset text changed");
  assert.equal(report.kinds.overset, 1);
  assert.notEqual(slugStory.contents, "Brindlewick slug line", "locked layer is included by default");
  assert.notEqual(groupedStory.contents, "Brindlewick grouped caption", "grouped frames are included");
  assert.equal(footerStory.contents, "Brindlewick confidential footer", "parent pages are not part of a page run");
});

test("document: reaches every story, table, footnote, path and parent page", () => {
  const f = deck();
  const report = run(f.app, { scope: "document", seed: 5 });

  for (const story of [f.article, f.footerStory, f.pasteboardStory, f.slugStory, f.lockedFrameStory, f.pathStory, f.groupedStory, f.unlistedStory, f.anchoredStory]) {
    assert.ok(!story.contents.includes("Brindlewick"), `still readable: ${story.contents}`);
  }
  for (const cell of [...f.table.rows, ...f.nested.rows]) assert.ok(!cell.contents.includes("Brindlewick"), cell.contents);
  assert.ok(!f.footnote.flow.text(0, 99).includes("Brindlewick"));
  assert.equal(f.hiddenStory.contents, "Hidden Brindlewick alternate", "hidden items are skipped by default");
  assert.equal(report.skipped.hidden, 1);
  assert.equal(report.skipped.locked, 0);
  assert.ok(report.parentPages >= 1);
  assert.ok(report.kinds.cell >= 4);
  assert.equal(report.kinds.footnote, 1);
  assert.equal(report.kinds.path, 1);
  assert.equal(report.errors.length, 0);
  assert.equal(f.app.doScriptCalls.length, 1);
});

test("document: each story is scrambled and counted once, however InDesign names it", () => {
  const { app, document } = createInDesign();
  const [page1, page2] = document.spread(["1", "2"]).pages;
  const article = document.story("Brindlewick grew in every region and kept going past the frame.");
  const first = document.frame(page1, article, { capacity: 20 });
  document.frame(page2, article);
  document.frame(page1, document.story("Quellmoor Orchard opened three rooms."));
  // document.stories names each story by index, its frames' parentStory by id: still two stories.
  assert.notEqual(document.stories.item(0)!.toSpecifier(), first.parentStory.toSpecifier());
  assert.equal(inspectScope(hostFor(app), { scope: "document" }).targets, 2);
  const report = run(app, { scope: "document", seed: 22 });
  assert.equal(report.changed, 2);
  assert.equal(report.kinds.story, 2);
  assert.equal(report.characters, Array.from(article.contents).length + "Quellmoor Orchard opened three rooms.".length);
});

test("document: locked layers and frames are unlocked for the edit and locked again", () => {
  const f = deck();
  run(f.app, { scope: "document", seed: 6 });
  assert.equal(f.lockedLayer.locked, true);
  assert.equal(f.lockedFrame.locked, true);
  assert.notEqual(f.slugStory.contents, "Brindlewick slug line");
  assert.notEqual(f.lockedFrameStory.contents, "Brindlewick locked frame");
});

test("document: locked items can be left alone, and are counted", () => {
  const f = deck();
  const lockedGroup = f.document.group(f.page2);
  lockedGroup.setLockedForTest(true);
  const inLockedGroup = f.document.story("Brindlewick in a locked group");
  f.document.frame(lockedGroup, inLockedGroup);

  const report = run(f.app, { scope: "document", includeLocked: false, seed: 6 });

  assert.equal(f.slugStory.contents, "Brindlewick slug line");
  assert.equal(f.lockedFrameStory.contents, "Brindlewick locked frame");
  assert.equal(inLockedGroup.contents, "Brindlewick in a locked group");
  assert.equal(report.skipped.locked, 3);
  assert.equal(f.lockedLayer.locked, true);
});

test("document: hidden items can be included", () => {
  const f = deck();
  const report = run(f.app, { scope: "document", includeHidden: true, seed: 8 });
  assert.notEqual(f.hiddenStory.contents, "Hidden Brindlewick alternate");
  assert.equal(report.skipped.hidden, 0);
});

test("one word cache per run: a name becomes the same invented word everywhere", () => {
  const f = deck();
  f.document.bookmark("Brindlewick");
  run(f.app, { scope: "document", seed: 9 });
  const invented = words(f.footerStory.contents)[0];
  assert.notEqual(invented, "Brindlewick");
  for (const text of [f.article.contents, f.table.rows[0].contents, f.nested.rows[0].contents, f.footnote.flow.text(0, 99), f.pathStory.contents, f.document.bookmarkList[0].name]) {
    assert.equal(words(text).filter((word) => word === invented).length > 0, true, `${invented} missing from ${text}`);
  }
});

test("seed: the same seed gives the same document, a different seed does not", () => {
  const a = deck();
  const b = deck();
  const c = deck();
  run(a.app, { scope: "document", seed: "pitch" });
  run(b.app, { scope: "document", seed: "pitch" });
  run(c.app, { scope: "document", seed: "dog" });
  assert.equal(allText(a.document), allText(b.document));
  assert.notEqual(allText(a.document), allText(c.document));
});

test("keep readable: kept paragraph styles stay, listed words still change", () => {
  const f = deck();
  const report = run(f.app, { scope: "document", keepStyles: ["Headline"], alwaysScramble: ["brindlewick"], seed: 10 });
  const headline = f.article.contents.split("\r")[0];
  assert.match(headline, /^\p{L}+ Annual Review$/u);
  assert.ok(!headline.startsWith("Brindlewick"));
  assert.equal(words(headline)[0], words(f.footerStory.contents)[0], "same invented word as elsewhere");
  assert.ok(!f.article.contents.includes("grew in every region"));
  assert.equal(report.keptParagraphs, 1);
});

test("keep readable: bookmarks and anchors follow the rule, variables scramble in full", () => {
  const f = deck();
  const bookmark = f.document.bookmark("Brindlewick Annual Review");
  const anchor = f.document.anchor("Brindlewick Annual Review");
  const client = f.document.variable("Client", "Brindlewick Traders");
  run(f.app, { scope: "document", keepStyles: ["Headline"], alwaysScramble: ["Brindlewick"], seed: 10 });
  const headline = f.article.contents.split("\r")[0];
  assert.equal(bookmark.name, headline);
  assert.equal(anchor.name, headline);
  assert.ok(!client.variableOptions.contents.includes("Traders"));
});

test("keep readable: a frame that starts mid-paragraph lines up with its paragraphs", () => {
  const { app, document } = createInDesign();
  const [page1, page2] = document.spread(["1", "2"]).pages;
  const keep = document.paragraphStyle("Keep");
  const story = document.story(["Opening paragraph scrambles.\r", keep, "This kept paragraph runs across two frames and stays readable.\r", document.basicParagraph, "Closing words scramble."]);
  document.frame(page1, story, { capacity: 45 });
  const second = document.frame(page2, story);
  app.activeWindow.activePage = page2;
  const secondStart = second.texts.item(0)!.index;
  assert.ok(secondStart > "Opening paragraph scrambles.\r".length, "fixture: frame 2 starts inside the kept paragraph");
  assert.notEqual(story.contents[secondStart - 1], "\r", "fixture: frame 2 starts mid-paragraph");

  run(app, { scope: "page", keepStyles: ["Keep"], seed: 11 });

  assert.ok(story.contents.includes("stays readable.\r"));
  assert.ok(!story.contents.includes("Closing words scramble."));
  assert.ok(story.contents.startsWith("Opening paragraph scrambles."), "page 1 was not in scope");
});

test("keep readable: everything kept is reported as such", () => {
  const { app, document } = createInDesign();
  const page = document.spread(["1"]).pages[0];
  const headline = document.paragraphStyle("Headline");
  document.frame(page, document.story([headline, "Only a headline"]));
  app.activeWindow.activePage = page;
  const report = run(app, { scope: "page", keepStyles: ["Headline"] });
  assert.equal(report.empty, "all-kept");
  assert.equal(app.doScriptCalls.length, 0);
});

test("keep readable: a bookmark that stays the same is not counted as changed", () => {
  const { app, document } = createInDesign();
  const page = document.spread(["1"]).pages[0];
  const headline = document.paragraphStyle("Headline");
  document.frame(page, document.story([headline, "Brindlewick Annual Review"]));
  const bookmark = document.bookmark("Brindlewick Annual Review");
  const report = run(app, { scope: "document", keepStyles: ["Headline"] });
  assert.equal(bookmark.name, "Brindlewick Annual Review");
  assert.equal(report.names, 0);
  assert.equal(report.empty, "all-kept");
  assert.equal(app.doScriptCalls.length, 0);
});

test("keepPlan lines up by search when indices disagree, and refuses to guess otherwise", () => {
  const { document } = createInDesign();
  const keep = document.paragraphStyle("Keep");
  const story = document.story(["First paragraph.\r", keep, "Kept paragraph.\r"]);
  const text = new Text(story.flow, 6, story.length);
  const shifted = Object.create(text, { index: { value: 0 } });
  const plan = keepPlan(shifted, 0, text.contents, { keepStyles: ["Keep"] });
  assert.deepEqual(plan, {
    segments: [
      { start: 0, end: "paragraph.\r".length, keep: false },
      { start: "paragraph.\r".length, end: text.length, keep: true },
    ],
    keptParagraphs: 1,
  });
  const wrong = Object.create(text, { contents: { value: "Something else entirely" } });
  assert.equal(keepPlan(wrong, 0, "Something else entirely", { keepStyles: ["Keep"] }), null);
});

test("overflow report: names the pages of frames and cells that now overflow", () => {
  const { app, document } = createInDesign();
  const spread = document.spread(["1", "2"]);
  const parent = document.masterSpread("B-Parent");
  // Wide letters replaced by average ones overflow a frame cut to the exact width.
  const tight = "lil fil tilt lit";
  const exact = Array.from(tight).reduce((total, character) => total + estimateVisualWidth(character), 0) + 0.001;
  const story = document.story(tight);
  document.frame(spread.pages[1], story, { capacity: exact });
  const already = document.story("This one already oversets badly");
  document.frame(spread.pages[0], already, { capacity: 2 });
  const parentStory = document.story(tight);
  document.frame(parent.pages[0], parentStory, { capacity: exact });
  const table = document.table([tight]);
  table.rows[0].capacity = exact;
  document.frame(spread.pages[0], document.story(["Table: ", table]));
  // A nested table's cell is named after the page its outer table sits on.
  const nested = document.table([tight]);
  nested.rows[0].capacity = exact;
  document.frame(spread.pages[1], document.story(["Outer: ", document.table([["Inner: ", nested]])]));

  const report = run(app, { scope: "document", seed: 12 });

  const labels = report.overflow.overflowing.map((item) => item.label).sort();
  assert.deepEqual(labels, ["page 2", "parent page B-Parent", "table on page 1", "table on page 2"]);
  assert.equal(report.overflow.alreadyOverflowing, 1);
  assert.equal(document.world.recomposed > 0, true);
});

test("cleanup: links point at example.com, names go neutral, document info clears", () => {
  const f = deck();
  f.document.link("https://brindlewick.invalid/annual", "https://brindlewick.invalid/annual");
  f.document.link("mailto:press@brindlewick.invalid", "mailto:press@brindlewick.invalid");
  f.document.pageLink("Brindlewick page 3");

  const report = run(f.app, { scope: "document", cleanup: true, seed: 13 });

  assert.deepEqual(
    f.document.urlDestinations.map((destination) => destination.destinationURL),
    ["https://example.com/link-1", "mailto:hello@example.com"],
  );
  assert.deepEqual(f.document.urlDestinations.map((destination) => destination.name), ["Link 1", "Link 2"]);
  assert.deepEqual(f.document.hyperlinkList.map((link) => link.name), ["Hyperlink 1", "Hyperlink 2"]);
  assert.equal(f.document.pageDestinations[0].name, "Page link 1");
  for (const key of ["author", "description", "copyrightNotice", "copyrightInfoURL", "jobName"]) {
    assert.equal(f.document.metadataPreferences[key], "", key);
  }
  assert.equal(f.document.metadataPreferences.documentTitle, "Untitled", "InDesign ignores an empty title, so it gets a neutral one");
  assert.deepEqual(f.document.metadataPreferences.keywords, []);
  assert.deepEqual(report.cleanup, { links: 2, renamed: 5, documentInfo: true });
  const everyAddress = f.document.urlDestinations.map((destination) => destination.destinationURL).join(" ");
  assert.ok(!/brindlewick/i.test(everyAddress));
});

test("cleanup: a title InDesign refuses to empty gets a neutral one", () => {
  const f = deck();
  let title = "Brindlewick deck";
  Object.defineProperty(f.document.metadataPreferences, "documentTitle", {
    get: () => title,
    set: (value: string) => {
      if (value === "") throw new Error("Invalid value for documentTitle.");
      title = value;
    },
  });
  const report = run(f.app, { scope: "document", cleanup: true, seed: 14 });
  assert.equal(title, "Untitled");
  assert.equal(f.document.metadataPreferences.author, "");
  assert.equal(report.cleanup?.documentInfo, true);
  assert.deepEqual(report.errors, []);
});

test("cleanup is off by default and works on its own", () => {
  const f = deck();
  const link = f.document.link("https://brindlewick.invalid/", "https://brindlewick.invalid/");
  run(f.app, { scope: "document", seed: 14 });
  assert.equal(link.destinationURL, "https://brindlewick.invalid/");
  assert.equal(f.document.metadataPreferences.author, "Sample Author");

  const { app, document } = createInDesign();
  const lone = document.link("https://brindlewick.invalid/", "https://brindlewick.invalid/");
  app.selection = [];
  const report = run(app, { scope: "selection", cleanup: true });
  assert.equal(lone.destinationURL, "https://example.com/link-1");
  assert.equal(report.empty, null);
});

test("document names: bookmarks, anchors and custom variables follow the scramble", () => {
  const f = deck();
  const chapter = f.document.bookmark("Brindlewick results");
  const child = f.document.bookmark("Regional detail", chapter);
  const web = f.document.bookmark("www.brindlewick.invalid");
  const anchor = f.document.anchor("Brindlewick results anchor");
  const client = f.document.variable("Client", "Brindlewick Traders");
  const fileName = f.document.variable("File", "brindlewick-deck.indd", VariableTypes.FILE_NAME_TYPE);

  const report = run(f.app, { scope: "document", seed: 15 });

  assert.notEqual(chapter.name, "Brindlewick results");
  assert.notEqual(child.name, "Regional detail");
  assert.equal(web.name, "www.brindlewick.invalid", "address-like names are never scrambled into new addresses");
  assert.notEqual(anchor.name, "Brindlewick results anchor");
  assert.notEqual(client.variableOptions.contents, "Brindlewick Traders");
  assert.equal(fileName.variableOptions.contents, "brindlewick-deck.indd");
  assert.equal(report.names, 4);

  const page = deck();
  const pageBookmark = page.document.bookmark("Brindlewick results");
  run(page.app, { scope: "page", seed: 15 });
  assert.equal(pageBookmark.name, "Brindlewick results", "names only change in a Whole document run");
});

test("text that does not line up character for character is left alone", () => {
  const { app, document, world } = createInDesign();
  const page = document.spread(["1"]).pages[0];
  const story = document.story("Brindlewick special characters");
  document.frame(page, story);
  Object.defineProperty(story, "contents", { get: () => "Brindlewick special characters plus" });
  const report = run(app, { scope: "document" });
  assert.equal(report.skipped.unreadable, 1);
  assert.equal(world.writes, 0);
  assert.ok(report.notes.some((note) => note.includes("lined up")));
});

test("overset text that cannot be lined up is skipped, not guessed", () => {
  const { app, document } = createInDesign();
  const page = document.spread(["1"]).pages[0];
  const story = document.story("Brindlewick text that is far too long for its little frame.");
  const frame = document.frame(page, story, { capacity: 10 });
  const real = frame.texts.item(0)!;
  Object.defineProperty(frame, "texts", { get: () => new Collection(() => [Object.create(real, { index: { value: real.index + 1 } })]) });
  app.activeWindow.activePage = page;
  const report = run(app, { scope: "page", seed: 16 });
  assert.equal(report.kinds.overset, 0);
  assert.equal(report.skipped.unreadable, 1);
});

test("a failed edit is reported, the rest still runs, and locks come back", () => {
  const f = deck();
  f.footerStory.flow.assertEditable = () => {
    throw new Error("Story is checked out to InCopy.");
  };
  const report = run(f.app, { scope: "document", seed: 17 });
  assert.deepEqual(report.errors, ["Story is checked out to InCopy."]);
  assert.equal(f.footerStory.contents, "Brindlewick confidential footer");
  assert.ok(!f.pathStory.contents.includes("Brindlewick"));
  assert.equal(f.lockedLayer.locked, true);
});

test("inspect counts without changing anything", () => {
  const f = deck();
  const before = allText(f.document);
  const summary = inspectScope(hostFor(f.app), { scope: "document" });
  assert.equal(f.app.doScriptCalls.length, 0);
  assert.equal(f.world.writes, 0);
  assert.equal(allText(f.document), before);
  assert.ok(summary.targets > 10);
  assert.ok(summary.characters > 200);
  assert.equal(summary.skipped.hidden, 1);
  assert.equal(summary.empty, null);
});

test("no document open", () => {
  const { app } = createInDesign();
  app.documentList.length = 0;
  assert.equal(run(app, { scope: "document" }).empty, "no-document");
  assert.equal(inspectScope(hostFor(app), { scope: "page" }).empty, "no-document");
  assert.deepEqual(paragraphStyleNames(hostFor(app)), []);
});

test("only hidden text in scope", () => {
  const { app, document } = createInDesign();
  const page = document.spread(["1"]).pages[0];
  document.frame(page, document.story("Brindlewick")).visible = false;
  app.activeWindow.activePage = page;
  assert.equal(run(app, { scope: "page" }).empty, "all-skipped");
});

test("paragraph style names are unique and reveal selects without editing", () => {
  const f = deck();
  f.document.paragraphStyle("Headline");
  assert.deepEqual(paragraphStyleNames(hostFor(f.app)), ["[Basic Paragraph]", "Headline", "Body"]);
  assert.equal(revealItem(hostFor(f.app), f.frame2), true);
  assert.deepEqual(f.app.selection, [f.frame2]);
  assert.equal(f.app.activeWindow.activePage, f.page2);
  assert.equal(revealItem(hostFor(f.app), f.table.rows[0]), true);
  assert.deepEqual(f.app.selection, [f.table.rows[0]]);
});

test("word lists and address detection", () => {
  assert.deepEqual(parseWordList(" Brindlewick, Amélie  Hart\nZoë;Brindlewick,, "), ["Brindlewick", "Amélie Hart", "Zoë"]);
  for (const address of ["hello@brindlewick.invalid", "https://brindlewick.invalid", "www.brindlewick", "brindlewick.com"]) {
    assert.equal(looksLikeAddress(address), true, address);
  }
  for (const name of ["Annual Review", "Chapter 1. Overview", "Q3 results"]) assert.equal(looksLikeAddress(name), false, name);
});
