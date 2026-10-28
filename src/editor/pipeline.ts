import type { CallExpression, Expression, Node, SpreadElement } from "acorn";
import { findProperty, parseChartExpression, stringLiteral } from "./source";

/**
 * The pipeline view: the gofish builder chain
 * `chart(data, opts).flow(a, b, ...).mark(m)` read from the code as a list
 * of stages, in pipeline order. It is derived from the code only, like
 * everything else, and each node keeps the source range it came from.
 */

export type PipelineKind = "chart" | "spread" | "stack" | "rect" | "mark" | "ribbon" | "op";

export type PipelineNode = {
  kind: PipelineKind;
  name: string;
  /** Compact rendering of the stage's key options, e.g. `by: region · spacing: 40`. */
  detail: string;
  /** Source range this stage came from (what clicking the row selects). */
  range: { start: number; end: number };
  /** Layout direction, for spread and stack glyphs; undefined if unknown. */
  dir?: "x" | "y";
  /** The grouping key (`by`) of a spread or stack, shown in the title line. */
  key?: string;
  /**
   * If set, a new flow operator can be inserted just above this stage, at
   * this index of the `.flow(...)` argument list (see insert.ts). Set on
   * each flow stage (its own index) and on the stage right after the last
   * one (the number of flow stages). With no `.flow` call, it is 0 on the
   * stage right after `chart(...)`, and inserting adds the `.flow` call.
   */
  insertIndex?: number;
};

export type PipelineResult =
  | { ok: true; nodes: PipelineNode[] }
  | { ok: false; error: string };

const SPREADS = ["spread", "spreadX", "spreadY"];
const STACKS = ["stack", "stackX", "stackY"];

/** One `.name(...)` call of the builder chain. */
export type ChainMethod = { name: string; call: CallExpression; nameStart: number };

/**
 * Unwind `base.m1(...).m2(...)` into its base expression and its method
 * calls in chain order. Shared by the pipeline view and insert.ts.
 */
export function unwindChain(expr: Expression): { base: Expression; methods: ChainMethod[] } {
  const methods: ChainMethod[] = [];
  while (
    expr.type === "CallExpression" &&
    expr.callee.type === "MemberExpression" &&
    !expr.callee.computed &&
    expr.callee.property.type === "Identifier"
  ) {
    methods.push({
      name: expr.callee.property.name,
      call: expr,
      nameStart: expr.callee.property.start,
    });
    expr = expr.callee.object as Expression;
  }
  methods.reverse();
  return { base: expr, methods };
}

export function derivePipeline(code: string): PipelineResult {
  const parsed = parseChartExpression(code);
  if (!parsed.ok) return parsed;
  const text = (n: Node) => code.slice(n.start, n.end);
  const { base, methods } = unwindChain(parsed.expr);

  const nodes: PipelineNode[] = [];
  const isChart = base.type === "CallExpression" && calleeName(base) === "chart";

  if (base.type === "CallExpression" && isChart) {
    const [data, opts] = base.arguments;
    nodes.push({
      kind: "chart",
      name: "chart",
      detail: [data ? shorten(text(data)) : "", opts ? compactOptions(opts, code) : ""]
        .filter(Boolean)
        .join(" · "),
      range: { start: base.start, end: base.end },
    });
  } else {
    // Not a chart(...) base; show it as an opaque first stage.
    nodes.push({
      kind: "op",
      name: shorten(text(base)),
      detail: "",
      range: { start: base.start, end: base.end },
    });
  }

  // Insertion points exist only for a chart(...) base: with a `.flow`, at
  // each of its indices; without one, right after chart(...).
  const hasFlow = methods.some((m) => m.name === "flow");
  let pendingInsert: number | undefined = isChart && !hasFlow ? 0 : undefined;
  let seenFlow = false;
  const push = (n: PipelineNode) => {
    if (pendingInsert !== undefined) n.insertIndex = pendingInsert;
    pendingInsert = undefined;
    nodes.push(n);
  };

  for (const m of methods) {
    if (m.name === "flow" && isChart && !seenFlow) {
      // Only the first .flow call gets insertion points.
      seenFlow = true;
      m.call.arguments.forEach((arg, i) => {
        pendingInsert = i;
        push(stageNode(arg, code));
      });
      pendingInsert = m.call.arguments.length;
    } else if (m.name === "flow") {
      for (const arg of m.call.arguments) push(stageNode(arg, code));
    } else if (m.name === "mark") {
      for (const arg of m.call.arguments) push(markNode(arg, code));
    } else if (m.name === "layer" && isRibbonLayer(m.call)) {
      // `.layer(ribbon({ along: "product", ... }))`: one row for the band layer.
      const opts = (m.call.arguments[0] as CallExpression).arguments[0];
      push({
        kind: "ribbon",
        name: "ribbon",
        detail: opts ? compactOptions(opts, code) : "",
        range: { start: m.nameStart, end: m.call.end },
      });
    } else {
      push({
        kind: "op",
        name: m.name,
        detail: m.call.arguments.map((a) => shorten(text(a))).join(" · "),
        range: { start: m.nameStart, end: m.call.end },
      });
    }
  }

  return { ok: true, nodes };
}

function stageNode(arg: Expression | SpreadElement, code: string): PipelineNode {
  const range = { start: arg.start, end: arg.end };
  const name = arg.type === "CallExpression" ? calleeName(arg) : undefined;
  if (!name || arg.type !== "CallExpression") {
    return { kind: "op", name: shorten(code.slice(arg.start, arg.end)), detail: "", range };
  }
  const opts = arg.arguments[0];
  const isSpread = SPREADS.includes(name);
  if (!isSpread && !STACKS.includes(name)) {
    return { kind: "op", name, detail: opts ? compactOptions(opts, code) : "", range };
  }
  // `by` is the structural part of a spread, so it is lifted out of the
  // detail line and into the title next to the operator name.
  const detail = opts ? compactOptions(opts, code, ["by"]) : "";
  const key =
    opts && opts.type === "ObjectExpression"
      ? stringLiteral(findProperty(opts, "by"))
      : undefined;
  const dirValue =
    opts && opts.type === "ObjectExpression"
      ? stringLiteral(findProperty(opts, "dir"))
      : undefined;
  const dir = name.endsWith("X")
    ? "x"
    : name.endsWith("Y")
      ? "y"
      : dirValue === "x" || dirValue === "y"
        ? dirValue
        : undefined;
  return { kind: isSpread ? "spread" : "stack", name, detail, range, dir, key };
}

function markNode(arg: Expression | SpreadElement, code: string): PipelineNode {
  const range = { start: arg.start, end: arg.end };
  const name = arg.type === "CallExpression" ? calleeName(arg) : undefined;
  if (!name || arg.type !== "CallExpression") {
    return { kind: "mark", name: shorten(code.slice(arg.start, arg.end)), detail: "", range };
  }
  const opts = arg.arguments[0];
  // A rect's `fill` has its own control in the panel, so it is left out of
  // the detail line (like a spread's `by`).
  const isRect = name === "rect";
  return {
    kind: isRect ? "rect" : "mark",
    name,
    detail: opts ? compactOptions(opts, code, isRect ? ["fill"] : []) : "",
    range,
  };
}

/** `.layer(ribbon(...))` with exactly that one argument. */
function isRibbonLayer(call: CallExpression): boolean {
  const [arg, ...rest] = call.arguments;
  return rest.length === 0 && !!arg && arg.type === "CallExpression" && calleeName(arg) === "ribbon";
}

function calleeName(call: CallExpression): string | undefined {
  return call.callee.type === "Identifier" ? call.callee.name : undefined;
}

/**
 * `{ by: "region", spacing: 40 }` -> `by: region · spacing: 40`. String
 * values lose their quotes; every other value is its source text.
 */
function compactOptions(
  e: Expression | SpreadElement,
  code: string,
  omit: string[] = [],
): string {
  if (e.type !== "ObjectExpression") return shorten(code.slice(e.start, e.end));
  return e.properties
    .filter((p) => !(p.type === "Property" && p.key.type === "Identifier" && omit.includes(p.key.name)))
    .map((p) => {
      if (p.type === "SpreadElement") return code.slice(p.start, p.end);
      const key = p.computed
        ? `[${code.slice(p.key.start, p.key.end)}]`
        : p.key.type === "Identifier"
          ? p.key.name
          : p.key.type === "Literal"
            ? String(p.key.value)
            : code.slice(p.key.start, p.key.end);
      const v = p.value;
      const value =
        v.type === "Literal" && typeof v.value === "string"
          ? v.value
          : code.slice(v.start, v.end);
      return `${key}: ${shorten(value)}`;
    })
    .join(" · ");
}

/** Collapse whitespace and cap length so a detail line stays one line. */
function shorten(s: string, max = 32): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}
