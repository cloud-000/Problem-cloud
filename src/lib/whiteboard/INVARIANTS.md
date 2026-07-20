# Whiteboard Invariants

Hard rules and seam contracts for anyone — human or agent — changing the
whiteboard. [`ARCHITECTURE.md`](./ARCHITECTURE.md) explains *why*; this file is
the *what you must not break*. When a change and a rule here conflict, the change
is wrong until this file is deliberately updated in the same edit.

Rules are testable. If you cannot point to how a rule holds after your change,
assume it is violated.

---

## Current vs. target

This blueprint describes the **target** model. The code is mid-migration toward
it, so some rules are already enforced and some are the direction of travel. Do
not assume the code matches a rule just because it is written here — check, and
when you touch adjacent code, move it *toward* the target, never away.

| Area | Status | Notes |
|---|---|---|
| Document is the field of record; `Scene` is a `resolveWhiteboardDocument` getter; `History<WhiteboardDocument>` | **Enforced today** | `DocumentController` (`whiteboard/document-controller.svelte`) holds `document = $state(...)`, owns the history, and projects the Scene; the store exposes it via getters. |
| Pure-TS core purity + downward-only deps (`asy/` ⊥ `whiteboard/`) | **Enforced today** | The core has zero Svelte/DOM imports. |
| Tools commit `BakedItem`s; **no** Scene→Document reconciliation (§4) | **Target** | The forbidden seam (`reconcileResolvedScene`, `#smartToolCommit`, `#conjoinCreatedFeatures`) still exists in the store. Shrink it; don't extend it. |
| Store carved into named collaborators (`ARCHITECTURE.md` §5) | **Partly** | Extracted: PersistenceIO, StyleModel, DocumentController, SelectionModel (`whiteboard/selection.svelte`; the store forwards `selection`/`selectionPreview`/`marquee`/`featureSelection` via getters). Remaining in the store: ConstraintService · InteractionController. Extract along the seams as you touch them. |
| One explicit pointer-down ownership branch (§3.1) | **Partly** | The store branches on `#smartTransform`/`#smartTranslation`/`#smartDrag` today; consolidate toward the single hit-test decision. |

When a "Target" rule and the current code disagree, the code is the debt, not
the rule.

---

## 0. Prime directives

1. **The `WhiteboardDocument` is the only editable model.** Every user-visible
   change is a `Document → Document` transaction. Nothing else is a source of
   truth.
2. **The `Scene` is a read-only projection.** It is produced by
   `resolveWhiteboardDocument(document)` and consumed only by render, hit-test,
   and export. Never edit a Scene and write it back.
3. **Every gesture commits exactly one transaction = one undo step.** Previews
   are transient and never touch history.
4. **Dependencies point downward only:** `asy/` → nothing above it;
   `whiteboard/model` → `asy/` only; store → model + asy; view → store.

Everything below is a consequence of these four.

---

## 1. Layer boundaries

- **`src/lib/asy/**` and `src/lib/whiteboard/model|solver/**` are pure TS.**
  Zero imports of Svelte, `$app/*`, `$lib` runes state, or the DOM. They must
  stay runnable under `bun test` with no browser. A `import ... from "svelte"`
  in these trees is a build-the-wrong-thing signal.
- **`asy/` must not import `whiteboard/`.** The interchange core does not know
  the parametric model exists. (The reverse is fine: `whiteboard/model` imports
  `asy/scene` types.)
- **The store (`state/whiteboard.svelte.ts`) holds no geometry algorithms.** It
  wires the core to reactivity. Math, solving, and transactions live in the
  core; if you are writing a loop over points in the store, it belongs in
  `model/` or `asy/` instead.
- **The view holds no model logic.** Components map pointer/DOM events to store
  calls and render the projected Scene. Coordinate mapping (screen ↔ asy-space)
  is view-owned; everything downstream is asy-space.

---

## 2. Data-model invariants

- **Coordinates are asy-space (y-up) everywhere below the view.** Only the view
  flips y at render time. Do not bake screen coordinates into the Document or
  Scene. (See `asy/scene/types.ts` header.)
- **Element and item ids are stable and unique.** Mint them via the factory
  (`asy/scene/factory.ts` `newId`), never by array index or content hash.
  Transactions preserve ids so history, selection, and glyphs stay anchored.
- **Baked vs. smart is a hard partition.** A `BakedItem` carries a raw
  `SceneElement` and never references the sketch graph. A smart item
  (`sketch-path` / `sketch-curve` / `sketch-point-marker`) never stores resolved
  coordinates — it references `sketch.points` / `sketch.curves`, and geometry is
  derived by resolve/solve. Do not cache solved coordinates on a smart item.
- **Transactions are pure.** `operations.ts` functions take a Document and return
  a new Document; they do not mutate inputs, call the solver as a side channel
  outside the documented request, or read Svelte state.
- **A rejected edit mutates nothing.** An impossible relation/dimension/drag
  returns the input Document unchanged (atomic), never a half-applied one.
- **Schema changes bump `WHITEBOARD_SCHEMA_VERSION`** and stay
  backward-compatible via optional fields + a migration in `model/document.ts`
  (`migrateSceneToWhiteboardDocument` and friends). Persisted V1/V2 docs must
  still load.

---

## 3. Interaction invariants (the two-pipeline boundary)

- **Pipeline ownership is decided once, on pointer-down, by hit-test.** Smart
  feature hit → Pipeline B (gesture + solver). Empty space / baked element /
  active creation tool → Pipeline A (Tool). No mid-gesture pipeline switch.
- **Tools never touch the DOM and never write the Scene as truth.** A `Tool`
  reads the projected Scene, returns `ToolResult` previews while dragging, and
  on commit its geometry is **lifted to `BakedItem`s appended to the Document**.
  `ToolResult.preview` is render-only; `ToolResult.commit` becomes a Document
  transaction, not a stored Scene.
- **Smart gestures go through `operations.ts` + the solver**, producing a single
  Document transaction on release. Preview solves during the drag are transient.
- **One gesture → one history entry.** Coalesce continuous edits (drag frames,
  inspector scrubbing) into a single undo step; do not push per-frame.
- **Escape / pointer-cancel abandons the preview and writes nothing.**

---

## 4. The forbidden seam (regression guard)

The old model let Pipeline A edit a `Scene` and folded it back into the Document.
That reconciliation is **removed**. Treat the following as red flags in review —
their presence means the two-source-of-truth model is creeping back:

- reading `store.scene` / `resolveWhiteboardDocument(...)`, mutating the result,
  and passing it to `applyDocument` / a transaction;
- new call sites of a Scene→Document merge (historically
  `reconcileResolvedScene`, `#smartToolCommit`, `#conjoinCreatedFeatures`,
  `replaceBakedDocumentScene`);
- a Tool whose `commit` is meant to become the authoritative Scene rather than
  Document items.

The correct shape is always: **build a Document transaction → apply it →
re-project the Scene.**

---

## 5. Where does X live? (routing table)

Before creating anything, find the home here. Most changes touch exactly one
cell.

| Task | Home |
|---|---|
| New drawing/creation tool | `asy/engine/tools/<tool>.ts` (+ register in `tools/index.ts`); implement the `Tool` contract |
| Scene primitive / element kind | `asy/scene/types.ts` + geometry in `asy/scene/`, then codec support |
| Asymptote read/write for a primitive | `asy/codec/` (`parser.ts` / `lower.ts` / `serialize.ts`) |
| Hit-testing behavior | `asy/engine/hit-test.ts` |
| Freehand ink shaping | `asy/engine/brush.ts` / `simplify.ts` |
| New constraint or relation kind | `whiteboard/model/types.ts` (`Constraint`) + `operations.ts` + `solver-adapter.ts` + `solver/` |
| A document mutation (transaction) | `whiteboard/model/operations.ts` |
| Sketch → Scene projection | `whiteboard/model/resolve.ts` |
| Dimension (length/radius/angle) | `whiteboard/model/operations.ts` + `types.ts` (`LengthDimension`) |
| Feature selection semantics | `whiteboard/model/features.ts` |
| Document validation / migration | `whiteboard/model/validation.ts` / `document.ts` |
| Wiring a core capability to the UI | `state/whiteboard.svelte.ts` (thin: forward to a collaborator) |
| Reactive read model (glyphs, inspector) | store `$derived` getters, computed from the Document |
| Canvas drawing | `components/whiteboard/render.ts` |
| Pointer/DOM → store event mapping | `components/whiteboard/whiteboard.svelte` |
| Toolbar / inspector / command UI | `components/whiteboard/*.svelte` (see `DOCS.md`) |
| SVG/PNG/asy export | `components/whiteboard/export.ts` (renders the *projected* Scene) |

If a task seems to need a **new** top-level home, stop — it almost certainly
belongs in one of the above, and adding a parallel structure is how the slop
started.

---

## 6. Anti-patterns (do not do)

- ❌ Storing screen/pixel coordinates below the view.
- ❌ Caching resolved geometry on smart items, or reading it back as truth.
- ❌ Editing a Scene and merging it into the Document (§4).
- ❌ Putting geometry/solver math in the store or a component.
- ❌ Importing Svelte/DOM into `asy/` or `whiteboard/model`.
- ❌ A gesture that emits multiple history entries, or a preview that mutates
  the Document.
- ❌ `asy/` importing `whiteboard/`.
- ❌ Adding a third interaction pipeline, or switching pipelines mid-gesture.
- ❌ Hand-writing ids or deriving them from array position.
- ❌ Growing `WhiteboardStore` with a new responsibility instead of extending
  the relevant collaborator/core module.

---

## 7. Before you call it done

Per repo convention (`CLAUDE.md`):

- `bun run check` — svelte-check clean.
- `bun test` — green. Pure-layer tests are necessary but **not sufficient**:
  logic the store or a component orchestrates needs a test at *that* layer, or a
  gesture/lifecycle bug passes every test beneath it.
- For any `.svelte` / `.svelte.ts` edit, run the Svelte MCP **autofixer** until
  clean (runes correctness).
- If you changed a component's public API, update
  `components/whiteboard/DOCS.md`. If you changed the *model*, update
  [`ARCHITECTURE.md`](./ARCHITECTURE.md) **and** this file in the same change —
  a stale invariant is worse than none.
