// A Node `vm` context that behaves like ExtendScript, the ES3 engine behind InDesign's classic
// Scripts panel, so the JSX can be run and tested on any OS without InDesign.
//
// ExtendScript differs from Node in ways that silently break scripts:
// - Object.prototype carries watch, unwatch, toSource and reflect, so `obj[word]` finds them.
// - ES5 and later builtins are missing: Array.prototype.forEach/map/indexOf…, Object.keys, JSON,
//   String.prototype.trim, Function.prototype.bind, Date.now, Math.imul, Map, Set and the rest.
// - `$.global` is the global object.
// The context below reproduces all three. Objects passed in from Node (such as a fake InDesign DOM)
// keep Node's builtins, so the sandbox cannot catch ES5 calls made on them; es3Problems() lints the
// source for exactly those calls instead.

import vm from "node:vm";
import { parse } from "acorn";

const REMOVED = {
  "Array.prototype": [
    "indexOf", "lastIndexOf", "forEach", "map", "filter", "some", "every", "reduce", "reduceRight",
    "find", "findIndex", "findLast", "findLastIndex", "includes", "fill", "flat", "flatMap", "copyWithin",
    "entries", "keys", "values", "at", "toSorted", "toReversed", "toSpliced", "with",
  ],
  Array: ["isArray", "from", "of"],
  Object: [
    "keys", "values", "entries", "fromEntries", "assign", "create", "defineProperty", "defineProperties",
    "getOwnPropertyNames", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getOwnPropertySymbols",
    "getPrototypeOf", "setPrototypeOf", "freeze", "isFrozen", "seal", "isSealed", "preventExtensions",
    "isExtensible", "is", "groupBy", "hasOwn",
  ],
  "String.prototype": [
    "trim", "trimStart", "trimEnd", "trimLeft", "trimRight", "includes", "startsWith", "endsWith", "repeat",
    "padStart", "padEnd", "codePointAt", "normalize", "at", "replaceAll", "matchAll", "isWellFormed", "toWellFormed",
  ],
  String: ["fromCodePoint", "raw"],
  "Function.prototype": ["bind"],
  Date: ["now"],
  "Date.prototype": ["toISOString", "toJSON"],
  Math: ["imul", "sign", "trunc", "cbrt", "hypot", "log2", "log10", "log1p", "expm1", "fround", "clz32", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh"],
  Number: ["isFinite", "isNaN", "isInteger", "isSafeInteger", "parseFloat", "parseInt", "EPSILON", "MAX_SAFE_INTEGER", "MIN_SAFE_INTEGER"],
  global: [
    "JSON", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "Symbol", "Promise", "Proxy",
    "Reflect", "BigInt", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics", "Int8Array", "Uint8Array",
    "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
    "BigInt64Array", "BigUint64Array", "AggregateError", "Intl", "WebAssembly", "Iterator", "globalThis",
  ],
};

const PRELUDE = `(function (global, removed) {
  var owners = {
    "Array.prototype": Array.prototype, Array: Array, Object: Object, "String.prototype": String.prototype,
    String: String, "Function.prototype": Function.prototype, Date: Date, "Date.prototype": Date.prototype,
    Math: Math, Number: Number, global: global
  };
  var hasOwn = Object.prototype.hasOwnProperty;
  Object.prototype.watch = function () {};
  Object.prototype.unwatch = function () {};
  Object.prototype.toSource = function () { return "({})"; };
  Object.prototype.reflect = {};
  global.$ = { global: global };
  for (var owner in removed) {
    if (!hasOwn.call(removed, owner) || !hasOwn.call(owners, owner)) continue;
    var names = removed[owner];
    for (var index = 0; index < names.length; index += 1) delete owners[owner][names[index]];
  }
})(this, __removed__);`;

/**
 * A fresh `vm` context that mimics ExtendScript. `globals` become globals inside it (for example
 * `app`, `ScriptLanguage`, `UndoModes`, `alert`).
 */
export function createExtendScriptContext(globals = {}) {
  const context = vm.createContext({});
  // Build the list inside the context so the prelude only touches sandbox objects.
  const removed = vm.runInContext(`(${JSON.stringify(REMOVED)})`, context);
  context.__removed__ = removed;
  vm.runInContext(PRELUDE, context, { filename: "extendscript-prelude.js" });
  delete context.__removed__;
  for (const [name, value] of Object.entries(globals)) context[name] = value;
  return context;
}

/** Copies JSON-like data (settings) into the context, so ES5 calls on its arrays fail as they would in ExtendScript. */
export function toContextValue(context, value) {
  if (value === undefined) return undefined;
  return vm.runInContext(`(${JSON.stringify(value)})`, context);
}

/** Copies a value out of the context as plain Node data, so node:assert compares it like any other object. */
export function fromContextValue(value) {
  return value === undefined || value === null ? value : JSON.parse(JSON.stringify(value));
}

/** Strips ExtendScript preprocessor lines such as `#target "InDesign"`, which are not JavaScript. */
// ExtendScript reads a line comment that starts with @ (//@include, //@target, // @anything) as a
// preprocessor directive, and stops the whole script with "Syntax error" on one it doesn't know.
const DIRECTIVE_COMMENT = /^\s*\/\/\s*@/;

/** 1-based numbers of the lines ExtendScript would read as preprocessor directives. */
export function directiveCommentLines(source) {
  return source.split(/\r\n|\r|\n/).flatMap((line, index) => (DIRECTIVE_COMMENT.test(line) ? [index + 1] : []));
}

/**
 * Drops the #target line, as ExtendScript does. Throws like ExtendScript on a `// @` line, so no test
 * can pass with a script that would not load in InDesign.
 */
export function stripDirectives(source) {
  const lines = directiveCommentLines(source);
  if (lines.length) throw new SyntaxError(`ExtendScript reads line ${lines.join(", ")} as an unknown preprocessor directive ("// @").`);
  return source.replace(/^#target.*$/gm, "");
}

const SECTION = /\/\/ \[([\w-]+):start\]\n([\s\S]*?)\/\/ \[\1:end\]/g;

/** Every `// [name:start]` … `// [name:end]` section of a source, by name. */
export function extractSections(source, required = []) {
  const sections = {};
  for (const match of source.matchAll(SECTION)) sections[match[1]] = match[2];
  for (const name of required) {
    if (!(name in sections)) throw new Error(`The script is missing its [${name}:start] … [${name}:end] section.`);
  }
  return sections;
}

/** Runs a whole JSX source in an ExtendScript context with the given globals. Returns the context. */
export function runJsx(source, globals = {}, filename = "Text Scramble.jsx") {
  const context = createExtendScriptContext(globals);
  vm.runInContext(stripDirectives(source), context, { filename });
  return context;
}

/**
 * Runs a whole JSX source headlessly: `$.global.TextScrambleTest` is set to `settings`, so the script
 * skips its dialog and alerts and leaves its report in `$.global.TextScrambleResult`, which is
 * returned as plain Node data. Any alert() during the run throws.
 */
export function runJsxHeadless(source, { app, ScriptLanguage, UndoModes, VariableTypes, settings = {}, globals = {}, filename } = {}) {
  const context = createExtendScriptContext({ app, ScriptLanguage, UndoModes, VariableTypes, ...globals });
  context.alert = (message) => {
    throw new Error(`alert() was called during a headless run: ${message}`);
  };
  context.__settings__ = toContextValue(context, settings);
  vm.runInContext("$.global.TextScrambleTest = __settings__; delete $.global.__settings__;", context);
  vm.runInContext(stripDirectives(source), context, { filename: filename ?? "Text Scramble.jsx" });
  return fromContextValue(vm.runInContext("$.global.TextScrambleResult", context));
}

const ES5_METHODS = new Set([
  "forEach", "map", "filter", "some", "every", "reduce", "reduceRight", "find", "findIndex", "findLast",
  "findLastIndex", "includes", "fill", "flat", "flatMap", "trim", "trimStart", "trimEnd", "trimLeft",
  "trimRight", "startsWith", "endsWith", "repeat", "padStart", "padEnd", "codePointAt", "normalize", "bind",
  "replaceAll", "matchAll",
]);
const ES5_STATICS = {
  Object: new Set(REMOVED.Object),
  Array: new Set(REMOVED.Array),
  String: new Set(REMOVED.String),
  Number: new Set(REMOVED.Number),
  Date: new Set(REMOVED.Date),
  Math: new Set(REMOVED.Math),
};
const ES5_GLOBALS = new Set(REMOVED.global);

/**
 * Lints a JSX source for ES5+ calls that the sandbox cannot catch at run time (calls on arrays that
 * come from the host, such as InDesign collections). Code inside the named sections is skipped, so
 * the engine can be left to its own checks. With `strictIndexOf`, any .indexOf/.lastIndexOf call
 * outside those sections is reported too, since an array from InDesign has neither in ExtendScript.
 * Returns a list of problems; empty means clean. Throws when the source is not valid ES3.
 */
export function es3Problems(source, { skipSections = [], strictIndexOf = false } = {}) {
  const code = stripDirectives(source);
  const ast = parse(code, { ecmaVersion: 3, allowReserved: "never", locations: true });
  const skipped = [];
  for (const name of skipSections) {
    const start = code.indexOf(`// [${name}:start]`);
    const end = code.indexOf(`// [${name}:end]`);
    if (start >= 0 && end > start) skipped.push([start, end]);
  }
  const problems = [];
  const report = (node, message) => problems.push(`line ${node.loc.start.line}: ${message}`);
  const inSkipped = (node) => skipped.some(([start, end]) => node.start >= start && node.end <= end);

  const visit = (node, parent, key) => {
    if (!node || typeof node.type !== "string") return;
    if (inSkipped(node)) return;
    if (node.type === "CallExpression" && node.callee.type === "MemberExpression" && !node.callee.computed) {
      const name = node.callee.property.name;
      if (ES5_METHODS.has(name)) report(node, `.${name}() is not in ExtendScript`);
      if (strictIndexOf && (name === "indexOf" || name === "lastIndexOf")) report(node, `.${name}() may run on an InDesign array, which lacks it in ExtendScript`);
    }
    if (node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier") {
      const statics = ES5_STATICS[node.object.name];
      if (statics && statics.has(node.property.name)) report(node, `${node.object.name}.${node.property.name} is not in ExtendScript`);
    }
    if (node.type === "Identifier" && ES5_GLOBALS.has(node.name)) {
      const isPropertyName = (parent?.type === "MemberExpression" && key === "property" && !parent.computed) || (parent?.type === "Property" && key === "key");
      if (!isPropertyName) report(node, `${node.name} is not in ExtendScript`);
    }
    if (node.type === "Literal" && node.regex && /\\[pP]\{/.test(node.regex.pattern)) {
      report(node, `/${node.regex.pattern}/ uses \\p{…}, which ExtendScript reads as a plain "p"`);
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === "loc") continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, node, childKey));
      else if (value && typeof value === "object") visit(value, node, childKey);
    }
  };
  visit(ast, null, null);
  return problems;
}
