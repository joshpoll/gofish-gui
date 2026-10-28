import { Show, Index, For, createSignal, onCleanup, createEffect, type Accessor } from "solid-js";
import type { PipelineNode } from "../editor/pipeline";
import type { Document } from "../editor/document";
import type { FillState } from "../editor/props";
import { FLOW_OPS, type FlowOp } from "../editor/insert";
import { Glyph } from "./glyphs";
import { FillControl } from "./FillControl";

/**
 * The pipeline panel: one row per stage of the chart's builder chain, a
 * square tile with a glyph and the stage's name and options to its left.
 * It is a view derived from the code; clicking a row selects its code.
 * A "+" on the connector above a stage inserts a new flow operator there:
 * pick the operator, then the data field it groups by (or no key).
 * The rect row carries a fill control (see FillControl.tsx).
 */
export function Pipeline(props: {
  nodes: Accessor<PipelineNode[]>;
  /** Code range being manipulated on the canvas; the row containing it lights up. */
  active: Accessor<{ from: number; to: number } | null>;
  onSelect: (node: PipelineNode) => void;
  /** Insert a flow operator at this index of the `.flow(...)` arguments. */
  onInsert: (flowIndex: number, op: FlowOp, by: string | undefined) => void;
  /** Data field names, offered as grouping keys and fill fields. */
  fields: string[];
  doc: Document;
  /** The mark's fill, and the source range of the mark call it belongs to. */
  fill: Accessor<{ state: FillState; callStart: number } | null>;
}) {
  const isActive = (n: PipelineNode) => {
    const a = props.active();
    return !!a && n.range.start <= a.from && a.to <= n.range.end;
  };

  // The flow index whose picker is open, if any, and the operator chosen
  // in its first step (the second step then lists the fields).
  const [open, setOpen] = createSignal<number | null>(null);
  const [op, setOp] = createSignal<FlowOp | null>(null);
  createEffect(() => {
    open(); // a picker opening, closing or moving starts at step one
    setOp(null);
  });
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
  const choose = (i: number, by: string | undefined) => {
    const o = op();
    setOpen(null);
    if (o) props.onInsert(i, o, by);
  };
  const fillFor = (n: PipelineNode) => {
    const f = props.fill();
    return n.kind === "rect" && f && f.callStart === n.range.start ? f : null;
  };

  return (
    <div class="pipeline">
      <Index each={props.nodes()}>
        {(node) => (
          <div class="pipe-item">
            {/* A div, not a button, because the rect row holds form controls. */}
            <div
              role="button"
              tabindex="0"
              class="pipe-row"
              classList={{ active: isActive(node()) }}
              title={node().detail ? `${node().name}: ${node().detail}` : node().name}
              onClick={() => props.onSelect(node())}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                props.onSelect(node());
              }}
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
                <span class="pipe-detail">
                  {node().detail}
                  <Show when={fillFor(node())}>
                    {(f) => (
                      <>
                        <Show when={node().detail}>{" · "}</Show>
                        <FillControl
                          doc={props.doc}
                          fill={() => f().state}
                          fields={props.fields}
                        />
                      </>
                    )}
                  </Show>
                </span>
              </span>
              <span class="pipe-tile">
                <Glyph node={node()} />
              </span>
            </div>
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
                    <Show
                      when={op()}
                      fallback={(Object.keys(FLOW_OPS) as FlowOp[]).map((o) => (
                        <button type="button" role="menuitem" onClick={() => setOp(o)}>
                          {o}
                        </button>
                      ))}
                    >
                      {(o) => (
                        <>
                          <button
                            type="button"
                            class="pipe-picker-back"
                            title="Back"
                            aria-label="Back"
                            onClick={() => setOp(null)}
                          >
                            ‹
                          </button>
                          <span class="pipe-picker-label">{o()} by</span>
                          <For each={props.fields}>
                            {(f) => (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => choose(node().insertIndex!, f)}
                              >
                                {f}
                              </button>
                            )}
                          </For>
                          <button
                            type="button"
                            role="menuitem"
                            class="pipe-picker-nokey"
                            onClick={() => choose(node().insertIndex!, undefined)}
                          >
                            no key
                          </button>
                        </>
                      )}
                    </Show>
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
