// Pretend Figma layers for tests. They copy the parts of Figma's behaviour the plugin relies on:
// styled characters, font loading, hidden layers inside instances, main components pushing text
// to their instances, and fixed-width text that grows taller when it wraps.
import { estimateVisualWidth } from "../../packages/core/src/scramble-text";
import type { FontNameLike, TextLayer, TreeNode } from "../../plugins/figma/src/scope";

export interface MockWorld {
  skipInvisibleInstanceChildren: boolean;
  missingFonts: Set<string>;
  loadedFonts: Set<string>;
  loadFont(font: FontNameLike): Promise<void>;
}

export function createWorld(): MockWorld {
  const world: MockWorld = {
    skipInvisibleInstanceChildren: false,
    missingFonts: new Set(),
    loadedFonts: new Set(),
    async loadFont(font) {
      const key = fontLabel(font);
      if (world.missingFonts.has(key)) throw new Error(`Font ${key} is not available`);
      world.loadedFonts.add(key);
    },
  };
  return world;
}

export function fontLabel(font: FontNameLike): string {
  return `${font.family} ${font.style}`;
}

let nextId = 1;

interface NodeOptions {
  name?: string;
  visible?: boolean;
  locked?: boolean;
}

export class MockNode implements TreeNode {
  readonly id: string;
  type: string;
  name: string;
  parent: MockNode | null = null;
  visible: boolean;
  locked: boolean;
  children: MockNode[] = [];

  constructor(
    readonly world: MockWorld,
    type: string,
    options: NodeOptions = {},
    id?: string,
  ) {
    this.id = id ?? `${nextId++}:1`;
    this.type = type;
    this.name = options.name ?? type.toLowerCase();
    this.visible = options.visible ?? true;
    this.locked = options.locked ?? false;
  }

  append(...children: MockNode[]): this {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }

  findAllWithCriteria(criteria: { types: ["TEXT"] }): MockText[] {
    const found: MockText[] = [];
    const visit = (node: MockNode, insideInstance: boolean) => {
      for (const child of node.children) {
        if (this.world.skipInvisibleInstanceChildren && insideInstance && !child.visible) continue;
        if (criteria.types.includes(child.type as "TEXT")) found.push(child as MockText);
        visit(child, insideInstance || child.type === "INSTANCE");
      }
    };
    visit(this, this.type === "INSTANCE" || hasInstanceAncestor(this));
    return found;
  }
}

function hasInstanceAncestor(node: MockNode): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "INSTANCE") return true;
  }
  return false;
}

export interface TextOptions extends NodeOptions {
  styles?: string[];
  fonts?: FontNameLike[];
  autoRename?: boolean;
  hasMissingFont?: boolean;
  textAutoResize?: TextLayer["textAutoResize"];
  // Box width for wrapping, in the engine's average-glyph units.
  wrapWidth?: number;
  // Copy Figma's possible habit of renaming auto-named layers when their text changes.
  renamesOnEdit?: boolean;
  // Overrides the wrapping model with an exact height for given characters.
  measure?: (characters: string) => number;
}

export const REGULAR: FontNameLike = { family: "Inter", style: "Regular" };
const LINE_HEIGHT = 12;

export class MockText extends MockNode implements TextLayer {
  declare type: "TEXT";
  characters: string;
  // One style label per UTF-16 code unit, like Figma's styled ranges.
  styles: string[];
  fonts: FontNameLike[];
  autoRename: boolean;
  hasMissingFont: boolean;
  textAutoResize: TextLayer["textAutoResize"];
  wrapWidth: number;
  renamesOnEdit: boolean;
  measure?: (characters: string) => number;
  // Main-component text pushes its characters to these instance copies until they are overridden.
  copies: MockText[] = [];
  source: MockText | null = null;
  overridden = false;
  edits = 0;

  constructor(world: MockWorld, characters: string, options: TextOptions = {}, id?: string) {
    super(world, "TEXT", { ...options, name: options.name ?? characters }, id);
    this.characters = characters;
    this.styles = options.styles ?? Array.from({ length: characters.length }, () => "regular");
    this.fonts = options.fonts ?? [REGULAR];
    this.autoRename = options.autoRename ?? options.name === undefined;
    this.hasMissingFont = options.hasMissingFont ?? false;
    this.textAutoResize = options.textAutoResize ?? "WIDTH_AND_HEIGHT";
    this.wrapWidth = options.wrapWidth ?? 1000;
    this.renamesOnEdit = options.renamesOnEdit ?? false;
    this.measure = options.measure;
  }

  get height(): number {
    if (this.measure) return this.measure(this.characters);
    if (this.textAutoResize !== "HEIGHT") return LINE_HEIGHT;
    return this.characters
      .split("\n")
      .reduce((total, line) => total + Math.max(1, Math.ceil(estimateVisualWidth(line) / this.wrapWidth)) * LINE_HEIGHT, 0);
  }

  getRangeAllFontNames(start: number, end: number): FontNameLike[] {
    if (start < 0 || end > this.characters.length || start > end) throw new Error("Range out of bounds");
    return this.fonts;
  }

  private assertEditable(): void {
    if (this.hasMissingFont) throw new Error("Cannot edit text with a missing font");
    for (const font of this.fonts) {
      if (!this.world.loadedFonts.has(fontLabel(font))) throw new Error(`Font ${fontLabel(font)} is not loaded`);
    }
  }

  insertCharacters(start: number, characters: string, useStyle: "BEFORE" | "AFTER" = "BEFORE"): void {
    this.assertEditable();
    const style =
      useStyle === "AFTER" ? (this.styles[start] ?? this.styles[start - 1]) : (this.styles[start - 1] ?? this.styles[start]);
    this.characters = this.characters.slice(0, start) + characters + this.characters.slice(start);
    this.styles.splice(start, 0, ...Array.from({ length: characters.length }, () => style));
    this.afterEdit();
  }

  deleteCharacters(start: number, end: number): void {
    this.assertEditable();
    this.characters = this.characters.slice(0, start) + this.characters.slice(end);
    this.styles.splice(start, end - start);
    this.afterEdit();
  }

  private afterEdit(): void {
    this.edits++;
    if (this.source) this.overridden = true;
    if (this.autoRename && this.renamesOnEdit) this.name = this.characters;
    for (const copy of this.copies) {
      if (copy.overridden) continue;
      copy.characters = this.characters;
      copy.styles = [...this.styles];
      if (copy.autoRename && copy.renamesOnEdit) copy.name = copy.characters;
    }
  }

  get styledRuns(): string {
    return this.styles.join(",");
  }
}

export function page(world: MockWorld, ...children: MockNode[]): MockNode {
  return new MockNode(world, "PAGE", { name: "Page 1" }).append(...children);
}

export function frame(world: MockWorld, options: NodeOptions, ...children: MockNode[]): MockNode {
  return new MockNode(world, "FRAME", options).append(...children);
}

export function text(world: MockWorld, characters: string, options: TextOptions = {}): MockText {
  return new MockText(world, characters, options);
}

export function component(world: MockWorld, options: NodeOptions, ...children: MockNode[]): MockNode {
  return new MockNode(world, "COMPONENT", options).append(...children);
}

// Builds an instance by copying a main component's layers. Copied text follows its main text
// until it is edited directly, as an instance override does in Figma.
export function instanceOf(main: MockNode, options: NodeOptions = {}): MockNode {
  const instance = new MockNode(main.world, "INSTANCE", { name: options.name ?? main.name, ...options });
  const copy = (node: MockNode, parent: MockNode) => {
    let clone: MockNode;
    const id = `I${instance.id};${node.id}`;
    if (node instanceof MockText) {
      const textCopy = new MockText(
        main.world,
        node.characters,
        {
          name: node.name,
          visible: node.visible,
          locked: node.locked,
          styles: [...node.styles],
          fonts: node.fonts,
          autoRename: node.autoRename,
          hasMissingFont: node.hasMissingFont,
          textAutoResize: node.textAutoResize,
          wrapWidth: node.wrapWidth,
          renamesOnEdit: node.renamesOnEdit,
        },
        id,
      );
      textCopy.source = node;
      node.copies.push(textCopy);
      clone = textCopy;
    } else {
      clone = new MockNode(main.world, node.type, { name: node.name, visible: node.visible, locked: node.locked }, id);
    }
    parent.append(clone);
    node.children.forEach((child) => copy(child, clone));
  };
  main.children.forEach((child) => copy(child, instance));
  return instance;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
