// The panel's remembered options, and how they become a run's options.
//
// Stored as JSON in the panel's localStorage. Anything unreadable falls back to the defaults one
// field at a time, so a bad or older value never stops the panel from opening.

import { parseWordList } from "./keep-readable";
import type { RunOptions, Scope } from "./run";

export interface PanelSettings {
  scope: Scope;
  scrambleNumbers: boolean;
  includeLocked: boolean;
  includeHidden: boolean;
  cleanup: boolean;
  /** Paragraph style names to keep readable. Kept across documents, so a template family shares them. */
  keepStyles: string[];
  /** The "Always scramble these words" text, as typed. */
  alwaysScramble: string;
  /** As typed. Empty means random. */
  seed: string;
  /** Whether the Keep readable section is open. */
  keepOpen: boolean;
}

export const SETTINGS_KEY = "text-scramble.indesign.settings.v1";

export const DEFAULT_SETTINGS: Readonly<PanelSettings> = Object.freeze({
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

const SCOPES: readonly Scope[] = ["selection", "page", "document"];
const MAX_TEXT = 5000;
const MAX_STYLES = 500;

export function defaultSettings(): PanelSettings {
  return { ...DEFAULT_SETTINGS, keepStyles: [] };
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : fallback;
}

/** Reads stored settings. Unknown fields are ignored; bad fields fall back to their defaults. */
export function parseSettings(raw: string | null | undefined): PanelSettings {
  const settings = defaultSettings();
  if (typeof raw !== "string" || !raw) return settings;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return settings;
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return settings;
  const value = stored as Record<string, unknown>;
  if (typeof value.scope === "string" && (SCOPES as readonly string[]).includes(value.scope)) settings.scope = value.scope as Scope;
  settings.scrambleNumbers = flag(value.scrambleNumbers, settings.scrambleNumbers);
  settings.includeLocked = flag(value.includeLocked, settings.includeLocked);
  settings.includeHidden = flag(value.includeHidden, settings.includeHidden);
  settings.cleanup = flag(value.cleanup, settings.cleanup);
  settings.keepOpen = flag(value.keepOpen, settings.keepOpen);
  settings.alwaysScramble = text(value.alwaysScramble, settings.alwaysScramble);
  settings.seed = text(value.seed, settings.seed);
  if (Array.isArray(value.keepStyles)) {
    settings.keepStyles = Array.from(
      new Set(value.keepStyles.filter((name): name is string => typeof name === "string" && name.length > 0)),
    ).slice(0, MAX_STYLES);
  }
  return settings;
}

export function serializeSettings(settings: PanelSettings): string {
  return JSON.stringify(settings);
}

/** The run options for these settings. The menu command passes "selection" as the scope. */
export function toRunOptions(settings: PanelSettings, scope: Scope = settings.scope): RunOptions {
  return {
    scope,
    scrambleNumbers: settings.scrambleNumbers,
    includeLocked: settings.includeLocked,
    includeHidden: settings.includeHidden,
    cleanup: settings.cleanup,
    keepStyles: [...settings.keepStyles],
    alwaysScramble: parseWordList(settings.alwaysScramble),
    seed: settings.seed.trim(),
  };
}

/**
 * Lines typed style names up with the document's styles, ignoring case and extra spaces, so
 * "headline" keeps the style called "Headline". Names with no match come back as `unknown`.
 */
export function matchStyleNames(typed: readonly string[], available: readonly string[]): { matched: string[]; unknown: string[] } {
  const normalize = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
  const byName = new Map<string, string[]>();
  available.forEach((name) => {
    const key = normalize(name);
    byName.set(key, [...(byName.get(key) ?? []), name]);
  });
  const matched: string[] = [];
  const unknown: string[] = [];
  typed.forEach((name) => {
    const exact = available.includes(name) ? [name] : byName.get(normalize(name));
    if (exact?.length) exact.forEach((match) => matched.includes(match) || matched.push(match));
    else if (!unknown.includes(name)) unknown.push(name);
  });
  return { matched, unknown };
}
