import type { CallExpression, ObjectExpression, Property } from "acorn";
import { parseChartExpression } from "./source";
import { unwindChain } from "./pipeline";

/**
 * Reading and writing one property of the mark's options object, e.g. the
 * `fill` in `.mark(rect({ h: "total", fill: "#7c8a99" }))`. Pure: code in,
 * a location or one text edit out. The panel applies the edit through the
 * document, so it is undoable like any other edit.
 */

type Range = { start: number; end: number };

export type MarkProperty = {
  /** The mark call, e.g. `rect({...})` (matches its pipeline node's range). */
  callRange: Range;
  /** The options object `{...}`, or null if the call has no object argument. */
  objectRange: Range | null;
  /** The property's value, or null if the object has no such property. */
  valueRange: Range | null;
  valueText: string | null;
  /** True when the value is a plain string literal. */
  isString: boolean;
  /** The string's value when `isString`. */
  stringValue?: string;
};

type Located = { call: CallExpression; obj: ObjectExpression | null; prop: Property | null };

/** The first `.mark(call(...))` of the chart chain and its options object. */
function locate(code: string, name: string): Located | null {
  const parsed = parseChartExpression(code);
  if (!parsed.ok) return null;
  const mark = unwindChain(parsed.expr).methods.find((m) => m.name === "mark");
  const call = mark?.call.arguments[0];
  if (!call || call.type !== "CallExpression") return null;
  const first = call.arguments[0];
  if (first && first.type !== "ObjectExpression") return null; // not an options object
  const obj = first ?? null;
  let prop: Property | null = null;
  for (const p of obj?.properties ?? []) {
    if (p.type !== "Property" || p.computed || p.kind !== "init") continue;
    const key = p.key.type === "Identifier" ? p.key.name : p.key.type === "Literal" ? String(p.key.value) : undefined;
    if (key === name) prop = p;
  }
  return { call, obj, prop };
}

/**
 * Find property `name` of the mark's options object. Returns null when the
 * code does not parse, has no `.mark(call(...))`, or the call's first
 * argument is something other than an object literal.
 */
export function findMarkProperty(code: string, name: string): MarkProperty | null {
  const loc = locate(code, name);
  if (!loc) return null;
  const { call, obj, prop } = loc;
  const v = prop?.value;
  const isString = !!v && v.type === "Literal" && typeof v.value === "string";
  return {
    callRange: { start: call.start, end: call.end },
    objectRange: obj ? { start: obj.start, end: obj.end } : null,
    valueRange: v ? { start: v.start, end: v.end } : null,
    valueText: v ? code.slice(v.start, v.end) : null,
    isString,
    ...(isString ? { stringValue: (v as { value: string }).value } : {}),
  };
}

/**
 * One text edit that sets property `name` of the mark's options to
 * `valueSource` (source text, e.g. `"#ff0000"` with its quotes). Replaces
 * the existing value, or adds the property: after the last property as
 * `, name: value`, into an empty `{}` as `{ name: value }`, or as a new
 * `{ name: value }` argument when the call has none. Null when there is no
 * mark options object to edit.
 */
export function setMarkProperty(
  code: string,
  name: string,
  valueSource: string
): { from: number; to: number; text: string } | null {
  const loc = locate(code, name);
  if (!loc) return null;
  const { call, obj, prop } = loc;
  if (prop) return { from: prop.value.start, to: prop.value.end, text: valueSource };
  const entry = `${name}: ${valueSource}`;
  if (!obj) {
    // `rect()`: the closing paren is the call's last character.
    if (call.arguments.length > 0) return null;
    return { from: call.end - 1, to: call.end - 1, text: `{ ${entry} }` };
  }
  if (obj.properties.length === 0) {
    return { from: obj.start, to: obj.end, text: `{ ${entry} }` };
  }
  const last = obj.properties[obj.properties.length - 1];
  return { from: last.end, to: last.end, text: `, ${entry}` };
}

/** Source text of a string literal, in the given quote style. */
export function stringSource(value: string, quote: string = '"'): string {
  const q = quote === "'" || quote === "`" ? quote : '"';
  return q + value.replace(/\\/g, "\\\\").replaceAll(q, `\\${q}`) + q;
}

/**
 * How a mark's `fill` is written, which decides the panel's control.
 *
 * gofish's own rule (gofish-graphics `inferColor` / `firstRowValue` in
 * src/ast/channels.ts): a string that names a key of the FIRST data row is
 * a field, and its value goes through the chart's colour scale; any other
 * string passes through unchanged as a literal CSS colour. We check the
 * field case first in the same way, so we never call a field a colour.
 * Among the other strings, we only call "constant" the ones we can show in
 * a colour input: `#rgb` / `#rrggbb` hex, or one of the 16 basic CSS colour
 * names. Anything else (a variable, a function, `rgb(...)`, an unknown
 * name) is "other" and is shown as its source text, not edited.
 */
export type FillState =
  | { kind: "constant"; hex: string; range: Range; quote: string }
  | { kind: "data"; field: string; range: Range; quote: string }
  | { kind: "other"; text: string }
  | { kind: "unset" };

const BASIC_COLORS: Record<string, string> = {
  black: "#000000", silver: "#c0c0c0", gray: "#808080", white: "#ffffff",
  maroon: "#800000", red: "#ff0000", purple: "#800080", fuchsia: "#ff00ff",
  green: "#008000", lime: "#00ff00", olive: "#808000", yellow: "#ffff00",
  navy: "#000080", blue: "#0000ff", teal: "#008080", aqua: "#00ffff",
};

/** `#abc` / `#aabbcc` / a basic colour name -> `#aabbcc`; otherwise null. */
export function colorHex(s: string): string | null {
  const named = BASIC_COLORS[s.toLowerCase()];
  if (named) return named;
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return ("#" + [...s.slice(1)].map((c) => c + c).join("")).toLowerCase();
  }
  return null;
}

export function classifyFill(p: MarkProperty | null, fields: string[]): FillState {
  if (!p || !p.valueRange || p.valueText === null) return { kind: "unset" };
  if (p.isString && p.stringValue !== undefined) {
    const quote = p.valueText[0];
    if (fields.includes(p.stringValue)) {
      return { kind: "data", field: p.stringValue, range: p.valueRange, quote };
    }
    const hex = colorHex(p.stringValue);
    if (hex) return { kind: "constant", hex, range: p.valueRange, quote };
  }
  return { kind: "other", text: p.valueText };
}
