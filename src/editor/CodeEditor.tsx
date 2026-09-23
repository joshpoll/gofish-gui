import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";
import { basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { Document } from "./document";

export type Range = { from: number; to: number };

// The literal currently being manipulated on the canvas, shown as a mark.
const setHighlight = StateEffect.define<Range | null>();
const highlightMark = Decoration.mark({ class: "cm-canvas-literal" });
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setHighlight)) continue;
      deco =
        e.value && e.value.to > e.value.from
          ? Decoration.set([highlightMark.range(e.value.from, e.value.to)])
          : Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** CodeMirror pane. `basicSetup` includes history + its keymap (Cmd+Z). */
export function CodeEditor(props: {
  doc: Document;
  highlight: Accessor<Range | null>;
}) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.doc.code(),
        extensions: [
          basicSetup,
          javascript(),
          highlightField,
          props.doc.extension,
        ],
      }),
    });
    props.doc.attach(view);
  });

  // The highlight range is derived from the current parse, so it follows
  // the literal as its length changes (e.g. 9 -> 10).
  createEffect(() => {
    const range = props.highlight();
    view?.dispatch({ effects: setHighlight.of(range) });
  });

  onCleanup(() => {
    props.doc.detach();
    view?.destroy();
  });

  return <div class="code-editor" ref={host} />;
}
