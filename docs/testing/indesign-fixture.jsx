#target "InDesign"

/*
  Text Scramble · InDesign scratch fixture (invented text only).

  Run directly: creates a NEW, unsaved document that has text in every place InDesign keeps it,
  and leaves it open for the panel checks. Never touches any other document.

  Used as a library by indesign-harness.jsx: when $.global.TextScrambleFixtureLibrary is true,
  it only defines $.global.buildTextScrambleFixture() and returns.
*/
(function () {
  function repeat(text, times) {
    var result = "";
    var index;
    for (index = 0; index < times; index += 1) result += text;
    return result;
  }

  function frame(container, bounds, contents, properties) {
    var item = container.textFrames.add(properties || {});
    item.geometricBounds = bounds;
    if (contents !== undefined) item.contents = contents;
    return item;
  }

  // Builds the fixture in a new document and returns references to every part, plus the original
  // text of each part so a test can tell what changed.
  function buildTextScrambleFixture() {
    var doc = app.documents.add(true);
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.documentPreferences.facingPages = false;
    doc.documentPreferences.pagesPerDocument = 2;
    doc.documentPreferences.pageWidth = 210;
    doc.documentPreferences.pageHeight = 297;

    var page1 = doc.pages.item(0);
    var page2 = doc.pages.item(1);
    var headline = doc.paragraphStyles.add({ name: "TS Headline" });
    var body = doc.paragraphStyles.add({ name: "TS Body" });

    // 1. A threaded article: page 1 -> page 2, then overset text. It holds a table with a nested
    //    table, a footnote and an anchored frame.
    var article1 = frame(page1, [20, 20, 70, 110]);
    var article2 = frame(page2, [20, 20, 45, 110]);
    article1.nextTextFrame = article2;
    var story = article1.parentStory;
    story.contents = "Brindlewick Annual Review\rBrindlewick grew in every region, and Quellmoor Orchard opened 3 rooms. ";
    story.paragraphs.item(0).appliedParagraphStyle = headline;
    story.paragraphs.item(1).appliedParagraphStyle = body;
    story.characters.item(2).underline = true;

    var table = story.insertionPoints.item(-1).tables.add({ bodyRowCount: 2, columnCount: 2 });
    table.cells.item(0).contents = "Brindlewick ledger";
    table.cells.item(1).contents = "Spring 2026";
    table.cells.item(2).contents = "Quellmoor totals";
    var nested = table.cells.item(3).insertionPoints.item(0).tables.add({ bodyRowCount: 1, columnCount: 1 });
    nested.cells.item(0).contents = "Brindlewick inner cell";

    story.insertionPoints.item(-1).contents = " See the note";
    var footnote = story.insertionPoints.item(-1).footnotes.add();
    footnote.insertionPoints.item(-1).contents = "Brindlewick footnote text.";
    story.insertionPoints.item(-1).contents = ". ";
    var anchored = story.insertionPoints.item(-1).textFrames.add();
    anchored.geometricBounds = [0, 0, 8, 50];
    anchored.contents = "Brindlewick anchored caption";
    story.insertionPoints.item(-1).contents = "\r" + repeat("The overset tail mentions Brindlewick once more. ", 40);

    // 2. Text on a parent (master) page.
    var parentSpread = doc.masterSpreads.item(0);
    var footer = frame(parentSpread.pages.item(0), [280, 20, 290, 150], "Brindlewick confidential footer");

    // 3. Text on the pasteboard, beside page 1.
    var pasteboard = frame(doc.spreads.item(0), [20, -120, 40, -20], "Brindlewick pasteboard note");

    // 4. A hidden frame.
    var hidden = frame(page1, [80, 20, 90, 110], "Hidden Brindlewick alternate");
    hidden.visible = false;

    // 5. A frame on a locked layer, and a locked frame.
    var lockedLayer = doc.layers.add({ name: "TS Locked furniture" });
    var slug = frame(page2, [60, 20, 70, 110], "Brindlewick slug line", { itemLayer: lockedLayer });
    var lockedFrame = frame(page1, [100, 20, 110, 110], "Brindlewick locked frame");
    lockedFrame.locked = true;

    // 6. Text on a path.
    var oval = page1.ovals.add();
    oval.geometricBounds = [120, 20, 170, 70];
    var path = oval.textPaths.add();
    path.parentStory.contents = "Brindlewick around a circle";

    // 7. A group with a text frame and a rectangle.
    var grouped = frame(page2, [80, 20, 90, 110], "Brindlewick grouped caption");
    var box = page2.rectangles.add();
    box.geometricBounds = [80, 120, 90, 150];
    var group = page2.groups.add([grouped, box]);

    // 8. A frame cut to fit narrow letters exactly: invented words are wider, so it should overflow.
    var tight = frame(page2, [100, 20, 110, 60], "lil fil tilt lit");
    tight.fit(FitOptions.FRAME_TO_CONTENT);

    // 9. Special characters: an emoji and an automatic page number marker.
    var special = frame(page1, [180, 20, 190, 150], "Brindlewick 🎉 page ");
    special.insertionPoints.item(-1).contents = SpecialCharacters.AUTO_PAGE_NUMBER;

    // 10. A custom text variable placed in a frame, a file-name variable, a bookmark, a text anchor and links.
    var client = doc.textVariables.add({ name: "TS Client", variableType: VariableTypes.CUSTOM_TEXT_TYPE });
    client.variableOptions.contents = "Brindlewick Studio";
    var variableFrame = frame(page1, [200, 20, 210, 150], "Client: ");
    variableFrame.insertionPoints.item(-1).textVariableInstances.add({ associatedTextVariable: client });

    var anchor = doc.hyperlinkTextDestinations.add(story.paragraphs.item(0), { name: "Brindlewick results anchor" });
    var bookmark = doc.bookmarks.add(anchor, { name: "Brindlewick results" });
    var web = doc.hyperlinkURLDestinations.add("https://brindlewick.invalid/annual", { name: "https://brindlewick.invalid/annual" });
    var mail = doc.hyperlinkURLDestinations.add("mailto:press@brindlewick.invalid", { name: "mailto:press@brindlewick.invalid" });
    var webSource = doc.hyperlinkTextSources.add(story.paragraphs.item(1).words.item(0));
    doc.hyperlinks.add(webSource, web, { name: "Brindlewick site" });
    var mailSource = doc.hyperlinkTextSources.add(pasteboard.parentStory.words.item(0));
    doc.hyperlinks.add(mailSource, mail, { name: "Brindlewick press" });

    doc.metadataPreferences.documentTitle = "Brindlewick deck";
    doc.metadataPreferences.author = "Sample Author";

    // Lock the layer last, so everything could be placed on it first.
    lockedLayer.locked = true;
    app.activeWindow.activePage = page1;

    return {
      doc: doc,
      page1: page1,
      page2: page2,
      story: story,
      article1: article1,
      article2: article2,
      table: table,
      nested: nested,
      footnote: footnote,
      anchored: anchored,
      footer: footer,
      pasteboard: pasteboard,
      hidden: hidden,
      lockedLayer: lockedLayer,
      slug: slug,
      lockedFrame: lockedFrame,
      path: path,
      group: group,
      grouped: grouped,
      tight: tight,
      special: special,
      client: client,
      anchor: anchor,
      bookmark: bookmark,
      web: web,
      mail: mail
    };
  }

  $.global.buildTextScrambleFixture = buildTextScrambleFixture;
  if ($.global.TextScrambleFixtureLibrary === true) return;
  buildTextScrambleFixture();
}());
