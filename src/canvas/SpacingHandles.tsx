import { createSignal, Index, Show, type Accessor, type Setter } from "solid-js";
import type { Document } from "../editor/document";
import type { Gap } from "../editor/layout";
import type { SpreadSite } from "../editor/source";

/** How close (px) the pointer must come to a gap for its handle to appear. */
const PROXIMITY = 12;

type Target = { spreadIndex: number; gapIndex: number };
type Drag = Target & {
  pointerId: number;
  startX: number;
  startY: number;
  startValue: number;
  lastValue: number;
};

/**
 * Figma-style spacing handles. A full-size overlay layer tracks the pointer;
 * when it comes within PROXIMITY of a gap whose spread has a numeric
 * `spacing` literal, a pink pill appears in that gap. Dragging it rewrites
 * the literal in the code (through the document), which re-renders the chart
 * through the normal path. The handles hold no chart state of their own.
 */
export function SpacingHandles(props: {
  doc: Document;
  /** Gap boxes from the most recent render, in overlay pixels. */
  gaps: Accessor<Gap[]>;
  /** Screen pixels per chart pixel. */
  scale: Accessor<number>;
  /** Spread sites of the CURRENT code, or null when no handles may be offered. */
  sites: Accessor<SpreadSite[] | null>;
  /** The spread level being hovered or dragged (drives the code highlight). */
  activeLevel: Accessor<number | null>;
  setActiveLevel: Setter<number | null>;
}) {
  let layer!: HTMLDivElement;
  const [hot, setHot] = createSignal<Target | null>(null);
  const [drag, setDrag] = createSignal<Drag | null>(null);
  const [pointer, setPointer] = createSignal({ x: 0, y: 0 });

  const literalFor = (k: number) => props.sites()?.[k]?.literal ?? null;
  const target = () => drag() ?? hot();
  const isTarget = (g: Gap) => {
    const t = target();
    return !!t && t.spreadIndex === g.spreadIndex && t.gapIndex === g.gapIndex;
  };

  function findHot(clientX: number, clientY: number): Target | null {
    const box = layer.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    let best: Target | null = null;
    let bestDist = PROXIMITY;
    for (const g of props.gaps()) {
      if (!literalFor(g.spreadIndex)) continue; // no literal, no handle
      const dx = Math.max(g.left - x, 0, x - (g.left + g.width));
      const dy = Math.max(g.top - y, 0, y - (g.top + g.height));
      const d = Math.hypot(dx, dy);
      if (d <= bestDist) {
        bestDist = d;
        best = { spreadIndex: g.spreadIndex, gapIndex: g.gapIndex };
      }
    }
    return best;
  }

  function onPointerMove(e: PointerEvent) {
    setPointer({ x: e.clientX, y: e.clientY });
    const d = drag();
    if (!d) {
      const t = findHot(e.clientX, e.clientY);
      setHot(t);
      props.setActiveLevel(t ? t.spreadIndex : null);
      return;
    }
    const gap = props.gaps().find((g) => g.spreadIndex === d.spreadIndex);
    const alongY = gap?.dir === "y";
    const delta = (alongY ? e.clientY - d.startY : e.clientX - d.startX) / props.scale();
    const value = Math.max(0, Math.round(d.startValue + delta));
    if (value === d.lastValue) return;
    // Re-read the literal's CURRENT range: its length changes as it is edited.
    const literal = literalFor(d.spreadIndex);
    if (!literal) return;
    setDrag({ ...d, lastValue: value });
    props.doc.replaceRange(literal.start, literal.end, String(value));
  }

  function onPointerDown(e: PointerEvent) {
    const t = findHot(e.clientX, e.clientY);
    const literal = t && literalFor(t.spreadIndex);
    if (!t || !literal) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    props.doc.beginGesture();
    setDrag({
      ...t,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startValue: literal.value,
      lastValue: literal.value,
    });
    props.setActiveLevel(t.spreadIndex);
  }

  function onPointerUp(e: PointerEvent) {
    const d = drag();
    if (!d || d.pointerId !== e.pointerId) return;
    if (layer.hasPointerCapture(e.pointerId)) layer.releasePointerCapture(e.pointerId);
    setDrag(null);
    props.doc.endGesture();
    const t = findHot(e.clientX, e.clientY);
    setHot(t);
    props.setActiveLevel(t ? t.spreadIndex : null);
  }

  function onPointerLeave() {
    if (drag()) return;
    setHot(null);
    props.setActiveLevel(null);
  }

  const cursor = () => {
    const t = target();
    if (!t) return undefined;
    const g = props.gaps().find((g) => g.spreadIndex === t.spreadIndex);
    return g?.dir === "y" ? "ns-resize" : "ew-resize";
  };

  const badgeValue = () => {
    const t = target();
    return t ? literalFor(t.spreadIndex)?.value : undefined;
  };

  return (
    <div
      class="handles-layer"
      classList={{ dragging: !!drag() }}
      style={{ cursor: cursor() }}
      ref={layer}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      <Index each={props.gaps()}>
        {(g) => (
          <Show when={literalFor(g().spreadIndex)}>
            <div
              class="gap"
              classList={{
                "gap-y": g().dir === "y",
                "same-level": props.activeLevel() === g().spreadIndex,
                target: isTarget(g()),
              }}
              style={{
                left: `${g().left}px`,
                top: `${g().top}px`,
                width: `${g().width}px`,
                height: `${g().height}px`,
              }}
            >
              <div class="gap-fill" />
              <div class="gap-pill" />
            </div>
          </Show>
        )}
      </Index>
      <Show when={badgeValue() !== undefined}>
        <div
          class="badge"
          style={{ left: `${pointer().x + 14}px`, top: `${pointer().y - 30}px` }}
        >
          {badgeValue()}
        </div>
      </Show>
    </div>
  );
}
