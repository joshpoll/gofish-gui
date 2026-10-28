import { createSignal, onCleanup, Show, type Accessor } from "solid-js";
import type { Document } from "../editor/document";
import { firstRow, type Leaf } from "../editor/layout";
import { planRibbon } from "../editor/ribbon";

type Drag = { pointerId: number; from: Leaf };

/**
 * The ribbon tool: drag from one rect to another to append
 * `.layer(ribbon({ along: <field> }))` to the chain. The field is the one
 * flow tier whose value differs between the two rects (see ribbon.ts); any
 * other drag makes no edit and says why. The only state here is the pointer
 * and the drag in progress; the rects come from the last render.
 */
export function RibbonTool(props: {
  doc: Document;
  /** Data marks from the most recent render, in overlay pixels. */
  leaves: Accessor<Leaf[]>;
  /** Show a message in the status line. */
  note: (message: string) => void;
  /** Return to Select: after the ribbon is written, or on Escape mid-drag. */
  onDone: () => void;
}) {
  let layer!: HTMLDivElement;
  const [pointer, setPointer] = createSignal<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = createSignal<Drag | null>(null);

  const local = (e: PointerEvent) => {
    const box = layer.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  // The topmost rect under a point (later leaves are drawn on top).
  const leafAt = (p: { x: number; y: number } | null) => {
    if (!p) return null;
    const hits = props.leaves().filter(
      (l) => p.x >= l.left && p.x <= l.left + l.width && p.y >= l.top && p.y <= l.top + l.height
    );
    return hits[hits.length - 1] ?? null;
  };
  const hover = () => leafAt(pointer());

  function cancel() {
    const d = drag();
    if (d && layer.hasPointerCapture(d.pointerId)) layer.releasePointerCapture(d.pointerId);
    setDrag(null);
  }

  // Escape cancels a drag and returns to Select wherever focus is (outside
  // a drag, the app's own shortcut handler does the same).
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !drag()) return;
    cancel();
    props.onDone();
  };
  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));

  function onPointerDown(e: PointerEvent) {
    const from = leafAt(local(e));
    if (!from) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    setDrag({ pointerId: e.pointerId, from });
  }

  function onPointerUp(e: PointerEvent) {
    const d = drag();
    if (!d || d.pointerId !== e.pointerId) return;
    cancel();
    const to = leafAt(local(e));
    if (!to) return; // released on empty space: nothing to connect
    if (to === d.from) return props.note("Ribbon: drag to a different rect.");
    const plan = planRibbon(props.doc.code(), firstRow(d.from.datum), firstRow(to.datum));
    if (!plan.ok) return props.note(plan.reason);
    const ins = plan.insertion;
    props.doc.beginGesture();
    props.doc.replaceRange(ins.from, ins.to, ins.text);
    props.doc.endGesture();
    props.doc.select(ins.selectFrom, ins.selectTo);
    props.onDone();
  }

  const box = (l: Leaf) => ({
    left: `${l.left}px`,
    top: `${l.top}px`,
    width: `${l.width}px`,
    height: `${l.height}px`,
  });
  const centre = (l: Leaf) => ({ x: l.left + l.width / 2, y: l.top + l.height / 2 });

  return (
    <div
      class="tool-layer"
      style={{ cursor: hover() || drag() ? "crosshair" : "default" }}
      ref={layer}
      onPointerMove={(e) => setPointer(local(e))}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onPointerLeave={() => !drag() && setPointer(null)}
    >
      <Show when={drag()}>
        {(d) => <div class="leaf-outline" style={box(d().from)} />}
      </Show>
      <Show when={hover() !== drag()?.from && hover()}>
        {(l) => <div class="leaf-outline" style={box(l())} />}
      </Show>
      <Show when={drag() && pointer()}>
        {(p) => (
          <svg class="tool-preview">
            <line
              x1={centre(drag()!.from).x}
              y1={centre(drag()!.from).y}
              x2={p().x}
              y2={p().y}
            />
            <circle cx={centre(drag()!.from).x} cy={centre(drag()!.from).y} r={3} />
          </svg>
        )}
      </Show>
    </div>
  );
}
