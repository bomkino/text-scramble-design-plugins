import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  defaultSettings,
  matchStyleNames,
  parseSettings,
  serializeSettings,
  toRunOptions,
} from "../plugins/indesign/src/panel-settings";

test("starts from the documented defaults", () => {
  assert.deepEqual(parseSettings(null), {
    scope: "selection",
    scrambleNumbers: true,
    includeLocked: true,
    includeHidden: false,
    cleanup: false,
    keepStyles: [],
    alwaysScramble: "",
    seed: "",
    keepOpen: false,
  });
  assert.deepEqual(parseSettings(""), defaultSettings());
  // Each call gets its own list, so the panel never edits the defaults.
  const settings = defaultSettings();
  settings.keepStyles.push("Headline");
  assert.deepEqual(DEFAULT_SETTINGS.keepStyles, []);
});

test("remembers every option through a round trip", () => {
  const settings = {
    scope: "document" as const,
    scrambleNumbers: false,
    includeLocked: false,
    includeHidden: true,
    cleanup: true,
    keepStyles: ["Headline", "Caption"],
    alwaysScramble: "Northwind, Ada Lovelace",
    seed: "spring-issue",
    keepOpen: true,
  };
  assert.deepEqual(parseSettings(serializeSettings(settings)), settings);
});

test("ignores bad stored data, field by field", () => {
  for (const raw of ["{", "null", "[]", "42", '"text"', "true"]) assert.deepEqual(parseSettings(raw), defaultSettings(), raw);
  const parsed = parseSettings(
    JSON.stringify({
      scope: "spread",
      scrambleNumbers: "yes",
      includeLocked: false,
      includeHidden: 1,
      keepStyles: ["Headline", 7, "", null, "Headline", "Body"],
      alwaysScramble: ["Northwind"],
      seed: 42,
      unknown: "ignored",
    }),
  );
  assert.equal(parsed.scope, "selection");
  assert.equal(parsed.scrambleNumbers, true);
  assert.equal(parsed.includeLocked, false);
  assert.equal(parsed.includeHidden, false);
  assert.deepEqual(parsed.keepStyles, ["Headline", "Body"]);
  assert.equal(parsed.alwaysScramble, "");
  assert.equal(parsed.seed, "");
  assert.ok(!("unknown" in parsed));
});

test("turns settings into run options", () => {
  const settings = {
    ...defaultSettings(),
    scope: "page" as const,
    keepStyles: ["Headline"],
    alwaysScramble: "Northwind,  Ada   Lovelace\nNorthwind; Contoso",
    seed: "  42  ",
    cleanup: true,
  };
  assert.deepEqual(toRunOptions(settings), {
    scope: "page",
    scrambleNumbers: true,
    includeLocked: true,
    includeHidden: false,
    cleanup: true,
    keepStyles: ["Headline"],
    alwaysScramble: ["Northwind", "Ada Lovelace", "Contoso"],
    seed: "42",
  });
  // The menu command always scrambles the selection, with the remembered options.
  assert.equal(toRunOptions(settings, "selection").scope, "selection");
  // An empty seed means random.
  assert.equal(toRunOptions(defaultSettings()).seed, "");
});

test("lines typed style names up with the document's styles", () => {
  const available = ["[Basic Paragraph]", "Headline", "Body Copy", "Caption"];
  assert.deepEqual(matchStyleNames(["headline", " body   copy ", "Caption", "Headlin", "Headlin"], available), {
    matched: ["Headline", "Body Copy", "Caption"],
    unknown: ["Headlin"],
  });
  assert.deepEqual(matchStyleNames([], available), { matched: [], unknown: [] });
  // An exact match wins over a case-insensitive one.
  assert.deepEqual(matchStyleNames(["Note"], ["note", "Note"]).matched, ["Note"]);
});
