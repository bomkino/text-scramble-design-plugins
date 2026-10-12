// Binds a run to the real InDesign host. Everything else lives in run.ts so it can be tested.

import {
  inspectScope as inspectWithHost,
  paragraphStyleNames as paragraphStyleNamesWithHost,
  revealItem as revealWithHost,
  runScramble,
  type InDesignHost,
  type RunOptions,
  type ScopeSummary,
  type ScrambleReport,
} from "./run";

export type { EmptyReason, RunOptions, Scope, ScopeSummary, ScrambleReport } from "./run";
export { summarizePlaces } from "./overflow";

declare const require: (module: string) => any;

let cachedHost: InDesignHost | null = null;

export function host(): InDesignHost {
  if (!cachedHost) {
    const { app, ScriptLanguage, UndoModes, VariableTypes } = require("indesign");
    cachedHost = { app, ScriptLanguage, UndoModes, VariableTypes };
  }
  return cachedHost;
}

export function scrambleDocument(options: RunOptions): ScrambleReport {
  return runScramble(host(), options);
}

export function inspectScope(options: RunOptions): ScopeSummary {
  return inspectWithHost(host(), options);
}

export function paragraphStyleNames(): string[] {
  return paragraphStyleNamesWithHost(host());
}

export function revealItem(item: unknown): boolean {
  return revealWithHost(host(), item);
}
