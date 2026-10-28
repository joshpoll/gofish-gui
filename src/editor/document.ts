import { batch, createSignal, type Accessor } from "solid-js";
import { ChangeSet, type Extension, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isolateHistory, undo } from "@codemirror/commands";

/**
 * The document: the code string, which is the single source of truth.
 *
 * `code` is a Solid signal mirroring the CodeMirror document. Every edit,
 * whether typed or made by a canvas handle, goes THROUGH the CodeMirror view
 * as a transaction, so the editor stays authoritative and undo/redo covers
 * canvas edits too. Nothing else holds chart state.
 */
export type Document = {
  code: Accessor<string>;
  /** True while a canvas gesture (a drag) is in progress. */
  inGesture: Accessor<boolean>;
  /** CodeMirror extension that keeps `code` in sync with the view. */
  extension: Extension;
  attach(view: EditorView): void;
  detach(): void;
  replaceRange(from: number, to: number, text: string): void;
  /** Select a range in the editor, scroll it into view and focus the editor. */
  select(from: number, to: number): void;
  /**
   * A gesture groups many small edits (one per pointer move, or one per
   * colour-picker `input` event) into a single undo step, so Cmd+Z after a
   * drag restores the value from before the drag.
   */
  beginGesture(): void;
  endGesture(): void;
};

export function createDocument(initial: string): Document {
  const [code, setCode] = createSignal(initial);
  const [inGesture, setInGesture] = createSignal(false);
  let view: EditorView | null = null;
  // Net change made by replaceRange calls during the current gesture,
  // from the document at gesture start to the current document, and
  // whether it is currently recorded as the newest history event.
  let gestureChanges: ChangeSet | null = null;
  let gestureStartDoc: Text | null = null;
  let gestureRecorded = false;

  const extension = EditorView.updateListener.of((update) => {
    if (update.docChanged) setCode(update.state.doc.toString());
  });

  function replaceRange(from: number, to: number, text: string) {
    if (!view) {
      const c = code();
      setCode(c.slice(0, from) + text + c.slice(to));
      return;
    }
    const changes = ChangeSet.of(
      { from, to, insert: text },
      view.state.doc.length
    );
    if (gestureChanges) {
      // The gesture is one history event holding the net change since the
      // gesture began. Each step replaces that event: undo it (the history
      // drops it cleanly) and record the new net change. We do not dispatch
      // the steps outside the history and replay the net change at the end,
      // because the history maps its older events through changes it does
      // not record, and a step that overwrites text an older event inserted
      // (a second drag of the same number) would corrupt that event's undo.
      // `batch` means observers see only the new text, not the rewind.
      const net = gestureChanges.compose(changes);
      const v = view;
      batch(() => {
        if (gestureRecorded) undo(v);
        v.dispatch({
          changes: net,
          userEvent: "input.canvas",
          annotations: isolateHistory.of("full"),
        });
      });
      gestureChanges = net;
      gestureRecorded = true;
    } else {
      view.dispatch({ changes, userEvent: "input.canvas" });
    }
  }

  function beginGesture() {
    if (view) {
      gestureStartDoc = view.state.doc;
      gestureChanges = ChangeSet.empty(view.state.doc.length);
    }
    setInGesture(true);
  }

  function endGesture() {
    const startDoc = gestureStartDoc;
    const recorded = gestureRecorded;
    gestureChanges = null;
    gestureStartDoc = null;
    gestureRecorded = false;
    // Note: this assumes no keyboard edits land in the middle of a gesture
    // (the pointer is captured by the canvas, or focus is in the colour
    // picker, so in practice they do not).
    batch(() => {
      // A gesture that ended where it began leaves no undo step.
      if (view && recorded && startDoc && startDoc.eq(view.state.doc)) undo(view);
      // A canvas drag is an edit to the code, so give the editor keyboard
      // focus: Cmd+Z right after a drag undoes it, like in Figma or tldraw.
      view?.focus();
      setInGesture(false);
    });
  }

  return {
    code,
    inGesture,
    extension,
    attach(v) {
      view = v;
    },
    detach() {
      view = null;
    },
    replaceRange,
    select(from, to) {
      if (!view) return;
      const len = view.state.doc.length;
      view.dispatch({
        selection: { anchor: Math.min(from, len), head: Math.min(to, len) },
        scrollIntoView: true,
      });
      view.focus();
    },
    beginGesture,
    endGesture,
  };
}
