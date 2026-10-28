import { For, type Accessor, type JSX } from "solid-js";

export type Tool = "select" | "text" | "ribbon";

const TOOLS: { id: Tool; label: string; key: string; glyph: () => JSX.Element }[] = [
  {
    id: "select",
    label: "Select",
    key: "V",
    glyph: () => <path d="M6 4l12 7-5.5 1.5L10 18z" />,
  },
  {
    id: "text",
    label: "Text",
    key: "T",
    glyph: () => <path d="M6 6h12M12 6v12M9.5 18h5" />,
  },
  {
    id: "ribbon",
    label: "Ribbon",
    key: "R",
    glyph: () => (
      <>
        <rect x={3} y={5} width={4} height={14} />
        <rect x={17} y={8} width={4} height={8} />
        <path d="M7 5C12 5 12 8 17 8M7 19C12 19 12 16 17 16" />
      </>
    ),
  },
];

/** The tool shortcut for a key press, if any (V, T, R; any case). */
export function toolForKey(key: string): Tool | undefined {
  return TOOLS.find((t) => t.key === key.toUpperCase())?.id;
}

/**
 * The vertical tool bank in the canvas pane, like tldraw's or Figma's. It
 * only shows and sets the active tool; the tools themselves live beside the
 * chart (SpacingHandles for Select, RibbonTool for Ribbon).
 */
export function ToolBank(props: { tool: Accessor<Tool>; setTool: (t: Tool) => void }) {
  return (
    <div class="tool-bank" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      <For each={TOOLS}>
        {(t) => (
          <button
            type="button"
            classList={{ on: props.tool() === t.id }}
            title={`${t.label} (${t.key})`}
            aria-label={t.label}
            aria-pressed={props.tool() === t.id}
            onClick={() => props.setTool(t.id)}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
              stroke-linecap="round"
              aria-hidden="true"
            >
              {t.glyph()}
            </svg>
          </button>
        )}
      </For>
    </div>
  );
}
