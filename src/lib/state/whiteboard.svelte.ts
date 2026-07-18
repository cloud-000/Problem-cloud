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
import { emptyScene } from "$lib/asy/scene";
import { parse, serialize } from "$lib/asy/codec";
import {
    createTool,
    type Tool,
    type ToolContext,
    type ToolKind,
    type ToolResult,
} from "$lib/asy/engine";
import { History } from "$lib/asy/engine";

function snapshot(scene: Scene): Scene {
    return $state.snapshot(scene) as Scene;
}

export class WhiteboardStore {
    scene = $state<Scene>(emptyScene());
    toolKind = $state<ToolKind>("select");
    pen = $state<Pen>({ namedColor: "black", lineWidth: 1 });
    selection = $state<string[]>([]);
    /** Transient render override during a drag (rubber-band / live move). */
    preview = $state<Scene | null>(null);
    canUndo = $state(false);
    canRedo = $state(false);

    /** Hit-test / commit tolerance in asy-space; the view keeps this in sync
     *  with its current px->asy scale. */
    tolerance = 0.5;
    /** RDP tolerance for freehand simplification, in asy-space. */
    simplifyEpsilon = 0.1;
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

    setTool(kind: ToolKind): void {
        this.#tool.onCancel();
        this.preview = null;
        this.toolKind = kind;
        this.#tool = createTool(kind);
    }

    // --- pointer plumbing (the view maps screen->asy before calling these) ----

    pointerDown(p: readonly [number, number]): void {
        this.#dispatch(this.#tool.onPointerDown(this.scene, p, this.#ctx()));
    }
    pointerMove(p: readonly [number, number]): void {
        this.#dispatch(this.#tool.onPointerMove(this.scene, p, this.#ctx()));
    }
    pointerUp(p: readonly [number, number]): void {
        this.#dispatch(this.#tool.onPointerUp(this.scene, p, this.#ctx()));
    }
    cancel(): void {
        this.#dispatch(this.#tool.onCancel());
    }

    #ctx(): ToolContext {
        return {
            pen: $state.snapshot(this.pen) as Pen,
            tolerance: this.tolerance,
            simplifyEpsilon: this.simplifyEpsilon,
            promptLabel: this.promptLabel,
        };
    }

    #dispatch(result: ToolResult): void {
        if (result.selection !== undefined) this.selection = result.selection;
        if (result.commit !== undefined) {
            this.apply(result.commit);
            this.preview = null;
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
        }
        this.#syncFlags();
    }

    redo(): void {
        const next = this.#history.redo(snapshot(this.scene));
        if (next) {
            this.scene = next;
            this.selection = [];
            this.preview = null;
        }
        this.#syncFlags();
    }

    #syncFlags(): void {
        this.canUndo = this.#history.canUndo;
        this.canRedo = this.#history.canRedo;
    }

    // --- editing convenience --------------------------------------------------

    deleteSelected(): void {
        if (this.selection.length === 0) return;
        const remove = new Set(this.selection);
        this.apply({ ...this.scene, elements: this.scene.elements.filter((e) => !remove.has(e.id)) });
        this.selection = [];
    }

    clearAll(): void {
        this.apply(emptyScene());
        this.selection = [];
    }

    // --- asy codec ------------------------------------------------------------

    toAsy(): string {
        return serialize(snapshot(this.scene));
    }

    /** Replace the scene with the result of parsing asy (undoable). */
    loadAsy(asy: string): void {
        this.apply(parse(asy).scene);
        this.selection = [];
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
