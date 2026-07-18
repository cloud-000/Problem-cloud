/**
 * Per-instance whiteboard store (like `LibraryStore`, not a global singleton):
 * a whiteboard is a scoped document editor and there may be more than one open
 * at once (e.g. a scratch overlay plus a "trace this diagram" board).
 *
 * It bridges the three pure-TS layers to the Svelte view:
 *   - scene / selection / tool / pen are reactive `$state`
 *   - edits flow through the engine tools and are recorded in snapshot history
 *   - `toAsy` / `loadAsy` use the codec; `persist` / `restore` use localStorage
 *
 * SSR caveat (per repo conventions): never mutate at module load; all
 * localStorage access is `browser`-guarded.
 */

import { browser } from "$app/environment";
import type { Pen, Scene } from "$lib/asy/scene/types";
import { emptyScene, isStraightPathVertexEditable } from "$lib/asy/scene";
import { parse, serialize } from "$lib/asy/codec";
import {
    createTool,
    type Tool,
    type ToolContext,
    type ToolKind,
    type ToolResult,
    type SelectionTransformGesture,
    type LineContinuation,
    DEFAULT_STROKE_PROCESSING_OPTIONS,
    type StrokeProcessingOptions,
} from "$lib/asy/engine";
import { History } from "$lib/asy/engine";

function snapshot(scene: Scene): Scene {
    return $state.snapshot(scene) as Scene;
}

export type WhiteboardToolKind = ToolKind | "pan";

export class WhiteboardStore {
    scene = $state<Scene>(emptyScene());
    toolKind = $state<WhiteboardToolKind>("select");
    pen = $state<Pen>({ namedColor: "black", lineWidth: 1 });
    selection = $state<string[]>([]);
    /** Candidate selection while a marquee drag is in progress. */
    selectionPreview = $state<string[] | null>(null);
    /** Transient render override during a drag (rubber-band / live move). */
    preview = $state<Scene | null>(null);
    marquee = $state<{ start: readonly [number, number]; end: readonly [number, number] } | null>(null);
    /** Active path continuation offered immediately after a line is drawn. */
    lineContinuation = $state<LineContinuation | null>(null);
    canUndo = $state(false);
    canRedo = $state(false);

    /** Hit-test / commit tolerance in asy-space; the view keeps this in sync
     *  with its current px->asy scale. */
    tolerance = 0.5;
    /** Pen travel that still counts as a tap; the view derives it from 2 CSS px. */
    penTapTolerance = 0.05;
    /** Freehand cleanup controls. The view keeps distance values in sync with
     *  its current px->scene scale; scalar values remain framework defaults. */
    strokeProcessing: StrokeProcessingOptions = { ...DEFAULT_STROKE_PROCESSING_OPTIONS };
    /** Supplied by the view so the label tool can prompt for text. */
    promptLabel?: (at: readonly [number, number]) => string | null;

    #history = new History<Scene>();
    #tool: Tool = createTool("select");

    constructor(initial?: Scene) {
        if (initial) this.scene = initial;
    }

    /** The scene the view should render (preview wins while dragging). */
    get displayScene(): Scene {
        return this.preview ?? this.scene;
    }

    setTool(kind: WhiteboardToolKind): void {
        this.#tool.onCancel();
        this.preview = null;
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.toolKind = kind;
        if (kind !== "pan") this.#tool = createTool(kind);
    }

    // --- pointer plumbing (the view maps screen->asy before calling these) ----

    pointerDown(p: readonly [number, number], selectionTransform?: SelectionTransformGesture): void {
        this.#dispatch(this.#tool.onPointerDown(this.scene, p, this.#ctx({ selectionTransform })));
    }
    pointerMove(p: readonly [number, number], snapRotation = false): void {
        this.#dispatch(this.#tool.onPointerMove(this.scene, p, this.#ctx({ snapRotation })));
    }
    pointerMoves(points: readonly (readonly [number, number])[], snapRotation = false): void {
        if (points.length === 0) return;
        const ctx = this.#ctx({ snapRotation });
        const result = this.#tool.onPointerMoves
            ? this.#tool.onPointerMoves(this.scene, points, ctx)
            : this.#tool.onPointerMove(this.scene, points[points.length - 1], ctx);
        this.#dispatch(result);
    }
    pointerUp(
        p: readonly [number, number],
        snapRotation = false,
        pendingMoves: readonly (readonly [number, number])[] = [],
    ): void {
        this.#dispatch(this.#tool.onPointerUp(
            this.scene,
            p,
            this.#ctx({ snapRotation }),
            pendingMoves,
        ));
    }
    cancel(): void {
        this.#dispatch(this.#tool.onCancel());
    }

    #ctx(overrides: Pick<ToolContext, "selectionTransform" | "snapRotation"> = {}): ToolContext {
        return {
            pen: $state.snapshot(this.pen) as Pen,
            tolerance: this.tolerance,
            penTapTolerance: this.penTapTolerance,
            strokeProcessing: { ...this.strokeProcessing },
            selection: $state.snapshot(this.selection) as string[],
            lineContinuation: this.lineContinuation
                ? ($state.snapshot(this.lineContinuation) as LineContinuation)
                : null,
            promptLabel: this.promptLabel,
            ...overrides,
        };
    }

    #dispatch(result: ToolResult): void {
        if (result.consoleMessage) console.info(result.consoleMessage);
        if (result.selection !== undefined) this.selection = result.selection;
        if (result.selectionPreview !== undefined) this.selectionPreview = result.selectionPreview;
        if (result.marquee !== undefined) this.marquee = result.marquee;
        if (result.lineContinuation !== undefined) {
            this.lineContinuation = result.lineContinuation;
        }
        if (result.commit !== undefined) {
            this.apply(result.commit);
            this.preview = null;
            this.selectionPreview = null;
            this.marquee = null;
            if (result.nextTool) {
                const continuation = result.lineContinuation;
                this.setTool(result.nextTool);
                if (continuation !== undefined) this.lineContinuation = continuation;
            }
        } else if (result.preview !== undefined) {
            this.preview = result.preview;
        }
    }

    // --- history --------------------------------------------------------------

    /** Replace the scene, recording the prior state for undo. */
    apply(next: Scene): void {
        this.#history.push(snapshot(this.scene));
        this.scene = next;
        this.#syncFlags();
    }

    undo(): void {
        const prev = this.#history.undo(snapshot(this.scene));
        if (prev) {
            this.scene = prev;
            this.selection = [];
            this.preview = null;
            this.selectionPreview = null;
            this.lineContinuation = null;
        }
        this.#syncFlags();
    }

    redo(): void {
        const next = this.#history.redo(snapshot(this.scene));
        if (next) {
            this.scene = next;
            this.selection = [];
            this.preview = null;
            this.selectionPreview = null;
            this.lineContinuation = null;
        }
        this.#syncFlags();
    }

    #syncFlags(): void {
        this.canUndo = this.#history.canUndo;
        this.canRedo = this.#history.canRedo;
    }

    // --- editing convenience --------------------------------------------------

    deletePathVertex(elementId: string, nodeIndex: number): void {
        const element = this.scene.elements.find(({ id }) => id === elementId);
        if (
            element?.kind !== "path" ||
            !isStraightPathVertexEditable(element.path) ||
            nodeIndex < 0 ||
            nodeIndex >= element.path.nodes.length
        ) return;

        const nodes = element.path.nodes.filter((_, index) => index !== nodeIndex);
        if (nodes.length < 2) {
            this.apply({
                ...this.scene,
                elements: this.scene.elements.filter(({ id }) => id !== elementId),
            });
            this.selection = this.selection.filter((id) => id !== elementId);
        } else {
            const cyclic = element.path.cyclic && nodes.length >= 3;
            const joinCount = cyclic ? nodes.length : nodes.length - 1;
            this.apply({
                ...this.scene,
                elements: this.scene.elements.map((candidate) =>
                    candidate.id === elementId && candidate.kind === "path"
                        ? {
                              ...candidate,
                              path: {
                                  ...candidate.path,
                                  nodes,
                                  joins: Array.from({ length: joinCount }, () => "--" as const),
                                  cyclic,
                              },
                          }
                        : candidate,
                ),
            });
        }
        this.preview = null;
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
    }

    deleteSelected(): void {
        if (this.selection.length === 0) return;
        this.apply({
            ...this.scene,
            elements: this.scene.elements.filter((element) => !this.selection.includes(element.id)),
        });
        this.selection = [];
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
    }

    clearAll(): void {
        this.apply(emptyScene());
        this.selection = [];
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
    }

    // --- asy codec ------------------------------------------------------------

    toAsy(): string {
        return serialize(snapshot(this.scene));
    }

    /** Replace the scene with the result of parsing asy (undoable). */
    loadAsy(asy: string): void {
        this.apply(parse(asy).scene);
        this.selection = [];
        this.selectionPreview = null;
        this.lineContinuation = null;
    }

    static fromAsy(asy: string): WhiteboardStore {
        return new WhiteboardStore(parse(asy).scene);
    }

    // --- persistence (localStorage, browser-only) -----------------------------

    persist(key: string): void {
        if (!browser) return;
        try {
            localStorage.setItem(key, JSON.stringify(snapshot(this.scene)));
        } catch {
            // best-effort; a full/blocked store must not break editing
        }
    }

    static restore(key: string): Scene | null {
        if (!browser) return null;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as Scene;
            if (!parsed || !Array.isArray(parsed.elements)) return null;
            return parsed;
        } catch {
            return null;
        }
    }
}
