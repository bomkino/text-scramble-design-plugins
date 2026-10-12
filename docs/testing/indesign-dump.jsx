#target "InDesign"

/*
  Text Scramble · read-only dump of the active (scratch) document, for checking panel runs.
  Changes nothing. Writes indesign-dump.json beside this file, or to $.global.TextScrambleDumpPath.
*/
(function () {
  var here = File($.fileName).parent;
  var outputFile = File($.global.TextScrambleDumpPath || here.fsName + "/indesign-dump.json");

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

  function safe(read, fallback) {
    try {
      return read();
    } catch (error) {
      return fallback;
    }
  }

  function place(item) {
    var page = safe(function () { return item.parentPage; }, null);
    if (!page) return "pasteboard or anchored";
    if (safe(function () { return page.parent.constructor.name; }, "") === "MasterSpread") return "parent page " + page.parent.name;
    return "page " + page.name;
  }

  if (!app.documents.length) return "No document open.";
  var doc = app.activeDocument;
  var dump = { document: doc.name, stories: [], cells: [], footnotes: [], layers: [], bookmarks: [], anchors: [], links: [], variables: [], info: {} };
  var index;
  var inner;
  for (index = 0; index < doc.stories.length; index += 1) {
    var story = doc.stories.item(index);
    var containers = safe(function () { return story.textContainers; }, []);
    var frames = [];
    for (inner = 0; inner < containers.length; inner += 1) {
      frames.push({ place: place(containers[inner].constructor.name === "TextPath" ? containers[inner].parent : containers[inner]), overflows: safe(function () { return containers[inner].overflows; }, null), locked: safe(function () { return containers[inner].locked; }, null), visible: safe(function () { return containers[inner].visible; }, null) });
    }
    dump.stories.push({ contents: safe(function () { return String(story.contents); }, "(unreadable)"), overflows: safe(function () { return story.overflows; }, null), frames: frames });
    for (inner = 0; inner < story.tables.length; inner += 1) {
      var cells = story.tables.item(inner).cells;
      var cellIndex;
      for (cellIndex = 0; cellIndex < cells.length; cellIndex += 1) dump.cells.push({ contents: String(cells.item(cellIndex).contents), overflows: cells.item(cellIndex).overflows });
    }
    for (inner = 0; inner < story.footnotes.length; inner += 1) dump.footnotes.push(String(story.footnotes.item(inner).texts.item(0).contents));
  }
  for (index = 0; index < doc.layers.length; index += 1) dump.layers.push({ name: doc.layers.item(index).name, locked: doc.layers.item(index).locked, visible: doc.layers.item(index).visible });
  for (index = 0; index < doc.bookmarks.length; index += 1) dump.bookmarks.push(doc.bookmarks.item(index).name);
  for (index = 0; index < doc.hyperlinkTextDestinations.length; index += 1) dump.anchors.push(doc.hyperlinkTextDestinations.item(index).name);
  for (index = 0; index < doc.hyperlinkURLDestinations.length; index += 1) dump.links.push({ name: doc.hyperlinkURLDestinations.item(index).name, url: doc.hyperlinkURLDestinations.item(index).destinationURL });
  for (index = 0; index < doc.textVariables.length; index += 1) {
    var variable = doc.textVariables.item(index);
    if (variable.variableType === VariableTypes.CUSTOM_TEXT_TYPE) dump.variables.push({ name: variable.name, contents: variable.variableOptions.contents });
  }
  dump.info = { title: doc.metadataPreferences.documentTitle, author: doc.metadataPreferences.author };

  outputFile.encoding = "UTF-8";
  outputFile.open("w");
  outputFile.write(json(dump));
  outputFile.close();
  return "Dumped to " + outputFile.fsName;
}());
