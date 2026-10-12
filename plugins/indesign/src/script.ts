// The Scripts panel version (Text Scramble.idjs): one dialog with the panel's choices, one run,
// then a message with the same report the panel shows.

import { parseWordList } from "./keep-readable";
import { showMessage } from "./message-dialog";
import { host, paragraphStyleNames, scrambleDocument, type RunOptions } from "./operations";
import { matchStyleNames } from "./panel-settings";
import { emptyMessage, errorMessage, runSummaryLines, SCOPES, unknownStylesNote } from "./report-text";

const TITLE = "Text Scramble";
const FIELD_WIDTH = 360;

interface Choices {
  options: RunOptions;
  keepTyped: string[];
}

function read<T>(read: () => T, fallback: T): T {
  try {
    const value = read();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function askForOptions(app: any): Choices | null {
  // With nothing selected, Page is the useful starting point.
  const hasSelection = read(() => Number(app.selection.length) > 0, false);
  const dialog = app.dialogs.add({ name: TITLE, canCancel: true });
  try {
    const column = dialog.dialogColumns.add();
    column.staticTexts.add({ staticLabel: "Invented copy. Same composition." });

    const scopeColumn = column.borderPanels.add().dialogColumns.add();
    scopeColumn.staticTexts.add({ staticLabel: "Scramble" });
    const scopeControl = scopeColumn.dropdowns.add({
      stringList: SCOPES.map(({ title, copy }) => `${title} — ${copy}`),
      selectedIndex: hasSelection ? 0 : 1,
      minWidth: FIELD_WIDTH,
    });

    const optionsColumn = column.borderPanels.add().dialogColumns.add();
    const numbers = optionsColumn.checkboxControls.add({ staticLabel: "Scramble numbers", checkedState: true });
    const locked = optionsColumn.checkboxControls.add({ staticLabel: "Include locked items (locked frames still print)", checkedState: true });
    const hidden = optionsColumn.checkboxControls.add({
      staticLabel: "Include hidden items (they don't print, but stay in the file)",
      checkedState: false,
    });
    const cleanup = optionsColumn.checkboxControls.add({
      staticLabel: "Clean links and document info (links point at example.com)",
      checkedState: false,
    });

    const keepColumn = column.borderPanels.add().dialogColumns.add();
    keepColumn.staticTexts.add({ staticLabel: "Keep readable: paragraph styles to leave as they are, separated by commas" });
    const keepBox = keepColumn.textEditboxes.add({ editContents: "", minWidth: FIELD_WIDTH });
    keepColumn.staticTexts.add({ staticLabel: "Always scramble these words, even in kept styles, separated by commas" });
    const alwaysBox = keepColumn.textEditboxes.add({ editContents: "", minWidth: FIELD_WIDTH });

    const seedColumn = column.borderPanels.add().dialogColumns.add();
    seedColumn.staticTexts.add({ staticLabel: "Seed (optional): same seed, same words, every time" });
    const seedBox = seedColumn.textEditboxes.add({ editContents: "", minWidth: FIELD_WIDTH });

    if (!dialog.show()) return null;
    const keepTyped = parseWordList(String(keepBox.editContents ?? ""));
    return {
      keepTyped,
      options: {
        scope: SCOPES[Number(scopeControl.selectedIndex)]?.scope ?? "selection",
        scrambleNumbers: Boolean(numbers.checkedState),
        includeLocked: Boolean(locked.checkedState),
        includeHidden: Boolean(hidden.checkedState),
        cleanup: Boolean(cleanup.checkedState),
        keepStyles: keepTyped,
        alwaysScramble: parseWordList(String(alwaysBox.editContents ?? "")),
        seed: String(seedBox.editContents ?? "").trim(),
      },
    };
  } finally {
    dialog.destroy();
  }
}

function main(): void {
  const { app } = host();
  if (!read(() => Number(app.documents.length) > 0, false)) {
    showMessage(app, TITLE, [emptyMessage("no-document")]);
    return;
  }
  const choices = askForOptions(app);
  if (!choices) return;
  const { matched, unknown } = matchStyleNames(choices.keepTyped, paragraphStyleNames());
  const options: RunOptions = { ...choices.options, keepStyles: matched };
  let lines: string[];
  try {
    lines = runSummaryLines(scrambleDocument(options), options);
  } catch (error) {
    lines = [errorMessage(error)];
  }
  const note = unknownStylesNote(unknown);
  if (note) lines.push(note);
  showMessage(app, TITLE, lines);
}

try {
  main();
} catch (error) {
  try {
    showMessage(host().app, TITLE, [errorMessage(error)]);
  } catch {
    // Without a dialog there is nowhere left to report the problem.
  }
}
