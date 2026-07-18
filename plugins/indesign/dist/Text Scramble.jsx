#target "InDesign"

/* Text Scramble for the classic InDesign Scripts panel · MIT · pitch.dog */
(function () {
  var VOWELS = ["a", "a", "a", "e", "e", "e", "e", "i", "i", "o", "o", "u"];
  var CONSONANTS = ["b", "c", "d", "f", "g", "h", "l", "l", "m", "m", "n", "n", "n", "p", "r", "r", "r", "s", "s", "t", "t", "v", "w"];
  var ENDINGS = ["d", "l", "m", "n", "n", "r", "r", "s", "s", "t"];
  var FORBIDDEN = {
    a: 1, an: 1, and: 1, are: 1, as: 1, at: 1, be: 1, by: 1, can: 1, deck: 1, design: 1,
    for: 1, from: 1, good: 1, great: 1, in: 1, is: 1, it: 1, make: 1, new: 1, not: 1,
    of: 1, on: 1, or: 1, our: 1, story: 1, text: 1, that: 1, the: 1, this: 1, to: 1,
    use: 1, we: 1, with: 1, work: 1, you: 1
  };
  var UNSAFE = ["anus", "ass", "cock", "cunt", "dick", "fuck", "hate", "kill", "nazi", "porn", "rape", "sex", "shit", "slut"];
  var WIDTH = { i: 0.34, j: 0.43, l: 0.38, f: 0.55, r: 0.58, t: 0.56, m: 1.34, w: 1.28 };

  function pick(values) {
    return values[Math.floor(Math.random() * values.length)];
  }

  function isVowel(character) {
    return /[aeiou]/.test(character);
  }

  function generate(length) {
    if (length === 1) return pick(VOWELS);
    var result = "";
    var index;
    for (index = 0; index < length; index += 1) {
      var previous = result.charAt(index - 1);
      var beforePrevious = result.charAt(index - 2);
      if (index === 0) {
        result += Math.random() < 0.18 ? pick(VOWELS) : pick(CONSONANTS);
      } else if (index === length - 1) {
        result += isVowel(previous) ? (Math.random() < 0.08 ? pick(VOWELS) : pick(ENDINGS)) : pick(VOWELS);
      } else if (isVowel(previous)) {
        result += isVowel(beforePrevious) || Math.random() < 0.94 ? pick(CONSONANTS) : pick(VOWELS);
      } else {
        result += pick(VOWELS);
      }
    }
    return result;
  }

  function characterWidth(character) {
    var lower = character.toLowerCase();
    return WIDTH[lower] || 0.94;
  }

  function measure(word) {
    var total = 0;
    var index;
    for (index = 0; index < word.length; index += 1) total += characterWidth(word.charAt(index));
    return total;
  }

  function isUnwelcome(word) {
    var lower = word.toLowerCase();
    if (FORBIDDEN[lower] || /[aeiou]{3}/.test(lower) || /[^aeiou]{3}/.test(lower) || /([a-z]{2})\1/.test(lower)) return true;
    var index;
    for (index = 0; index < UNSAFE.length; index += 1) {
      if (lower.indexOf(UNSAFE[index]) !== -1) return true;
    }
    return false;
  }

  function applyCase(source, replacement) {
    var result = "";
    var index;
    for (index = 0; index < source.length; index += 1) {
      var character = replacement.charAt(index);
      result += source.charAt(index) === source.charAt(index).toUpperCase() ? character.toUpperCase() : character;
    }
    return result;
  }

  function shapeWord(source) {
    var targetWidth = Math.max(measure(source), 0.01);
    var best = "";
    var bestScore = 999;
    var attempt;
    for (attempt = 0; attempt < 96; attempt += 1) {
      var candidate = generate(source.length);
      if (candidate.toLowerCase() === source.toLowerCase() || isUnwelcome(candidate)) continue;
      var score = Math.abs(measure(candidate) - targetWidth) / targetWidth;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) best = "velorani".substr(0, source.length);
    while (best.length < source.length) best += "a";
    return applyCase(source, best);
  }

  function scrambleNumber(source) {
    var result = "";
    var index;
    for (index = 0; index < source.length; index += 1) {
      var digit = parseInt(source.charAt(index), 10);
      result += String((digit + 1 + Math.floor(Math.random() * 9)) % 10);
    }
    return result;
  }

  function scrambleContents(source, scrambleNumbers, cache) {
    return source.replace(/[A-Za-z]+|[0-9]+/g, function (token) {
      if (/^[0-9]+$/.test(token)) return scrambleNumbers ? scrambleNumber(token) : token;
      var key = token.toLowerCase();
      if (!cache[key]) cache[key] = shapeWord(token.toLowerCase());
      return applyCase(token, cache[key]);
    });
  }

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
      if (name === "Text" || name === "Character" || name === "Word" || name === "Line" || name === "Paragraph" || name === "TextStyleRange" || name === "Story") return item;
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

  function targetsFor(scope) {
    var targets = [];
    var index;
    if (scope === "selection") {
      for (index = 0; index < app.selection.length; index += 1) {
        var selectedText = textFromSelection(app.selection[index]);
        if (selectedText && selectedText.contents.length) targets.push(selectedText);
      }
    } else {
      var frames = app.activeWindow.activePage.textFrames;
      for (index = 0; index < frames.length; index += 1) {
        if (!editableFrame(frames.item(index))) continue;
        var pageText = frames.item(index).texts.item(0);
        if (pageText.contents.length) targets.push(pageText);
      }
    }
    return targets;
  }

  function replaceCharacters(target, source, output) {
    var sourceCharacters = toCharacters(source);
    var outputCharacters = toCharacters(output);
    if (sourceCharacters.length !== outputCharacters.length) throw new Error("Scrambled text changed character structure.");
    var index;
    for (index = outputCharacters.length - 1; index >= 0; index -= 1) {
      if (sourceCharacters[index] !== outputCharacters[index]) target.characters.item(index).contents = outputCharacters[index];
    }
  }

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
