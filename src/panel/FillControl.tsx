import { For, Match, Show, Switch, createSignal, type Accessor } from "solid-js";
import type { Document } from "../editor/document";
import { stringSource, setMarkProperty, type FillState } from "../editor/props";

/** The constant colour written when switching a fill to "const". */
export const DEFAULT_FILL = "#7c8a99";

/**
 * The rect row's `fill` control, in the row's detail line: a two-segment
 * "const | data" toggle, then a colour swatch (const) or a field select
 * (data). Every change is one text edit to the fill's string literal, whose
 * range is read again from the current code each time (as the spacing drag
 * does). A fill that is neither a colour nor a field is shown as its source
 * text and cannot be edited here.
 */
export function FillControl(props: {
  doc: Document;
  fill: Accessor<FillState>;
  fields: string[];
}) {
  // The field chosen most recently, used when switching back to "data".
  const [lastField, setLastField] = createSignal<string | undefined>();

  /** Set `fill` to the string `value`, keeping the literal's quote style. */
  const write = (value: string) => {
    const f = props.fill();
    const quote = f.kind === "constant" || f.kind === "data" ? f.quote : '"';
    const edit = setMarkProperty(props.doc.code(), "fill", stringSource(value, quote));
    if (edit) props.doc.replaceRange(edit.from, edit.to, edit.text);
  };

  const toConst = () => {
    if (props.fill().kind !== "constant") write(DEFAULT_FILL);
  };
  const toData = () => {
    if (props.fill().kind === "data") return;
    const last = lastField();
    write(last && props.fields.includes(last) ? last : props.fields[0]);
  };
  const pickField = (field: string) => {
    setLastField(field);
    write(field);
  };

  // One native colour pick (many `input` events, then `change`) is one
  // gesture, so it is one undo step.
  let picking = false;
  const onColorInput = (hex: string) => {
    if (!picking) {
      picking = true;
      props.doc.beginGesture();
    }
    write(hex);
  };
  const endPick = () => {
    if (!picking) return;
    picking = false;
    props.doc.endGesture();
  };

  const kind = () => props.fill().kind;
  const editable = () => kind() !== "other";

  return (
    <span
      class="fill-control"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span class="fill-label">fill:</span>
      <Show when={editable()}>
        <span class="fill-mode" role="group" aria-label="fill mode">
          <button
            type="button"
            classList={{ on: kind() === "constant" }}
            aria-pressed={kind() === "constant"}
            title="Constant colour"
            onClick={toConst}
          >
            const
          </button>
          <button
            type="button"
            classList={{ on: kind() === "data" }}
            aria-pressed={kind() === "data"}
            title="Colour by a data field"
            onClick={toData}
          >
            data
          </button>
        </span>
      </Show>
      <Switch>
        <Match when={props.fill().kind === "constant" && (props.fill() as Extract<FillState, { kind: "constant" }>)}>
          {(f) => (
            <label class="fill-swatch" title="Pick a colour">
              <input
                type="color"
                value={f().hex}
                onInput={(e) => onColorInput(e.currentTarget.value)}
                onChange={endPick}
                onBlur={endPick}
              />
              <span class="fill-value">{f().hex}</span>
            </label>
          )}
        </Match>
        <Match when={props.fill().kind === "data" && (props.fill() as Extract<FillState, { kind: "data" }>)}>
          {(f) => (
            <select
              class="fill-field"
              value={f().field}
              title="Data field"
              onChange={(e) => pickField(e.currentTarget.value)}
            >
              <For each={props.fields}>{(name) => <option value={name}>{name}</option>}</For>
            </select>
          )}
        </Match>
        <Match when={props.fill().kind === "other" && (props.fill() as Extract<FillState, { kind: "other" }>)}>
          {(f) => <span class="fill-value" title="Not a colour or a data field; edit it in the code">{f().text}</span>}
        </Match>
        <Match when={kind() === "unset"}>
          <span class="fill-value">unset</span>
        </Match>
      </Switch>
    </span>
  );
}
