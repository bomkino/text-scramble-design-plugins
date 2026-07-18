import { app, scrambleDocument, type Scope } from "./operations";

function showMessage(title: string, message: string): void {
  const dialog = app.dialogs.add({ name: title, canCancel: false });
  const column = dialog.dialogColumns.add();
  column.staticTexts.add({ staticLabel: message });
  dialog.show();
  dialog.destroy();
}

if (!app.documents || app.documents.length === 0) {
  showMessage("Text Scramble", "Open an InDesign document first.");
} else {
  const dialog = app.dialogs.add({ name: "Text Scramble — shape-matched draft copy", canCancel: true });
  const column = dialog.dialogColumns.add();
  column.staticTexts.add({ staticLabel: "Scramble selected text/frames or every text frame on the active page." });
  const scopeControl = column.dropdowns.add({ stringList: ["Selection", "Active page"], selectedIndex: 0 });
  const numbersControl = column.checkboxControls.add({ staticLabel: "Scramble numbers", checkedState: true });
  const accepted = dialog.show();
  const scope: Scope = scopeControl.selectedIndex === 1 ? "page" : "selection";
  const scrambleNumbers = numbersControl.checkedState;
  dialog.destroy();

  if (accepted) {
    const result = scrambleDocument(scope, scrambleNumbers);
    if (!result.targets) {
      showMessage("Text Scramble", scope === "selection" ? "Select text or one or more text frames." : "No editable text on the active page.");
    }
  }
}
