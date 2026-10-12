#target "InDesign"

/* Text Scramble for the classic InDesign Scripts panel · MIT · pitch.dog */
(function () {
  // [engine:start]
  // [build:engine]
  // [engine:end]

  // Document walking and in-place replacement. Kept apart from the engine so the algorithm can change
  // without touching how the script finds and edits InDesign text.
  //
  // This block mirrors the UXP panel step for step (plugins/indesign/src/collect.ts, keep-readable.ts,
  // cleanup.ts, overflow.ts and run.ts), so both give the same report for the same document. It is
  // ES3 for ExtendScript, and it lives in one closure so none of its names can clash with the engine.
  // [document:start]
  var documentTools = (function () {
    var UNDO_NAME = "Text Scramble";
    var EXAMPLE_LINK = "https://example.com/";
    var EXAMPLE_EMAIL = "mailto:hello@example.com";
    var NEUTRAL_TITLE = "Untitled";
    var TEXT_TYPES = makeSet(["Text", "Character", "Word", "Line", "Paragraph", "TextColumn", "TextStyleRange", "Story"]);
    var CELL_TYPES = makeSet(["Cell", "Table", "Row", "Column"]);
    var FRAME_TYPES = makeSet(["TextFrame", "EndnoteTextFrame"]);
    var LAYOUT_ROOTS = makeSet(["Spread", "MasterSpread", "Page", "Document", "Application"]);
    var SCOPES = makeSet(["selection", "page", "document"]);

    // Small ES3 helpers. ExtendScript objects inherit watch, unwatch, toSource and reflect, so every
    // keyed lookup uses a prefixed own-property check.

    function makeSet(values) {
      var set = { members: {}, size: 0 };
      var index;
      if (values) {
        for (index = 0; index < values.length; index += 1) setAdd(set, values[index]);
      }
      return set;
    }

    function setHas(set, value) {
      return Object.prototype.hasOwnProperty.call(set.members, "~" + value);
    }

    function setAdd(set, value) {
      if (setHas(set, value)) return false;
      set.members["~" + value] = true;
      set.size += 1;
      return true;
    }

    function uniqueStrings(values) {
      var seen = makeSet([]);
      var result = [];
      var index;
      for (index = 0; index < values.length; index += 1) {
        if (setAdd(seen, values[index])) result.push(values[index]);
      }
      return result;
    }

    function trimString(value) {
      return String(value).replace(/^\s+|\s+$/g, "");
    }

    /** Splits text into code points: InDesign counts a character outside the BMP as one character. */
    function toCharacters(value) {
      var result = [];
      var index = 0;
      while (index < value.length) {
        var first = value.charCodeAt(index);
        var second = value.charCodeAt(index + 1);
        if (first >= 0xD800 && first <= 0xDBFF && second >= 0xDC00 && second <= 0xDFFF) {
          result.push(value.substr(index, 2));
          index += 2;
        } else {
          result.push(value.charAt(index));
          index += 1;
        }
      }
      return result;
    }

    /** Reads object.a.b.c, or returns the fallback when any step throws or the value is missing. */
    function readPath(object, names, fallback) {
      var value = object;
      var index;
      try {
        for (index = 0; index < names.length; index += 1) value = value[names[index]];
      } catch (error) {
        return fallback;
      }
      return value === undefined || value === null ? fallback : value;
    }

    function readProperty(object, name, fallback) {
      return readPath(object, [name], fallback);
    }

    function readFlag(object, name, expected) {
      try {
        return object[name] === expected;
      } catch (error) {
        return false;
      }
    }

    function readNumber(object, name) {
      try {
        return Number(object[name]);
      } catch (error) {
        return NaN;
      }
    }

    function readString(object, name, fallback) {
      try {
        return String(object[name]);
      } catch (error) {
        return fallback;
      }
    }

    function firstText(owner) {
      try {
        var text = owner.texts.item(0);
        return text === undefined || text === null ? null : text;
      } catch (error) {
        return null;
      }
    }

    function errorMessage(error) {
      try {
        if (error && typeof error.message === "string") return error.message;
      } catch (ignored) {}
      return String(error);
    }

    /** "TextFrame", "Story", "Cell"... ExtendScript names the class on constructor.name; UXP on constructorName. */
    function constructorName(item) {
      var name = "";
      if (item === undefined || item === null) return "Unknown";
      try {
        name = item.constructor ? item.constructor.name : "";
      } catch (error) {
        name = "";
      }
      if (!name) {
        try {
          name = item.constructorName;
        } catch (error) {
          name = "";
        }
      }
      return name ? String(name) : "Unknown";
    }

    /** The valid items of an InDesign collection or an array. */
    function collectionItems(collection) {
      var items = [];
      var length = 0;
      var index;
      var item;
      if (!collection) return items;
      try {
        length = Number(collection.length || 0);
      } catch (error) {
        return items;
      }
      for (index = 0; index < length; index += 1) {
        try {
          item = typeof collection.item === "function" ? collection.item(index) : collection[index];
          if (item && item.isValid !== false) items.push(item);
        } catch (error) {
          // InDesign collections can contain unresolved objects. Ignore only that object.
        }
      }
      return items;
    }

    function isValid(item) {
      if (!item) return false;
      try {
        return item.isValid !== false;
      } catch (error) {
        return false;
      }
    }

    function specifier(item, fallback) {
      var value = "";
      try {
        value = typeof item.toSpecifier === "function" ? String(item.toSpecifier()) : "";
      } catch (error) {
        value = "";
      }
      return value || fallback;
    }

    var ID_KEYED = makeSet(["TextFrame", "EndnoteTextFrame", "TextPath", "Story"]);

    /**
     * A key that names the same object however it was reached. InDesign's specifier depends on the
     * path: document.stories.item(0) is "story[0]" but a frame's parentStory is "story[@id=233]".
     * Stories, frames and text paths have an id that is unique in the document, so they are keyed by it.
     */
    function identity(item, fallback) {
      var type = constructorName(item);
      var id = readProperty(item, "id", null);
      return setHas(ID_KEYED, type) && typeof id === "number" ? type + "#" + id : specifier(item, fallback);
    }

    function textContents(text) {
      var contents = readProperty(text, "contents", null);
      return typeof contents === "string" ? contents : null;
    }

    function activeDocument(application) {
      try {
        if (!(Number(application.documents.length) > 0)) return null;
      } catch (error) {
        return null;
      }
      return readProperty(application, "activeDocument", null);
    }

    function activePage(application) {
      try {
        var page = application.activeWindow ? application.activeWindow.activePage : undefined;
        if (!page) {
          var windows = application.layoutWindows;
          var first = windows ? windows.item(0) : undefined;
          page = first ? first.activePage : undefined;
        }
        return page || null;
      } catch (error) {
        return null;
      }
    }

    // InDesign enumerations can come back as objects that only compare equal with ==.
    function sameEnum(left, right) {
      return left == right;
    }

    function customTextType() {
      try {
        return typeof VariableTypes === "undefined" ? undefined : VariableTypes.CUSTOM_TEXT_TYPE;
      } catch (error) {
        return undefined;
      }
    }

    // The engine block is the ES3 port of the TypeScript core (packages/core/es3), with the same API.
    function createEngine(scrambleNumbers, seed) {
      var scrambler = createScrambler(seed === undefined ? { scrambleNumbers: scrambleNumbers } : { scrambleNumbers: scrambleNumbers, seed: seed });
      return {
        scramble: function (text, filter) {
          return String(filter ? scrambler.scramble(text, filter) : scrambler.scramble(text));
        },
        matcher: function (entries) {
          return createWordMatcher(entries);
        },
        hasText: function (text) {
          return Boolean(hasScramblableText(text, { scrambleNumbers: scrambleNumbers }));
        }
      };
    }

    // Collecting (collect.ts): every piece of text a run should change, without changing anything.

    /** The page item that decides whether a text container is locked or hidden. */
    function pageItemOf(container) {
      return constructorName(container) === "TextPath" ? readProperty(container, "parent", container) : container;
    }

    function isOnParentPage(item) {
      var pageItem = pageItemOf(item);
      var page = readProperty(pageItem, "parentPage", null);
      var parent;
      var depth;
      var type;
      if (page) return constructorName(readProperty(page, "parent", null)) === "MasterSpread";
      parent = readProperty(pageItem, "parent", null);
      for (depth = 0; parent && depth < 12; depth += 1) {
        type = constructorName(parent);
        if (type === "MasterSpread") return true;
        if (type === "Spread" || type === "Document") return false;
        parent = readProperty(parent, "parent", null);
      }
      return false;
    }

    function anyOnParentPage(items) {
      var index;
      for (index = 0; index < items.length; index += 1) {
        if (isOnParentPage(items[index])) return true;
      }
      return false;
    }

    /** True for a story's last frame or path. InDesign answers "nothing" with null or a NothingEnum. */
    function isLastContainer(container) {
      var next = readProperty(container, "nextTextFrame", null);
      var type;
      if (!next || !isValid(next)) return true;
      type = constructorName(next);
      return !(setHas(FRAME_TYPES, type) || type === "TextPath");
    }

    function storyOffsetAtOrAfter(item, end) {
      try {
        return Number(item.storyOffset.index) >= end;
      } catch (error) {
        return false;
      }
    }

    function createWalker(options) {
      var targets = [];
      var skipped = { locked: 0, hidden: 0, unreadable: 0 };
      var containers = [];
      var cells = [];
      var stories = [];
      var notes = [];
      var seenTargets = makeSet([]);
      var seenContainers = makeSet([]);
      var seenCells = makeSet([]);
      var seenStories = makeSet([]);
      var includeLocked = options.includeLocked !== false;
      var includeHidden = options.includeHidden === true;
      // A whole-document run reaches anchored frames through document.stories already.
      var followAnchored = options.scope !== "document";

      function eligibility(container) {
        var unlock = [];
        var hidden = false;
        var item = pageItemOf(container);
        var layer = readProperty(item, "itemLayer", null);
        var depth;
        var type;
        for (depth = 0; item && depth < 24; depth += 1) {
          type = constructorName(item);
          if (setHas(LAYOUT_ROOTS, type) || setHas(TEXT_TYPES, type) || type === "Cell") break;
          if (readFlag(item, "visible", false)) hidden = true;
          if (readFlag(item, "locked", true)) unlock.push(item);
          item = readProperty(item, "parent", null);
        }
        if (layer) {
          if (readFlag(layer, "visible", false)) hidden = true;
          if (readFlag(layer, "locked", true)) unlock.unshift(layer);
        }
        if (hidden && !includeHidden) return { skip: "hidden", unlock: unlock };
        if (unlock.length && !includeLocked) return { skip: "locked", unlock: unlock };
        return { skip: null, unlock: unlock };
      }

      function countSkip(container, reason) {
        var key = identity(container, "container-" + seenContainers.size);
        if (!setAdd(seenContainers, key)) return;
        skipped[reason] += 1;
      }

      function rememberStory(story) {
        var key;
        if (!isValid(story)) return;
        key = identity(story, "story-" + seenStories.size);
        if (!setAdd(seenStories, key)) return;
        stories.push(story);
      }

      function addTarget(text, offset, source, kind, unlock, onParentPage) {
        var key = identity(text, "text-" + seenTargets.size) + "@" + offset;
        if (!setAdd(seenTargets, key)) return;
        targets.push({ text: text, offset: offset, source: source, kind: kind, key: key, onParentPage: onParentPage, unlock: unlock });
      }

      /** Adds a text flow, then the tables, footnotes and anchored frames inside it. */
      function addFlow(text, kind, unlock, onParentPage) {
        var contents;
        var tables;
        var footnotes;
        var items;
        var index;
        if (!isValid(text)) return;
        contents = textContents(text);
        if (contents === null) return;
        if (contents.length) addTarget(text, 0, contents, kind, unlock, onParentPage);
        tables = collectionItems(readProperty(text, "tables", null));
        for (index = 0; index < tables.length; index += 1) addTable(tables[index], unlock, onParentPage);
        footnotes = collectionItems(readProperty(text, "footnotes", null));
        for (index = 0; index < footnotes.length; index += 1) addFlow(firstText(footnotes[index]), "footnote", unlock, onParentPage);
        if (followAnchored) {
          items = collectionItems(readProperty(text, "allPageItems", null));
          for (index = 0; index < items.length; index += 1) addPageItem(items[index]);
        }
      }

      function addTable(table, unlock, onParentPage) {
        var tableCells = collectionItems(readProperty(table, "cells", null));
        var index;
        for (index = 0; index < tableCells.length; index += 1) addCell(tableCells[index], unlock, onParentPage);
      }

      function addCell(cell, unlock, onParentPage) {
        var key;
        if (!isValid(cell)) return;
        key = specifier(cell, "cell-" + seenCells.size);
        if (setAdd(seenCells, key)) cells.push(cell);
        addFlow(firstText(cell) || cell, "cell", unlock, onParentPage);
      }

      /** A text frame or text path: its visible text, plus the overset text if it ends the story. */
      function addContainer(container, kind) {
        var key;
        var decision;
        var onParentPage;
        var text;
        if (!isValid(container)) return;
        key = identity(container, "container-" + seenContainers.size);
        if (setHas(seenContainers, key)) return;
        decision = eligibility(container);
        if (decision.skip) {
          countSkip(container, decision.skip);
          return;
        }
        setAdd(seenContainers, key);
        containers.push(container);
        onParentPage = isOnParentPage(container);
        text = firstText(container);
        rememberStory(readProperty(container, "parentStory", null));
        addFlow(text, kind, decision.unlock, onParentPage);
        if (isLastContainer(container) && readFlag(container, "overflows", true)) {
          addOverset(container, text, decision.unlock, onParentPage);
        }
      }

      /** Text past the end of a story's last frame. It never prints, but it is still in the file. */
      function addOverset(container, frameText, unlock, onParentPage) {
        var story = readProperty(container, "parentStory", null);
        var storyContents = story ? textContents(story) : null;
        var frameContents = frameText ? textContents(frameText) : null;
        var start = readNumber(frameText, "index");
        var storyCharacters;
        var end;
        var tables;
        var footnotes;
        var index;
        if (storyContents === null || frameContents === null || !isFinite(start)) {
          skipped.unreadable += 1;
          notes.push("Some overset text could not be read. Try the Whole document scope.");
          return;
        }
        storyCharacters = toCharacters(storyContents);
        end = start + toCharacters(frameContents).length;
        if (storyCharacters.slice(start, end).join("") !== frameContents) {
          skipped.unreadable += 1;
          notes.push("Some overset text could not be lined up safely. Try the Whole document scope.");
          return;
        }
        if (end >= storyCharacters.length) return;
        addTarget(story, end, storyCharacters.slice(end).join(""), "overset", unlock, onParentPage);
        tables = collectionItems(readProperty(story, "tables", null));
        for (index = 0; index < tables.length; index += 1) {
          if (storyOffsetAtOrAfter(tables[index], end)) addTable(tables[index], unlock, onParentPage);
        }
        footnotes = collectionItems(readProperty(story, "footnotes", null));
        for (index = 0; index < footnotes.length; index += 1) {
          if (storyOffsetAtOrAfter(footnotes[index], end)) addFlow(firstText(footnotes[index]), "footnote", unlock, onParentPage);
        }
      }

      function addTextPaths(item) {
        var paths = collectionItems(readProperty(item, "textPaths", null));
        var index;
        for (index = 0; index < paths.length; index += 1) addContainer(paths[index], "path");
      }

      /** Any page item: text frames, plus text on the item's paths. Groups are flattened by the caller. */
      function addPageItem(item) {
        if (setHas(FRAME_TYPES, constructorName(item))) addContainer(item, "frame");
        addTextPaths(item);
      }

      /** Decides once for every frame a selection touches: any skipped frame skips the selection. */
      function selectionDecision(frames) {
        var unlock = [];
        var decision;
        var index;
        for (index = 0; index < frames.length; index += 1) {
          decision = eligibility(frames[index]);
          if (decision.skip) return { skip: decision.skip, unlock: [] };
          unlock = unlock.concat(decision.unlock);
        }
        return { skip: null, unlock: unlock };
      }

      function addSelected(item) {
        var type = constructorName(item);
        var frames;
        var decision;
        var table;
        var selectedCells;
        var onParentPage;
        var children;
        var index;
        if (type === "InsertionPoint") return;
        if (setHas(TEXT_TYPES, type)) {
          if (type === "Story") {
            addStory(item);
            return;
          }
          frames = collectionItems(readProperty(item, "parentTextFrames", null));
          decision = selectionDecision(frames);
          if (decision.skip) {
            skipped[decision.skip] += 1;
            return;
          }
          rememberStory(readProperty(item, "parentStory", null));
          addFlow(item, "selection", decision.unlock, anyOnParentPage(frames));
          return;
        }
        if (setHas(CELL_TYPES, type)) {
          table = type === "Table" ? item : readProperty(item, "parent", null);
          frames = collectionItems(readPath(table, ["storyOffset", "parentTextFrames"], null));
          decision = selectionDecision(frames);
          if (decision.skip) {
            skipped[decision.skip] += 1;
            return;
          }
          selectedCells = collectionItems(readProperty(item, "cells", null));
          if (!selectedCells.length && type === "Cell") selectedCells = [item];
          onParentPage = anyOnParentPage(frames);
          for (index = 0; index < selectedCells.length; index += 1) addCell(selectedCells[index], decision.unlock, onParentPage);
          return;
        }
        if (setHas(FRAME_TYPES, type) || type === "TextPath") {
          addContainer(item, type === "TextPath" ? "path" : "frame");
          addTextPaths(item);
          return;
        }
        addPageItem(item);
        children = collectionItems(readProperty(item, "allPageItems", null));
        for (index = 0; index < children.length; index += 1) addPageItem(children[index]);
      }

      /**
       * A whole story: every frame, the overset text, tables and footnotes. When some of its frames are
       * skipped (hidden or locked), fall back to the eligible frames one by one.
       */
      function addStory(story) {
        var storyContainers;
        var decisions = [];
        var eligible = [];
        var unlock = [];
        var allPaths = true;
        var container;
        var containerKey;
        var index;
        if (!isValid(story)) return;
        if (setHas(seenStories, identity(story, "story-" + seenStories.size))) return;
        storyContainers = collectionItems(readProperty(story, "textContainers", null));
        if (!storyContainers.length) {
          rememberStory(story);
          addFlow(story, "story", [], false);
          return;
        }
        for (index = 0; index < storyContainers.length; index += 1) {
          decisions.push({ container: storyContainers[index], eligibility: eligibility(storyContainers[index]) });
        }
        for (index = 0; index < decisions.length; index += 1) {
          if (!decisions[index].eligibility.skip) eligible.push(decisions[index]);
        }
        for (index = 0; index < decisions.length; index += 1) {
          if (decisions[index].eligibility.skip) countSkip(decisions[index].container, decisions[index].eligibility.skip);
        }
        if (!eligible.length) return;
        if (eligible.length < decisions.length) {
          for (index = 0; index < eligible.length; index += 1) {
            container = eligible[index].container;
            addContainer(container, constructorName(container) === "TextPath" ? "path" : "frame");
          }
          return;
        }
        rememberStory(story);
        for (index = 0; index < eligible.length; index += 1) {
          container = eligible[index].container;
          containerKey = identity(container, "container-" + seenContainers.size);
          if (setAdd(seenContainers, containerKey)) containers.push(container);
          unlock = unlock.concat(eligible[index].eligibility.unlock);
        }
        for (index = 0; index < storyContainers.length; index += 1) {
          if (constructorName(storyContainers[index]) !== "TextPath") allPaths = false;
        }
        addFlow(story, allPaths ? "path" : "story", unlock, anyOnParentPage(storyContainers));
      }

      function addDocument(document) {
        var storyList = collectionItems(readProperty(document, "stories", null));
        var items;
        var paths;
        var story;
        var index;
        var pathIndex;
        for (index = 0; index < storyList.length; index += 1) addStory(storyList[index]);
        // Belt and braces: reach any story that document.stories did not list, such as text on parent
        // pages or the pasteboard in older documents.
        items = collectionItems(readProperty(document, "allPageItems", null));
        for (index = 0; index < items.length; index += 1) {
          if (setHas(FRAME_TYPES, constructorName(items[index]))) {
            story = readProperty(items[index], "parentStory", null);
            if (story) addStory(story);
          }
          paths = collectionItems(readProperty(items[index], "textPaths", null));
          for (pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
            story = readProperty(paths[pathIndex], "parentStory", null);
            if (story) addStory(story);
          }
        }
      }

      return {
        addSelected: addSelected,
        addPageItem: addPageItem,
        addDocument: addDocument,
        result: function () {
          return { targets: targets, skipped: skipped, containers: containers, cells: cells, stories: stories, notes: notes };
        }
      };
    }

    function collectTargets(application, options) {
      var walker = createWalker(options);
      var document = activeDocument(application);
      var items;
      var index;
      if (!document) return walker.result();
      if (options.scope === "selection") {
        items = collectionItems(readProperty(application, "selection", []));
        for (index = 0; index < items.length; index += 1) walker.addSelected(items[index]);
      } else if (options.scope === "page") {
        items = collectionItems(readProperty(activePage(application), "allPageItems", null));
        for (index = 0; index < items.length; index += 1) walker.addPageItem(items[index]);
      } else {
        walker.addDocument(document);
      }
      return walker.result();
    }

    // Keep readable (keep-readable.ts): paragraphs in chosen styles stay, listed words still change.

    function paragraphStyleName(paragraph) {
      try {
        return String(paragraph.appliedParagraphStyle.name);
      } catch (error) {
        return "";
      }
    }

    function joinedMatchesAt(joined, start, count, expected) {
      return joined.slice(start, start + count).join("") === expected;
    }

    /**
     * Splits a target into kept and scrambled stretches, in code points. A target can start or end in
     * the middle of a paragraph, so the paragraphs are lined up against the target's own text first.
     * Returns null when they cannot be lined up; the caller then scrambles the target in full.
     */
    function keepPlan(text, offset, source, keepStyles) {
      var length = toCharacters(source).length;
      var whole = { segments: [{ start: 0, end: length, keep: false }], keptParagraphs: 0 };
      var paragraphs;
      var spans = [];
      var joined = [];
      var anyKept = false;
      var contents;
      var characters;
      var keep;
      var flowText;
      var flowCharacters;
      var flowJoined;
      var lead;
      var firstLength;
      var from;
      var to;
      var segments = [];
      var keptParagraphs = 0;
      var start;
      var end;
      var last;
      var tail;
      var index;
      var characterIndex;
      if (!keepStyles.size || !length) return whole;
      paragraphs = collectionItems(readProperty(text, "paragraphs", null));
      if (!paragraphs.length) return whole;
      for (index = 0; index < paragraphs.length; index += 1) {
        contents = readProperty(paragraphs[index], "contents", null);
        if (typeof contents !== "string") return null;
        characters = toCharacters(contents);
        keep = setHas(keepStyles, paragraphStyleName(paragraphs[index]));
        if (keep) anyKept = true;
        spans.push({ start: joined.length, end: joined.length + characters.length, keep: keep });
        for (characterIndex = 0; characterIndex < characters.length; characterIndex += 1) joined.push(characters[characterIndex]);
      }
      if (!anyKept) return whole;

      flowText = readProperty(text, "contents", null);
      if (typeof flowText !== "string") return null;
      flowCharacters = toCharacters(flowText);
      flowJoined = flowCharacters.join("");

      // Stories, cells and footnotes start with their first paragraph. Frames and selections may not.
      if (constructorName(text) === "Story") {
        lead = 0;
      } else {
        try {
          lead = Number(text.index) - Number(paragraphs[0].index);
        } catch (error) {
          lead = 0;
        }
      }
      if (!isFinite(lead) || lead < 0 || !joinedMatchesAt(joined, lead, flowCharacters.length, flowJoined)) {
        lead = -1;
        firstLength = spans[0].end - spans[0].start;
        for (start = 0; start < Math.max(firstLength, 1); start += 1) {
          if (joinedMatchesAt(joined, start, flowCharacters.length, flowJoined)) {
            lead = start;
            break;
          }
        }
        if (lead < 0) return null;
      }

      from = lead + offset;
      to = from + length;
      for (index = 0; index < spans.length; index += 1) {
        start = Math.max(spans[index].start, from) - from;
        end = Math.min(spans[index].end, to) - from;
        if (end <= start) continue;
        if (spans[index].keep) keptParagraphs += 1;
        last = segments.length ? segments[segments.length - 1] : null;
        if (last && last.keep === spans[index].keep && last.end === start) last.end = end;
        else segments.push({ start: start, end: end, keep: spans[index].keep });
      }
      if (!segments.length) return whole;
      // Text past the last paragraph (never expected, but never dropped) is scrambled.
      tail = segments[segments.length - 1].end;
      if (tail < length) segments.push({ start: tail, end: length, keep: false });
      return { segments: segments, keptParagraphs: keptParagraphs };
    }

    /** Scrambles each stretch: kept stretches only change listed words. */
    function scrambleSegments(source, plan, scramble) {
      var characters = toCharacters(source);
      var parts = [];
      var index;
      var segment;
      for (index = 0; index < plan.segments.length; index += 1) {
        segment = plan.segments[index];
        parts.push(scramble(characters.slice(segment.start, segment.end).join(""), segment.keep));
      }
      return parts.join("");
    }

    // Names and cleanup (cleanup.ts). Only example.com addresses are ever written.

    /** URLs and email addresses must never be scrambled into new, real-looking ones. */
    function looksLikeAddress(value) {
      return /@|:\/\/|^www\.|\.(?:com|net|org|io|co|uk|de|fr|app|dev)\b/i.test(trimString(value));
    }

    function bookmarksOf(owner) {
      var result = [];
      var bookmarks = collectionItems(readProperty(owner, "bookmarks", null));
      var index;
      for (index = 0; index < bookmarks.length; index += 1) {
        result.push(bookmarks[index]);
        result = result.concat(bookmarksOf(bookmarks[index]));
      }
      return result;
    }

    function addName(names, item, kind) {
      var name = readProperty(item, "name", null);
      if (typeof name !== "string" || !trimString(name) || looksLikeAddress(name)) return;
      names.push({ source: name, kind: kind, owner: item, field: "name" });
    }

    /** Names that appear in an exported PDF, plus custom text variables. Scrambled in Whole document runs. */
    function documentNames(document, textType) {
      var names = [];
      var bookmarks = bookmarksOf(document);
      var anchors = collectionItems(readProperty(document, "hyperlinkTextDestinations", null));
      var variables;
      var options;
      var contents;
      var index;
      for (index = 0; index < bookmarks.length; index += 1) addName(names, bookmarks[index], "bookmark");
      for (index = 0; index < anchors.length; index += 1) addName(names, anchors[index], "anchor");
      if (textType !== undefined) {
        variables = collectionItems(readProperty(document, "textVariables", null));
        for (index = 0; index < variables.length; index += 1) {
          if (!sameEnum(readProperty(variables[index], "variableType", null), textType)) continue;
          options = readProperty(variables[index], "variableOptions", null);
          contents = readProperty(options, "contents", null);
          if (typeof contents !== "string" || !trimString(contents) || looksLikeAddress(contents)) continue;
          names.push({ source: contents, kind: "variable", owner: options, field: "contents" });
        }
      }
      return names;
    }

    function renameItem(item, base, used) {
      var attempt;
      var name;
      for (attempt = 1; attempt < 50; attempt += 1) {
        name = attempt === 1 ? base : base + " (" + attempt + ")";
        if (setHas(used, name)) continue;
        try {
          item.name = name;
          setAdd(used, name);
          return true;
        } catch (error) {
          // Another object already uses this name. Try the next one.
        }
      }
      return false;
    }

    /** Points links at example.com, gives links neutral names and clears the document info. */
    function cleanDocument(document) {
      var report = { links: 0, renamed: 0, documentInfo: false };
      var used = makeSet([]);
      var destinations = collectionItems(readProperty(document, "hyperlinkURLDestinations", null));
      var hyperlinks = collectionItems(readProperty(document, "hyperlinks", null));
      var pageDestinations = collectionItems(readProperty(document, "hyperlinkPageDestinations", null));
      var metadata = readProperty(document, "metadataPreferences", null);
      var fields;
      var left;
      var url;
      var index;
      for (index = 0; index < destinations.length; index += 1) {
        url = String(readProperty(destinations[index], "destinationURL", ""));
        try {
          destinations[index].destinationURL = /^mailto:/i.test(url) ? EXAMPLE_EMAIL : EXAMPLE_LINK + "link-" + (index + 1);
          report.links += 1;
        } catch (error) {
          // A shared destination from another document can be read-only. Leave it.
        }
        if (renameItem(destinations[index], "Link " + (index + 1), used)) report.renamed += 1;
      }
      for (index = 0; index < hyperlinks.length; index += 1) {
        if (renameItem(hyperlinks[index], "Hyperlink " + (index + 1), used)) report.renamed += 1;
      }
      for (index = 0; index < pageDestinations.length; index += 1) {
        if (renameItem(pageDestinations[index], "Page link " + (index + 1), used)) report.renamed += 1;
      }
      // InDesign quietly ignores an empty value for some fields (the document title, for one), so a
      // field that still holds text afterwards gets a neutral placeholder instead.
      if (metadata) {
        fields = [
          ["documentTitle", "", NEUTRAL_TITLE], ["author", "", "Unknown"], ["description", "", "None"], ["keywords", [], null],
          ["copyrightNotice", "", "None"], ["copyrightInfoURL", "", EXAMPLE_LINK], ["jobName", "", NEUTRAL_TITLE]
        ];
        for (index = 0; index < fields.length; index += 1) {
          try {
            try {
              metadata[fields[index][0]] = fields[index][1];
            } catch (error) {
              if (fields[index][2] === null) throw error;
            }
            left = readProperty(metadata, fields[index][0], "");
            if (fields[index][2] !== null && typeof left === "string" && left !== "") metadata[fields[index][0]] = fields[index][2];
            report.documentInfo = true;
          } catch (error) {
            // Not every InDesign version exposes every field.
          }
        }
      }
      return report;
    }

    // Overflow (overflow.ts): frames and cells that overflow now but did not before.

    function snapshotOverflow(items) {
      var result = [];
      var index;
      for (index = 0; index < items.length; index += 1) result.push(readFlag(items[index], "overflows", true));
      return result;
    }

    /** A short, human place name: "page 4", "parent page A-Parent" or "pasteboard". */
    function placeLabel(item) {
      var page = readProperty(pageItemOf(item), "parentPage", null);
      var spread;
      if (page) {
        spread = readProperty(page, "parent", null);
        if (constructorName(spread) === "MasterSpread") return "parent page " + readString(spread, "name", readString(page, "name", "?"));
        return "page " + readString(page, "name", "?");
      }
      return "pasteboard";
    }

    function cellLabel(cell) {
      var table = readProperty(cell, "parent", null);
      var offset;
      var frame;
      var outerCell;
      var depth;
      // A nested table sits in a cell of an outer table, so climb out until a table sits in a frame.
      for (depth = 0; table && depth < 8; depth += 1) {
        offset = readProperty(table, "storyOffset", null);
        frame = readPath(offset, ["parentTextFrames", 0], null);
        if (frame) return "table on " + placeLabel(frame);
        outerCell = readProperty(offset, "parent", null);
        table = constructorName(outerCell) === "Cell" ? readProperty(outerCell, "parent", null) : null;
      }
      return "table";
    }

    function overflowReport(containers, containersBefore, cells, cellsBefore) {
      var report = { overflowing: [], alreadyOverflowing: 0 };
      var index;
      for (index = 0; index < containers.length; index += 1) {
        if (containersBefore[index]) report.alreadyOverflowing += 1;
        else if (readFlag(containers[index], "overflows", true)) report.overflowing.push({ label: placeLabel(containers[index]), kind: "frame" });
      }
      for (index = 0; index < cells.length; index += 1) {
        if (cellsBefore[index]) report.alreadyOverflowing += 1;
        else if (readFlag(cells[index], "overflows", true)) report.overflowing.push({ label: cellLabel(cells[index]), kind: "cell" });
      }
      return report;
    }

    // The run (run.ts): collect, scramble with one engine per run, write back character by character
    // inside one undo step, then report.

    function emptyKinds() {
      return { selection: 0, frame: 0, story: 0, overset: 0, cell: 0, footnote: 0, path: 0 };
    }

    function copyStrings(values) {
      var result = [];
      var length = 0;
      var index;
      if (!values) return result;
      if (typeof values === "string") return [values];
      try {
        length = Number(values.length || 0);
      } catch (error) {
        return result;
      }
      for (index = 0; index < length; index += 1) {
        if (values[index] !== undefined && values[index] !== null) result.push(String(values[index]));
      }
      return result;
    }

    function normalizeSettings(settings) {
      var source = settings || {};
      var scope = readProperty(source, "scope", "selection");
      var seed = readProperty(source, "seed", undefined);
      var keepStyles = copyStrings(readProperty(source, "keepStyles", null));
      return {
        scope: setHas(SCOPES, scope) ? scope : "selection",
        scrambleNumbers: readProperty(source, "scrambleNumbers", true) !== false,
        includeLocked: readProperty(source, "includeLocked", true) !== false,
        includeHidden: readProperty(source, "includeHidden", false) === true,
        keepStyles: keepStyles,
        keepStyleSet: makeSet(keepStyles),
        alwaysScramble: copyStrings(readProperty(source, "alwaysScramble", null)),
        cleanup: Boolean(readProperty(source, "cleanup", false)),
        seed: typeof seed === "number" || typeof seed === "string" ? seed : undefined
      };
    }

    function selectionLength(application) {
      try {
        return Number(application.selection.length);
      } catch (error) {
        return 0;
      }
    }

    function emptyReason(application, options, count, skipped) {
      if (count) return null;
      if (!activeDocument(application)) return "no-document";
      if (options.scope === "selection" && !selectionLength(application)) return "empty-selection";
      if (skipped.locked + skipped.hidden > 0) return "all-skipped";
      return "nothing-to-scramble";
    }

    /** InDesign counts characters by code point. Text that does not line up is left alone. */
    function linesUp(target) {
      var total;
      try {
        total = Number(target.text.characters.length);
      } catch (error) {
        total = NaN;
      }
      return total === target.offset + toCharacters(target.source).length;
    }

    function unlockKey(item, index) {
      var key = "";
      try {
        key = String(item.toSpecifier());
      } catch (error) {
        key = "";
      }
      return key || constructorName(item) + "-" + readProperty(item, "id", index);
    }

    /** Unlocks layers first, then groups and frames. Returns what it unlocked, to lock again later. */
    function unlockAll(items) {
      var positions = {};
      var unique = [];
      var layers = [];
      var others = [];
      var ordered;
      var unlocked = [];
      var key;
      var index;
      for (index = 0; index < items.length; index += 1) {
        key = "~" + unlockKey(items[index], index);
        if (Object.prototype.hasOwnProperty.call(positions, key)) {
          unique[positions[key]] = items[index];
        } else {
          positions[key] = unique.length;
          unique.push(items[index]);
        }
      }
      for (index = 0; index < unique.length; index += 1) {
        if (constructorName(unique[index]) === "Layer") layers.push(unique[index]);
        else others.push(unique[index]);
      }
      ordered = layers.concat(others);
      for (index = 0; index < ordered.length; index += 1) {
        try {
          if (ordered[index].locked === true) {
            ordered[index].locked = false;
            unlocked.push(ordered[index]);
          }
        } catch (error) {
          // If it cannot be unlocked, the edit below reports the problem for that text.
        }
      }
      return unlocked;
    }

    function relockAll(unlocked) {
      var index;
      for (index = unlocked.length - 1; index >= 0; index -= 1) {
        try {
          unlocked[index].locked = true;
        } catch (error) {
          // Keep going: every other item should still be locked again.
        }
      }
    }

    /** Writes only the characters that changed, one by one, so every character keeps its formatting. */
    function replaceCharacters(text, offset, source, output) {
      var sourceCharacters = toCharacters(source);
      var outputCharacters = toCharacters(output);
      var characters;
      var edits = [];
      var character;
      var position;
      var index;
      if (sourceCharacters.length !== outputCharacters.length) throw new Error("Scrambled text changed character structure.");
      characters = text.characters;
      for (index = 0; index < sourceCharacters.length; index += 1) {
        if (sourceCharacters[index] === outputCharacters[index]) continue;
        position = offset + index;
        character = typeof characters.item === "function" ? characters.item(position) : characters[position];
        if (!character || character.isValid === false) throw new Error("Cannot edit character " + (position + 1) + ".");
        edits.push({ character: character, replacement: outputCharacters[index] });
      }
      for (index = edits.length - 1; index >= 0; index -= 1) {
        edits[index].character.contents = edits[index].replacement;
      }
    }

    /**
     * One run. Settings: scope ("selection" | "page" | "document"), scrambleNumbers, includeLocked,
     * includeHidden, keepStyles and alwaysScramble (arrays of strings), cleanup and seed. Returns the
     * same report as the UXP panel's runScramble, with overflow items carrying only label and kind.
     */
    function runTextScramble(settings) {
      var options = normalizeSettings(settings);
      var document = activeDocument(app);
      var collection = collectTargets(app, options);
      var engine = createEngine(options.scrambleNumbers, options.seed);
      var report = {
        scope: options.scope,
        changed: 0,
        characters: 0,
        kinds: emptyKinds(),
        parentPages: 0,
        names: 0,
        skipped: { locked: collection.skipped.locked, hidden: collection.skipped.hidden, unreadable: collection.skipped.unreadable },
        keptParagraphs: 0,
        overflow: { overflowing: [], alreadyOverflowing: 0 },
        cleanup: null,
        errors: [],
        notes: collection.notes.slice(0),
        empty: null
      };
      var targets = [];
      var names = [];
      var allNames;
      var listed;
      var keepNames;
      var writes = [];
      var nameWrites = [];
      var plan;
      var output;
      var containersBefore;
      var cellsBefore;
      var target;
      var index;

      function scramble(text, keep) {
        return keep ? engine.scramble(text, listed) : engine.scramble(text);
      }

      function apply() {
        var unlockItems = [];
        var unlocked;
        var write;
        var applyIndex;
        for (applyIndex = 0; applyIndex < writes.length; applyIndex += 1) unlockItems = unlockItems.concat(writes[applyIndex].target.unlock);
        unlocked = unlockAll(unlockItems);
        try {
          for (applyIndex = 0; applyIndex < writes.length; applyIndex += 1) {
            write = writes[applyIndex];
            try {
              replaceCharacters(write.target.text, write.target.offset, write.target.source, write.output);
              report.changed += 1;
              report.characters += toCharacters(write.target.source).length;
              report.kinds[write.target.kind] += 1;
              if (write.target.onParentPage) report.parentPages += 1;
            } catch (error) {
              report.errors.push(errorMessage(error));
            }
          }
          for (applyIndex = 0; applyIndex < nameWrites.length; applyIndex += 1) {
            try {
              nameWrites[applyIndex].name.owner[nameWrites[applyIndex].name.field] = nameWrites[applyIndex].output;
              report.names += 1;
            } catch (error) {
              report.errors.push(errorMessage(error));
            }
          }
          if (options.cleanup) report.cleanup = cleanDocument(document);
          for (applyIndex = 0; applyIndex < collection.stories.length; applyIndex += 1) {
            try {
              collection.stories[applyIndex].recompose();
            } catch (error) {
              // Recomposing only makes the overflow report exact; InDesign recomposes on its own anyway.
            }
          }
        } finally {
          relockAll(unlocked);
        }
      }

      for (index = 0; index < collection.targets.length; index += 1) {
        target = collection.targets[index];
        if (!engine.hasText(target.source)) continue;
        if (linesUp(target)) {
          targets.push(target);
        } else {
          report.skipped.unreadable += 1;
          report.notes.push("Some text with special characters could not be lined up safely, so it was left as it is.");
        }
      }
      if (options.scope === "document" && document) {
        allNames = documentNames(document, customTextType());
        for (index = 0; index < allNames.length; index += 1) {
          if (engine.hasText(allNames[index].source)) names.push(allNames[index]);
        }
      }

      // One engine per run: a word becomes the same invented word in every frame, cell and note.
      listed = engine.matcher(options.alwaysScramble);
      for (index = 0; index < targets.length; index += 1) {
        target = targets[index];
        plan = keepPlan(target.text, target.offset, target.source, options.keepStyleSet);
        if (plan === null) {
          report.notes.push("Some paragraphs could not be matched to their styles, so they were scrambled in full.");
          plan = { segments: [{ start: 0, end: toCharacters(target.source).length, keep: false }], keptParagraphs: 0 };
        }
        report.keptParagraphs += plan.keptParagraphs;
        output = scrambleSegments(target.source, plan, scramble);
        if (output !== target.source) writes.push({ target: target, output: output });
      }
      // Bookmarks and anchors usually repeat headings, so they follow the "keep readable" rule: with
      // kept styles, only listed words change in them. Text variables always scramble in full.
      // A name that comes out unchanged (kept readable, with no listed word in it) is left alone and not counted.
      keepNames = options.keepStyles.length > 0;
      for (index = 0; index < names.length; index += 1) {
        output = scramble(names[index].source, keepNames && names[index].kind !== "variable");
        if (output !== names[index].source) nameWrites.push({ name: names[index], output: output });
      }

      report.empty = emptyReason(app, options, writes.length + nameWrites.length, report.skipped);
      // Text was found but kept on purpose: say so, even when hidden or locked items were skipped too.
      if ((report.empty === "nothing-to-scramble" || report.empty === "all-skipped") && targets.length && report.keptParagraphs) report.empty = "all-kept";
      if (!document || (!writes.length && !nameWrites.length && !options.cleanup)) {
        report.notes = uniqueStrings(report.notes);
        return report;
      }

      containersBefore = snapshotOverflow(collection.containers);
      cellsBefore = snapshotOverflow(collection.cells);
      app.doScript(apply, ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, UNDO_NAME);

      report.overflow = overflowReport(collection.containers, containersBefore, collection.cells, cellsBefore);
      report.errors = uniqueStrings(report.errors);
      report.notes = uniqueStrings(report.notes);
      report.empty = report.changed || report.names || report.cleanup ? null : report.empty;
      return report;
    }

    /** Unique paragraph style names in the document, for the "keep readable" list. */
    function paragraphStyleNames(document) {
      var styles = collectionItems(readProperty(document, "allParagraphStyles", null));
      var names = [];
      var index;
      var name;
      for (index = 0; index < styles.length; index += 1) {
        name = readString(styles[index], "name", "");
        if (name.length > 0) names.push(name);
      }
      return uniqueStrings(names);
    }

    function copyList(values) {
      var result = [];
      var index;
      for (index = 0; index < values.length; index += 1) result.push(values[index]);
      return result;
    }

    /** A copy of a report with nothing but plain values in it, for $.global.TextScrambleResult. */
    function plainReport(report) {
      var overflowing = [];
      var kinds = report.kinds;
      var index;
      for (index = 0; index < report.overflow.overflowing.length; index += 1) {
        overflowing.push({ label: String(report.overflow.overflowing[index].label), kind: String(report.overflow.overflowing[index].kind) });
      }
      return {
        scope: report.scope,
        changed: report.changed,
        characters: report.characters,
        kinds: { selection: kinds.selection, frame: kinds.frame, story: kinds.story, overset: kinds.overset, cell: kinds.cell, footnote: kinds.footnote, path: kinds.path },
        parentPages: report.parentPages,
        names: report.names,
        skipped: { locked: report.skipped.locked, hidden: report.skipped.hidden, unreadable: report.skipped.unreadable },
        keptParagraphs: report.keptParagraphs,
        overflow: { overflowing: overflowing, alreadyOverflowing: report.overflow.alreadyOverflowing },
        cleanup: report.cleanup ? { links: report.cleanup.links, renamed: report.cleanup.renamed, documentInfo: report.cleanup.documentInfo } : null,
        errors: copyList(report.errors),
        notes: copyList(report.notes),
        empty: report.empty
      };
    }

    return {
      run: runTextScramble,
      plainReport: plainReport,
      paragraphStyleNames: paragraphStyleNames,
      activeDocument: activeDocument,
      selectionLength: selectionLength,
      trimString: trimString,
      makeSet: makeSet,
      setAdd: setAdd
    };
  }());

  function runTextScramble(settings) {
    return documentTools.run(settings);
  }

  // [document:end]

  // The dialog and the closing message. Plain ScriptUI, so it looks the same on Mac and Windows.
  // [ui:start]
  var dialogTools = (function () {
    var SCOPE_VALUES = ["selection", "page", "document"];
    var SCOPE_LABELS = ["Selection", "Active page", "Whole document"];

    /** Splits a typed list ("Brindlewick, Amelie Hart" or one per line) into clean entries. */
    function parseWordList(value) {
      var parts = String(value || "").split(/[\r\n,;]+/);
      var seen = documentTools.makeSet([]);
      var result = [];
      var entry;
      var index;
      for (index = 0; index < parts.length; index += 1) {
        entry = documentTools.trimString(parts[index]).replace(/\s+/g, " ");
        if (entry.length > 0 && documentTools.setAdd(seen, entry)) result.push(entry);
      }
      return result;
    }

    function count(value, singular, plural) {
      return value + " " + (value === 1 ? singular : plural);
    }

    function joinPhrases(phrases) {
      if (phrases.length < 2) return phrases.join("");
      return phrases.slice(0, phrases.length - 1).join(", ") + " and " + phrases[phrases.length - 1];
    }

    /** "page 4, page 7 (2), table on page 9" */
    function summarizePlaces(items) {
      var labels = [];
      var counts = {};
      var key;
      var index;
      var result = [];
      for (index = 0; index < items.length; index += 1) {
        key = "~" + items[index].label;
        if (Object.prototype.hasOwnProperty.call(counts, key)) {
          counts[key] += 1;
        } else {
          counts[key] = 1;
          labels.push(items[index].label);
        }
      }
      for (index = 0; index < labels.length; index += 1) {
        key = "~" + labels[index];
        result.push(counts[key] > 1 ? labels[index] + " (" + counts[key] + ")" : labels[index]);
      }
      return result.join(", ");
    }

    function whereText(scope) {
      if (scope === "page") return "on this page";
      if (scope === "document") return "in this document";
      return "in the selection";
    }

    function skippedLines(skipped) {
      var lines = [];
      if (skipped.locked) {
        lines.push("Left " + count(skipped.locked, "locked item", "locked items") + " alone. Locked frames still print, so turn on \u201CInclude locked items\u201D to scramble them.");
      }
      if (skipped.hidden) {
        lines.push("Left " + count(skipped.hidden, "hidden item", "hidden items") + " alone. Hidden items don\u2019t print, but they stay in the file; turn on \u201CInclude hidden items\u201D to scramble them too.");
      }
      return lines;
    }

    /** One plain-language message that sums up a report. */
    function summaryMessage(report) {
      var lines = [];
      var kinds = report.kinds;
      var places = [];
      var cleanup = report.cleanup;
      var index;
      if (report.empty === "no-document") return "Open an InDesign document first.";
      if (report.empty === "empty-selection") {
        return "Nothing is selected. Select some text, a text frame or a table, or choose Active page or Whole document.";
      }
      if (report.empty === "all-skipped") {
        lines.push("Everything " + whereText(report.scope) + " is locked or hidden, so nothing changed.");
        lines = lines.concat(skippedLines(report.skipped));
        return lines.join("\n\n");
      }
      if (report.empty === "all-kept") {
        lines.push("Every paragraph " + whereText(report.scope) + " uses a paragraph style you chose to keep readable, so nothing changed. Add words to \u201CAlways scramble these words\u201D to change names inside them.");
        lines = lines.concat(skippedLines(report.skipped));
        return lines.join("\n\n");
      }
      if (report.empty === "nothing-to-scramble") {
        lines.push("There\u2019s no text to scramble " + whereText(report.scope) + ", so nothing changed.");
        if (report.scope !== "document") lines.push("Try Whole document to reach every page, parent page and the pasteboard.");
        return lines.join("\n\n");
      }

      if (kinds.frame) places.push(count(kinds.frame, "text frame", "text frames"));
      if (kinds.story) places.push(count(kinds.story, "story", "stories"));
      if (kinds.selection) places.push(count(kinds.selection, "text selection", "text selections"));
      if (kinds.overset) places.push(count(kinds.overset, "overset passage", "overset passages"));
      if (kinds.cell) places.push(count(kinds.cell, "table cell", "table cells"));
      if (kinds.footnote) places.push(count(kinds.footnote, "footnote", "footnotes"));
      if (kinds.path) places.push(count(kinds.path, "text path", "text paths"));
      if (report.changed) {
        lines.push("Scrambled " + count(report.characters, "character", "characters") + " in " + joinPhrases(places) + ".");
        if (report.parentPages) lines.push(count(report.parentPages, "of these is on a parent page", "of these are on parent pages") + ".");
      }
      if (report.names) lines.push("Also scrambled " + count(report.names, "bookmark, text anchor or text variable", "bookmarks, text anchors and text variables") + ".");
      if (report.keptParagraphs) lines.push("Kept " + count(report.keptParagraphs, "paragraph", "paragraphs") + " readable, as you asked.");
      lines = lines.concat(skippedLines(report.skipped));
      if (report.overflow.overflowing.length) {
        lines.push("The new words run a little wider, so text now overflows here: " + summarizePlaces(report.overflow.overflowing) + ".");
      }
      if (report.overflow.alreadyOverflowing) {
        lines.push(count(report.overflow.alreadyOverflowing, "frame or cell was", "frames and cells were") + " already overflowing before the run.");
      }
      if (cleanup) {
        lines.push("Cleanup: pointed " + count(cleanup.links, "link", "links") + " at example.com, gave " + count(cleanup.renamed, "link a neutral name", "links neutral names") + (cleanup.documentInfo ? " and cleared the title, author and other document info." : "."));
      }
      if (report.errors.length) {
        lines.push(count(report.errors.length, "problem", "problems") + " stopped some text from changing: " + report.errors[0] + (report.errors.length > 1 ? " (and more)" : ""));
      }
      for (index = 0; index < report.notes.length; index += 1) lines.push(report.notes[index]);
      lines.push("Edit > Undo Text Scramble puts it all back in one step.");
      return lines.join("\n\n");
    }

    /** Shows the settings dialog. Returns the settings, or null when the person cancels. */
    function askSettings(document) {
      var styleNames = documentTools.paragraphStyleNames(document);
      var dialog = new Window("dialog", "Text Scramble");
      var scopeRow;
      var scopeList;
      var numbers;
      var locked;
      var hidden;
      var cleanup;
      var keepPanel;
      var styleList;
      var wordsGroup;
      var words;
      var seedGroup;
      var seed;
      var buttons;
      var keepStyles = [];
      var index;
      dialog.orientation = "column";
      dialog.alignChildren = ["fill", "top"];
      dialog.spacing = 10;
      dialog.margins = 16;

      scopeRow = dialog.add("group");
      scopeRow.orientation = "row";
      scopeRow.add("statictext", undefined, "Scramble:");
      scopeList = scopeRow.add("dropdownlist", undefined, SCOPE_LABELS);
      scopeList.selection = documentTools.selectionLength(app) > 0 ? 0 : 1;

      numbers = dialog.add("checkbox", undefined, "Scramble numbers");
      numbers.value = true;
      locked = dialog.add("checkbox", undefined, "Include locked items");
      locked.value = true;
      locked.helpTip = "Locked frames still print";
      hidden = dialog.add("checkbox", undefined, "Include hidden items");
      hidden.value = false;
      hidden.helpTip = "Hidden items don\u2019t print, but stay in the file";
      cleanup = dialog.add("checkbox", undefined, "Clean links and document info");
      cleanup.value = false;
      cleanup.helpTip = "Points links at example.com and clears the title and author";

      keepPanel = dialog.add("panel", undefined, "Keep these paragraph styles readable");
      keepPanel.alignChildren = ["fill", "top"];
      keepPanel.margins = [10, 16, 10, 10];
      styleList = keepPanel.add("listbox", undefined, styleNames, { multiselect: true });
      styleList.preferredSize = [320, 120];

      wordsGroup = dialog.add("group");
      wordsGroup.orientation = "column";
      wordsGroup.alignChildren = ["fill", "top"];
      wordsGroup.add("statictext", undefined, "Always scramble these words");
      words = wordsGroup.add("edittext", undefined, "");
      words.helpTip = "Separate words with commas. They change even inside kept paragraphs.";

      seedGroup = dialog.add("group");
      seedGroup.orientation = "column";
      seedGroup.alignChildren = ["fill", "top"];
      seedGroup.add("statictext", undefined, "Seed (optional)");
      seed = seedGroup.add("edittext", undefined, "");
      seed.helpTip = "The same seed gives the same invented words every time";

      buttons = dialog.add("group");
      buttons.alignment = "right";
      buttons.add("button", undefined, "Cancel", { name: "cancel" });
      buttons.add("button", undefined, "Scramble", { name: "ok" });

      if (dialog.show() !== 1) return null;
      for (index = 0; index < styleList.items.length; index += 1) {
        if (styleList.items[index].selected) keepStyles.push(String(styleList.items[index].text));
      }
      return {
        scope: SCOPE_VALUES[scopeList.selection ? scopeList.selection.index : 0],
        scrambleNumbers: numbers.value === true,
        includeLocked: locked.value === true,
        includeHidden: hidden.value === true,
        cleanup: cleanup.value === true,
        keepStyles: keepStyles,
        alwaysScramble: parseWordList(words.text),
        seed: documentTools.trimString(seed.text)
      };
    }

    return { askSettings: askSettings, summaryMessage: summaryMessage, parseWordList: parseWordList, summarizePlaces: summarizePlaces };
  }());
  // [ui:end]

  // A test harness sets $.global.TextScrambleTest to a settings object: the script then skips the
  // dialog and every alert, runs, and leaves a plain copy of the report in $.global.TextScrambleResult.
  var headlessSettings = null;
  try {
    headlessSettings = $.global.TextScrambleTest || null;
  } catch (error) {
    headlessSettings = null;
  }
  if (headlessSettings) {
    $.global.TextScrambleResult = null;
    $.global.TextScrambleResult = documentTools.plainReport(runTextScramble(headlessSettings));
    return;
  }

  if (!app.documents.length) {
    alert("Open an InDesign document first.", "Text Scramble");
    return;
  }

  var chosenSettings = dialogTools.askSettings(app.activeDocument);
  if (!chosenSettings) return;
  var finalReport;
  try {
    finalReport = runTextScramble(chosenSettings);
  } catch (error) {
    alert("Text Scramble stopped: " + (error && error.message ? error.message : String(error)) + "\n\nIf anything changed, Edit > Undo puts it back.", "Text Scramble");
    return;
  }
  alert(dialogTools.summaryMessage(finalReport), "Text Scramble");
}());
