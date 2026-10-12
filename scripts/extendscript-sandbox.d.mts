// Types for scripts/extendscript-sandbox.mjs, so the TypeScript tests can import it.
import type { Context } from "node:vm";

export interface HeadlessRunOptions {
  app: unknown;
  ScriptLanguage: unknown;
  UndoModes: unknown;
  VariableTypes?: unknown;
  /** Becomes $.global.TextScrambleTest. Must be JSON-like: it is copied into the sandbox. */
  settings?: object;
  /** Extra globals, for example an engine to run the script with. */
  globals?: Record<string, unknown>;
  filename?: string;
}

export function createExtendScriptContext(globals?: Record<string, unknown>): Context;
export function toContextValue(context: Context, value: unknown): any;
export function fromContextValue<T = any>(value: unknown): T;
export function stripDirectives(source: string): string;
export function extractSections(source: string, required?: readonly string[]): Record<string, string>;
export function runJsx(source: string, globals?: Record<string, unknown>, filename?: string): Context;
export function runJsxHeadless(source: string, options: HeadlessRunOptions): any;
export function es3Problems(source: string, options?: { skipSections?: readonly string[]; strictIndexOf?: boolean }): string[];
