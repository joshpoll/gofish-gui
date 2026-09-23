import { parseChartExpression } from "./source";
import { unwindChain } from "./pipeline";

/**
 * Inserting a new operator into the chart's `.flow(...)` argument list, as
 * a plain text edit. Pure: code in, one edit out. The pipeline panel's "+"
 * buttons call this and apply the edit through the document, so the
 * insertion is one undo step and everything else re-derives from the code.
 */

/** The operator templates offered by the "+" picker. */
export const FLOW_TEMPLATES = {
  spread: 'spread({ dir: "x" })',
  stack: 'stack({ dir: "y" })',
} as const;
export type FlowTemplate = keyof typeof FLOW_TEMPLATES;

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
 * Insert `op` so that it becomes argument `flowIndex` of the first `.flow`
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
