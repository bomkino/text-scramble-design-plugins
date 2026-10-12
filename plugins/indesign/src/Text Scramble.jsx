#target "InDesign"

/* Text Scramble for the classic InDesign Scripts panel · MIT · pitch.dog */
(function () {
  // @engine:start
  // @build:engine
  // @engine:end

  // Document walking and in-place replacement. Kept apart from the engine so the algorithm can change
  // without touching how the script finds and edits InDesign text.
  // @document:start
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

  function constructorName(value) {
    try { return value.constructor.name; } catch (error) { return ""; }
  }

  function textFromSelection(item) {
    var name = constructorName(item);
    try {
      if (name === "TextFrame" || name === "EndnoteTextFrame") return item.texts.item(0);
      if (name === "Text" || name === "Character" || name === "Word" || name === "Line" || name === "Paragraph" || name === "TextColumn" || name === "TextStyleRange" || name === "Cell" || name === "Story") return item;
    } catch (error) {}
    return null;
  }

  function editableFrame(frame) {
    try {
      return !frame.locked && frame.visible !== false && !frame.itemLayer.locked && frame.itemLayer.visible !== false;
    } catch (error) {
      return false;
    }
  }

  function addTarget(target, targets, seen) {
    if (!target || !target.contents || !target.contents.length) return;
    var key = "";
    try { key = target.toSpecifier(); } catch (error) {}
    if (key && seen[key]) return;
    if (key) seen[key] = true;
    targets.push(target);
  }

  function addFrameTargets(container, targets, seen) {
    var pageItems;
    try { pageItems = container.allPageItems; } catch (error) { return; }
    var index;
    for (index = 0; index < pageItems.length; index += 1) {
      var frame;
      try { frame = typeof pageItems.item === "function" ? pageItems.item(index) : pageItems[index]; } catch (error) { continue; }
      var name = constructorName(frame);
      if ((name !== "TextFrame" && name !== "EndnoteTextFrame") || !editableFrame(frame)) continue;
      try { addTarget(frame.texts.item(0), targets, seen); } catch (error) {}
    }
  }

  function targetsFor(scope) {
    var targets = [];
    var seen = {};
    var index;
    if (scope === "selection") {
      for (index = 0; index < app.selection.length; index += 1) {
        var selectedText = textFromSelection(app.selection[index]);
        if (selectedText) addTarget(selectedText, targets, seen);
        else addFrameTargets(app.selection[index], targets, seen);
      }
    } else {
      addFrameTargets(app.activeWindow.activePage, targets, seen);
    }
    return targets;
  }

  function replaceCharacters(target, source, output) {
    var sourceCharacters = toCharacters(source);
    var outputCharacters = toCharacters(output);
    if (sourceCharacters.length !== outputCharacters.length) throw new Error("Scrambled text changed character structure.");
    var edits = [];
    var index;
    for (index = outputCharacters.length - 1; index >= 0; index -= 1) {
      if (sourceCharacters[index] === outputCharacters[index]) continue;
      var character = target.characters.item(index);
      if (!character || character.isValid === false) throw new Error("Cannot edit character " + (index + 1) + ".");
      edits.push({ character: character, replacement: outputCharacters[index] });
    }
    for (index = 0; index < edits.length; index += 1) {
      edits[index].character.contents = edits[index].replacement;
    }
  }

  // @document:end

  if (!app.documents.length) {
    alert("Open an InDesign document first.", "Text Scramble");
    return;
  }

  var dialog = app.dialogs.add({ name: "Text Scramble — shape-matched draft copy", canCancel: true });
  var column = dialog.dialogColumns.add();
  column.staticTexts.add({ staticLabel: "Scramble selected text/frames or every text frame on the active page." });
  var scopeControl = column.dropdowns.add({ stringList: ["Selection", "Active page"], selectedIndex: 0 });
  var numbersControl = column.checkboxControls.add({ staticLabel: "Scramble numbers", checkedState: true });
  var accepted = dialog.show();
  var scope = scopeControl.selectedIndex === 1 ? "page" : "selection";
  var scrambleNumbers = numbersControl.checkedState;
  dialog.destroy();
  if (!accepted) return;

  var targets = targetsFor(scope);
  var targetIndex;
  for (targetIndex = targets.length - 1; targetIndex >= 0; targetIndex -= 1) {
    if (!hasScramblableContents(String(targets[targetIndex].contents), scrambleNumbers)) targets.splice(targetIndex, 1);
  }
  if (!targets.length) {
    alert(scope === "selection" ? "Select text or one or more text frames." : "No editable text on the active page.", "Text Scramble");
    return;
  }

  var cache = {};
  var characterCount = 0;
  app.doScript(function () {
    var index;
    for (index = 0; index < targets.length; index += 1) {
      var source = String(targets[index].contents);
      var output = scrambleContents(source, scrambleNumbers, cache);
      replaceCharacters(targets[index], source, output);
      characterCount += source.length;
    }
  }, ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, "Text Scramble");

  alert("Done — " + targets.length + (targets.length === 1 ? " text frame, " : " text frames, ") + characterCount + " characters.", "Text Scramble");
}());
