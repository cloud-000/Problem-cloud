/**
 * DocumentController — the whiteboard's document lifecycle (ARCHITECTURE.md §5).
 *
 * Owns the single source of truth (`WhiteboardDocument`), its snapshot history,
 * and the one-directional projection to a `Scene`. It is the only place that
 * pushes to / pops from history, so "one gesture → one undo step" is enforced
 * here rather than scattered across the store (INVARIANTS §3).
 *
 * Boundary: it holds the document as reactive `$state` and exposes `applyDocument`
 * / `undo` / `redo` / `pushBaseline`; it does **not** know about selection, tools,
 * previews, or any other view state. `undo`/`redo` return the restored document (or
 * `null`) and leave resetting the surrounding view state to the store — this keeps
 * the controller framework-neutral about everything except the document itself.
 *
 * The projection (`scene`) is read-only and derived by
 * `resolveWhiteboardDocument`; nothing here ever folds a Scene back into the
 * Document (the forbidden seam, INVARIANTS §4).
 */

import type { Scene } from "$lib/asy/scene/types";
import { History } from "$lib/asy/engine";
import {
    emptyWhiteboardDocument,
    resolveWhiteboardDocument,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

function snapshot(document: WhiteboardDocument): WhiteboardDocument {
    return $state.snapshot(document) as WhiteboardDocument;
}

export class DocumentController {
    /** The single source of truth; every visible change is a new value here. */
    document = $state<WhiteboardDocument>(emptyWhiteboardDocument());
    canUndo = $state(false);
    canRedo = $state(false);

    #history = new History<WhiteboardDocument>();

    constructor(initial?: WhiteboardDocument) {
        if (initial) this.document = initial;
    }

    /** The read-only Scene projection consumed by render / hit-test / export. */
    get scene(): Scene {
        return resolveWhiteboardDocument(this.document);
    }

    /** Atomic commit of one transaction, pushed as a single undo step. */
    applyDocument(next: WhiteboardDocument): void {
        this.#history.push(snapshot(this.document));
        this.document = next;
        this.#syncFlags();
    }

    /** Record a pre-edit baseline as the undo step for a coalesced edit. */
    pushBaseline(baseline: WhiteboardDocument): void {
        this.#history.push(baseline);
        this.#syncFlags();
    }

    /** Undo, returning the restored document (or `null` if nothing to undo). */
    undo(): WhiteboardDocument | null {
        const prev = this.#history.undo(snapshot(this.document));
        if (prev) this.document = prev;
        this.#syncFlags();
        return prev;
    }

    /** Redo, returning the restored document (or `null` if nothing to redo). */
    redo(): WhiteboardDocument | null {
        const next = this.#history.redo(snapshot(this.document));
        if (next) this.document = next;
        this.#syncFlags();
        return next;
    }

    #syncFlags(): void {
        this.canUndo = this.#history.canUndo;
        this.canRedo = this.#history.canRedo;
    }
}
