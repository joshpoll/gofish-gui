import { createEffect, type Accessor, type JSX } from "solid-js";
import { RENDER_OPTIONS, type Evaluation } from "../editor/evaluate";
import { computeGaps, dataLeaves, type Gap, type Leaf } from "../editor/layout";

type Ok = Extract<Evaluation, { ok: true }>;

export type Rendered = {
  /** The evaluation this render came from. */
  evaluation: Ok;
  /** Gap boxes in overlay (container) pixels. */
  gaps: Gap[];
  /** Data marks (rects) in overlay pixels, for the canvas tools' hit tests. */
  leaves: Leaf[];
  /** Screen pixels per display-list pixel (1 unless the SVG is scaled). */
  scale: number;
};

/**
 * Renders the latest evaluation into a mount div. gofish clears the
 * innerHTML of the element it renders into, so the chart gets its own child
 * mount and the overlay (`props.children`, the handles) sits beside it.
 *
 * Renders are serialized by a pump: at most one render is in flight, and
 * when it finishes only the LATEST requested evaluation is rendered next.
 * Stale renders are never queued, so a fast drag cannot finish out of order.
 */
export function Chart(props: {
  evaluation: Accessor<Ok | null>;
  onRendered: (r: Rendered) => void;
  onError: (message: string | null) => void;
  children?: JSX.Element;
}) {
  let container!: HTMLDivElement;
  let mount!: HTMLDivElement;

  let latest: Ok | null = null;
  let lastDone: Ok | null = null;
  let inFlight = false;

  function pump() {
    if (inFlight || !latest || latest === lastDone) return;
    const ev = latest;
    inFlight = true;
    renderOnce(ev)
      .then((r) => {
        props.onRendered(r);
        props.onError(null);
      })
      .catch((e: unknown) => {
        props.onError(`Render error: ${(e as Error)?.message ?? String(e)}`);
      })
      .finally(() => {
        lastDone = ev;
        inFlight = false;
        pump(); // catch up if newer code arrived meanwhile
      });
  }

  async function renderOnce(ev: Ok): Promise<Rendered> {
    // Same builder, same options: the display list's pixels are the SVG's.
    // Layout runs first so a layout error leaves the previous chart on screen.
    const dl = await ev.spec.toDisplayList(RENDER_OPTIONS);
    await ev.spec.render(mount, RENDER_OPTIONS);
    await nextFrame(); // let the reactive mount land before measuring
    const svg = mount.querySelector("svg");
    const box = container.getBoundingClientRect();
    const svgBox = svg?.getBoundingClientRect();
    const scale = svgBox && dl.viewport.w > 0 ? svgBox.width / dl.viewport.w : 1;
    const dx = svgBox ? svgBox.left - box.left : 0;
    const dy = svgBox ? svgBox.top - box.top : 0;
    const toOverlay = <B extends { left: number; top: number; width: number; height: number }>(b: B): B => ({
      ...b,
      left: dx + b.left * scale,
      top: dy + b.top * scale,
      width: b.width * scale,
      height: b.height * scale,
    });
    const gaps = computeGaps(dl, ev.calls).map(toOverlay);
    const leaves = dataLeaves(dl).map(toOverlay);
    return { evaluation: ev, gaps, leaves, scale };
  }

  createEffect(() => {
    const ev = props.evaluation();
    if (!ev) return;
    latest = ev;
    pump();
  });

  return (
    <div class="chart" ref={container}>
      <div class="chart-mount" ref={mount} />
      {props.children}
    </div>
  );
}

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
