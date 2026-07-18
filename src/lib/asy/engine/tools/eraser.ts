import type { Pair, Scene } from "../../scene/types";
import { hitTest } from "../hit-test";
import { NO_RESULT, pointerPoint, removeElementById, type PointerInput, type Tool, type ToolContext, type ToolResult } from "./types";

/**
 * Removes elements under the pointer. A press-drag erases everything the cursor
 * passes over; the whole gesture is committed as one edit on release so undo
 * restores all of them at once.
 */
export class EraserTool implements Tool {
    readonly kind = "eraser" as const;
    private erasing = false;
    private working: Scene | null = null;
    private changed = false;

    onPointerDown(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        this.erasing = true;
        this.working = scene;
        this.changed = false;
        return this.eraseAt(p, ctx);
    }

    onPointerMove(_scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        if (!this.erasing) return NO_RESULT;
        return this.eraseAt(p, ctx);
    }

    onPointerUp(): ToolResult {
        if (!this.erasing) return NO_RESULT;
        this.erasing = false;
        const result: ToolResult = this.changed && this.working ? { commit: this.working } : { preview: null };
        this.working = null;
        this.changed = false;
        return result;
    }

    onCancel(): ToolResult {
        this.erasing = false;
        this.working = null;
        this.changed = false;
        return { preview: null };
    }

    private eraseAt(p: Pair, ctx: ToolContext): ToolResult {
        if (!this.working) return NO_RESULT;
        const hit = hitTest(this.working, p, ctx.tolerance);
        if (!hit) return { preview: this.working };
        this.working = removeElementById(this.working, hit.id);
        this.changed = true;
        return { preview: this.working };
    }
}
