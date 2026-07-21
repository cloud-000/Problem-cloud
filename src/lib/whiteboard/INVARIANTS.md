# Whiteboard Invariants

Hard rules and seam contracts for anyone — human or agent — changing the
whiteboard. [`ARCHITECTURE.md`](./ARCHITECTURE.md) explains *why*; this file is
the *what you must not break*. When a change and a rule here conflict, the change
is wrong until this file is deliberately updated in the same edit.

Rules are testable. If you cannot point to how a rule holds after your change,
assume it is violated.

---

## Current vs. target

The migration is **complete**: every structural rule in this blueprint is
enforced by the code today, so this table is now a *regression* record rather
than a plan. Each row names the file that holds the rule up — if you change that
file, you own the row. A change that puts any row back into "direction of
travel" is the debt, not the rule.

| Area | Status | Notes |
|---|---|---|
| Document is the field of record; `Scene` is a `resolveWhiteboardDocument` getter; `History<WhiteboardDocument>` | **Enforced today** | `DocumentController` (`whiteboard/document-controller.svelte`) holds `document = $state(...)`, owns the history, and projects the Scene; the store exposes it via getters. |
| Pure-TS core purity + downward-only deps (`asy/` ⊥ `whiteboard/`) | **Enforced today** | The core has zero Svelte/DOM imports. |
| Tools commit a `ToolCommit` delta; **no** Scene→Document reconciliation (§4) | **Enforced today** | `reconcileResolvedScene`, `#smartToolCommit`, and `replaceBakedDocumentScene` are deleted. `ToolResult.commit` is a `ToolCommit`, lifted by the store's single `#liftCommit` step. `#conjoinCreatedFeatures` remains, but only as snap inference *inside* the lift — it reads the Document, never a Scene. |
| Store carved into named collaborators (`ARCHITECTURE.md` §5) | **Enforced today** | All six are extracted: PersistenceIO, StyleModel, DocumentController, SelectionModel (`whiteboard/selection.svelte`), ConstraintService (`whiteboard/constraint-service.svelte`), InteractionController (`whiteboard/interaction.svelte`). The store forwards to them via getters/setters and holds only transient view state (`preview`/`snapProposal`/`lineContinuation`/`arcGuide`/`toolKind`) plus derived read models. New behavior belongs in a collaborator, not the store. |
| One explicit pointer-down ownership branch (§3.1) | **Enforced today** | `InteractionController.#routePointerDown` is the single decision: one hit-test returns a `PointerRoute`, and the chosen pipeline is stored as one `ActiveGesture` value. `pointerMove`/`pointerUp` switch on that discriminant — they never re-probe nullable gesture fields, and nothing switches pipeline mid-gesture. |
| No seam-era dead code; no orphaned exports | **Enforced today** | The all-baked-document helpers the seam needed (`isBakedDocument`, `updateBakedElements`) are deleted, so no operation can take a `Scene` as the document's item list. Every remaining `export` under `asy/`, `whiteboard/`, and the store is imported by production code or a test; internal-only helpers (`validateScene`, `documentToSolverGraph`, `RELATION_ACTIONS`) are module-private. |

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
  reads the projected Scene and returns `ToolResult` previews while dragging, but
  commits a **`ToolCommit`** — a delta (`add` · `replace` · `erase` ·
  `extend-path` / `close-path`), never a Scene. `ToolResult.preview` is
  render-only; `ToolResult.commit` is lifted to exactly one Document transaction
  by the store's `#liftCommit`. A tool must describe *what it changed*; deriving
  that by diffing a Scene against the projection is the retired seam (§4).
- **Smart gestures go through `operations.ts` + the solver**, producing a single
  Document transaction on release. Preview solves during the drag are transient.
- **One gesture → one history entry.** Coalesce continuous edits (drag frames,
  inspector scrubbing) into a single undo step; do not push per-frame.
- **Escape / pointer-cancel abandons the preview and writes nothing.**

---

## 4. The forbidden seam (regression guard)

The old model let Pipeline A edit a `Scene` and folded it back into the Document.
That reconciliation is **removed** — `reconcileResolvedScene`, `#smartToolCommit`,
and `replaceBakedDocumentScene` no longer exist. Treat the following as red flags
in review — their presence means the two-source-of-truth model is creeping back:

- reading `store.scene` / `resolveWhiteboardDocument(...)`, mutating the result,
  and passing it to `applyDocument` / a transaction;
- reintroducing a Scene→Document merge, or deriving a commit's effect by
  **diffing a committed Scene against the projection** instead of having the tool
  state what it changed;
- widening `ToolResult.commit` back to a `Scene`, or a Tool whose `commit` is
  meant to become the authoritative Scene rather than a `ToolCommit` delta;
- adding a second lift site: `#liftCommit` is the *only* place a `ToolCommit`
  becomes a Document mutation.

The correct shape is always: **tool emits a `ToolCommit` → lift it to one Document
transaction → apply it → re-project the Scene.**

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
| Pointer routing / a new gesture kind | `whiteboard/interaction.svelte.ts` (`#routePointerDown` + the `ActiveGesture` union) |
| Wiring a core capability to the UI | `state/whiteboard.svelte.ts` (thin: forward to a collaborator) |
| Reactive read model (glyphs, inspector) | store `$derived` getters, computed from the Document |
| Canvas drawing | `components/whiteboard/render.ts` |
| Screen-space overlay geometry (selection box, handles, arc guide, glyph placement) | `components/whiteboard/overlay-model.ts` (pure TS: `buildOverlay`) |
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
