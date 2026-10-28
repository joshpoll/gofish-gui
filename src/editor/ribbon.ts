import { derivePipeline } from "./pipeline";
import { appendChainMethod, type Insertion } from "./insert";

/**
 * The ribbon tool's rule, as pure functions of the code and two data rows.
 *
 * gofish's `ribbon({ along: f })` draws one band per combination of the
 * other flow tiers' `by` values, travelling along the tier grouped by `f`.
 * So a drag from rect A to rect B names a ribbon exactly when A and B differ
 * in one tier's field: that field is `along`. Any other drag (same values,
 * or two or more fields differ) is ambiguous, and the editor does not guess.
 */

type Row = Record<string, unknown> | undefined;

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

/**
 * The `by` field of every spread and stack in the chain, in pipeline order.
 * Fails when the code does not parse, has no such stage, or one of them has
 * no literal `by` string (its grouping cannot be read from the code).
 */
export function flowTiers(code: string): Result<{ fields: string[] }> {
  const p = derivePipeline(code);
  if (!p.ok) return { ok: false, reason: "Ribbon: the code does not parse." };
  const stages = p.nodes.filter((n) => n.kind === "spread" || n.kind === "stack");
  if (stages.length === 0) {
    return { ok: false, reason: "Ribbon: the chart has no spread or stack to travel along." };
  }
  const missing = stages.find((n) => n.key === undefined);
  if (missing) {
    return {
      ok: false,
      reason: `Ribbon: a ${missing.name} has no literal \`by\` field, so its tier cannot be read from the code.`,
    };
  }
  return { ok: true, fields: stages.map((n) => n.key!) };
}

/** The one tier field whose values differ between rows `a` and `b`. */
export function ribbonAlong(fields: string[], a: Row, b: Row): Result<{ field: string }> {
  if (!a || !b) return { ok: false, reason: "Ribbon: a rect has no data row." };
  const differ = fields.filter((f) => String(a[f]) !== String(b[f]));
  if (differ.length === 1) return { ok: true, field: differ[0] };
  const hint = "drag between rects that differ in one field.";
  if (differ.length === 0) {
    return { ok: false, reason: `Ribbon: the two rects have the same ${list(fields)}; ${hint}` };
  }
  return { ok: false, reason: `Ribbon: the two rects differ in ${list(differ)}; ${hint}` };
}

/** Source text of the method appended to the chain, without its dot. */
export function ribbonLayerText(along: string): string {
  return `layer(ribbon({ along: ${JSON.stringify(along)}, opacity: 0.5 }))`;
}

/** The whole gesture: tiers, rule and text edit. */
export function planRibbon(code: string, a: Row, b: Row): Result<{ along: string; insertion: Insertion }> {
  const tiers = flowTiers(code);
  if (!tiers.ok) return tiers;
  const along = ribbonAlong(tiers.fields, a, b);
  if (!along.ok) return along;
  const insertion = appendChainMethod(code, ribbonLayerText(along.field));
  if (!insertion) return { ok: false, reason: "Ribbon: the code is not a chart(...) chain." };
  return { ok: true, along: along.field, insertion };
}

/** `a`, `a and b`, `a, b and c`. */
function list(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
