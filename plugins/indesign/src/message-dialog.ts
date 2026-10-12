// A plain InDesign message dialog, used by the Scripts panel script and the panel's menu command.
// InDesign dialogs show one line per static text, so long lines are wrapped here.

import { wrapText } from "./report-text";

const MAX_LINES = 28;

export function showMessage(app: any, title: string, lines: readonly string[]): void {
  const wrapped = lines.flatMap((line) => wrapText(line, 72));
  const shown = wrapped.length > MAX_LINES ? [...wrapped.slice(0, MAX_LINES - 1), "…"] : wrapped;
  const dialog = app.dialogs.add({ name: title, canCancel: false });
  try {
    const column = dialog.dialogColumns.add();
    shown.forEach((line) => column.staticTexts.add({ staticLabel: line }));
    dialog.show();
  } finally {
    dialog.destroy();
  }
}
