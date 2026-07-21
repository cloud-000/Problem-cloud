import type { Pair, Scene } from "../../scene/types";
import { createPath, makePath } from "../../scene/factory";
import { distance } from "../geometry";
import { addElement, NO_RESULT, pointerPoint, type PointerInput, type Tool, type ToolContext, type ToolResult } from "./types";

/** Straight segment via click-click or press-drag-release. */
export class LineTool implements Tool {
    readonly kind = "line" as const;
    private start: Pair | null = null;

    onPointerDown(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        if (this.start) {
            if (distance(this.start, p) < ctx.tolerance) return { preview: scene };
            const start = this.start;
            this.start = null;
            return this.commitSegment(scene, start, p, ctx);
        }
        this.start = p;
        return { preview: scene };
    }

    onPointerMove(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        if (!this.start) return NO_RESULT;
        return { preview: addElement(scene, createPath(makePath([this.start, p]), ctx.pen)) };
    }

    onPointerUp(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        if (!this.start) return NO_RESULT;
        const start = this.start;
        if (distance(start, p) < ctx.tolerance) return { preview: scene };
        this.start = null;
        return this.commitSegment(scene, start, p, ctx);
    }

    private commitSegment(_scene: Scene, start: Pair, end: Pair, ctx: ToolContext): ToolResult {
        const path = createPath(makePath([start, end]), ctx.pen);
        return {
            commit: { kind: "add", elements: [path] },
            selection: [path.id],
            preview: null,
            nextTool: "select",
            lineContinuation: { elementId: path.id, nodeIndex: 1 },
        };
    }

    onCancel(): ToolResult {
        this.start = null;
        return { preview: null };
    }
}
