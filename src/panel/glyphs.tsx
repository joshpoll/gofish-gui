import { Match, Switch, type JSX } from "solid-js";
import type { PipelineNode } from "../editor/pipeline";

/**
 * Monochrome, stroke-based glyphs for pipeline stages (24px viewBox,
 * currentColor), so a tile turns pink with its text color.
 */
function Svg(props: { children: JSX.Element }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

/** Three bars along `dir`, each `size` wide, `gap` apart, centered in 24. */
function Bars(props: { dir: "x" | "y"; size: number; gap: number }) {
  const total = () => 3 * props.size + 2 * props.gap;
  const offset = (i: number) => (24 - total()) / 2 + i * (props.size + props.gap);
  return (
    <>
      {[0, 1, 2].map((i) =>
        props.dir === "x" ? (
          <rect x={offset(i)} y={5} width={props.size} height={14} />
        ) : (
          <rect x={5} y={offset(i)} width={14} height={props.size} />
        )
      )}
    </>
  );
}

export function Glyph(props: { node: PipelineNode }) {
  const dir = () => props.node.dir ?? "x";
  return (
    <Svg>
      <Switch fallback={<circle cx={12} cy={12} r={4} />}>
        <Match when={props.node.kind === "chart"}>
          <rect x={3} y={3} width={18} height={18} rx={2} />
          <path d="M7 7v10h10" />
        </Match>
        <Match when={props.node.kind === "spread"}>
          <Bars dir={dir()} size={3.5} gap={2.75} />
        </Match>
        <Match when={props.node.kind === "stack"}>
          <Bars dir={dir()} size={5} gap={0} />
        </Match>
        <Match when={props.node.kind === "rect"}>
          <rect x={6} y={6} width={12} height={12} rx={1} fill="currentColor" />
        </Match>
        <Match when={props.node.kind === "ribbon"}>
          <rect x={3} y={5} width={4} height={14} />
          <rect x={17} y={8} width={4} height={8} />
          <path d="M7 5C12 5 12 8 17 8M7 19C12 19 12 16 17 16" />
        </Match>
      </Switch>
    </Svg>
  );
}
