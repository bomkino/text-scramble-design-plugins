// Runs the Scripts panel script (script.ts, built as Text Scramble.idjs) against the fake InDesign
// DOM, with the person's dialog answers scripted, and checks the run and the final message.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createInDesign, ScriptLanguage, UndoModes, VariableTypes, type Application } from "./fakes/indesign";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let bundled: Promise<string> | null = null;
function scriptSource(): Promise<string> {
  bundled ??= build({
    entryPoints: [path.join(root, "plugins", "indesign", "src", "script.ts")],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "neutral",
    target: "es2020",
    external: ["indesign", "uxp"],
  }).then((result) => result.outputFiles[0].text);
  return bundled;
}

interface Control {
  type: "staticText" | "dropdown" | "checkbox" | "textEditbox";
  label?: string;
  [property: string]: unknown;
}

/** The person's answers: change controls, then return false to cancel. */
type Answer = (controls: Control[]) => boolean;

function fakeDialogs(answers: Answer[], messages: string[][]) {
  const containers = (controls: Control[]): any => ({
    staticTexts: { add: (props: any) => controls.push({ type: "staticText", label: props.staticLabel }) },
    dropdowns: { add: (props: any) => pushed(controls, { type: "dropdown", ...props }) },
    checkboxControls: { add: (props: any) => pushed(controls, { type: "checkbox", label: props.staticLabel, ...props }) },
    textEditboxes: { add: (props: any) => pushed(controls, { type: "textEditbox", ...props }) },
    borderPanels: { add: () => ({ dialogColumns: { add: () => containers(controls) } }) },
    dialogRows: { add: () => containers(controls) },
  });
  const pushed = (controls: Control[], control: Control) => {
    controls.push(control);
    return control;
  };
  return {
    add: (props: { name: string; canCancel: boolean }) => {
      const controls: Control[] = [];
      let destroyed = false;
      return {
        dialogColumns: { add: () => containers(controls) },
        show: () => {
          assert.equal(destroyed, false);
          if (!props.canCancel) {
            messages.push(controls.map((control) => String(control.label)));
            return true;
          }
          const answer = answers.shift();
          assert.ok(answer, "The script asked more questions than expected.");
          return answer(controls);
        },
        destroy: () => {
          destroyed = true;
        },
      };
    },
  };
}

async function runScript(app: Application, answers: Answer[] = []): Promise<string[][]> {
  const messages: string[][] = [];
  (app as any).dialogs = fakeDialogs(answers, messages);
  const indesign = { app, ScriptLanguage, UndoModes, VariableTypes };
  const require = (name: string) => {
    if (name === "indesign") return indesign;
    throw new Error(`Unexpected module ${name}`);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", await scriptSource())(require, module, module.exports);
  return messages;
}

function control(controls: Control[], type: Control["type"], label?: RegExp, index = 0): Control {
  const matches = controls.filter((item) => item.type === type && (!label || label.test(String(item.label))));
  assert.ok(matches[index], `No ${type} control ${label ?? ""}`);
  return matches[index];
}

function sampleDocument() {
  const { app, document } = createInDesign();
  const headline = document.paragraphStyle("Headline");
  const body = document.paragraphStyle("Body Copy");
  const [page] = document.spread(["1"]).pages;
  app.activeWindow.activePage = page;
  const story = document.story([headline, "Brindlewick spring catalogue\r", body, "Fresh produce from local farms, delivered daily."]);
  document.frame(page, story);
  return { app, document, story, page };
}

test("asks to open a document first", async () => {
  const { app } = createInDesign();
  app.documentList.length = 0;
  assert.deepEqual(await runScript(app), [["Open a document to begin."]]);
});

test("cancelling the dialog changes nothing and says nothing", async () => {
  const { app, story } = sampleDocument();
  const before = story.contents;
  assert.deepEqual(await runScript(app, [() => false]), []);
  assert.equal(story.contents, before);
  assert.equal(app.doScriptCalls.length, 0);
});

test("offers the three scopes and every option, starting on Page when nothing is selected", async () => {
  const { app } = sampleDocument();
  let seen: Control[] = [];
  await runScript(app, [
    (controls) => {
      seen = controls;
      return false;
    },
  ]);
  const scope = control(seen, "dropdown");
  assert.deepEqual(scope.stringList, [
    "Selection — Text, frames or table cells",
    "Page — Every frame on this page, overset text included",
    "Document — Every story, table, footnote, parent page and bookmark",
  ]);
  assert.equal(scope.selectedIndex, 1);
  assert.deepEqual(
    seen.filter((item) => item.type === "checkbox").map((item) => [item.label, item.checkedState]),
    [
      ["Scramble numbers", true],
      ["Include locked items (locked frames still print)", true],
      ["Include hidden items (they don't print, but stay in the file)", false],
      ["Clean links and document info (links point at example.com)", false],
    ],
  );
  assert.equal(seen.filter((item) => item.type === "textEditbox").length, 3);
});

test("runs with the chosen options and reports in plain words", async () => {
  const { app, story } = sampleDocument();
  const messages = await runScript(app, [
    (controls) => {
      control(controls, "textEditbox", undefined, 0).editContents = "headline, Headlin";
      control(controls, "textEditbox", undefined, 1).editContents = "Brindlewick";
      control(controls, "textEditbox", undefined, 2).editContents = " 7 ";
      return true;
    },
  ]);
  assert.equal(app.doScriptCalls.length, 1);
  assert.match(story.contents, /^\S+ spring catalogue\r/);
  assert.ok(!story.contents.startsWith("Brindlewick"));
  assert.ok(!story.contents.includes("Fresh produce"));
  assert.equal(messages.length, 1);
  const message = messages[0].join(" ");
  assert.match(messages[0][0], /^Done — [\d,]+ characters in 1 frame\.$/);
  assert.match(message, /1 paragraph kept readable\./);
  assert.match(message, /no paragraph style called “Headlin”/);
  assert.match(message, /Edit > Undo Text Scramble/);
  // Long lines are wrapped for the dialog.
  assert.ok(messages[0].every((line) => line.length <= 72));
});

test("the same seed gives the same words", async () => {
  const outputs: string[] = [];
  for (let run = 0; run < 2; run++) {
    const { app, story } = sampleDocument();
    await runScript(app, [
      (controls) => {
        control(controls, "textEditbox", undefined, 2).editContents = "spring-issue";
        return true;
      },
    ]);
    outputs.push(story.contents);
  }
  assert.equal(outputs[0], outputs[1]);
});

test("an empty selection gets the friendly message", async () => {
  const { app } = sampleDocument();
  const messages = await runScript(app, [
    (controls) => {
      control(controls, "dropdown").selectedIndex = 0;
      return true;
    },
  ]);
  assert.deepEqual(messages, [["Select text, frames or table cells — or switch to Page or Document."]]);
});

test("exceptions end in a friendly message", async () => {
  const { app } = sampleDocument();
  (app as any).doScript = () => {
    throw new Error("InDesign is busy");
  };
  const messages = await runScript(app, [() => true]);
  assert.equal(messages.length, 1);
  assert.match(messages[0].join(" "), /^Something went wrong: InDesign is busy\. If anything changed, Edit > Undo Text Scramble puts it back\.$/);
});
