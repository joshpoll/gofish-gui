import { Show, Index, createSignal, onCleanup, createEffect, type Accessor } from "solid-js";
import type { PipelineNode } from "../editor/pipeline";
import { FLOW_TEMPLATES, type FlowTemplate } from "../editor/insert";
import { Glyph } from "./glyphs";

/**
 * The pipeline panel: one row per stage of the chart's builder chain, a
 * square tile with a glyph and the stage's name and options to its left.
 * It is a view derived from the code; clicking a row selects its code.
 * A "+" on the connector above a stage inserts a new flow operator there.
 */
export function Pipeline(props: {
  nodes: Accessor<PipelineNode[]>;
  /** Code range being manipulated on the canvas; the row containing it lights up. */
  active: Accessor<{ from: number; to: number } | null>;
  onSelect: (node: PipelineNode) => void;
  /** Insert a flow operator at this index of the `.flow(...)` arguments. */
  onInsert: (flowIndex: number, template: FlowTemplate) => void;
}) {
  const isActive = (n: PipelineNode) => {
    const a = props.active();
    return !!a && n.range.start <= a.from && a.to <= n.range.end;
  };

  // The flow index whose picker is open, if any.
  const [open, setOpen] = createSignal<number | null>(null);
  createEffect(() => {
    if (open() === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest(".pipe-insert")) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    });
  });
  const choose = (i: number, t: FlowTemplate) => {
    setOpen(null);
    props.onInsert(i, t);
  };

  return (
    <div class="pipeline">
      <Index each={props.nodes()}>
        {(node) => (
          <div class="pipe-item">
            <button
              type="button"
              class="pipe-row"
              classList={{ active: isActive(node()) }}
              title={node().detail ? `${node().name}: ${node().detail}` : node().name}
              onClick={() => props.onSelect(node())}
            >
              <span class="pipe-text">
                <span class="pipe-title">
                  <span class="pipe-name">{node().name}</span>
                  <Show when={node().key}>
                    <span class="pipe-key">
                      <span class="pipe-key-label">by </span>
                      {node().key}
                    </span>
                  </Show>
                </span>
                <span class="pipe-detail">{node().detail}</span>
              </span>
              <span class="pipe-tile">
                <Glyph node={node()} />
              </span>
            </button>
            <Show when={node().insertIndex !== undefined}>
              <div class="pipe-insert" classList={{ open: open() === node().insertIndex }}>
                <button
                  type="button"
                  class="pipe-plus"
                  title="Insert an operator here"
                  aria-label="Insert an operator here"
                  aria-expanded={open() === node().insertIndex}
                  onClick={() => {
                    const i = node().insertIndex!;
                    setOpen(open() === i ? null : i);
                  }}
                >
                  <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">
                    <path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                  </svg>
                </button>
                <Show when={open() === node().insertIndex}>
                  <div class="pipe-picker" role="menu">
                    {(Object.keys(FLOW_TEMPLATES) as FlowTemplate[]).map((t) => (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => choose(node().insertIndex!, t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        )}
      </Index>
    </div>
  );
}
