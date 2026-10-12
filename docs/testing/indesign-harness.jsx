#target "InDesign"

/*
  Text Scramble · automatic InDesign checks for the classic script (invented text only).

  For each case it builds a NEW scratch document (indesign-fixture.jsx), runs the built
  "Text Scramble.jsx" through its headless test entry ($.global.TextScrambleTest), checks the
  result, and closes the scratch document WITHOUT saving, even when a check fails. It never
  touches any other open document. Results go to indesign-jsx-results.json beside this file.

  Optional settings, before running:
    $.global.TextScrambleHarness = { script: "/path/to/Text Scramble.jsx", output: "/path/results.json" };
*/
(function () {
  var here = File($.fileName).parent;
  var settings = $.global.TextScrambleHarness || {};
  var scriptFile = File(settings.script || here.fsName + "/../text-scramble-design-plugins/plugins/indesign/dist/Text Scramble.jsx");
  var outputFile = File(settings.output || here.fsName + "/indesign-jsx-results.json");
  var results = [];
  var reports = {};

  function json(value) {
    var index;
    var parts;
    var key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "string") {
      return "\"" + value.replace(/[\\"]/g, "\\$&").replace(/[\u0000-\u001f]/g, function (character) {
        return "\\u" + ("000" + character.charCodeAt(0).toString(16)).slice(-4);
      }) + "\"";
    }
    if (value instanceof Array) {
      parts = [];
      for (index = 0; index < value.length; index += 1) parts.push(json(value[index]));
      return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] !== "function") parts.push(json(key) + ":" + json(value[key]));
    }
    return "{" + parts.join(",") + "}";
  }

  function check(caseName, name, ok, detail) {
    results.push({ test: caseName, check: name, pass: !!ok, detail: detail === undefined ? "" : String(detail) });
  }

  function text(item) {
    try {
      return String(item.contents);
    } catch (error) {
      return "(unreadable: " + error + ")";
    }
  }

  function snapshot(f) {
    return {
      story: text(f.story),
      frame1: text(f.article1.texts.item(0)),
      frame2: text(f.article2.texts.item(0)),
      cell0: text(f.table.cells.item(0)),
      nested: text(f.nested.cells.item(0)),
      footnote: text(f.footnote.texts.item(0)),
      anchored: text(f.anchored.parentStory),
      footer: text(f.footer.parentStory),
      pasteboard: text(f.pasteboard.parentStory),
      hidden: text(f.hidden.parentStory),
      slug: text(f.slug.parentStory),
      lockedFrame: text(f.lockedFrame.parentStory),
      path: text(f.path.parentStory),
      grouped: text(f.grouped.parentStory),
      special: text(f.special.parentStory),
      client: String(f.client.variableOptions.contents),
      bookmark: String(f.bookmark.name),
      anchor: String(f.anchor.name),
      web: String(f.web.destinationURL),
      mail: String(f.mail.destinationURL),
      author: String(f.doc.metadataPreferences.author),
      title: String(f.doc.metadataPreferences.documentTitle)
    };
  }

  function runScript(options) {
    $.global.TextScrambleResult = undefined;
    $.global.TextScrambleTest = options;
    try {
      $.evalFile(scriptFile);
    } finally {
      $.global.TextScrambleTest = undefined;
    }
    return $.global.TextScrambleResult;
  }

  // Builds a fresh fixture, runs `body`, and always closes the scratch document without saving.
  function withFixture(caseName, body) {
    var fixture = null;
    try {
      fixture = $.global.buildTextScrambleFixture();
      if (app.activeDocument !== fixture.doc && app.activeDocument.id !== fixture.doc.id) throw new Error("The scratch document is not the active document.");
      body(fixture);
    } catch (error) {
      check(caseName, "ran without an exception", false, error + (error.line ? " (line " + error.line + ")" : ""));
    } finally {
      if (fixture && fixture.doc && fixture.doc.isValid) fixture.doc.close(SaveOptions.NO);
    }
  }

  var interaction = app.scriptPreferences.userInteractionLevel;
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
  try {
    if (!scriptFile.exists) throw new Error("Built script not found: " + scriptFile.fsName);
    $.global.TextScrambleFixtureLibrary = true;
    $.evalFile(File(here.fsName + "/indesign-fixture.jsx"));
    $.global.TextScrambleFixtureLibrary = undefined;

    withFixture("1 whole document, defaults", function (f) {
      var before = snapshot(f);
      var report = runScript({ scope: "document", scrambleNumbers: true, seed: 1 });
      var after = snapshot(f);
      reports.wholeDocument = report;
      var name;
      var changed = ["story", "cell0", "nested", "footnote", "anchored", "footer", "pasteboard", "slug", "lockedFrame", "path", "grouped", "client", "bookmark", "anchor"];
      for (name = 0; name < changed.length; name += 1) {
        check("1 whole document, defaults", changed[name] + " changed", after[changed[name]] !== before[changed[name]], after[changed[name]]);
        check("1 whole document, defaults", changed[name] + " has no Brindlewick", after[changed[name]].indexOf("Brindlewick") === -1, after[changed[name]]);
      }
      check("1 whole document, defaults", "hidden frame untouched", after.hidden === before.hidden, after.hidden);
      check("1 whole document, defaults", "report counts the hidden frame", report && report.skipped && report.skipped.hidden >= 1, report && json(report.skipped));
      check("1 whole document, defaults", "locked layer locked again", f.lockedLayer.locked === true);
      check("1 whole document, defaults", "locked frame locked again", f.lockedFrame.locked === true);
      check("1 whole document, defaults", "links untouched without cleanup", after.web === before.web && after.mail === before.mail);
      check("1 whole document, defaults", "document info untouched without cleanup", after.author === before.author);
      check("1 whole document, defaults", "same length as before", after.story.length === before.story.length, before.story.length + " -> " + after.story.length);
      check("1 whole document, defaults", "headline style kept", f.story.paragraphs.item(0).appliedParagraphStyle.name === "TS Headline");
      check("1 whole document, defaults", "underline kept on character 3", f.story.characters.item(2).underline === true);
      check("1 whole document, defaults", "no errors", report && report.errors && report.errors.length === 0, report && json(report.errors));
      check("1 whole document, defaults", "overflow report lists the tight frame", report && report.overflow && json(report.overflow).indexOf("page 2") !== -1, report && json(report.overflow));
      check("1 whole document, defaults", "special characters: scrambled or reported as unreadable", after.special !== before.special || (report && report.skipped && report.skipped.unreadable > 0), before.special + " -> " + after.special);

      f.doc.undo();
      var undone = snapshot(f);
      check("1 whole document, defaults", "one Undo restores the story", undone.story === before.story);
      check("1 whole document, defaults", "one Undo restores the parent page", undone.footer === before.footer);
      check("1 whole document, defaults", "one Undo restores the bookmark", undone.bookmark === before.bookmark);
      check("1 whole document, defaults", "one Undo restores the variable", undone.client === before.client);
    });

    withFixture("2 page scope", function (f) {
      app.activeWindow.activePage = f.page2;
      var before = snapshot(f);
      var report = runScript({ scope: "page", seed: 2 });
      var after = snapshot(f);
      reports.page = report;
      check("2 page scope", "page 1 frame untouched", after.frame1 === before.frame1);
      check("2 page scope", "page 2 frame changed", after.frame2 !== before.frame2, after.frame2);
      check("2 page scope", "overset text changed", report && report.kinds && report.kinds.overset === 1, report && json(report.kinds));
      check("2 page scope", "slug on locked layer changed", after.slug !== before.slug);
      check("2 page scope", "grouped caption changed", after.grouped !== before.grouped);
      check("2 page scope", "parent page untouched", after.footer === before.footer);
      check("2 page scope", "page 1 path untouched", after.path === before.path);
    });

    withFixture("3 selection", function (f) {
      app.select(f.article1);
      var before = snapshot(f);
      runScript({ scope: "selection", seed: 3 });
      var after = snapshot(f);
      check("3 selection", "selected frame changed", after.frame1 !== before.frame1, after.frame1);
      check("3 selection", "next frame untouched", after.frame2 === before.frame2);
      check("3 selection", "other frames untouched", after.pasteboard === before.pasteboard && after.footer === before.footer);
    });

    withFixture("4 include hidden, leave locked", function (f) {
      var before = snapshot(f);
      var report = runScript({ scope: "document", includeHidden: true, includeLocked: false, seed: 4 });
      var after = snapshot(f);
      check("4 include hidden, leave locked", "hidden frame changed", after.hidden !== before.hidden, after.hidden);
      check("4 include hidden, leave locked", "locked layer text untouched", after.slug === before.slug);
      check("4 include hidden, leave locked", "locked frame text untouched", after.lockedFrame === before.lockedFrame);
      check("4 include hidden, leave locked", "report counts 2 locked", report && report.skipped && report.skipped.locked === 2, report && json(report.skipped));
    });

    withFixture("5 keep headline readable", function (f) {
      var report = runScript({ scope: "document", keepStyles: ["TS Headline"], alwaysScramble: ["Brindlewick"], seed: 5 });
      var headline = text(f.story.paragraphs.item(0));
      check("5 keep headline readable", "headline keeps Annual Review", /^\S+ Annual Review\r?$/.test(headline), headline);
      check("5 keep headline readable", "Brindlewick scrambled inside the headline", headline.indexOf("Brindlewick") === -1, headline);
      check("5 keep headline readable", "body scrambled", text(f.story.paragraphs.item(1)).indexOf("grew in every region") === -1);
      check("5 keep headline readable", "report counts 1 kept paragraph", report && report.keptParagraphs === 1, report && report.keptParagraphs);
    });

    withFixture("6 cleanup", function (f) {
      var report = runScript({ scope: "document", cleanup: true, seed: 6 });
      var after = snapshot(f);
      reports.cleanup = report;
      check("6 cleanup", "web link points at example.com", after.web === "https://example.com/link-1", after.web);
      check("6 cleanup", "mail link points at example.com", after.mail === "mailto:hello@example.com", after.mail);
      check("6 cleanup", "author cleared", after.author === "", after.author);
      check("6 cleanup", "title cleared", after.title === "", after.title);
    });

    var seeded = [];
    withFixture("7 seed, first run", function (f) {
      runScript({ scope: "document", seed: "pitch" });
      seeded.push(text(f.story));
    });
    withFixture("7 seed, second run", function (f) {
      runScript({ scope: "document", seed: "pitch" });
      seeded.push(text(f.story));
    });
    check("7 seed", "same seed, same words", seeded.length === 2 && seeded[0] === seeded[1], seeded.join(" | "));
  } catch (error) {
    check("harness", "ran", false, error);
  } finally {
    app.scriptPreferences.userInteractionLevel = interaction;
    $.global.TextScrambleFixtureLibrary = undefined;
  }

  var passed = 0;
  var index;
  for (index = 0; index < results.length; index += 1) if (results[index].pass) passed += 1;
  outputFile.encoding = "UTF-8";
  outputFile.open("w");
  outputFile.write(json({ script: scriptFile.fsName, passed: passed, failed: results.length - passed, results: results, reports: reports }));
  outputFile.close();
  return passed + " of " + results.length + " checks passed. Results: " + outputFile.fsName;
}());
