import type { DisplayItem, DisplayList, SpreadCall } from "./evaluate";

/** A gap between two neighbouring children of one spread, in display-list px. */
export type Gap = {
  spreadIndex: number;
  /** Position of this gap among all gaps of the same spread level. */
  gapIndex: number;
  dir: "x" | "y";
  left: number;
  top: number;
  width: number;
  height: number;
};

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Gap geometry, derived from gofish's own layout output (never from pixels
 * in the SVG).
 *
 * ROUTE: display-list leaves grouped by the recorded `by` keys. We first
 * tried walking gofish's laid-out node tree, but by the time layout has run
 * a spread has been lowered into generic `layer` nodes (with axis-label
 * text and `ref` nodes mixed in), so the tree no longer says which node was
 * which spread. The display list, on the other hand, gives every data mark
 * in final pixels together with its source rows (`datum`). So:
 *
 *   1. take the data-mark leaves (role "node", with a box and a datum);
 *   2. key each leaf by the values of spread 0..k's `by` fields on its row;
 *   3. leaves sharing keys 0..k-1 are one parent; within a parent, leaves
 *      sharing key k are one child of spread k; union their boxes;
 *   4. sort the children along the spread's dir; the space between
 *      consecutive children is a gap.
 *
 * Limitations (declared): this assumes every grouping operator in the flow
 * is a spread with a string `by` (a level whose `by` or any ancestor's `by`
 * is not a string gets no gaps), and that marks are boxes (x, y, w, h).
 */
export function computeGaps(dl: DisplayList, calls: SpreadCall[]): Gap[] {
  const leaves = dl.items.filter(isDataLeaf);
  const gaps: Gap[] = [];
  calls.forEach((call, k) => {
    const dir = call.dir;
    if (!dir) return;
    const fields = calls.slice(0, k + 1).map((c) => c.by);
    if (!fields.every((f): f is string => typeof f === "string")) return;

    // parent key -> child key -> union box
    const parents = new Map<string, Map<string, Box>>();
    for (const leaf of leaves) {
      const row = firstRow(leaf.datum);
      if (!row) continue;
      const keys = fields.map((f) => String(row[f]));
      const parentKey = JSON.stringify(keys.slice(0, k));
      const childKey = keys[k];
      let children = parents.get(parentKey);
      if (!children) parents.set(parentKey, (children = new Map()));
      const box = leafBox(leaf);
      const prev = children.get(childKey);
      children.set(childKey, prev ? union(prev, box) : box);
    }

    let gapIndex = 0;
    for (const children of parents.values()) {
      const boxes = [...children.values()];
      const along = dir === "x" ? (b: Box) => b.x0 : (b: Box) => b.y0;
      boxes.sort((a, b) => along(a) - along(b));
      // Every gap in a parent spans the parent's full cross extent, so the
      // handles line up like Figma's rather than following each bar's height.
      const all = boxes.reduce(union);
      for (let i = 0; i + 1 < boxes.length; i++) {
        const a = boxes[i];
        const b = boxes[i + 1];
        gaps.push(
          dir === "x"
            ? {
                spreadIndex: k,
                gapIndex: gapIndex++,
                dir,
                left: a.x1,
                width: Math.max(0, b.x0 - a.x1),
                top: all.y0,
                height: all.y1 - all.y0,
              }
            : {
                spreadIndex: k,
                gapIndex: gapIndex++,
                dir,
                top: a.y1,
                height: Math.max(0, b.y0 - a.y1),
                left: all.x0,
                width: all.x1 - all.x0,
              }
        );
      }
    }
  });
  return gaps;
}

function isDataLeaf(item: DisplayItem): boolean {
  return (
    item.role === "node" &&
    item.datum !== undefined &&
    [item.x, item.y, item.w, item.h].every((v) => typeof v === "number")
  );
}

function leafBox(item: DisplayItem): Box {
  // Normalise negative widths/heights.
  const x = item.x!, y = item.y!, w = item.w!, h = item.h!;
  return {
    x0: Math.min(x, x + w),
    x1: Math.max(x, x + w),
    y0: Math.min(y, y + h),
    y1: Math.max(y, y + h),
  };
}

function union(a: Box, b: Box): Box {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** A leaf's datum is a row or an array of rows (all sharing group keys). */
function firstRow(datum: unknown): Record<string, unknown> | undefined {
  const row = Array.isArray(datum) ? datum[0] : datum;
  return row && typeof row === "object"
    ? (row as Record<string, unknown>)
    : undefined;
}
