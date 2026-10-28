# gofish gui

An experimental editor for [gofish](../gofish-20250316/packages/gofish-graphics)
charts. The left pane holds gofish code. The right pane shows the chart it
draws. When you move the pointer near a gap between bars, a pink handle
appears in the gap, in the style of Figma. Dragging the handle changes the
number in the code, and the chart redraws as you drag. A small tool bank at
the left of the chart switches between Select (the spacing handles), Text
and Ribbon (drag from one bar to another to add a ribbon layer).

This is a small vertical slice. The only thing you can drag today is the
`spacing` of a `spread`, and only when that spacing is written as a plain
number in the code. The pipeline panel above the code can also insert a
`spread` or `stack` keyed by a data field, and set the rect's `fill` to a
constant colour or a data field.

## Run it

```sh
pnpm install
pnpm dev        # then open the printed URL (http://localhost:5173 by default)
```

Other scripts: `pnpm typecheck` (runs `tsc --noEmit`), `pnpm test` (checks
of the operator insertion in `scripts/test-insert.mjs`, of the mark
property edits in `scripts/test-props.mjs` and of the ribbon rule and edit
in `scripts/test-ribbon.mjs`) and `pnpm build`.

The app uses the built `dist/` of gofish-graphics from the sibling checkout.
If you change gofish, rebuild it first:

```sh
cd ../gofish-20250316 && pnpm --filter gofish-graphics build
```

## Principles

1. **The code is the source of truth.** The chart, the handles and the
   highlighted number are all worked out again from the code text. A drag
   does not keep its own copy of the chart state. It edits the code through
   the code editor, and the chart redraws from the new code by the same path
   as typing does. This is also why Cmd+Z undoes a drag.
2. **Only concrete values can be moved.** A handle exists only for a
   `spacing` written as a plain number, such as `spacing: 40`. If the spacing
   is left out, or written as `4 * 2` or a variable, there is no handle. The
   editor never guesses a value and never writes a new one into the code.
3. **Edits must be predictable.** Dragging one pixel changes the number by
   one. Every gap made by the same `spread` call lights up together while you
   hover or drag, and the number being edited is highlighted in the code, so
   you can see what will change before and while you change it. One drag is
   one undo step.
4. **Handles appear when you come close.** The chart looks like a normal
   chart until the pointer is within about 12 pixels of a gap.

## Inspirations

- **Figma's paired features.** From
  [Behind the feature: the multiple lives of multi-edit](https://www.figma.com/blog/behind-the-feature-the-multiple-lives-of-multi-edit/):
  "When you look at Figma, almost every feature that helps you structure your
  file has a free-spirited cousin feature for the times when you want to keep
  things loose." Here the code is the structured side and the canvas handles
  are the loose side. The pink spacing handles come from Figma's auto layout.
- **tldraw's architecture.** A small editor core with the document as plain
  data, and tools that change the document through one channel. We keep
  that shape at a much smaller size.
- **Data Illustrator, Lyra and Charticulator.** Direct manipulation of chart
  layout, as opposed to only writing specs.
- **Bret Victor, "Drawing Dynamic Visualizations".** Drawing a
  visualization directly while keeping it tied to data.
- **The Fusion 360 timeline.** Direct edits in a view are recorded as edits
  to a readable history of parameters.
- **cuttle.xyz.** Code and canvas side by side, where dragging on the canvas
  changes numbers in the code.
- **UI component editors for lists.** Editors that show gap handles for the
  spacing of a list of items.

A direct-manipulation prototype in the thesis presentation
(`phd-thesis-20260618/presentation/dm-prototype/`) came first. From it we
reuse the render pump and the pink look. We do not reuse its way of finding
gaps (grouping bars by fill color and picking the largest gaps). This editor
uses gofish's own layout output instead.

## Architecture

```
src/
  main.tsx               mounts <App/>
  App.tsx                two panes + status line; derives everything from the code
  data.ts                the fixed dataset (`data`), its field names and the starting code
  editor/
    document.ts          the code as a Solid signal; replaceRange() and gestures
    CodeEditor.tsx       CodeMirror 6 pane (JS mode, history, literal highlight)
    source.ts            acorn: parse helper; find spread calls and their `spacing` literals
    pipeline.ts          acorn: the builder chain as a list of pipeline stages
    insert.ts            pure text edits: an operator into `.flow(...)`, a method onto the chain
    ribbon.ts            the ribbon tool's rule: flow tiers, the one differing field, the edit
    props.ts             acorn: read and set one property (`fill`) of the mark's options
    evaluate.ts          run the code with gofish in scope; record spread calls
    layout.ts            gap boxes and data-mark boxes from gofish's display list
  canvas/
    Chart.tsx            renders into a mount div through a render pump
    SpacingHandles.tsx   proximity, pink pill, drag, badge (the Select tool)
    RibbonTool.tsx       drag from rect to rect to append a ribbon layer
    ToolBank.tsx         the vertical toolbar (Select, Text, Ribbon)
  panel/
    Pipeline.tsx         the pipeline panel above the code (one tile per stage)
    FillControl.tsx      the rect row's fill control (const colour or data field)
    glyphs.tsx           the small stroke glyphs drawn in the tiles
  styles.css
```

The data flows in one direction:

1. `document.ts` holds the code. Every edit goes through the CodeMirror view
   as a transaction, and a CodeMirror update listener copies the new text
   into the `code` signal. A drag is a *gesture*: the whole gesture is one
   history entry that holds the net change since the drag began. Each small
   edit undoes that entry with CodeMirror's own `undo` and records the new
   net change. (An earlier version kept the small edits out of the history
   and replayed the net change at the end. That broke undo, because the
   history shifts its older entries through edits it does not record, and a
   second drag of the same number damaged the first drag's entry.)
2. `source.ts` parses the code with acorn. It finds every call to `spread`,
   `spreadX` or `spreadY` in source order. For each one it records the
   position and value of its `spacing` literal (or `null` if there is no
   plain number), and the `by` and `dir` strings when they are literals.
3. `evaluate.ts` runs the chart expression with `new Function`. Every
   gofish export and `data` are in scope. The spread functions are wrapped
   so that each call's options are recorded in the order the calls run. We
   assume that for a straight chain like `chart(...).flow(spread(...),
   spread(...))`, source order equals run order. `checkAlignment` checks this
   (same number of calls, same callee, each literal arrived unchanged). If
   the check fails, no handles are offered and the status line says why.
4. `Chart.tsx` renders the chart. gofish clears the element it renders into,
   so the chart goes into its own mount div and the handle layer sits beside
   it. At most one render runs at a time. When it finishes, only the newest
   code is rendered next, so a fast drag never queues stale renders or
   finishes them out of order. Typing is debounced by 100 ms; drag edits
   render at once.
5. `layout.ts` turns gofish's layout into gap boxes (see below).
6. `SpacingHandles.tsx` draws the handles. A drag maps the pointer movement
   in chart pixels to `max(0, round(start + dx))`, reads the literal's
   current position from a fresh parse (its length can change, for example
   from 9 to 10), and calls `document.replaceRange`.

The left pane shows a pipeline panel above the code editor. `pipeline.ts`
reads the chain `chart(data, opts).flow(...).mark(...)` from the code and
lists its stages in order (chart, one per flow step, the mark), each
with its source range; if the code does not parse, the last good list stays
on screen. `Pipeline.tsx` draws one row per stage. Clicking a row selects
that stage's code, and the row whose code contains the number being
dragged on the canvas turns pink, like the number in the code.

A small "+" on the connector above a stage inserts a new `spread` or
`stack` there. The picker has two steps: first the operator, then the data
field to group by (from `dataFields()`), or "no key". `flowOpText` in
`insert.ts` writes the call, such as `stack({ by: "product", dir: "y" })`.
Each stage that has an insertion point carries its index into the
`.flow(...)` argument list (`insertIndex`), and `insertFlowOp` turns (code,
index, call text) into one text edit, matching the list's style (one
argument per line or inline) and adding `.flow(...)` if there is none. The
panel applies it through the document, so Cmd+Z undoes it, and selects the
new call in the editor.

The rect row shows its `fill` in the detail line with a small "const |
data" toggle. `props.ts` finds the property in the mark's options object
with acorn (`findMarkProperty`) and makes one text edit to replace it, or
to add it when it is missing (`setMarkProperty`). A constant colour shows a
swatch that opens the browser's colour picker; one pick is one gesture, so
one undo step. A data field shows a select of the fields. Switching to
const writes `"#7c8a99"`; switching to data writes the last field chosen,
or the first field. A fill that is neither (a variable, `"steelblue"`,
`rgb(...)`) is shown as its source text and is not editable here. The
classification follows gofish's own rule (`inferColor` in gofish's
`src/ast/channels.ts`): a string that names a key of the first data row is
a field and goes through the chart's colour scale; any other string is a
literal CSS colour. Without `color: palette(...)` on `chart()`, gofish uses
its default six-colour palette for fields.

### The tool bank

The canvas pane has a small vertical toolbar, like tldraw's or Figma's,
with three tools: Select (V), Text (T) and Ribbon (R). The keys work when
focus is not in the code editor or a form control. The active tool is one
Solid signal, `tool`, in `App.tsx`. The spacing handles exist only under
Select. After a tool writes its edit, the app returns to Select, like
tldraw does after you draw a shape. Escape returns to Select and cancels a
drag in progress. When a tool's gesture makes no edit, the status line
says why; that message clears when the tool or the code changes.

`Chart.tsx` gives the tools the data marks (`dataLeaves` in `layout.ts`)
as boxes in overlay pixels with their rows, taken from the same display
list as the gaps, so the tools hit-test against gofish's own layout.

**Ribbon.** Hover a bar to outline it. Press on bar A, drag (a pink line
follows the pointer) and release on bar B. The flow tiers are the `by`
fields of the spreads and stacks in the pipeline, in order. If any of them
has no literal `by` string, the tool cannot be used and the status line
says so. Otherwise the tool compares the first data row of A and of B on
each tier's field. The rule: the drag is valid only when the two bars
differ in exactly one tier's field. That field becomes `along`, and the
tool appends `.layer(ribbon({ along: "<field>", opacity: 0.5 }))` to the
end of the chain, in the chain's own line style (`appendChainMethod` in
`insert.ts`). gofish then draws one band per combination of the other
tiers' values, travelling along that tier. If the bars differ in no field
or in two or more, there is no edit and the status line names the fields,
because any choice would be a guess. The edit is one gesture through the
document, so Cmd+Z undoes it, and the new call is selected in the editor.
The pipeline panel shows the layer as a `ribbon` row.

**Text.** The tool can be selected but does nothing yet. We checked
whether `.layer(text({ text: "total" }))` over the rects draws a label per
bar. It does not: gofish's `text` option is a raw string, so the layer
draws one label that reads "total" at the chart's lower left. Until there
is an edit that labels each bar, the tool only says so in the status line.

### How gap geometry is found

We use gofish's display list, not the pixels of the SVG and not a guess.
`Chart.tsx` calls `toDisplayList` and `render` on the same builder with the
same options, so the display list coordinates are the SVG's coordinates.
The overlay adds the SVG's offset inside the chart box (and a scale factor,
which is 1 unless the SVG is resized).

We first looked at walking gofish's laid-out node tree, which would give
each spread's children directly. But after layout a spread has been lowered
into generic `layer` nodes mixed with axis-label `text` and `ref` nodes, so
the tree no longer says which node came from which spread. The display list
instead gives every data mark in final pixels together with its source rows.
So `layout.ts` does this for spread level k:

1. Take the data marks (role `node`, with a box and a datum).
2. Key each mark by the values of the `by` fields of spreads 0 to k on its
   row.
3. Marks that share keys 0 to k-1 have the same parent. Inside a parent,
   marks that share key k form one child of spread k. Join their boxes.
4. Sort the children along the spread's `dir`. The space between two
   neighbours is a gap.

Known limits of this approach: it assumes every grouping step in the flow
is a spread with a string `by`, and that marks are boxes. A level that does
not meet this gets no handles.

## Depending on gofish

`package.json` links the sibling checkout:
`"gofish-graphics": "link:../gofish-20250316/packages/gofish-graphics"`,
and the app uses its built `dist/`. We did not alias `gofish-graphics` to its
`src/`, because the display list gives us everything we need and nothing
internal (such as `runLayout`) is required. Using `dist` also avoids
compiling gofish's TSX and aliasing `gofish-ir` in this app.

gofish keeps `solid-js` as an external peer dependency. A linked package
would normally load `solid-js` from its own `node_modules`, which would give
two copies of Solid. `vite.config.ts` sets `resolve.dedupe: ["solid-js"]` so
that every import of Solid resolves to this app's copy. The production build
contains one copy.

## Why no base editor was forked

- **tldraw** has the architecture we like, but its SDK is source-available
  under its own licence, which requires a watermark or a paid licence. It is
  not MIT.
- **Excalidraw** is MIT, but it is built around free shapes, not charts
  made from code.
- **Utopia** is MIT and is the closest in idea (code and canvas kept in
  sync), but it is far too large for this experiment.

So we borrow ideas only, and keep this editor small.

## Status and future work

- `dir: "y"` spacing handles work (drag down to increase), but they have
  only been checked lightly.
- Inserting a `spacing` literal where none exists is future work. Today a
  spread without a plain number simply has no handle.
- Other kinds of handles (sizes, padding, reordering) are future work.
- The dataset is fixed: 12 rows of `region` × `quarter` × `product` with a
  `total`. The starting chart spreads by quarter, then by product, and
  stacks by region, so each bar holds one row.
- The ribbon tool compares only the first data row of each bar, and it
  needs every spread and stack to have a literal `by` string. It does not
  check whether the chain already has the same ribbon layer.
- The Text tool is not wired yet (see above). The code
  pane holds only the chart expression, without `.render(...)`.
- The fill control only recognises `#rgb`, `#rrggbb` and the 16 basic CSS
  colour names as constants.

## Licence

MIT. See `LICENSE`.
