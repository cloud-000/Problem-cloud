import type { Pair, Scene } from "../../scene/types";
import { elementBounds } from "../../scene/bounds";
import { hitTest } from "../hit-test";
import { translateElement } from "../geometry";
import { mapElements, NO_RESULT, type Tool, type ToolContext, type ToolResult } from "./types";

/**
 * Select + move + marquee. Click an element to select it; drag selected elements
 * to move them. Drag empty space to rubber-band every fully enclosed element.
 * A move is committed once on release so it remains a single undo step.
 */
export class SelectTool implements Tool {
    readonly kind = "select" as const;
    private dragStart: Pair | null = null;
    private movingIds: string[] = [];
    private marqueeStart: Pair | null = null;
    private base: Scene | null = null;
    private moved = false;

    onPointerDown(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        const hit = hitTest(scene, p, ctx.tolerance);
        if (!hit || hit.kind === "raw") {
            this.reset();
            this.marqueeStart = p;
            this.base = scene;
            return { selection: [], selectionPreview: [], marquee: { start: p, end: p } };
        }
        this.dragStart = p;
        this.movingIds = ctx.selection.includes(hit.id) ? [...ctx.selection] : [hit.id];
        this.base = scene;
        this.moved = false;
        return { selection: this.movingIds, selectionPreview: null, preview: scene, marquee: null };
    }

    onPointerMove(_scene: Scene, p: Pair): ToolResult {
        if (this.movingIds.length && this.dragStart && this.base) {
            const dx = p[0] - this.dragStart[0];
            const dy = p[1] - this.dragStart[1];
            if (dx !== 0 || dy !== 0) this.moved = true;
            return { preview: this.translate(this.base, this.movingIds, dx, dy) };
        }
        if (this.marqueeStart && this.base) {
            this.moved = this.moved || p[0] !== this.marqueeStart[0] || p[1] !== this.marqueeStart[1];
            return {
                selectionPreview: this.enclosedIds(this.base, this.marqueeStart, p),
                marquee: { start: this.marqueeStart, end: p },
            };
        }
        return NO_RESULT;
    }

    onPointerUp(_scene: Scene, p: Pair): ToolResult {
        if (this.movingIds.length && this.dragStart && this.base) {
            const dx = p[0] - this.dragStart[0];
            const dy = p[1] - this.dragStart[1];
            const base = this.base;
            const ids = this.movingIds;
            const moved = this.moved;
            this.reset();
            if (!moved) return { preview: null };
            return { commit: this.translate(base, ids, dx, dy), preview: null };
        }
        if (this.marqueeStart && this.base) {
            const start = this.marqueeStart;
            const base = this.base;
            const moved = this.moved;
            this.reset();
            if (!moved) return { selection: [], selectionPreview: null, marquee: null };
            return {
                selection: this.enclosedIds(base, start, p),
                selectionPreview: null,
                marquee: null,
            };
        }
        return NO_RESULT;
    }

    onCancel(): ToolResult {
        this.reset();
        return { preview: null, selectionPreview: null, marquee: null };
    }

    private translate(scene: Scene, ids: string[], dx: number, dy: number): Scene {
        const selected = new Set(ids);
        return mapElements(scene, (el) => selected.has(el.id) ? translateElement(el, dx, dy) : el);
    }

    private enclosedIds(scene: Scene, start: Pair, end: Pair): string[] {
        const minX = Math.min(start[0], end[0]);
        const maxX = Math.max(start[0], end[0]);
        const minY = Math.min(start[1], end[1]);
        const maxY = Math.max(start[1], end[1]);
        return scene.elements.flatMap((element) => {
            const bounds = elementBounds(element);
            return bounds &&
                bounds.min[0] >= minX && bounds.max[0] <= maxX &&
                bounds.min[1] >= minY && bounds.max[1] <= maxY
                ? [element.id]
                : [];
        });
    }

    private reset(): void {
        this.dragStart = null;
        this.movingIds = [];
        this.marqueeStart = null;
        this.base = null;
        this.moved = false;
    }
}
