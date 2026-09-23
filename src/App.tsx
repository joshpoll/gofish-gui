import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { CodeEditor, type Range } from "./editor/CodeEditor";
import { createDocument } from "./editor/document";
import { checkAlignment, evaluate, type Evaluation } from "./editor/evaluate";
import type { Gap } from "./editor/layout";
import { derivePipeline, type PipelineNode } from "./editor/pipeline";
import { FLOW_TEMPLATES, insertFlowOp } from "./editor/insert";
import { parseSource } from "./editor/source";
import { Chart, type Rendered } from "./canvas/Chart";
import { SpacingHandles } from "./canvas/SpacingHandles";
import { Pipeline } from "./panel/Pipeline";
import { INITIAL_CODE, salesByRegion } from "./data";

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
  const [scale, setScale] = createSignal(1);
  const [renderError, setRenderError] = createSignal<string | null>(null);
  const onRendered = (r: Rendered) => {
    setGaps(r.gaps);
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
            onInsert={(i, t) => {
              const ins = insertFlowOp(doc.code(), i, FLOW_TEMPLATES[t]);
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
            <SpacingHandles
              doc={doc}
              gaps={gaps}
              scale={scale}
              sites={sites}
              activeLevel={activeLevel}
              setActiveLevel={setActiveLevel}
            />
          </Chart>
        </section>
      </main>
      <footer class="status" classList={{ error: status().error }}>
        {status().text}
      </footer>
    </div>
  );
}
