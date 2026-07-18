/**
 * Snapshot-based undo/redo. Scenes are small, so full snapshots are cheap and
 * trivially correct (no per-tool bookkeeping). A bounded ring buffer caps memory.
 *
 * Usage: before applying an edit, `push(current)`; then swap in the new scene.
 * `undo(current)` returns the previous snapshot (and stashes `current` for redo).
 */

import type { Scene } from "../scene/types";

export class History<T = Scene> {
    private past: T[] = [];
    private future: T[] = [];
    constructor(private readonly limit = 100) {}

    /** Record a snapshot as the new "current" baseline; clears the redo stack. */
    push(snapshot: T): void {
        this.past.push(snapshot);
        if (this.past.length > this.limit) this.past.shift();
        this.future = [];
    }

    get canUndo(): boolean {
        return this.past.length > 0;
    }

    get canRedo(): boolean {
        return this.future.length > 0;
    }

    /** Return the previous snapshot, moving `current` onto the redo stack. */
    undo(current: T): T | null {
        const prev = this.past.pop();
        if (prev === undefined) return null;
        this.future.push(current);
        return prev;
    }

    /** Return the next redo snapshot, moving `current` back onto the undo stack. */
    redo(current: T): T | null {
        const next = this.future.pop();
        if (next === undefined) return null;
        this.past.push(current);
        return next;
    }

    clear(): void {
        this.past = [];
        this.future = [];
    }
}
