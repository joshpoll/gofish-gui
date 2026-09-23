# gofish gui

An experimental editor for [gofish](../gofish-20250316/packages/gofish-graphics)
charts. The left pane holds gofish code. The right pane shows the chart it
draws. When you move the pointer near a gap between bars, a pink handle
appears in the gap, in the style of Figma. Dragging the handle changes the
number in the code, and the chart redraws as you drag.

This is a small vertical slice. The only thing you can drag today is the
`spacing` of a `spread`, and only when that spacing is written as a plain
number in the code.

## Run it

```sh
pnpm install
pnpm dev        # then open the printed URL (http://localhost:5173 by default)
```

Other scripts: `pnpm typecheck` (runs `tsc --noEmit`), `pnpm test` (checks
of the operator insertion in `scripts/test-insert.mjs`) and `pnpm build`.

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
  data.ts                the fixed dataset (`data`) and the starting code
  editor/
    document.ts          the code as a Solid signal; replaceRange() and gestures
    CodeEditor.tsx       CodeMirror 6 pane (JS mode, history, literal highlight)
    source.ts            acorn: parse helper; find spread calls and their `spacing` literals
    pipeline.ts          acorn: the builder chain as a list of pipeline stages
    insert.ts            pure text edit that inserts an operator into `.flow(...)`
    evaluate.ts          run the code with gofish in scope; record spread calls
    layout.ts            gap boxes from gofish's display list
  canvas/
    Chart.tsx            renders into a mount div through a render pump
    SpacingHandles.tsx   proximity, pink pill, drag, badge
  panel/
    Pipeline.tsx         the pipeline panel above the code (one tile per stage)
    glyphs.tsx           the small stroke glyphs drawn in the tiles
  styles.css
```

The data flows in one direction:

1. `document.ts` holds the code. Every edit goes through the CodeMirror view
   as a transaction, and a CodeMirror update listener copies the new text
   into the `code` signal. A drag is a *gesture*: the small edits made while
   dragging are kept out of the undo history, and when the drag ends the net
   change is recorded as one history entry.
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
`stack` there. Each stage that has an insertion point carries its index
into the `.flow(...)` argument list (`insertIndex`), and `insert.ts` turns
(code, index, template) into one text edit, matching the list's style (one
argument per line or inline) and adding `.flow(...)` if there is none. The
panel applies it through the document, so Cmd+Z undoes it, and selects the
new call in the editor. `pnpm test` runs quick checks of `insert.ts`.

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
- The dataset is fixed. The code pane holds only the chart expression,
  without `.render(...)`.

## Licence

MIT. See `LICENSE`.
