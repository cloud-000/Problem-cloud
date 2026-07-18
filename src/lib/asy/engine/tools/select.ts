import type { Pair, Scene } from "../../scene/types";
import { hitTest } from "../hit-test";
import { translateElement } from "../geometry";
import { mapElements, NO_RESULT, type Tool, type ToolContext, type ToolResult } from "./types";

/**
 * Select + move. Click an element to select it; drag to move it. A pure click
 * (no drag) only updates the selection; clicking empty space clears it. The move
 * is committed once on release so it's a single undo step.
 */
export class SelectTool implements Tool {
    readonly kind = "select" as const;
    private dragStart: Pair | null = null;
    private movingId: string | null = null;
    private base: Scene | null = null;
    private moved = false;

    onPointerDown(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        const hit = hitTest(scene, p, ctx.tolerance);
        if (!hit || hit.kind === "raw") {
            this.reset();
            return { selection: [] };
        }
        this.dragStart = p;
        this.movingId = hit.id;
        this.base = scene;
        this.moved = false;
        return { selection: [hit.id], preview: scene };
    }

    onPointerMove(_scene: Scene, p: Pair): ToolResult {
        if (!this.movingId || !this.dragStart || !this.base) return NO_RESULT;
        const dx = p[0] - this.dragStart[0];
        const dy = p[1] - this.dragStart[1];
        if (dx !== 0 || dy !== 0) this.moved = true;
        return { preview: this.translate(this.base, this.movingId, dx, dy) };
    }

    onPointerUp(_scene: Scene, p: Pair): ToolResult {
        if (!this.movingId || !this.dragStart || !this.base) return NO_RESULT;
        const dx = p[0] - this.dragStart[0];
        const dy = p[1] - this.dragStart[1];
        const base = this.base;
        const id = this.movingId;
        const moved = this.moved;
        this.reset();
        if (!moved) return { preview: null };
        return { commit: this.translate(base, id, dx, dy), preview: null };
    }

    onCancel(): ToolResult {
        this.reset();
        return { preview: null };
    }

    private translate(scene: Scene, id: string, dx: number, dy: number): Scene {
        return mapElements(scene, (el) => (el.id === id ? translateElement(el, dx, dy) : el));
    }

    private reset(): void {
        this.dragStart = null;
        this.movingId = null;
        this.base = null;
        this.moved = false;
    }
}
