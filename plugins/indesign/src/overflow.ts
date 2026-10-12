// Invented words run slightly wider than the originals, so a tightly set frame can overset after a
// run. The report lists every frame and table cell that overflows now but did not before.

import { constructorName, pageItemOf } from "./collect";

export interface OverflowItem {
  label: string;
  kind: "frame" | "cell";
  item: any;
}

export interface OverflowReport {
  /** Frames and cells that overflow after the run but did not before. */
  overflowing: OverflowItem[];
  /** Frames and cells that already overflowed before the run. */
  alreadyOverflowing: number;
}

function read<T>(read: () => T, fallback: T): T {
  try {
    const value = read();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function overflows(item: any): boolean {
  return read(() => item.overflows === true, false);
}

export function snapshotOverflow(items: readonly any[]): boolean[] {
  return items.map(overflows);
}

/** A short, human place name: "page 4", "parent page A-Parent" or "pasteboard". */
export function placeLabel(item: any): string {
  const pageItem = pageItemOf(item);
  const page = read(() => pageItem.parentPage, null);
  if (page) {
    const spread = read(() => page.parent, null);
    if (constructorName(spread) === "MasterSpread") return `parent page ${read(() => String(spread.name), read(() => String(page.name), "?"))}`;
    return `page ${read(() => String(page.name), "?")}`;
  }
  return "pasteboard";
}

function cellLabel(cell: any): string {
  let table = read(() => cell.parent, null);
  // A nested table sits in a cell of an outer table, so climb out until a table sits in a frame.
  for (let depth = 0; table && depth < 8; depth++) {
    const offset = read(() => table.storyOffset, null);
    const frame = read(() => offset.parentTextFrames[0], null);
    if (frame) return `table on ${placeLabel(frame)}`;
    const outerCell = read(() => offset.parent, null);
    table = constructorName(outerCell) === "Cell" ? read(() => outerCell.parent, null) : null;
  }
  return "table";
}

export function overflowReport(
  containers: readonly any[],
  containersBefore: readonly boolean[],
  cells: readonly any[],
  cellsBefore: readonly boolean[],
): OverflowReport {
  const report: OverflowReport = { overflowing: [], alreadyOverflowing: 0 };
  containers.forEach((container, index) => {
    if (containersBefore[index]) report.alreadyOverflowing++;
    else if (overflows(container)) report.overflowing.push({ label: placeLabel(container), kind: "frame", item: container });
  });
  cells.forEach((cell, index) => {
    if (cellsBefore[index]) report.alreadyOverflowing++;
    else if (overflows(cell)) report.overflowing.push({ label: cellLabel(cell), kind: "cell", item: cell });
  });
  return report;
}

/** "page 4, page 7 (2), table on page 9" */
export function summarizePlaces(items: readonly OverflowItem[]): string {
  const counts = new Map<string, number>();
  items.forEach((item) => counts.set(item.label, (counts.get(item.label) ?? 0) + 1));
  return Array.from(counts, ([label, count]) => (count > 1 ? `${label} (${count})` : label)).join(", ");
}
