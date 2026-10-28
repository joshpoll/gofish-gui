import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { CodeEditor, type Range } from "./editor/CodeEditor";
import { createDocument } from "./editor/document";
import { checkAlignment, evaluate, type Evaluation } from "./editor/evaluate";
import type { Gap, Leaf } from "./editor/layout";
import { derivePipeline, type PipelineNode } from "./editor/pipeline";
import { flowOpText, insertFlowOp } from "./editor/insert";
import { classifyFill, findMarkProperty } from "./editor/props";
import { parseSource } from "./editor/source";
import { flowTiers } from "./editor/ribbon";
import { Chart, type Rendered } from "./canvas/Chart";
import { SpacingHandles } from "./canvas/SpacingHandles";
import { RibbonTool } from "./canvas/RibbonTool";
import { ToolBank, toolForKey, type Tool } from "./canvas/ToolBank";
import { Pipeline } from "./panel/Pipeline";
import { INITIAL_CODE, dataFields, salesByRegion } from "./data";

/** Typing re-evaluates after this pause; canvas drags re-evaluate at once. */
const TYPING_DEBOUNCE_MS = 100;

export function App() {
  const doc = createDocument(INITIAL_CODE);

  // Everything below is derived from the code text.
  const parsed = createMemo(() => parseSource(doc.code()));

  // The pipeline view. While the code does not parse, keep the last good one.
  const pipeline = createMemo<PipelineNode[]>((prev) => {
    const r = derivePipeline(doc.code());
    return r.ok ? r.nodes : prev;
  }, []);

  // The rect's fill, for the pipeline panel's fill control. Null (no
  // control) while the code does not parse or has no mark options object.
  const fields = dataFields();
  const fill = createMemo(() => {
    const p = findMarkProperty(doc.code(), "fill");
    return p ? { state: classifyFill(p, fields), callStart: p.callRange.start } : null;
  });

  const [evaluation, setEvaluation] = createSignal<Evaluation | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const code = doc.code();
    const p = parsed();
    const run = () => setEvaluation(evaluate(code, p, salesByRegion));
    clearTimeout(timer);
    if (doc.inGesture() || evaluation() === null) run();
    else timer = setTimeout(run, TYPING_DEBOUNCE_MS);
  });
  onCleanup(() => clearTimeout(timer));

  const okEvaluation = createMemo(() => {
    const ev = evaluation();
    return ev && ev.ok ? ev : null;
  });

  const [gaps, setGaps] = createSignal<Gap[]>([]);
  const [leaves, setLeaves] = createSignal<Leaf[]>([]);
  const [scale, setScale] = createSignal(1);
  const [renderError, setRenderError] = createSignal<string | null>(null);
  const onRendered = (r: Rendered) => {
    setGaps(r.gaps);
    setLeaves(r.leaves);
    setScale(r.scale);
  };

  // Handles are offered only when the current code parses and the last
  // evaluation lined up with it (see checkAlignment).
  const alignmentProblem = createMemo(() => {
    const ev = okEvaluation();
    return ev ? checkAlignment(parseSource(ev.code), ev.calls) : null;
  });
  const sites = createMemo(() => {
    const p = parsed();
    if (!p.ok || alignmentProblem()) return null;
    return p.sites;
  });

  const [activeLevel, setActiveLevel] = createSignal<number | null>(null);

  // The active canvas tool. Select (the spacing handles) is the default;
  // after a tool makes its edit, the app returns to Select, like tldraw.
  const [tool, setTool] = createSignal<Tool>("select");
  // The last canvas tool's message (why a drag made no edit). It is only
  // feedback about one gesture, so it clears when the tool or the code changes.
  const [toolNote, setToolNote] = createSignal<string | null>(null);
  createEffect(on([tool, doc.code], () => setToolNote(null), { defer: true }));
  createEffect(on(tool, () => setActiveLevel(null), { defer: true }));

  // V / T / R pick a tool and Escape returns to Select, unless the key is
  // meant for the code editor or a form control.
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as Element | null;
    if (t?.closest(".cm-editor, input, select, textarea, [contenteditable]")) return;
    const next = e.key === "Escape" ? "select" : toolForKey(e.key);
    if (!next) return;
    e.preventDefault();
    setTool(next);
  };
  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));
  const highlight = createMemo<Range | null>(() => {
    const k = activeLevel();
    const lit = k === null ? null : sites()?.[k]?.literal;
    return lit ? { from: lit.start, to: lit.end } : null;
  });

  const status = createMemo(() => {
    const p = parsed();
    if (!p.ok) return { error: true, text: p.error };
    const ev = evaluation();
    if (ev && !ev.ok) return { error: true, text: ev.error };
    if (renderError()) return { error: true, text: renderError()! };
    if (toolNote()) return { error: false, text: toolNote()! };
    if (tool() === "ribbon") {
      const tiers = flowTiers(doc.code());
      return {
        error: false,
        text: tiers.ok
          ? "Ribbon: drag from one rect to another that differs in one field. Esc returns to Select."
          : tiers.reason,
      };
    }
    if (tool() === "text") {
      // TODO: wire the Text tool. `.layer(text({ text: "total" }))` over the
      // rects draws one literal label "total" for the whole chart, not a
      // label per rect, so there is no edit yet that does what the tool means.
      return { error: false, text: "Text tool: placing labels is not wired yet." };
    }
    if (alignmentProblem()) return { error: false, text: alignmentProblem()! };
    const n = p.sites.filter((s) => s.literal).length;
    return {
      error: false,
      text:
        n > 0
          ? "Hover near a gap between bars and drag the pink handle. Cmd+Z undoes."
          : "No spread has a numeric spacing literal, so there is nothing to drag.",
    };
  });

  return (
    <div class="app">
      <header class="app-header">
        <strong>gofish gui</strong>
        <span class="muted">code is the source of truth; drag concrete numbers</span>
      </header>
      <main class="panes">
        <section class="pane code-pane">
          <div class="pane-header">pipeline</div>
          <Pipeline
            nodes={pipeline}
            active={highlight}
            onSelect={(n) => doc.select(n.range.start, n.range.end)}
            fields={fields}
            doc={doc}
            fill={fill}
            onInsert={(i, op, by) => {
              const ins = insertFlowOp(doc.code(), i, flowOpText(op, by));
              if (!ins) return;
              doc.replaceRange(ins.from, ins.to, ins.text);
              doc.select(ins.selectFrom, ins.selectTo);
            }}
          />
          <CodeEditor doc={doc} highlight={highlight} />
        </section>
        <section class="pane canvas-pane">
          <Chart
            evaluation={okEvaluation}
            onRendered={onRendered}
            onError={setRenderError}
          >
            <Show when={tool() === "select"}>
              <SpacingHandles
                doc={doc}
                gaps={gaps}
                scale={scale}
                sites={sites}
                activeLevel={activeLevel}
                setActiveLevel={setActiveLevel}
              />
            </Show>
            <Show when={tool() === "ribbon"}>
              <RibbonTool
                doc={doc}
                leaves={leaves}
                note={setToolNote}
                onDone={() => setTool("select")}
              />
            </Show>
          </Chart>
          <ToolBank tool={tool} setTool={setTool} />
        </section>
      </main>
      <footer class="status" classList={{ error: status().error }}>
        {status().text}
      </footer>
    </div>
  );
}
