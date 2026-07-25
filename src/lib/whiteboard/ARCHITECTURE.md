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
│  camera.svelte.ts     the only screen ⇄ asy-space conversion (§2.4)         │
│  overlay-model.ts     Scene + camera → OverlayModel (pure TS, `buildOverlay`)│
│  pointer-input.svelte.ts / shortcuts.svelte.ts   DOM events → store calls    │
│  render.ts            Scene + OverlayModel → Canvas                          │
│  whiteboard.svelte · toolbars · cards · constraint-toolbar · export          │
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
  (coincident, horizontal, parallel, distance, angle, point-on-curve, tangent,
  …). Smart items get their
  geometry from here; baked items do not touch it. A **segment** and an **arc**
  are defined entirely by *points* — an arc by its center plus two rim endpoints,
  with radius (`|center − start|`) and both angles **derived** at resolve time —
  so their endpoints are ordinary drag/snap/constraint targets. A **circle**
  still carries a scalar radius, since its rim is not a point.
  Non-uniform resizing promotes circular smart curves to affine `ellipse` /
  `elliptical-arc` curves. Their full `axisX`/`axisY` basis stays in the
  Document, while elliptical-arc center/start/end remain ordinary sketch
  points for snapping and constraints.
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

### 2.4 `OverlayModel` — the screen-space projection

The Scene answers *"what geometry?"*, but the editor also has to draw things that
are **not geometry**: the selection box, resize/rotation/vertex handles, the arc
construction guide, snap proposals, constraint glyphs, and dimension labels.
Those are *presentation geometry* — they exist in **screen space**, at pixel
sizes that must not scale with zoom, and they belong to no document.

The chain is:

```
   WhiteboardDocument ──resolve()──▶ Scene ──project(camera)──▶ OverlayModel ──▶ Canvas
        (truth)                    (projection)                (presentation)
```

Three rules make this a boundary rather than a habit:

- **`Camera` is the sole screen ⇄ asy boundary.** `camera.svelte.ts` owns pan,
  zoom, pinch, and every pixel↔unit conversion (`project`, `toAsy`,
  `toAsyLength`, `toScreenLength`). Nothing else multiplies or divides by
  `scale`. Everything below the view is asy-space (y-up); the Camera is where
  that stops being true.
- **The OverlayModel is pure.** `overlay-model.ts` is plain TypeScript with no
  Svelte and no DOM: `buildOverlay(input)` takes the projected Scene, the store's
  read models, and the Camera's `project` / `toScreenLength` as **injected
  functions**, and returns a plain value. Even text measurement — the one real
  DOM capability it needs — is injected as `measureLabelWidth`, with a pure
  fallback (`estimateLabelWidth`). That is what makes it unit-testable and why
  overlay geometry is never derived inline in a component.
- **Overlays are one-way and terminal.** They read the Document (through the
  Scene and the store's derived read models) and are consumed only by the canvas
  and by DOM hit-testing. An overlay never appears in the Document, in the
  Scene, or in any export — `export.ts` renders the projected Scene alone, so
  asy / SVG / PNG output carries no handle, glyph, guide, or dimension chrome.

`OverlayModel` is to the view what `Scene` is to the core: a derived, read-only
projection, one step further down.

---

## 3. Interaction: two pipelines, one write target

Input handling keeps **two pipelines** — they are genuinely different mechanics —
but they converge on a single write target (the Document) and a single commit
rule. The boundary between them is a documented contract, not an accident.

| | **Pipeline A — Tools** | **Pipeline B — Smart gestures** |
|---|---|---|
| Handles | creation & freehand: pen, line, rectangle, arc, point, label, eraser, marquee | constraint-driven edits: drag a smart feature, translate / rotate / affine-resize a smart selection |
| Contract | `Tool` state machine (`asy/engine/tools`) — `onPointerDown/Move/Up` return a `ToolResult` | `operations.ts` transactions + the `solver` |
| Reads | the projected `Scene` (for hit-testing & rubber-band preview) | the Document's `SketchGraph` |
| Writes on commit | **a `ToolCommit` delta, lifted to one Document transaction** | Document (points/params updated by the solver) |

### 3.1 Ownership — who gets the gesture

Decided once, on **pointer-down**, by a hit-test:

- pointer hits a **smart feature** (a sketch point, a curve, an ellipse axis, or a
  **smart arc's center/start/end handle**) → **Pipeline B**.
- pointer hits **empty space, a baked element, or a creation tool is active** → **Pipeline A**.

A *baked* arc's handles still go to Pipeline A (the select tool edits its
`center`/`radius`/angles as raw geometry); only a **smart** arc's handles resolve
to sketch points and take Pipeline B (`arcControlFeature`).

This is the *only* branch. There is no third path and no mid-gesture pipeline
switch.

### 3.2 Commit — the single rule

> Every gesture, in either pipeline, ends as **exactly one `Document`
> transaction**, pushed to history as one undo step. The Scene is re-projected
> afterward. **No pipeline ever writes the Scene.**

A Tool does not commit a Scene. It commits a **`ToolCommit`** — a description of
what the gesture changed (`add` · `replace` · `erase` · `extend-path` /
`close-path`) — which is **lifted** to one Document transaction at a single
defined step (`liftCommit`, in `whiteboard/commit-lift.ts`), so its output enters
the Document like everything else. What the lift produces depends on the tool:

- **line · rectangle · point · arc** → a **smart** sketch item (`createSmartPath` /
  `createSmartPointMarker` / `createSmartArc`), with snap-inferred coincidence, so
  drawn geometry is immediately constrainable. The rectangle additionally ships
  with three `perpendicular` constraints (`addDefaultRectangleConstraints`) — its
  defining right angles — so it stays rectangular under rotate/resize.
- **pen · label** → **`BakedItem`s** appended. Arc-tool output is always smart,
  including a full circle: its distinct start/end point identities share an
  inferred coincidence while closed, which can be pulled apart to reopen it.
  Imported raw arcs remain baked.
- **eraser** → `deleteWhiteboardItems`; **select** move/resize/rotate/vertex →
  the changed baked elements replaced in place by id.

Resize corners are freeform by default and Shift locks the pointer-down aspect
ratio; edge handles resize one axis. A single rotated smart rectangle uses its
own edge frame, while aggregate selections use canvas axes. The solver remains
authoritative: incompatible driving constraints reject the commit, and a
radial constraint prevents promotion to an ellipse.

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
| **InteractionController** (`interaction.svelte.ts`) | the pointer-down ownership branch and the two-pipeline boundary (§3.1); holds the active gesture and drives Pipeline A's `Tool` |
| **SmartGestureController** (`smart-gestures.svelte.ts`) | Pipeline B mechanics — smart-feature drag, translate / rotate / resize: preview solves during the drag, one commit solve on release |
| **commit lift** (`commit-lift.ts`) | the single, pure `ToolCommit → Document` step (`liftCommit`) plus snap inference; the only place a tool commit becomes a mutation (§3.2) |
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
- **Camera** — the view's viewport: pan/zoom state and the *only* screen ⇄
  asy-space conversion. §2.4
- **Overlay model** — `buildOverlay(...)`, the pure screen-space projection of
  the Scene plus editor affordances; never exported, never in the Document. §2.4
- **Presentation geometry** — pixel-space chrome (handles, glyphs, guides,
  dimension labels) that belongs to the overlay, not to any document. §2.4
- **Lift** — `liftCommit`, turning a tool's `ToolCommit` delta into exactly one
  Document transaction. §3.2

---

## 7. Related docs

- [`INVARIANTS.md`](./INVARIANTS.md) — hard rules, seam contracts, and the
  "which layer does X live in" routing table for implementers/agents.
- `src/lib/asy/scene/types.ts` — Scene IR definition (authoritative, with a
  coordinate-space header).
- `docs/whiteboard-solver-spike.md` — the solver's Phase 0 decision record.
- `src/lib/components/whiteboard/DOCS.md` — the view components' public API.
