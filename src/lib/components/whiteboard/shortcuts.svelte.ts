import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
import type { PointerInputController } from "./pointer-input.svelte";
import type { VertexRef } from "./overlay-model";

/**
 * The canvas that most recently took a pointer. Module-level on purpose: with
 * several boards mounted, only the last-touched one answers keyboard shortcuts.
 */
let activeShortcutSurface: HTMLCanvasElement | null = null;

/**
 * What the shortcut controller needs from `whiteboard.svelte`: the collaborators
 * a shortcut acts on, plus the component state that decides whether this canvas
 * is listening at all.
 */
export interface ShortcutHost {
    get store(): WhiteboardStore;
    get pointer(): PointerInputController;
    get surface(): HTMLCanvasElement | null;
    /** Whether viewport gestures (space-to-pan) are enabled. */
    get navigation(): boolean;
    /** Answer shortcuts without requiring a prior pointer interaction. */
    get shortcutsAlwaysActive(): boolean;
    /** The vertex whose handle survives the current selection, if any. */
    get activeSelectedVertex(): VertexRef | null;
}

/**
 * Window-level keyboard handling for the whiteboard canvas: which surface owns
 * shortcuts, the held-space pan modifier, and the editing keys (Escape, select
 * all, delete, undo/redo).
 *
 * It holds no model logic — every key maps to a store or pointer-controller
 * call.
 */
export class KeyboardShortcutController {
    #host: ShortcutHost;

    #spacePressed = $state(false);

    constructor(host: ShortcutHost) {
        this.#host = host;
    }

    /** Whether space is held, which turns any tool into a temporary pan. */
    get spacePressed(): boolean {
        return this.#spacePressed;
    }

    /** This canvas just took the pointer, so it owns keyboard shortcuts. */
    claimSurface(): void {
        activeShortcutSurface = this.#host.surface;
    }

    /** Give up shortcut ownership when the claiming canvas goes away. */
    releaseSurface(node: HTMLCanvasElement): void {
        if (activeShortcutSurface === node) activeShortcutSurface = null;
    }

    keyDown(e: KeyboardEvent): void {
        const { store, pointer } = this.#host;
        const target = e.target;
        if (
            (!this.#host.shortcutsAlwaysActive && activeShortcutSurface !== this.#host.surface) ||
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            (target instanceof HTMLElement && target.isContentEditable)
        ) return;

        if (this.#host.navigation && e.key === " ") {
            e.preventDefault();
            this.#spacePressed = true;
        } else if (e.key === "Escape") {
            pointer.cancelPenBatch();
            store.cancel();
            pointer.clearHandleSelection();
            pointer.abortGesture();
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
            e.preventDefault();
            pointer.cancelPenBatch();
            store.cancel();
            pointer.clearHandleSelection();
            store.selectAll();
        } else if (e.key === "Delete" || e.key === "Backspace") {
            const activeSelectedVertex = this.#host.activeSelectedVertex;
            if (activeSelectedVertex) {
                e.preventDefault();
                store.deletePathVertex(
                    activeSelectedVertex.elementId,
                    activeSelectedVertex.nodeIndex,
                );
                pointer.clearHandleSelection();
            } else if (store.selectedConstraintId) {
                e.preventDefault();
                store.deleteSelectedConstraint();
            } else if (store.selectedDimensionId) {
                e.preventDefault();
                store.deleteSelected();
            } else if (store.selection.length) {
                e.preventDefault();
                store.deleteSelected();
            }
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (e.shiftKey) store.redo();
            else store.undo();
        }
    }

    keyUp(e: KeyboardEvent): void {
        if (e.key === " ") this.#spacePressed = false;
    }

    /** The window lost focus, so the space key-up will never arrive. */
    blur(): void {
        this.#spacePressed = false;
    }
}
