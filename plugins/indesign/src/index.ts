import { inspectScope, scrambleDocument, type Scope } from "./operations";

declare const require: (module: string) => any;
const { entrypoints } = require("uxp");

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function currentScope(): Scope {
  return byId<HTMLInputElement>("page")?.checked ? "page" : "selection";
}

function setStatus(message: string, kind = ""): void {
  const status = byId<HTMLElement>("status");
  if (!status) return;
  status.textContent = message;
  status.className = `status visible ${kind}`;
}

function refreshScope(): void {
  const summaryCopy = byId<HTMLElement>("summary-copy");
  const summaryCount = byId<HTMLElement>("summary-count");
  if (!summaryCopy || !summaryCount) return;
  try {
    const summary = inspectScope(currentScope());
    summaryCopy.textContent = summary.targets ? `${summary.characters.toLocaleString()} characters ready` : "No eligible text yet";
    summaryCount.textContent = `${summary.targets} ${summary.targets === 1 ? "frame" : "frames"}`;
  } catch (error) {
    summaryCopy.textContent = "Open a document to begin";
    summaryCount.textContent = "—";
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

function bindPanel(): void {
  const button = byId<HTMLButtonElement>("scramble");
  if (!button || button.dataset.bound === "true") return;
  button.dataset.bound = "true";

  document.querySelectorAll<HTMLInputElement>('input[name="scope"]').forEach((input) => input.addEventListener("change", refreshScope));
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Shaping fresh language…";
    setStatus("Reading character styles and preparing one clean undo step…");
    try {
      const result = scrambleDocument(currentScope(), byId<HTMLInputElement>("numbers")?.checked !== false);
      if (!result.targets) {
        setStatus(currentScope() === "selection" ? "Select text or one or more text frames." : "No editable text on the active page.", "error");
      } else {
        const skipped = result.skipped ? ` · ${result.skipped} skipped` : "";
        setStatus(`Done — ${result.targets} ${result.targets === 1 ? "frame" : "frames"}, ${result.characters.toLocaleString()} characters${skipped}.`, "success");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      button.disabled = false;
      button.textContent = "Scramble with soul";
      refreshScope();
    }
  });
  refreshScope();
}

entrypoints.setup({
  commands: { scrambleSelection: () => scrambleDocument("selection", true) },
  panels: {
    textScramblePanel: {
      create() { bindPanel(); },
      show() { bindPanel(); refreshScope(); },
    },
  },
});

document.addEventListener("DOMContentLoaded", bindPanel);
