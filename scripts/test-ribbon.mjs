// Quick checks for the ribbon tool's pure parts: `node scripts/test-ribbon.mjs`.
// appendChainMethod (insert.ts), the ribbon rule (ribbon.ts) and the
// pipeline's ribbon row. Loads the TypeScript through Vite's SSR loader.
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
const { appendChainMethod } = await server.ssrLoadModule("/src/editor/insert.ts");
const { flowTiers, ribbonAlong, ribbonLayerText, planRibbon } = await server.ssrLoadModule("/src/editor/ribbon.ts");
const { derivePipeline } = await server.ssrLoadModule("/src/editor/pipeline.ts");
const { INITIAL_CODE } = await server.ssrLoadModule("/src/data.ts");

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n${e.message}`); }
};
const apply = (code, ins) => {
  assert.ok(ins, "no insertion");
  return code.slice(0, ins.from) + ins.text + code.slice(ins.to);
};

const M = 'layer(ribbon({ along: "product", opacity: 0.5 }))';
const row = (quarter, product, region) => ({ quarter, product, region, total: 1 });

check("append: multi-line chain keeps its indent", () => {
  const ins = appendChainMethod(INITIAL_CODE, M);
  const out = apply(INITIAL_CODE, ins);
  assert.equal(out, INITIAL_CODE.replace('fill: "region" }))\n', `fill: "region" }))\n  .${M}\n`));
  assert.equal(out.slice(ins.selectFrom, ins.selectTo), M);
});
check("append: inline chain stays inline", () => {
  const code = `chart(data).flow(spread({ by: "a" })).mark(rect({}))`;
  assert.equal(apply(code, appendChainMethod(code, M)), `${code}.${M}`);
});
check("append: other indents and comments", () => {
  const code = `chart(data)\n    .mark(rect({}))`;
  assert.equal(apply(code, appendChainMethod(code, M)), `${code}\n    .${M}`);
  const commented = `chart(data)\n  // the mark\n  .mark(rect({}))`;
  assert.equal(apply(commented, appendChainMethod(commented, M)), `${commented}\n  .${M}`);
});
check("append: bare chart() and non-charts", () => {
  assert.equal(apply(`chart(data)`, appendChainMethod(`chart(data)`, M)), `chart(data)\n  .${M}`);
  assert.equal(appendChainMethod(`foo(data).mark(rect({}))`, M), null);
  assert.equal(appendChainMethod(`chart(`, M), null);
});

check("tiers: in pipeline order, spreads and stacks", () => {
  assert.deepEqual(flowTiers(INITIAL_CODE), { ok: true, fields: ["quarter", "product", "region"] });
});
check("tiers: a stage without a literal by blocks the tool", () => {
  const r = flowTiers(INITIAL_CODE.replace('stack({ by: "region", dir: "y" })', 'stack({ dir: "y" })'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /stack has no literal `by`/);
  assert.equal(flowTiers(INITIAL_CODE.replace('by: "quarter"', "by: q")).ok, false);
  assert.equal(flowTiers(`chart(data).mark(rect({}))`).ok, false);
});

const F = ["quarter", "product", "region"];
check("rule: exactly one differing field is along", () => {
  assert.deepEqual(ribbonAlong(F, row("Q1", "A", "North"), row("Q1", "B", "North")), { ok: true, field: "product" });
  assert.deepEqual(ribbonAlong(F, row("Q1", "A", "North"), row("Q2", "A", "North")), { ok: true, field: "quarter" });
  assert.deepEqual(ribbonAlong(F, row("Q1", "A", "North"), row("Q1", "A", "East")), { ok: true, field: "region" });
});
check("rule: zero or several differing fields make no edit", () => {
  const two = ribbonAlong(F, row("Q1", "A", "North"), row("Q2", "B", "North"));
  assert.equal(two.reason, "Ribbon: the two rects differ in quarter and product; drag between rects that differ in one field.");
  const three = ribbonAlong(F, row("Q1", "A", "North"), row("Q2", "B", "East"));
  assert.match(three.reason, /differ in quarter, product and region;/);
  const none = ribbonAlong(F, row("Q1", "A", "North"), row("Q1", "A", "North"));
  assert.match(none.reason, /have the same quarter, product and region;/);
  assert.equal(ribbonAlong(F, undefined, row("Q1", "A", "North")).ok, false);
});

check("plan: the whole edit", () => {
  const p = planRibbon(INITIAL_CODE, row("Q1", "A", "North"), row("Q1", "B", "North"));
  assert.equal(p.ok, true);
  assert.equal(p.along, "product");
  assert.equal(apply(INITIAL_CODE, p.insertion), INITIAL_CODE.replace(/\n$/, `\n  .${ribbonLayerText("product")}\n`));
  assert.equal(planRibbon(INITIAL_CODE, row("Q1", "A", "North"), row("Q2", "B", "North")).ok, false);
});

check("pipeline: .layer(ribbon(...)) is a ribbon row", () => {
  const code = apply(INITIAL_CODE, appendChainMethod(INITIAL_CODE, M));
  const r = derivePipeline(code);
  const last = r.nodes[r.nodes.length - 1];
  assert.equal(last.kind, "ribbon");
  assert.equal(last.detail, "along: product · opacity: 0.5");
  assert.equal(code.slice(last.range.start, last.range.end), M);
  // Anything else in .layer stays a generic op.
  const other = derivePipeline(`chart(data).mark(rect({})).layer(text({}))`);
  assert.equal(other.nodes[other.nodes.length - 1].kind, "op");
});

await server.close();
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all passed");
