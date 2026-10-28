import { parseChartExpression } from "./source";
import { unwindChain } from "./pipeline";

/**
 * Inserting a new operator into the chart's `.flow(...)` argument list, as
 * a plain text edit. Pure: code in, one edit out. The pipeline panel's "+"
 * buttons call this and apply the edit through the document, so the
 * insertion is one undo step and everything else re-derives from the code.
 */

/** The operators offered by the "+" picker, with their default direction. */
export const FLOW_OPS = { spread: "x", stack: "y" } as const;
export type FlowOp = keyof typeof FLOW_OPS;

/**
 * Source text of a new operator call: `stack({ by: "product", dir: "y" })`,
 * or `stack({ dir: "y" })` with no key.
 */
export function flowOpText(op: FlowOp, by?: string): string {
  const key = by === undefined ? "" : `by: ${JSON.stringify(by)}, `;
  return `${op}({ ${key}dir: "${FLOW_OPS[op]}" })`;
}

export type Insertion = {
  /** Replace [from, to) with `text` (from === to: a pure insertion). */
  from: number;
  to: number;
  text: string;
  /** Where the inserted operator call ends up, in the new code. */
  selectFrom: number;
  selectTo: number;
};

/**
 * Insert `op` (the operator call's source text, see flowOpText) so that it becomes argument `flowIndex` of the first `.flow`
 * call of `chart(...)...`. Formatting follows the existing list: one
 * argument per line (same indentation as the neighbour, trailing comma kept
 * if the list has one) or inline (`a, op`). With no `.flow` call, index 0
 * adds `.flow(op)` right after `chart(...)`, separated from it the same way
 * the next method is. Returns null when the code has no such position.
 */
export function insertFlowOp(code: string, flowIndex: number, op: string): Insertion | null {
  const parsed = parseChartExpression(code);
  if (!parsed.ok) return null;
  const { base, methods } = unwindChain(parsed.expr);
  if (
    base.type !== "CallExpression" ||
    base.callee.type !== "Identifier" ||
    base.callee.name !== "chart"
  ) {
    return null;
  }

  const flow = methods.find((m) => m.name === "flow");
  if (!flow) {
    if (flowIndex !== 0) return null;
    // Reuse the separator between chart(...) and the next method, e.g.
    // "\n  ." in the multi-line style, or "." inline.
    const next = methods[0];
    const sep = next ? code.slice(base.end, next.nameStart) : ".";
    const prefix = `${sep}flow(`;
    return at(base.end, `${prefix}${op})`, prefix.length, op);
  }

  const args = flow.call.arguments;
  if (flowIndex < 0 || flowIndex > args.length) return null;
  if (args.length === 0) {
    // `.flow()`: the closing paren is the call's last character.
    return at(flow.call.end - 1, op, 0, op);
  }

  // One per line if a line break separates `flow` from its first argument.
  const multiline = code.slice(flow.call.callee.end, args[0].start).includes("\n");

  if (flowIndex < args.length) {
    // Before argument `flowIndex`, which moves down (or right).
    const next = args[flowIndex];
    const text = multiline ? `${op},\n${indentOf(code, next.start)}` : `${op}, `;
    return at(next.start, text, 0, op);
  }

  // After the last argument, past its trailing comma if it has one.
  const last = args[args.length - 1];
  if (!multiline) return at(last.end, `, ${op}`, 2, op);
  const indent = indentOf(code, last.start);
  const comma = /^\s*,/.exec(code.slice(last.end));
  if (comma) {
    const prefix = `\n${indent}`;
    return at(last.end + comma[0].length, `${prefix}${op},`, prefix.length, op);
  }
  const prefix = `,\n${indent}`;
  return at(last.end, `${prefix}${op}`, prefix.length, op);
}

/** Insert `text` at `pos`; the operator starts `opOffset` chars into it. */
function at(pos: number, text: string, opOffset: number, op: string): Insertion {
  const selectFrom = pos + opOffset;
  return { from: pos, to: pos, text, selectFrom, selectTo: selectFrom + op.length };
}

/** The leading whitespace of the line containing `pos`. */
function indentOf(code: string, pos: number): string {
  const lineStart = code.lastIndexOf("\n", pos - 1) + 1;
  return /^[ \t]*/.exec(code.slice(lineStart))![0];
}

/**
 * Append `.method` (source text without the dot, e.g.
 * `layer(ribbon({ along: "product" }))`) at the end of the chart chain
 * `chart(...)...`, after its last method call. The separator before the dot
 * follows the chain's own style: the whitespace before the last method's dot
 * (a line break and indent in the multi-line style, nothing inline), or a
 * line break and two spaces when `chart(...)` has no methods yet. The
 * selection covers `method`. Null when the code is not a chart chain.
 */
export function appendChainMethod(code: string, method: string): Insertion | null {
  const parsed = parseChartExpression(code);
  if (!parsed.ok) return null;
  const { base, methods } = unwindChain(parsed.expr);
  if (
    base.type !== "CallExpression" ||
    base.callee.type !== "Identifier" ||
    base.callee.name !== "chart"
  ) {
    return null;
  }
  const last = methods[methods.length - 1];
  let space = "\n  ";
  if (last) {
    // The text between the chained object and the method name holds the dot;
    // keep only the whitespace in front of it (never a comment).
    const object = last.call.callee.type === "MemberExpression" ? last.call.callee.object : base;
    space = /^\s*/.exec(code.slice(object.end, last.nameStart))![0];
  }
  const prefix = `${space}.`;
  return at(parsed.expr.end, `${prefix}${method}`, prefix.length, method);
}
