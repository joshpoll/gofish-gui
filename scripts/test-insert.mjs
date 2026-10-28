// Quick checks for src/editor/insert.ts: `node scripts/test-insert.mjs`.
// Loads the TypeScript module through Vite's SSR loader (no extra deps).
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
const { insertFlowOp, flowOpText } = await server.ssrLoadModule("/src/editor/insert.ts");
const { derivePipeline } = await server.ssrLoadModule("/src/editor/pipeline.ts");

const OP = 'stack({ dir: "y" })';
const apply = (code, i) => {
  const ins = insertFlowOp(code, i, OP);
  assert.ok(ins, `no insertion at ${i}`);
  const out = code.slice(0, ins.from) + ins.text + code.slice(ins.to);
  assert.equal(out.slice(ins.selectFrom, ins.selectTo), OP, "selection covers the op");
  return out;
};
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n${e.message}`); }
};

const multi = `chart(data, { axes: true })
  .flow(
    spread({ by: "region", dir: "x", spacing: 40 }),
    spread({ by: "quarter", dir: "x", spacing: 8 }),
  )
  .mark(rect({ h: "total", fill: "#7c8a99" }))
`;
const line = (s) => `    ${s},\n`;
const R = line('spread({ by: "region", dir: "x", spacing: 40 })');
const Q = line('spread({ by: "quarter", dir: "x", spacing: 8 })');
const S = line(OP);
const wrap = (body) => `chart(data, { axes: true })\n  .flow(\n${body}  )\n  .mark(rect({ h: "total", fill: "#7c8a99" }))\n`;

check("multi-line, index 0", () => assert.equal(apply(multi, 0), wrap(S + R + Q)));
check("multi-line, between", () => assert.equal(apply(multi, 1), wrap(R + S + Q)));
check("multi-line, at end (trailing comma)", () => assert.equal(apply(multi, 2), wrap(R + Q + S)));
check("multi-line, at end (no trailing comma)", () => {
  const code = multi.replace("spacing: 8 }),\n", "spacing: 8 })\n");
  assert.equal(apply(code, 2), code.replace("spacing: 8 })\n", `spacing: 8 }),\n    ${OP}\n`));
});

const inline = `chart(data).flow(spread({ by: "a", dir: "x" }), spread({ by: "b", dir: "x" })).mark(rect({}))`;
check("inline, index 0", () =>
  assert.equal(apply(inline, 0), inline.replace("flow(", `flow(${OP}, `)));
check("inline, between", () =>
  assert.equal(apply(inline, 1), inline.replace(`}), spread({ by: "b"`, `}), ${OP}, spread({ by: "b"`)));
check("inline, at end", () =>
  assert.equal(apply(inline, 2), inline.replace(`"x" })).mark`, `"x" }), ${OP}).mark`)));

check("no .flow, multi-line", () => {
  const code = `chart(data, { axes: true })\n  .mark(rect({ h: "total" }))\n`;
  assert.equal(apply(code, 0), `chart(data, { axes: true })\n  .flow(${OP})\n  .mark(rect({ h: "total" }))\n`);
});
check("no .flow, inline", () => {
  const code = `chart(data).mark(rect({}))`;
  assert.equal(apply(code, 0), `chart(data).flow(${OP}).mark(rect({}))`);
});
check("empty .flow()", () => {
  const code = `chart(data).flow().mark(rect({}))`;
  assert.equal(apply(code, 0), `chart(data).flow(${OP}).mark(rect({}))`);
});
check("out of range / not a chart", () => {
  assert.equal(insertFlowOp(multi, 3, OP), null);
  assert.equal(insertFlowOp(`foo(data).flow(a)`, 0, OP), null);
  assert.equal(insertFlowOp(`chart(`, 0, OP), null);
});

check("flowOpText: keyed and keyless templates", () => {
  assert.equal(flowOpText("stack", "product"), 'stack({ by: "product", dir: "y" })');
  assert.equal(flowOpText("spread", "product"), 'spread({ by: "product", dir: "x" })');
  assert.equal(flowOpText("stack"), 'stack({ dir: "y" })');
  assert.equal(flowOpText("spread"), 'spread({ dir: "x" })');
});
check("insert a keyed stack between the spreads", () => {
  const op = flowOpText("stack", "product");
  const ins = insertFlowOp(multi, 2, op);
  const out = multi.slice(0, ins.from) + ins.text + multi.slice(ins.to);
  assert.equal(out, wrap(R + Q + line(op)));
  assert.equal(out.slice(ins.selectFrom, ins.selectTo), op);
});

check("pipeline insert indices", () => {
  const r = derivePipeline(multi);
  assert.ok(r.ok);
  assert.deepEqual(r.nodes.map((n) => [n.name, n.insertIndex]),
    [["chart", undefined], ["spread", 0], ["spread", 1], ["rect", 2]]);
  assert.equal(r.nodes[0].detail, "data · axes: true");
  assert.equal(r.nodes[3].detail, "h: total", "rect detail leaves fill to its control");
  const r2 = derivePipeline(`chart(data).mark(rect({}))`);
  assert.deepEqual(r2.nodes.map((n) => [n.name, n.insertIndex]), [["chart", undefined], ["rect", 0]]);
});

await server.close();
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all passed");
