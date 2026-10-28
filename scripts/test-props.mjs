// Quick checks for src/editor/props.ts: `node scripts/test-props.mjs`.
// Loads the TypeScript module through Vite's SSR loader (no extra deps).
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
const { findMarkProperty, setMarkProperty, classifyFill, colorHex, stringSource } =
  await server.ssrLoadModule("/src/editor/props.ts");

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n${e.message}`); }
};
const apply = (code, e) => {
  assert.ok(e, "no edit");
  return code.slice(0, e.from) + e.text + code.slice(e.to);
};
const FIELDS = ["region", "quarter", "product", "total"];
const code = `chart(data, { axes: true })
  .flow(spread({ by: "region", dir: "x" }))
  .mark(rect({ h: "total", fill: "#7c8a99" }))
`;

check("find: string fill", () => {
  const p = findMarkProperty(code, "fill");
  assert.equal(p.valueText, '"#7c8a99"');
  assert.equal(p.isString, true);
  assert.equal(p.stringValue, "#7c8a99");
  assert.equal(code.slice(p.valueRange.start, p.valueRange.end), '"#7c8a99"');
  assert.equal(code.slice(p.objectRange.start, p.objectRange.end), '{ h: "total", fill: "#7c8a99" }');
  assert.equal(code.slice(p.callRange.start, p.callRange.end), 'rect({ h: "total", fill: "#7c8a99" })');
});
check("find: missing / non-string / no mark / no parse", () => {
  const missing = findMarkProperty(code.replace(', fill: "#7c8a99"', ""), "fill");
  assert.equal(missing.valueRange, null);
  assert.ok(missing.objectRange);
  const expr = findMarkProperty(code.replace('"#7c8a99"', "c"), "fill");
  assert.equal(expr.isString, false);
  assert.equal(expr.valueText, "c");
  assert.equal(findMarkProperty(`chart(data).flow(spread({}))`, "fill"), null);
  assert.equal(findMarkProperty(`chart(data).mark(rect(opts))`, "fill"), null);
  assert.equal(findMarkProperty(`chart(`, "fill"), null);
});

check("set: replace an existing value", () => {
  assert.equal(apply(code, setMarkProperty(code, "fill", '"#ff0000"')), code.replace("#7c8a99", "#ff0000"));
  assert.equal(apply(code, setMarkProperty(code, "fill", '"product"')), code.replace('"#7c8a99"', '"product"'));
});
check("set: add after the last property", () => {
  const c = code.replace(', fill: "#7c8a99"', "");
  assert.equal(apply(c, setMarkProperty(c, "fill", '"region"')), code.replace('"#7c8a99"', '"region"'));
});
check("set: add into {} and into rect()", () => {
  assert.equal(apply(`chart(data).mark(rect({}))`, setMarkProperty(`chart(data).mark(rect({}))`, "fill", '"red"')),
    `chart(data).mark(rect({ fill: "red" }))`);
  assert.equal(apply(`chart(data).mark(rect())`, setMarkProperty(`chart(data).mark(rect())`, "fill", '"red"')),
    `chart(data).mark(rect({ fill: "red" }))`);
  assert.equal(setMarkProperty(`chart(data).mark(rect(opts))`, "fill", '"red"'), null);
});

check("classify: gofish's rule, field names first", () => {
  const cls = (c) => classifyFill(findMarkProperty(c, "fill"), FIELDS);
  assert.equal(cls(code).kind, "constant");
  assert.equal(cls(code).hex, "#7c8a99");
  assert.deepEqual(
    (({ kind, field }) => ({ kind, field }))(cls(code.replace('"#7c8a99"', '"product"'))),
    { kind: "data", field: "product" });
  assert.equal(cls(code.replace('"#7c8a99"', "'red'")).hex, "#ff0000");
  assert.equal(cls(code.replace('"#7c8a99"', "'red'")).quote, "'");
  assert.deepEqual(cls(code.replace('"#7c8a99"', '"steelblue"')), { kind: "other", text: '"steelblue"' });
  assert.deepEqual(cls(code.replace('"#7c8a99"', "c")), { kind: "other", text: "c" });
  assert.deepEqual(cls(code.replace(', fill: "#7c8a99"', "")), { kind: "unset" });
  // A field named like a colour is a field, as in gofish.
  assert.equal(classifyFill(findMarkProperty(code.replace("#7c8a99", "red"), "fill"), ["red"]).kind, "data");
});
check("colorHex and stringSource", () => {
  assert.equal(colorHex("#ABC"), "#aabbcc");
  assert.equal(colorHex("#7C8A99"), "#7c8a99");
  assert.equal(colorHex("Navy"), "#000080");
  assert.equal(colorHex("#12345"), null);
  assert.equal(colorHex("rgb(0,0,0)"), null);
  assert.equal(stringSource("a'b", "'"), "'a\\'b'");
  assert.equal(stringSource("x"), '"x"');
});

await server.close();
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all passed");
