import { batch, createSignal, type Accessor } from "solid-js";
import { ChangeSet, Transaction, type Extension, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

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
   * A gesture groups many small edits (one per pointer move) into a single
   * undo step. Edits made inside a gesture are kept out of the history; when
   * the gesture ends, the net change is recorded as one history entry, so
   * Cmd+Z after a drag restores the value from before the drag.
   */
  beginGesture(): void;
  endGesture(): void;
};

export function createDocument(initial: string): Document {
  const [code, setCode] = createSignal(initial);
  const [inGesture, setInGesture] = createSignal(false);
  let view: EditorView | null = null;
  // Net change made by replaceRange calls during the current gesture,
  // from the document at gesture start to the current document.
  let gestureChanges: ChangeSet | null = null;
  let gestureStartDoc: Text | null = null;

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
      gestureChanges = gestureChanges.compose(changes);
      view.dispatch({
        changes,
        annotations: Transaction.addToHistory.of(false),
      });
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
    const net = gestureChanges;
    const startDoc = gestureStartDoc;
    gestureChanges = null;
    gestureStartDoc = null;
    // Note: this assumes no keyboard edits land in the middle of a drag (the
    // pointer is captured by the canvas, so in practice they do not).
    batch(() => {
      if (view && net && startDoc && !startDoc.eq(view.state.doc)) {
        // Rewind silently to the pre-gesture document, then replay the net
        // change as one undoable transaction. `batch` means observers only
        // see the final text.
        view.dispatch({
          changes: net.invert(startDoc),
          annotations: Transaction.addToHistory.of(false),
        });
        view.dispatch({ changes: net, userEvent: "input.canvas" });
      }
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
