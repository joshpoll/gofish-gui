import * as gofish from "gofish-graphics";
import { SPREAD_CALLEES, type ParsedSource, type SpreadCallee } from "./source";

/** Render options shared by `render` and `toDisplayList`, so geometry matches. */
export const RENDER_OPTIONS = { w: 420, h: 250, axes: true } as const;

/** The display-list shape we rely on (gofish's own type is looser here). */
export type DisplayItem = {
  kind: string;
  id?: string;
  role?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  datum?: unknown;
};
export type DisplayList = {
  viewport: { w: number; h: number };
  items: DisplayItem[];
};

/** What the code must evaluate to: a gofish chart builder. */
export type ChartSpec = {
  render(el: HTMLElement, opts: typeof RENDER_OPTIONS): Promise<unknown>;
  toDisplayList(opts: typeof RENDER_OPTIONS): Promise<DisplayList>;
};

/** The options one spread call actually received at evaluation time. */
export type SpreadCall = {
  callee: SpreadCallee;
  by: unknown;
  dir: "x" | "y" | undefined;
  spacing: unknown;
};

export type Evaluation =
  | { ok: true; spec: ChartSpec; calls: SpreadCall[]; code: string }
  | { ok: false; error: string };

const IDENT = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set(["default", "function", "class", "new", "delete", "in", "for"]);

/**
 * Evaluate the chart expression with every gofish export (plus `data`) in
 * scope. The spread callees are wrapped so each call's options are recorded
 * in call order.
 *
 * ASSUMPTION: for a straight-line builder chain, source order equals
 * evaluation order, so recorded call k is the k-th spread CallExpression
 * found by `source.ts`. The caller checks this (same count, same spacing
 * values) before offering any handles, and offers none if it fails.
 */
export function evaluate(
  code: string,
  parsed: ParsedSource,
  data: unknown
): Evaluation {
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const expression = code.slice(parsed.expression.start, parsed.expression.end);

  const calls: SpreadCall[] = [];
  const scope = new Map<string, unknown>();
  for (const [name, value] of Object.entries(gofish)) {
    if (IDENT.test(name) && !RESERVED.has(name)) scope.set(name, value);
  }
  for (const callee of SPREAD_CALLEES) {
    const original = gofish[callee] as (...args: unknown[]) => unknown;
    scope.set(callee, (...args: unknown[]) => {
      const first = args[0];
      const opts =
        first && typeof first === "object" && !Array.isArray(first)
          ? (first as Record<string, unknown>)
          : {};
      const dir =
        callee === "spreadX" ? "x" : callee === "spreadY" ? "y" : opts.dir;
      calls.push({
        callee,
        by: opts.by,
        dir: dir === "x" || dir === "y" ? dir : undefined,
        spacing: opts.spacing,
      });
      return original(...args);
    });
  }
  scope.set("data", data);

  let result: unknown;
  try {
    const fn = new Function(
      ...scope.keys(),
      `"use strict";\nreturn (\n${expression}\n);`
    );
    result = fn(...scope.values());
  } catch (e) {
    return { ok: false, error: `Runtime error: ${(e as Error).message}` };
  }
  if (!isChartSpec(result)) {
    return {
      ok: false,
      error:
        "The code should evaluate to a chart builder, e.g. chart(data).flow(...).mark(...) (without .render)",
    };
  }
  return { ok: true, spec: result, calls, code };
}

function isChartSpec(x: unknown): x is ChartSpec {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as ChartSpec).render === "function" &&
    typeof (x as ChartSpec).toDisplayList === "function"
  );
}

/**
 * Check the source-order == evaluation-order assumption: every spread call
 * site was called exactly once, in order, and each literal spacing arrived
 * unchanged. Returns a reason string when the check fails.
 */
export function checkAlignment(
  parsed: ParsedSource,
  calls: SpreadCall[]
): string | null {
  if (!parsed.ok) return null;
  const sites = parsed.sites;
  if (sites.length !== calls.length) {
    return `Handles off: ${sites.length} spread call(s) in the source but ${calls.length} at run time.`;
  }
  for (const site of sites) {
    const call = calls[site.spreadIndex];
    if (call.callee !== site.callee) {
      return "Handles off: spread calls ran in a different order than they appear in the source.";
    }
    if (site.literal && call.spacing !== site.literal.value) {
      return "Handles off: a spacing literal did not reach its spread call unchanged.";
    }
  }
  return null;
}
