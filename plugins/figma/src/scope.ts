import { hasScramblableText } from "../../../packages/core/src/scramble-text";

export type Scope = "selection" | "page";

export interface FontNameLike {
  family: string;
  style: string;
}

// The slice of Figma's node API this plugin reads. Real Figma nodes fit these shapes, and so do the
// mock nodes in tests/helpers/figma-mock.ts, which lets the scope and run logic be tested off Figma.
export interface TreeNode {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly parent: TreeNode | null;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly children?: readonly TreeNode[];
}

export interface TextLayer extends TreeNode {
  readonly type: "TEXT";
  name: string;
  characters: string;
  autoRename: boolean;
  readonly hasMissingFont: boolean;
  readonly height: number;
  readonly textAutoResize: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  insertCharacters(start: number, characters: string, useStyle?: "BEFORE" | "AFTER"): void;
  deleteCharacters(start: number, end: number): void;
  getRangeAllFontNames(start: number, end: number): FontNameLike[];
}

interface TextContainer extends TreeNode {
  findAllWithCriteria(criteria: { types: ["TEXT"] }): readonly TextLayer[];
}

export interface ScanOptions {
  includeHidden: boolean;
  scrambleNumbers: boolean;
}

export interface SkipCounts {
  hidden: number;
  missingFont: number;
}

export interface ScanResult {
  scope: Scope;
  includeHidden: boolean;
  roots: number;
  textLayers: number;
  // Ready to scramble, in write order: main components before instances, so text an instance
  // inherits is changed once at its source instead of being copied into an override.
  eligible: TextLayer[];
  characters: number;
  skipped: SkipCounts;
  // Layers that hold only numbers while "Scramble numbers" is off.
  numbersOnly: number;
  // Eligible layers that are locked, or inside something locked. Figma's lock only stops canvas edits:
  // locked text still shows and exports, so it is scrambled, and the panel says so.
  locked: number;
  // Eligible layers inside a main component. Changing them also changes that component's instances.
  inMainComponents: number;
}

interface Ancestry {
  hidden: boolean;
  locked: boolean;
  instanceDepth: number;
  inMainComponent: boolean;
}

const TOP: Ancestry = { hidden: false, locked: false, instanceDepth: 0, inMainComponent: false };

// Walks up from each node once and remembers every ancestor, so a page with thousands of layers
// costs one visit per layer instead of one walk to the top per text layer.
function createAncestryLookup(): (node: TreeNode) => Ancestry {
  const known = new Map<string, Ancestry>();

  const lookup = (node: TreeNode | null): Ancestry => {
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") return TOP;
    const cached = known.get(node.id);
    if (cached) return cached;

    const above = lookup(node.parent);
    const result: Ancestry = {
      hidden: above.hidden || node.visible === false,
      locked: above.locked || node.locked === true,
      instanceDepth: above.instanceDepth + (node.type === "INSTANCE" ? 1 : 0),
      inMainComponent: above.inMainComponent || node.type === "COMPONENT" || node.type === "COMPONENT_SET",
    };
    known.set(node.id, result);
    return result;
  };

  return lookup;
}

export function textDescendants(node: TreeNode): readonly TextLayer[] {
  if (node.type === "TEXT") return [node as TextLayer];
  if ("findAllWithCriteria" in node) return (node as TextContainer).findAllWithCriteria({ types: ["TEXT"] });
  return [];
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

// Figma lists the selection in the order layers were clicked. Sorting roots into layer order keeps
// a seeded run repeatable however the selection was made.
export function sortByLayerOrder<T extends TreeNode>(nodes: readonly T[]): T[] {
  const siblingIndexes = new Map<string, Map<string, number>>();

  const indexIn = (parent: TreeNode, child: TreeNode): number => {
    let indexes = siblingIndexes.get(parent.id);
    if (!indexes) {
      indexes = new Map((parent.children ?? []).map((sibling, index) => [sibling.id, index]));
      siblingIndexes.set(parent.id, indexes);
    }
    return indexes.get(child.id) ?? -1;
  };

  // Figma refuses to read hidden layers inside instances while they are skipped. Those sort first, and
  // scanScope counts them as hidden.
  const pathOf = (node: TreeNode): number[] =>
    safely(() => {
      const path: number[] = [];
      let current = node;
      while (current.parent) {
        path.unshift(indexIn(current.parent, current));
        current = current.parent;
      }
      return path;
    }, []);

  return nodes
    .map((node, order) => ({ node, order, path: pathOf(node) }))
    .sort((a, b) => comparePaths(a.path, b.path) || a.order - b.order)
    .map((entry) => entry.node);
}

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function scanScope(scope: Scope, roots: readonly TreeNode[], options: ScanOptions): ScanResult {
  const ancestry = createAncestryLookup();
  const seen = new Set<string>();
  const skipped: SkipCounts = { hidden: 0, missingFont: 0 };
  const ready: { layer: TextLayer; depth: number }[] = [];
  let textLayers = 0;
  let characters = 0;
  let numbersOnly = 0;
  let locked = 0;
  let inMainComponents = 0;

  for (const root of sortByLayerOrder(roots)) {
    // With hidden layers excluded, Figma refuses to read hidden layers inside instances. Treat a
    // root it refuses as hidden rather than failing the whole scan.
    const layers = safely(() => textDescendants(root), null);
    if (!layers) {
      skipped.hidden++;
      textLayers++;
      continue;
    }

    for (const layer of layers) {
      if (seen.has(layer.id)) continue;
      seen.add(layer.id);
      textLayers++;

      const place = ancestry(layer);
      if (!options.includeHidden && place.hidden) {
        skipped.hidden++;
        continue;
      }
      if (layer.hasMissingFont) {
        skipped.missingFont++;
        continue;
      }

      const text = layer.characters;
      if (!hasScramblableText(text, { scrambleNumbers: options.scrambleNumbers })) {
        if (!options.scrambleNumbers && hasScramblableText(text)) numbersOnly++;
        continue;
      }

      ready.push({ layer, depth: place.instanceDepth });
      characters += Array.from(text).length;
      if (place.locked) locked++;
      if (place.inMainComponent) inMainComponents++;
    }
  }

  // Array.prototype.sort is stable, so layers keep layer order within each instance depth.
  const eligible = ready.sort((a, b) => a.depth - b.depth).map((entry) => entry.layer);

  return { scope, includeHidden: options.includeHidden, roots: roots.length, textLayers, eligible, characters, skipped, numbersOnly, locked, inMainComponents };
}
