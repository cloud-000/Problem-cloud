# Whiteboard Architecture

The human-facing design reference for the whiteboard feature. It describes the
**model** — the concepts and the boundaries between them — deliberately without
the noise of the implementation. Read this first; read [`INVARIANTS.md`](./INVARIANTS.md)
before you touch code.

> **The one sentence:** the `WhiteboardDocument` is the only editable model; the
> `Scene` is a one-way projection of it used for rendering, hit-testing, and
> export. Everything else follows from that.

---

## 1. Layers

The feature is four layers, stacked from framework-neutral core to Svelte view.
The lower two are **pure TypeScript with zero Svelte / `$lib` imports** and are
independently `bun test`-able (and extractable to a package later).

```
┌─ src/lib/asy/  ── interchange core (pure TS) ──────────────────────────────┐
│  scene/    Scene IR: flat SceneElement[] + geometry (bounds, path, pen)     │
│  codec/    Scene ⇄ Asymptote text  (lexer → parser → AST → lower / serialize)│
│  engine/   editing primitives: brush · hit-test · simplify · History        │
│            + tools/  — each Tool is a small pointer state machine            │
├─ src/lib/whiteboard/model/  ── parametric model (pure TS) ─────────────────┤
│  WhiteboardDocument + SketchGraph (points · params · curves · constraints)  │
│  operations (transactions) · resolve (Document → Scene) · dimensions         │
│  src/lib/whiteboard/solver/  — constraint solver (damped least-squares)     │
├─ src/lib/state/whiteboard.svelte.ts  ── orchestration (Svelte runes) ──────┤
│  WhiteboardStore: wires the core to the view, holds reactive state          │
├─ src/lib/components/whiteboard/  ── view (Svelte) ─────────────────────────┤
│  whiteboard.svelte · render.ts · toolbars · cards · export                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

Dependencies point **downward only**. `asy/` knows nothing about `whiteboard/`;
`whiteboard/model` knows nothing about the store; the store knows nothing about
the DOM. A violation of that direction is an architecture bug, not a style nit.

---

## 2. The domain model

### 2.1 `WhiteboardDocument` — the aggregate root

The Document is the **single source of truth** and the **only editable model**.
It holds three kinds of state:

- **`items[]`** — the draw order. Each item is either
  - a **`BakedItem`** — a wrapper around a raw `SceneElement` (freehand ink,
    imported asy, anything with no parametric intent), or
  - a **smart item** (`sketch-path` / `sketch-curve` / `sketch-point-marker`) —
    a *reference* into the sketch graph plus presentation style.
- **`sketch: SketchGraph`** — the parametric substrate: `points`, scalar
  `parameters`, `curves` (segment / circle / arc), and `constraints`
  (coincident, horizontal, parallel, distance, angle, …). Smart items get their
  geometry from here; baked items do not touch it.
- **`dimensions`** — driving/reference length·radius·angle annotations.

All mutation of the whiteboard is a mutation of *this* object, produced by the
**operations** layer (`model/operations.ts`) as pure `Document → Document`
transactions and pushed through `History<WhiteboardDocument>`.

### 2.2 `Scene` — the projection (never edited)

`resolveWhiteboardDocument(document)` computes a `Scene`: it solves nothing new,
it *reads* the (already-solved) point positions and flattens every item into
baked `SceneElement`s. The Scene is consumed three ways, all read-only:

- **render** — `components/whiteboard/render.ts` draws it to Canvas.
- **hit-test** — `asy/engine/hit-test.ts` picks elements under the pointer.
- **export** — `asy/codec` serializes it to Asymptote; SVG/PNG snapshot it.

> **Projection is one-directional.** Nothing edits a `Scene` and folds it back
> into the Document. If you find yourself reconciling Scene → Document, you are
> re-introducing the seam this architecture exists to remove (see §4).

```
   edit ──▶ WhiteboardDocument ──resolve()──▶ Scene ──▶ render · hit-test · asy/svg/png
              (source of truth)                (projection, read-only)
```

### 2.3 Why two representations at all

Because they answer different questions. The Document answers *"what did the
user mean?"* (a square whose sides stay equal, a point on a circle). The Scene
answers *"what pixels / what asy?"*. The parametric intent cannot be recovered
from flattened geometry, so the Document must be primary; the flattened geometry
is cheap to recompute, so it must be derived. Making the Scene editable was the
original mistake — it created a second source of truth that had to be
reconciled.

---

## 3. Interaction: two pipelines, one write target

Input handling keeps **two pipelines** — they are genuinely different mechanics —
but they converge on a single write target (the Document) and a single commit
rule. The boundary between them is a documented contract, not an accident.

| | **Pipeline A — Tools** | **Pipeline B — Smart gestures** |
|---|---|---|
| Handles | creation & freehand: pen, line, rectangle, arc, point, label, eraser, marquee | constraint-driven edits: drag a smart feature, translate / rotate / resize a smart selection |
| Contract | `Tool` state machine (`asy/engine/tools`) — `onPointerDown/Move/Up` return a `ToolResult` | `operations.ts` transactions + the `solver` |
| Reads | the projected `Scene` (for hit-testing & rubber-band preview) | the Document's `SketchGraph` |
| Writes on commit | **a `ToolCommit` delta, lifted to one Document transaction** | Document (points/params updated by the solver) |

### 3.1 Ownership — who gets the gesture

Decided once, on **pointer-down**, by a hit-test:

- pointer hits a **smart feature** (a sketch point, a curve, an ellipse axis) → **Pipeline B**.
- pointer hits **empty space, a baked element, or a creation tool is active** → **Pipeline A**.

This is the *only* branch. There is no third path and no mid-gesture pipeline
switch.

### 3.2 Commit — the single rule

> Every gesture, in either pipeline, ends as **exactly one `Document`
> transaction**, pushed to history as one undo step. The Scene is re-projected
> afterward. **No pipeline ever writes the Scene.**

A Tool does not commit a Scene. It commits a **`ToolCommit`** — a description of
what the gesture changed (`add` · `replace` · `erase` · `extend-path` /
`close-path`) — which the store **lifts** to one Document transaction at a single
defined step (`#liftCommit`), so its output enters the Document like everything
else. What the lift produces depends on the tool:

- **line · rectangle · point** → a **smart** sketch item (`createSmartPath` /
  `createSmartPointMarker`), with snap-inferred coincidence, so drawn geometry is
  immediately constrainable.
- **pen · arc · label** → **`BakedItem`s** appended.
- **eraser** → `deleteWhiteboardItems`; **select** move/resize/rotate/vertex →
  the changed baked elements replaced in place by id.

Previews are the only transient Scenes, and they are render-only (never stored,
never history).

---

## 4. The seam we removed

Historically Pipeline A wrote to the `Scene` and a reconciliation step folded
that back into the Document so freehand and smart items could coexist
(`reconcileResolvedScene`, `#smartToolCommit`, `replaceBakedDocumentScene`). That
Scene → Document merge was the single most fragile part of the feature and the
reason mixed baked/smart edits were error-prone: it rebuilt the whole item list
from a Scene and had to re-derive which smart items survived, throwing when a
smart item appeared to have drifted.

It **no longer exists** — those functions are deleted. Tools describe their
commit as a `ToolCommit` delta and the store lifts it to a targeted transaction,
so there is nothing to reconcile and an unchanged smart item is never even read.
Any code that reads a Scene, mutates it, and writes it back into the Document is
a regression toward the old model.

---

## 5. Orchestration: the store is a wiring layer

`WhiteboardStore` exists to bridge the pure core to Svelte reactivity and the
view — nothing more. Logic lives in the core; the store *wires* it. It carves
into these collaborators (each framework-neutral where possible), so no single
concern owns the whole file:

| Collaborator | Owns |
|---|---|
| **InteractionController** | pointer → pipeline routing and the two-pipeline boundary (§3) |
| **SelectionModel** | item selection, feature selection, marquee |
| **DocumentController** | apply transactions · undo/redo · projection cache |
| **ConstraintService** | relations, dimensions, solver invocation |
| **StyleModel** | pen/tool defaults · inspector properties · property edits |
| **PersistenceIO** | `toAsy` / `loadAsy` / local persistence |

The store itself only holds `$state`/`$derived`, forwards view events to the
right collaborator, and exposes derived read models (glyphs, inspector title).

---

## 6. Glossary

- **Document** — `WhiteboardDocument`, the editable aggregate root. §2.1
- **Scene / IR** — flattened `SceneElement[]`, a read-only projection. §2.2
- **Baked item** — a `SceneElement` with no parametric intent, wrapped as a Document item.
- **Smart item** — a Document item that references the sketch graph.
- **Sketch graph** — points/params/curves/constraints; the parametric substrate.
- **Resolve** — `Document → Scene` projection (`resolveWhiteboardDocument`).
- **Solve** — update sketch point positions to satisfy constraints (the solver).
- **Transaction** — a pure `Document → Document` operation; one undo step.
- **Pipeline A / B** — the Tool and smart-gesture input paths. §3.
- **Codec** — `Scene ⇄ Asymptote text`.

---

## 7. Related docs

- [`INVARIANTS.md`](./INVARIANTS.md) — hard rules, seam contracts, and the
  "which layer does X live in" routing table for implementers/agents.
- `src/lib/asy/scene/types.ts` — Scene IR definition (authoritative, with a
  coordinate-space header).
- `docs/whiteboard-solver-spike.md` — the solver's Phase 0 decision record.
- `src/lib/components/whiteboard/DOCS.md` — the view components' public API.
