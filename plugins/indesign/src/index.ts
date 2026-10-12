// The Text Scramble panel and its Scramble Selection menu command.
//
// Choose a scope and options, see what the scope holds, run, then read what changed. UXP is not a
// browser, so this sticks to plain DOM calls (getElementById, createElement, className,
// textContent, addEventListener), and every InDesign call is guarded.

import { showMessage } from "./message-dialog";
import {
  host,
  inspectScope,
  paragraphStyleNames,
  revealItem,
  scrambleDocument,
  type RunOptions,
  type Scope,
  type ScopeSummary,
  type ScrambleReport,
} from "./operations";
import { defaultSettings, parseSettings, serializeSettings, SETTINGS_KEY, toRunOptions, type PanelSettings } from "./panel-settings";
import {
  describeRun,
  describeScope,
  describeScopeSkips,
  errorMessage,
  inspectErrorMessage,
  overflowItemLabel,
  runSummaryLines,
  type OverflowSummary,
  type ReportOptions,
} from "./report-text";

declare const require: (module: string) => any;
const { entrypoints } = require("uxp");

const TITLE = "Text Scramble";
const BUTTON_LABEL = "Scramble with soul";
const WORKING_LABEL = "Shaping fresh language…";
const REFRESH_DELAY = 250;
const MAX_OVERFLOW_ROWS = 20;
const SCOPE_VALUES: readonly Scope[] = ["selection", "page", "document"];

let settings: PanelSettings = loadSettings();
let bound = false;
let listening = false;
let running = false;
/** Bumped by every refresh request and every run, so a refresh that finishes late is dropped. */
let generation = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let panelShown = true;
/** An InDesign event arrived while the panel was hidden. */
let dirty = false;
let stylesDirty = true;
let stylesDrawn = false;
let stylesDrawnOpen = false;
let documentOpen = true;
let styleNames: string[] = [];
const inDesignListeners: unknown[] = [];

// Small DOM helpers that only use what UXP supports.

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setClass(element: Element | null, name: string, on: boolean): void {
  if (!element) return;
  const classes = String(element.className || "")
    .split(/\s+/)
    .filter((value) => value && value !== name);
  if (on) classes.push(name);
  element.className = classes.join(" ");
}

function clear(element: Element): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function make(tag: string, className: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// Remembered options. localStorage can be missing or throw; the panel works without it.

function loadSettings(): PanelSettings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return defaultSettings();
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, serializeSettings(settings));
  } catch {
    // Remembering options is a convenience. The run never depends on it.
  }
}

function setChecked(id: string, checked: boolean): void {
  const input = byId<HTMLInputElement>(id);
  if (input) input.checked = checked;
}

function setValue(id: string, value: string): void {
  const input = byId<HTMLInputElement | HTMLTextAreaElement>(id);
  if (input) input.value = value;
}

function showScope(scope: Scope): void {
  SCOPE_VALUES.forEach((value) => {
    setChecked(`scope-${value}`, value === scope);
    setClass(byId(`scope-row-${value}`), "is-selected", value === scope);
  });
}

function showKeepOpen(): void {
  setClass(byId("keep"), "is-open", settings.keepOpen);
  byId("keep-toggle")?.setAttribute("aria-expanded", settings.keepOpen ? "true" : "false");
}

function showKeepSummary(): void {
  const summary = byId("keep-summary");
  if (!summary) return;
  // With a document open, count only the remembered styles this document has.
  const kept = documentOpen && styleNames.length
    ? settings.keepStyles.filter((name) => styleNames.indexOf(name) >= 0).length
    : settings.keepStyles.length;
  summary.textContent = kept ? `Keeping ${kept} ${kept === 1 ? "style" : "styles"} readable.` : "Leave chosen paragraph styles as they are.";
}

function showSettings(): void {
  showScope(settings.scope);
  setChecked("numbers", settings.scrambleNumbers);
  setChecked("locked", settings.includeLocked);
  setChecked("hidden", settings.includeHidden);
  setChecked("cleanup", settings.cleanup);
  setValue("always", settings.alwaysScramble);
  setValue("seed", settings.seed);
  showKeepOpen();
  showKeepSummary();
}

// The live summary under the scope.

function scheduleRefresh(delay = REFRESH_DELAY): void {
  generation++;
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshNow();
  }, delay);
}

/** For InDesign events: refresh now if the panel is showing, otherwise when it shows again. */
function requestRefresh(): void {
  if (panelShown) scheduleRefresh();
  else dirty = true;
}

function refreshNow(): void {
  // A run refreshes the panel itself when it ends.
  if (running || !bound) return;
  dirty = false;
  const ticket = ++generation;
  if (stylesDirty) renderStyles();
  const options = toRunOptions(settings);
  Promise.resolve()
    .then(() => inspectScope(options))
    .then(
      (summary) => {
        if (ticket === generation && !running) showSummary(summary, options);
      },
      (error) => {
        if (ticket === generation && !running) showSummaryError(error);
      },
    );
}

function updateButton(): void {
  const button = byId<HTMLButtonElement>("scramble");
  if (!button) return;
  button.disabled = running || !documentOpen;
  button.textContent = running ? WORKING_LABEL : BUTTON_LABEL;
}

function showSummary(summary: ScopeSummary, options: RunOptions): void {
  const wasOpen = documentOpen;
  documentOpen = summary.empty !== "no-document";
  const copy = byId("summary-copy");
  const skips = byId("summary-skips");
  if (copy) copy.textContent = describeScope(summary, options);
  if (skips) {
    clear(skips);
    describeScopeSkips(summary).forEach((line) => skips.appendChild(make("span", "summary-skip", line)));
  }
  setClass(byId("summary"), "is-empty", summary.empty !== null);
  updateButton();
  if (wasOpen !== documentOpen) renderStyles();
}

function showSummaryError(error: unknown): void {
  const copy = byId("summary-copy");
  const skips = byId("summary-skips");
  if (copy) copy.textContent = inspectErrorMessage(error);
  if (skips) clear(skips);
  setClass(byId("summary"), "is-empty", true);
  updateButton();
}

// Keep readable: one checkbox per paragraph style in the active document.

function hasDocument(): boolean {
  try {
    return Number(host().app.documents.length) > 0;
  } catch {
    return false;
  }
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

function renderStyles(): void {
  stylesDirty = false;
  const open = hasDocument();
  let names: string[] = [];
  try {
    names = open ? paragraphStyleNames() : [];
  } catch {
    names = [];
  }
  const list = byId("style-list");
  // Redrawing an unchanged list would only lose its scroll position.
  const unchanged = stylesDrawn && stylesDrawnOpen === open && sameNames(names, styleNames);
  styleNames = names;
  stylesDrawn = true;
  stylesDrawnOpen = open;
  if (list && !unchanged) {
    clear(list);
    if (!names.length) {
      list.appendChild(make("span", "list-empty", open ? "This document has no paragraph styles yet." : "Open a document to choose styles."));
    }
    names.forEach((name) => {
      const row = make("label", "style-row");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = settings.keepStyles.indexOf(name) >= 0;
      input.addEventListener("change", () => {
        const others = settings.keepStyles.filter((kept) => kept !== name);
        settings.keepStyles = input.checked ? [...others, name] : others;
        saveSettings();
        showKeepSummary();
      });
      row.appendChild(input);
      row.appendChild(make("span", "style-name", name));
      list.appendChild(row);
    });
  }
  showKeepSummary();
}

function toggleKeep(): void {
  settings.keepOpen = !settings.keepOpen;
  showKeepOpen();
  saveSettings();
  // Styles may have been added since the list was drawn.
  if (settings.keepOpen) renderStyles();
}

// The run and its report.

function bringIntoView(element: HTMLElement): void {
  try {
    const rect = element.getBoundingClientRect();
    const height = window.innerHeight || document.documentElement.clientHeight;
    // Show the whole report if it fits, otherwise its first line.
    if (height && rect.bottom > height && typeof element.scrollIntoView === "function") element.scrollIntoView(rect.height > height);
  } catch {
    // Scrolling is a nicety; the report is there either way.
  }
}

function reportBox(tone: string): HTMLElement | null {
  const box = byId("report");
  if (!box) return null;
  clear(box);
  box.className = `report visible ${tone}`;
  return box;
}

function addGroup(box: HTMLElement, lines: readonly string[], className = ""): void {
  if (!lines.length) return;
  const group = make("div", `report-group ${className}`.trim());
  lines.forEach((line) => group.appendChild(make("div", "report-line", line)));
  box.appendChild(group);
}

function overflowGroup(overflow: OverflowSummary): HTMLElement {
  const group = make("div", "report-group");
  group.appendChild(make("div", "report-line report-strong", `${overflow.headline}.`));
  group.appendChild(make("div", "report-line", overflow.advice));
  if (overflow.earlier) group.appendChild(make("div", "report-line", overflow.earlier));
  overflow.items.slice(0, MAX_OVERFLOW_ROWS).forEach((item) => {
    const row = make("div", "overflow-row");
    const label = make("span", "overflow-label", overflowItemLabel(item));
    const button = make("button", "show", "Show") as HTMLButtonElement;
    button.setAttribute("type", "button");
    button.addEventListener("click", () => {
      if (running) return;
      let shown = false;
      try {
        shown = revealItem(item.item);
      } catch {
        shown = false;
      }
      if (!shown) {
        label.textContent = "Couldn't find it. It may have moved or been deleted.";
        button.disabled = true;
      }
    });
    row.appendChild(label);
    row.appendChild(button);
    group.appendChild(row);
  });
  if (overflow.items.length > MAX_OVERFLOW_ROWS) {
    group.appendChild(make("div", "report-line", `…and ${overflow.items.length - MAX_OVERFLOW_ROWS} more.`));
  }
  return group;
}

function showWorking(scope: Scope): void {
  const box = reportBox("working");
  if (!box) return;
  box.appendChild(make("div", "report-headline", "Reading character styles and preparing one clean undo step…"));
  if (scope === "document") box.appendChild(make("div", "report-line", "Long documents can take a moment."));
}

function showReport(report: ScrambleReport, options: ReportOptions): void {
  const summary = describeRun(report, options);
  const box = reportBox(summary.tone);
  if (!box) return;
  box.appendChild(make("div", "report-headline", summary.headline));
  summary.details.forEach((line) => box.appendChild(make("div", "report-line", line)));
  addGroup(box, summary.skipped);
  if (summary.overflow) box.appendChild(overflowGroup(summary.overflow));
  addGroup(box, summary.errors);
  addGroup(box, summary.notes);
  if (summary.undo) box.appendChild(make("div", "report-undo", summary.undo));
  bringIntoView(box);
}

function showFailure(error: unknown): void {
  const box = reportBox("error");
  if (!box) return;
  box.appendChild(make("div", "report-headline", errorMessage(error)));
  bringIntoView(box);
}

function stopRefreshing(): void {
  generation++;
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
}

/** Reads the controls once more before a run, in case a change event never arrived. */
function readForm(): void {
  if (!bound) return;
  const checked = (id: string, fallback: boolean) => {
    const input = byId<HTMLInputElement>(id);
    return input ? input.checked === true : fallback;
  };
  const value = (id: string, fallback: string) => {
    const input = byId<HTMLInputElement | HTMLTextAreaElement>(id);
    return input ? String(input.value ?? "") : fallback;
  };
  settings.scrambleNumbers = checked("numbers", settings.scrambleNumbers);
  settings.includeLocked = checked("locked", settings.includeLocked);
  settings.includeHidden = checked("hidden", settings.includeHidden);
  settings.cleanup = checked("cleanup", settings.cleanup);
  settings.alwaysScramble = value("always", settings.alwaysScramble);
  settings.seed = value("seed", settings.seed);
  saveSettings();
}

function startRun(): void {
  if (running || !documentOpen) return;
  readForm();
  const options = toRunOptions(settings);
  running = true;
  stopRefreshing();
  updateButton();
  showWorking(options.scope);
  // Give the panel a moment to paint the working state before InDesign gets busy.
  setTimeout(() => {
    let report: ScrambleReport | null = null;
    let failure: unknown = null;
    try {
      report = scrambleDocument(options);
    } catch (error) {
      failure = error;
    }
    running = false;
    updateButton();
    if (report) showReport(report, options);
    else showFailure(failure);
    scheduleRefresh(0);
  }, 40);
}

/** The Scramble Selection menu command: the Selection scope with the remembered options. */
function scrambleSelectionCommand(): void {
  if (running) return;
  readForm();
  const options = toRunOptions(settings, "selection");
  const reportOptions: ReportOptions = { ...options, fromMenu: true };
  running = true;
  stopRefreshing();
  let report: ScrambleReport | null = null;
  let failure: unknown = null;
  try {
    report = scrambleDocument(options);
  } catch (error) {
    failure = error;
  } finally {
    running = false;
  }
  if (bound) {
    if (report) showReport(report, reportOptions);
    else showFailure(failure);
    scheduleRefresh(0);
  }
  // The panel may be closed, so say anything that needs attention in a dialog too.
  const lines = report ? runSummaryLines(report, reportOptions) : [errorMessage(failure)];
  if (!report || report.empty || report.errors.length || report.overflow.overflowing.length) {
    try {
      showMessage(host().app, TITLE, lines);
    } catch {
      // The panel shows the same report.
    }
  }
}

// Live refresh from InDesign.

function listenToInDesign(): void {
  if (listening) return;
  listening = true;
  let app: any;
  try {
    app = host().app;
  } catch {
    return;
  }
  const on = (name: string, handler: () => void) => {
    try {
      if (typeof app.addEventListener === "function") {
        inDesignListeners.push(app.addEventListener(name, handler));
        return;
      }
    } catch {
      // Try the older collection below.
    }
    try {
      inDesignListeners.push(app.eventListeners.add(name, handler));
    } catch {
      // No live refresh: showing the panel and changing options still refresh it.
    }
  };
  on("afterSelectionChanged", () => {
    if (settings.scope === "selection") requestRefresh();
  });
  on("afterContextChanged", () => {
    stylesDirty = true;
    requestRefresh();
  });
}

function chooseScope(scope: Scope): void {
  const changed = settings.scope !== scope;
  settings.scope = scope;
  showScope(scope);
  if (!changed) return;
  saveSettings();
  scheduleRefresh();
}

function bindCheckbox(id: string, apply: (checked: boolean) => void, refresh: boolean): void {
  const input = byId<HTMLInputElement>(id);
  if (!input) return;
  input.addEventListener("change", () => {
    apply(input.checked === true);
    saveSettings();
    if (refresh) scheduleRefresh();
  });
}

function bindText(id: string, apply: (value: string) => void): void {
  const input = byId<HTMLInputElement | HTMLTextAreaElement>(id);
  if (!input) return;
  const update = () => {
    apply(String(input.value ?? ""));
    saveSettings();
  };
  input.addEventListener("input", update);
  input.addEventListener("change", update);
}

function bindPanel(): void {
  if (bound) return;
  const button = byId<HTMLButtonElement>("scramble");
  if (!button) return;
  bound = true;
  showSettings();

  SCOPE_VALUES.forEach((scope) => {
    byId(`scope-row-${scope}`)?.addEventListener("click", () => chooseScope(scope));
    const input = byId<HTMLInputElement>(`scope-${scope}`);
    input?.addEventListener("change", () => {
      if (input.checked) chooseScope(scope);
    });
  });
  bindCheckbox("numbers", (checked) => (settings.scrambleNumbers = checked), true);
  bindCheckbox("locked", (checked) => (settings.includeLocked = checked), true);
  bindCheckbox("hidden", (checked) => (settings.includeHidden = checked), true);
  bindCheckbox("cleanup", (checked) => (settings.cleanup = checked), false);
  bindText("always", (value) => (settings.alwaysScramble = value));
  bindText("seed", (value) => (settings.seed = value));

  const toggle = byId("keep-toggle");
  toggle?.addEventListener("click", toggleKeep);
  toggle?.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== "Enter" && key !== " ") return;
    event.preventDefault();
    toggleKeep();
  });

  button.addEventListener("click", startRun);
  // InDesign has no event for turning pages, so a Page summary catches up when the pointer comes back.
  document.body?.addEventListener("mouseenter", () => {
    panelShown = true;
    if (dirty || settings.scope === "page" || !documentOpen) scheduleRefresh();
  });

  listenToInDesign();
  stylesDirty = true;
  scheduleRefresh(0);
}

entrypoints.setup({
  commands: {
    scrambleSelection: () => scrambleSelectionCommand(),
  },
  panels: {
    textScramblePanel: {
      create() {
        bindPanel();
      },
      show() {
        panelShown = true;
        bindPanel();
        stylesDirty = true;
        scheduleRefresh(0);
      },
      hide() {
        panelShown = false;
      },
    },
  },
});

document.addEventListener("DOMContentLoaded", bindPanel);
bindPanel();
