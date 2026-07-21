import type { Pair, Scene } from "../../scene/types";
import { createPath, makePath } from "../../scene/factory";
import { addElement, NO_RESULT, pointerPoint, type PointerInput, type Tool, type ToolContext, type ToolResult } from "./types";

/** Axis-aligned rectangle via press-drag-release. */
export class RectangleTool implements Tool {
    readonly kind = "rectangle" as const;
    private start: Pair | null = null;

    onPointerDown(scene: Scene, input: PointerInput): ToolResult {
        this.start = pointerPoint(input);
        return { preview: scene };
    }

    onPointerMove(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        if (!this.start) return NO_RESULT;
        return { preview: addElement(scene, this.createRectangle(this.start, p, ctx)) };
    }

    onPointerUp(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        if (!this.start) return NO_RESULT;
        const start = this.start;
        this.start = null;
        if (
            Math.abs(p[0] - start[0]) < ctx.tolerance ||
            Math.abs(p[1] - start[1]) < ctx.tolerance
        ) {
            return { preview: null };
        }
        const rectangle = this.createRectangle(start, p, ctx);
        return {
            commit: { kind: "add", elements: [rectangle] },
            selection: [rectangle.id],
            nextTool: "select",
            preview: null,
        };
    }

    onCancel(): ToolResult {
        this.start = null;
        return { preview: null };
    }

    private createRectangle(start: Pair, end: Pair, ctx: ToolContext) {
        return createPath(
            makePath(
                [start, [end[0], start[1]], end, [start[0], end[1]]],
                { cyclic: true },
            ),
            ctx.pen,
            ctx.fillPen,
        );
    }
}
