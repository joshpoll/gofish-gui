import {
  parse,
  type CallExpression,
  type Expression,
  type Node,
  type ObjectExpression,
  type Program,
} from "acorn";

/**
 * Source analysis with acorn: find the concrete numeric literals the canvas
 * is allowed to manipulate. Nothing is inferred. A spread without a literal
 * `spacing` is still listed (so indices line up with evaluation) but gets
 * `literal: null` and no handle.
 */

/** Callees that count as spread calls, in source and at evaluation time. */
export const SPREAD_CALLEES = ["spread", "spreadX", "spreadY"] as const;
export type SpreadCallee = (typeof SPREAD_CALLEES)[number];

export type NumericLiteral = { start: number; end: number; value: number };

export type SpreadSite = {
  /** Position among spread calls in source order. */
  spreadIndex: number;
  callee: SpreadCallee;
  /** The `spacing: <number>` literal, or null if absent / not a plain literal. */
  literal: NumericLiteral | null;
  by: string | undefined;
  dir: "x" | "y" | undefined;
};

export type ParsedSource =
  | {
      ok: true;
      /** Range of the single top-level expression (the chart spec). */
      expression: { start: number; end: number };
      sites: SpreadSite[];
    }
  | { ok: false; error: string };

/**
 * Parse the code as a single top-level expression (the chart spec). Shared
 * by every analysis of the code (spread sites here, the pipeline view).
 */
export function parseChartExpression(
  code: string
): { ok: true; program: Program; expr: Expression } | { ok: false; error: string } {
  let program: Program;
  try {
    program = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  } catch (e) {
    return { ok: false, error: `Syntax error: ${(e as Error).message}` };
  }
  const body = program.body;
  if (body.length !== 1 || body[0].type !== "ExpressionStatement") {
    return {
      ok: false,
      error:
        "The code should be a single chart expression, e.g. chart(data).flow(...).mark(...)",
    };
  }
  return { ok: true, program, expr: body[0].expression };
}

export function parseSource(code: string): ParsedSource {
  const parsed = parseChartExpression(code);
  if (!parsed.ok) return parsed;
  const { program, expr } = parsed;

  const calls: CallExpression[] = [];
  walk(program, (node) => {
    if (node.type === "CallExpression" && isSpreadCallee(node as CallExpression)) {
      calls.push(node as CallExpression);
    }
  });
  // Source order = order of the call's start offset.
  calls.sort((a, b) => a.start - b.start);

  const sites = calls.map((call, spreadIndex): SpreadSite => {
    const callee = (call.callee as { name: SpreadCallee }).name;
    const opts = call.arguments[0];
    const obj = opts && opts.type === "ObjectExpression" ? opts : undefined;
    const spacing = obj && findProperty(obj, "spacing");
    const by = obj && findProperty(obj, "by");
    const dir = obj && findProperty(obj, "dir");
    const dirValue = stringLiteral(dir);
    return {
      spreadIndex,
      callee,
      literal: numericLiteral(spacing),
      by: stringLiteral(by),
      dir:
        callee === "spreadX"
          ? "x"
          : callee === "spreadY"
            ? "y"
            : dirValue === "x" || dirValue === "y"
              ? dirValue
              : undefined,
    };
  });

  return {
    ok: true,
    expression: { start: expr.start, end: expr.end },
    sites,
  };
}

function isSpreadCallee(call: CallExpression): boolean {
  return (
    call.callee.type === "Identifier" &&
    (SPREAD_CALLEES as readonly string[]).includes(call.callee.name)
  );
}

export function findProperty(obj: ObjectExpression, name: string) {
  for (const p of obj.properties) {
    if (p.type !== "Property" || p.computed || p.kind !== "init") continue;
    const key = p.key;
    const keyName =
      key.type === "Identifier"
        ? key.name
        : key.type === "Literal"
          ? String(key.value)
          : undefined;
    if (keyName === name) return p.value as Expression;
  }
  return undefined;
}

/** Only plain, non-negative numeric literals are manipulable. */
function numericLiteral(e: Expression | undefined): NumericLiteral | null {
  if (!e || e.type !== "Literal" || typeof e.value !== "number") return null;
  return { start: e.start, end: e.end, value: e.value };
}

export function stringLiteral(e: Expression | undefined): string | undefined {
  return e && e.type === "Literal" && typeof e.value === "string"
    ? e.value
    : undefined;
}

/** Minimal pre-order walk over every ESTree node. */
function walk(node: Node, visit: (n: Node) => void) {
  visit(node);
  for (const key of Object.keys(node)) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const c of child) if (isNode(c)) walk(c, visit);
    } else if (isNode(child)) {
      walk(child, visit);
    }
  }
}

function isNode(x: unknown): x is Node {
  return typeof x === "object" && x !== null && typeof (x as Node).type === "string";
}
